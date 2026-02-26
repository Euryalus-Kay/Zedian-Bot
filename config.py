import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Central configuration for the Viral Reddit Story Bot."""

    # Flask
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "dev-secret-key-change-me")
    PORT = int(os.getenv("FLASK_PORT", 5000))

    # Reddit
    REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
    REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
    REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "ViralStoryBot/1.0")

    # Subreddits to scrape for viral stories
    STORY_SUBREDDITS = [
        "tifu",
        "AmItheAsshole",
        "relationship_advice",
        "confessions",
        "TrueOffMyChest",
        "pettyrevenge",
        "MaliciousCompliance",
        "NuclearRevenge",
        "EntitledParents",
        "choosingbeggars",
        "ProRevenge",
        "BestofRedditorUpdates",
        "offmychest",
        "AskReddit",
        "nosleep",
    ]

    # Claude / Anthropic
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    CLAUDE_MODEL = "claude-sonnet-4-20250514"

    # TTS
    TTS_VOICE = "en-US-ChristopherNeural"  # Male narrator voice
    TTS_RATE = "+10%"  # Slightly faster for engagement

    # Video settings (9:16 vertical for Shorts/TikTok/Reels)
    VIDEO_WIDTH = 1080
    VIDEO_HEIGHT = 1920
    VIDEO_FPS = 30
    MAX_VIDEO_DURATION = 59  # seconds - under 60s for Shorts

    # Caption style
    CAPTION_FONT_SIZE = 72
    CAPTION_FONT = "Arial-Bold"
    CAPTION_COLOR = "white"
    CAPTION_STROKE_COLOR = "black"
    CAPTION_STROKE_WIDTH = 5
    CAPTION_WORDS_PER_GROUP = 3  # Words shown at a time
    CAPTION_HIGHLIGHT = True  # Colored background box behind text
    CAPTION_HIGHLIGHT_COLOR = (200, 15, 15)  # RGB - bold red highlight
    CAPTION_HIGHLIGHT_OPACITY = 0.75  # 0.0 - 1.0
    CAPTION_HIGHLIGHT_PADDING = 20  # Pixels of padding around text

    # YouTube
    YOUTUBE_CLIENT_SECRETS = os.getenv("YOUTUBE_CLIENT_SECRETS", "client_secrets.json")
    YOUTUBE_CATEGORY_ID = "24"  # Entertainment
    YOUTUBE_PRIVACY = "public"

    # Paths
    OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
    DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
    ASSETS_DIR = os.path.join(os.path.dirname(__file__), "static", "assets")
    BG_VIDEOS_DIR = os.path.join(ASSETS_DIR, "backgrounds")

    # Cloudflare
    CLOUDFLARE_TUNNEL = os.getenv("CLOUDFLARE_TUNNEL", "false").lower() == "true"
