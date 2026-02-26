"""Background video manager - downloads and manages gameplay footage."""

import glob
import logging
import os
import random

from config import Config

logger = logging.getLogger(__name__)


# Curated list of free-to-use background video search terms
BG_VIDEO_TYPES = {
    "minecraft_parkour": "minecraft parkour gameplay no copyright vertical",
    "subway_surfers": "subway surfers gameplay no copyright vertical",
    "gta_driving": "gta driving gameplay no copyright vertical",
    "satisfying": "satisfying slime cutting compilation vertical",
    "cooking": "satisfying cooking compilation vertical no copyright",
}


class BackgroundVideoManager:
    """Manages background gameplay videos for story overlays."""

    def __init__(self):
        self.bg_dir = Config.BG_VIDEOS_DIR
        os.makedirs(self.bg_dir, exist_ok=True)

    def download_background(self, video_type: str = "minecraft_parkour",
                            url: str = None) -> str | None:
        """Download a background video using yt-dlp.

        Args:
            video_type: Type key from BG_VIDEO_TYPES.
            url: Direct YouTube URL to download. If None, searches by type.

        Returns:
            Path to downloaded video, or None on failure.
        """
        try:
            import yt_dlp
        except ImportError:
            logger.error("yt-dlp not installed. Run: pip install yt-dlp")
            return None

        output_template = os.path.join(
            self.bg_dir, f"{video_type}_%(id)s.%(ext)s"
        )

        ydl_opts = {
            "format": "bestvideo[height<=1920][ext=mp4]+bestaudio[ext=m4a]/best[height<=1920][ext=mp4]/best",
            "outtmpl": output_template,
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "max_downloads": 1,
            "duration_filter": "longer_than=60",
        }

        try:
            if url:
                search_query = url
            else:
                search_term = BG_VIDEO_TYPES.get(video_type, BG_VIDEO_TYPES["minecraft_parkour"])
                search_query = f"ytsearch3:{search_term}"

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(search_query, download=True)
                if "entries" in info:
                    info = info["entries"][0]
                filepath = ydl.prepare_filename(info)
                logger.info("Downloaded background video: %s", filepath)
                return filepath

        except Exception as e:
            logger.error("Failed to download background video: %s", e)
            return None

    def list_backgrounds(self) -> list[dict]:
        """List all available background videos.

        Returns:
            List of dicts with 'filename', 'path', 'type', 'size_mb'.
        """
        videos = []
        patterns = ["*.mp4", "*.webm", "*.mkv"]
        for pattern in patterns:
            for filepath in glob.glob(os.path.join(self.bg_dir, pattern)):
                filename = os.path.basename(filepath)
                size_mb = os.path.getsize(filepath) / (1024 * 1024)
                # Determine type from filename
                vid_type = "unknown"
                for type_key in BG_VIDEO_TYPES:
                    if filename.startswith(type_key):
                        vid_type = type_key
                        break
                videos.append({
                    "filename": filename,
                    "path": filepath,
                    "type": vid_type,
                    "size_mb": round(size_mb, 2),
                })

        videos.sort(key=lambda v: v["filename"])
        return videos

    def get_random_background(self, video_type: str = None) -> str | None:
        """Get a random background video path.

        Args:
            video_type: Optional type filter.

        Returns:
            Path to a random background video, or None if none available.
        """
        backgrounds = self.list_backgrounds()
        if video_type:
            backgrounds = [b for b in backgrounds if b["type"] == video_type]

        if not backgrounds:
            logger.warning("No background videos available.")
            return None

        chosen = random.choice(backgrounds)
        return chosen["path"]

    def delete_background(self, filename: str) -> bool:
        """Delete a background video.

        Args:
            filename: Name of the file to delete.

        Returns:
            True if deleted, False otherwise.
        """
        filepath = os.path.join(self.bg_dir, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            logger.info("Deleted background video: %s", filename)
            return True
        return False

    @staticmethod
    def get_video_types() -> dict:
        """Return available background video types."""
        return BG_VIDEO_TYPES.copy()
