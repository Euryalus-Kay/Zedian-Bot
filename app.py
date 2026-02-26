"""Viral Reddit Story Bot - Flask Application."""

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS

from config import Config
from core.reddit_scraper import RedditScraper
from core.story_ranker import StoryRanker
from core.tts_engine import TTSEngine, VOICE_OPTIONS
from core.caption_gen import CaptionGenerator
from core.video_editor import VideoEditor
from core.bg_video import BackgroundVideoManager, BG_VIDEO_TYPES
from core.youtube_uploader import YouTubeUploader

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Flask app
app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["SECRET_KEY"] = Config.SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500MB max upload
CORS(app)

# Core services
scraper = RedditScraper()
ranker = StoryRanker()
tts = TTSEngine()
caption_gen = CaptionGenerator()
editor = VideoEditor()
bg_manager = BackgroundVideoManager()
yt_uploader = YouTubeUploader()

# Job tracking
jobs: dict[str, dict] = {}

# Ensure directories exist
os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
os.makedirs(Config.DATA_DIR, exist_ok=True)
os.makedirs(Config.BG_VIDEOS_DIR, exist_ok=True)


# ─── Static / SPA ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


# ─── Reddit Scraping ─────────────────────────────────────────────────────────

@app.route("/api/scrape", methods=["POST"])
def scrape_stories():
    """Scrape Reddit for viral stories."""
    data = request.get_json(silent=True) or {}
    sort = data.get("sort", "top")
    time_filter = data.get("time_filter", "week")
    limit = min(data.get("limit", 15), 50)
    subreddits = data.get("subreddits", None)

    if subreddits:
        all_stories = []
        for sub in subreddits:
            stories = scraper.scrape_subreddit(sub, sort=sort,
                                               time_filter=time_filter, limit=limit)
            all_stories.extend(stories)
        all_stories.sort(key=lambda s: s["score"], reverse=True)
    else:
        all_stories = scraper.scrape_all(sort=sort, time_filter=time_filter,
                                         limit=limit)

    return jsonify({"status": "ok", "count": len(all_stories), "stories": all_stories})


@app.route("/api/stories/cached")
def cached_stories():
    """Get previously scraped stories from cache."""
    stories = scraper.load_cache()
    return jsonify({"status": "ok", "count": len(stories), "stories": stories})


@app.route("/api/stories/generate", methods=["POST"])
def generate_ai_stories():
    """Generate original viral stories with Claude (no Reddit needed)."""
    data = request.get_json(silent=True) or {}
    count = min(data.get("count", 5), 10)
    style = data.get("style", "mixed")

    stories = ranker.generate_ai_stories(count=count, style=style)

    if stories:
        return jsonify({"status": "ok", "count": len(stories), "stories": stories})
    return jsonify({
        "status": "error",
        "message": "Story generation failed. Check your Claude API key.",
    }), 500


@app.route("/api/stories/rank", methods=["POST"])
def rank_stories():
    """Rank stories by viral potential using AI."""
    data = request.get_json(silent=True) or {}
    stories = data.get("stories", [])
    top_n = min(data.get("top_n", 10), 25)

    if not stories:
        stories = scraper.load_cache()

    ranked = ranker.rank_stories(stories, top_n=top_n)
    return jsonify({"status": "ok", "count": len(ranked), "stories": ranked})


@app.route("/api/stories/script", methods=["POST"])
def generate_script():
    """Generate a narration script for a story."""
    story = request.get_json(silent=True)
    if not story:
        return jsonify({"status": "error", "message": "No story provided."}), 400

    script_data = ranker.generate_script(story)
    return jsonify({"status": "ok", "script": script_data})


# ─── Subreddits ──────────────────────────────────────────────────────────────

@app.route("/api/subreddits")
def get_subreddits():
    """Get the list of configured subreddits."""
    return jsonify({"subreddits": Config.STORY_SUBREDDITS})


# ─── TTS ─────────────────────────────────────────────────────────────────────

@app.route("/api/tts/voices")
def get_voices():
    """Get available TTS voices."""
    return jsonify({"voices": VOICE_OPTIONS})


@app.route("/api/tts/generate", methods=["POST"])
def generate_tts():
    """Generate TTS audio from text."""
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")
    voice = data.get("voice", None)
    filename = data.get("filename", None)

    if not text:
        return jsonify({"status": "error", "message": "No text provided."}), 400

    if voice:
        tts.set_voice(voice)

    result = tts.generate(text, filename=filename)
    return jsonify({"status": "ok", **result})


# ─── Background Videos ───────────────────────────────────────────────────────

@app.route("/api/backgrounds")
def list_backgrounds():
    """List available background videos."""
    videos = bg_manager.list_backgrounds()
    return jsonify({"status": "ok", "backgrounds": videos, "types": BG_VIDEO_TYPES})


@app.route("/api/backgrounds/download", methods=["POST"])
def download_background():
    """Download a background video."""
    data = request.get_json(silent=True) or {}
    video_type = data.get("type", "minecraft_parkour")
    url = data.get("url", None)

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"status": "processing", "type": "bg_download", "progress": 0}

    def do_download():
        try:
            path = bg_manager.download_background(video_type=video_type, url=url)
            if path:
                jobs[job_id] = {"status": "complete", "path": path}
            else:
                jobs[job_id] = {"status": "error", "message": "Download failed."}
        except Exception as e:
            jobs[job_id] = {"status": "error", "message": str(e)}

    threading.Thread(target=do_download, daemon=True).start()
    return jsonify({"status": "ok", "job_id": job_id})


@app.route("/api/backgrounds/<filename>", methods=["DELETE"])
def delete_background(filename):
    """Delete a background video."""
    success = bg_manager.delete_background(filename)
    return jsonify({"status": "ok" if success else "error"})


# ─── Video Generation ────────────────────────────────────────────────────────

@app.route("/api/generate", methods=["POST"])
def generate_video():
    """Full pipeline: story -> script -> TTS -> captions -> video.

    Runs in a background thread and returns a job ID.
    """
    data = request.get_json(silent=True) or {}

    story = data.get("story")
    script_text = data.get("script")
    voice = data.get("voice")
    bg_type = data.get("background_type", "minecraft_parkour")
    bg_file = data.get("background_file")

    if not story and not script_text:
        return jsonify({"status": "error", "message": "Provide a story or script."}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "status": "processing",
        "type": "video_generation",
        "progress": 0,
        "step": "Starting...",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    def do_generate():
        try:
            # Step 1: Generate script if not provided
            jobs[job_id]["step"] = "Generating script..."
            jobs[job_id]["progress"] = 10
            if not script_text and story:
                script_data = ranker.generate_script(story)
                narration = script_data["script"]
                title = script_data["title"]
                description = script_data["description"]
                tags = script_data["tags"]
            else:
                narration = script_text
                title = data.get("title", "Reddit Story #storytime")
                description = data.get("description", "")
                tags = data.get("tags", ["reddit", "storytime", "viral"])

            # Step 2: Generate TTS audio
            jobs[job_id]["step"] = "Generating voice narration..."
            jobs[job_id]["progress"] = 30
            if voice:
                tts.set_voice(voice)
            tts_result = tts.generate(narration, filename=f"narration_{job_id}")

            # Step 3: Generate captions from TTS timestamps
            jobs[job_id]["step"] = "Creating captions..."
            jobs[job_id]["progress"] = 50
            captions = caption_gen.generate_from_tts_timestamps(
                tts_result["word_timestamps"]
            )

            # Step 4: Get background video
            jobs[job_id]["step"] = "Preparing background video..."
            jobs[job_id]["progress"] = 60
            if bg_file:
                bg_path = os.path.join(Config.BG_VIDEOS_DIR, bg_file)
            else:
                bg_path = bg_manager.get_random_background(bg_type)

            if not bg_path or not os.path.exists(bg_path):
                jobs[job_id] = {
                    "status": "error",
                    "message": "No background video available. Please download one first.",
                }
                return

            # Step 5: Create video
            jobs[job_id]["step"] = "Editing video..."
            jobs[job_id]["progress"] = 70
            output_name = f"viral_{job_id}"
            video_result = editor.create_video(
                audio_path=tts_result["audio_path"],
                background_path=bg_path,
                captions=captions,
                output_name=output_name,
            )

            # Step 6: Generate thumbnail
            jobs[job_id]["step"] = "Creating thumbnail..."
            jobs[job_id]["progress"] = 90
            thumb_path = editor.create_thumbnail(video_result["video"])

            jobs[job_id] = {
                "status": "complete",
                "progress": 100,
                "step": "Done!",
                "result": {
                    **video_result,
                    "thumbnail": thumb_path,
                    "title": title,
                    "description": description,
                    "tags": tags,
                    "script": narration,
                },
            }
            logger.info("Video generation complete: %s", job_id)

        except Exception as e:
            logger.error("Video generation failed: %s", e)
            jobs[job_id] = {"status": "error", "message": str(e)}

    threading.Thread(target=do_generate, daemon=True).start()
    return jsonify({"status": "ok", "job_id": job_id})


@app.route("/api/jobs/<job_id>")
def get_job_status(job_id):
    """Get the status of a background job."""
    job = jobs.get(job_id)
    if not job:
        return jsonify({"status": "error", "message": "Job not found."}), 404
    return jsonify(job)


# ─── Output Files ─────────────────────────────────────────────────────────────

@app.route("/api/output")
def list_outputs():
    """List all generated output files."""
    files = []
    for f in os.listdir(Config.OUTPUT_DIR):
        filepath = os.path.join(Config.OUTPUT_DIR, f)
        if os.path.isfile(filepath):
            files.append({
                "filename": f,
                "size_mb": round(os.path.getsize(filepath) / (1024 * 1024), 2),
                "created": datetime.fromtimestamp(
                    os.path.getctime(filepath), tz=timezone.utc
                ).isoformat(),
                "type": _get_file_type(f),
            })
    files.sort(key=lambda x: x["created"], reverse=True)
    return jsonify({"status": "ok", "files": files})


@app.route("/api/output/<filename>")
def serve_output(filename):
    """Serve an output file for download/preview."""
    filepath = os.path.join(Config.OUTPUT_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"status": "error", "message": "File not found."}), 404
    return send_file(filepath)


@app.route("/api/output/<filename>", methods=["DELETE"])
def delete_output(filename):
    """Delete an output file."""
    filepath = os.path.join(Config.OUTPUT_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "File not found."}), 404


# ─── YouTube ─────────────────────────────────────────────────────────────────

@app.route("/api/youtube/auth", methods=["POST"])
def youtube_auth():
    """Authenticate with YouTube."""
    data = request.get_json(silent=True) or {}
    auth_code = data.get("auth_code")
    result = yt_uploader.authenticate(auth_code=auth_code)
    return jsonify(result)


@app.route("/api/youtube/status")
def youtube_status():
    """Check YouTube authentication status."""
    if yt_uploader.is_authenticated:
        analytics = yt_uploader.get_channel_analytics()
        return jsonify({"authenticated": True, **analytics})
    return jsonify({"authenticated": False})


@app.route("/api/youtube/upload", methods=["POST"])
def youtube_upload():
    """Upload a video to YouTube."""
    data = request.get_json(silent=True) or {}
    video_path = data.get("video_path")
    title = data.get("title", "Reddit Story #shorts")
    description = data.get("description", "")
    tags = data.get("tags", [])
    privacy = data.get("privacy", "public")

    if not video_path or not os.path.exists(video_path):
        return jsonify({"status": "error", "message": "Video file not found."}), 400

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {"status": "processing", "type": "youtube_upload", "progress": 0}

    def do_upload():
        try:
            result = yt_uploader.upload_video(
                video_path=video_path,
                title=title,
                description=description,
                tags=tags,
                privacy=privacy,
            )
            jobs[job_id] = {**result, "progress": 100}
        except Exception as e:
            jobs[job_id] = {"status": "error", "message": str(e)}

    threading.Thread(target=do_upload, daemon=True).start()
    return jsonify({"status": "ok", "job_id": job_id})


@app.route("/api/youtube/videos")
def youtube_videos():
    """Get recent channel videos."""
    videos = yt_uploader.get_channel_videos()
    return jsonify({"status": "ok", "videos": videos})


@app.route("/api/youtube/disconnect", methods=["POST"])
def youtube_disconnect():
    """Disconnect YouTube account."""
    yt_uploader.disconnect()
    return jsonify({"status": "ok"})


# ─── Settings ─────────────────────────────────────────────────────────────────

@app.route("/api/settings")
def get_settings():
    """Get current app settings."""
    return jsonify({
        "subreddits": Config.STORY_SUBREDDITS,
        "voice": tts.voice,
        "voices": VOICE_OPTIONS,
        "video_width": Config.VIDEO_WIDTH,
        "video_height": Config.VIDEO_HEIGHT,
        "max_duration": Config.MAX_VIDEO_DURATION,
        "caption_words_per_group": Config.CAPTION_WORDS_PER_GROUP,
        "caption_font_size": Config.CAPTION_FONT_SIZE,
        "bg_video_types": BG_VIDEO_TYPES,
        "youtube_authenticated": yt_uploader.is_authenticated,
        "reddit_configured": bool(Config.REDDIT_CLIENT_ID),
        "claude_configured": bool(Config.ANTHROPIC_API_KEY),
    })


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_file_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    type_map = {
        "mp4": "video",
        "mp3": "audio",
        "vtt": "subtitle",
        "jpg": "image",
        "jpeg": "image",
        "png": "image",
        "json": "data",
    }
    return type_map.get(ext, "other")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if Config.CLOUDFLARE_TUNNEL:
        try:
            from flask_cloudflared import run_with_cloudflared
            run_with_cloudflared(app)
            logger.info("Cloudflare tunnel enabled.")
        except ImportError:
            logger.warning("flask-cloudflared not installed. Running without tunnel.")

    app.run(
        host="0.0.0.0",
        port=Config.PORT,
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
    )
