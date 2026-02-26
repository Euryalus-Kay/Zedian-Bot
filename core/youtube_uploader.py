"""YouTube uploader and channel manager using YouTube Data API v3."""

import json
import logging
import os
import time

from config import Config

logger = logging.getLogger(__name__)

YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube"
YOUTUBE_API_SERVICE = "youtube"
YOUTUBE_API_VERSION = "v3"
TOKEN_FILE = os.path.join(Config.DATA_DIR, "youtube_token.json")


class YouTubeUploader:
    """Handles YouTube video uploads and channel management."""

    def __init__(self):
        self.service = None
        self._authenticated = False

    def authenticate(self, auth_code: str = None) -> dict:
        """Authenticate with YouTube using OAuth 2.0.

        On first call, returns an auth URL for the user to visit.
        On subsequent call with auth_code, completes authentication.

        Returns:
            Dict with 'status' and either 'auth_url' or 'channel_name'.
        """
        try:
            from google_auth_oauthlib.flow import InstalledAppFlow
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
        except ImportError:
            return {"status": "error", "message": "Google API libraries not installed."}

        scopes = [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_MANAGE_SCOPE]

        # Check for existing token
        if os.path.exists(TOKEN_FILE):
            try:
                creds = Credentials.from_authorized_user_file(TOKEN_FILE, scopes)
                if creds and creds.valid:
                    self.service = build(YOUTUBE_API_SERVICE, YOUTUBE_API_VERSION, credentials=creds)
                    self._authenticated = True
                    channel_info = self._get_channel_info()
                    return {"status": "authenticated", **channel_info}
                elif creds and creds.expired and creds.refresh_token:
                    from google.auth.transport.requests import Request
                    creds.refresh(Request())
                    self._save_token(creds)
                    self.service = build(YOUTUBE_API_SERVICE, YOUTUBE_API_VERSION, credentials=creds)
                    self._authenticated = True
                    channel_info = self._get_channel_info()
                    return {"status": "authenticated", **channel_info}
            except Exception as e:
                logger.warning("Stored token invalid: %s", e)

        # Check for client secrets file
        secrets_path = Config.YOUTUBE_CLIENT_SECRETS
        if not os.path.exists(secrets_path):
            return {
                "status": "error",
                "message": f"YouTube client_secrets.json not found at: {secrets_path}. "
                           "Download from Google Cloud Console -> APIs & Services -> Credentials."
            }

        try:
            flow = InstalledAppFlow.from_client_secrets_file(
                secrets_path, scopes,
                redirect_uri="urn:ietf:wg:oauth:2.0:oob"
            )

            if not auth_code:
                auth_url, _ = flow.authorization_url(prompt="consent")
                return {"status": "needs_auth", "auth_url": auth_url}

            # Complete auth with the provided code
            flow.fetch_token(code=auth_code)
            creds = flow.credentials
            self._save_token(creds)

            self.service = build(YOUTUBE_API_SERVICE, YOUTUBE_API_VERSION, credentials=creds)
            self._authenticated = True
            channel_info = self._get_channel_info()
            return {"status": "authenticated", **channel_info}

        except Exception as e:
            logger.error("YouTube authentication failed: %s", e)
            return {"status": "error", "message": str(e)}

    def upload_video(self, video_path: str, title: str, description: str,
                     tags: list[str] = None, privacy: str = None,
                     category_id: str = None) -> dict:
        """Upload a video to YouTube.

        Args:
            video_path: Path to the video file.
            title: Video title.
            description: Video description.
            tags: List of tags.
            privacy: Privacy status ('public', 'private', 'unlisted').
            category_id: YouTube category ID.

        Returns:
            Dict with 'status', 'video_id', and 'url'.
        """
        if not self._authenticated or not self.service:
            return {"status": "error", "message": "Not authenticated. Call authenticate() first."}

        if not os.path.exists(video_path):
            return {"status": "error", "message": f"Video file not found: {video_path}"}

        try:
            from googleapiclient.http import MediaFileUpload

            body = {
                "snippet": {
                    "title": title[:100],
                    "description": description[:5000],
                    "tags": tags or ["reddit", "storytime", "viral"],
                    "categoryId": category_id or Config.YOUTUBE_CATEGORY_ID,
                },
                "status": {
                    "privacyStatus": privacy or Config.YOUTUBE_PRIVACY,
                    "selfDeclaredMadeForKids": False,
                    "shorts": {
                        "shortsEligibility": "ELIGIBLE",
                    },
                },
            }

            media = MediaFileUpload(
                video_path,
                mimetype="video/mp4",
                resumable=True,
                chunksize=256 * 1024,
            )

            request = self.service.videos().insert(
                part=",".join(body.keys()),
                body=body,
                media_body=media,
            )

            # Execute with retry
            response = self._resumable_upload(request)

            if response:
                video_id = response["id"]
                video_url = f"https://youtube.com/shorts/{video_id}"
                logger.info("Video uploaded: %s", video_url)
                return {
                    "status": "success",
                    "video_id": video_id,
                    "url": video_url,
                }

            return {"status": "error", "message": "Upload returned no response."}

        except Exception as e:
            logger.error("Upload failed: %s", e)
            return {"status": "error", "message": str(e)}

    def _resumable_upload(self, request, max_retries: int = 5) -> dict | None:
        """Execute a resumable upload with exponential backoff."""
        response = None
        retries = 0

        while response is None:
            try:
                status, response = request.next_chunk()
                if status:
                    logger.info("Upload progress: %d%%", int(status.progress() * 100))
            except Exception as e:
                if retries >= max_retries:
                    raise
                retries += 1
                wait = 2 ** retries
                logger.warning("Upload error (retry %d/%d in %ds): %s",
                               retries, max_retries, wait, e)
                time.sleep(wait)

        return response

    def get_channel_videos(self, max_results: int = 20) -> list[dict]:
        """Get recent videos from the authenticated channel.

        Returns:
            List of video dicts.
        """
        if not self._authenticated or not self.service:
            return []

        try:
            # Get channel's uploads playlist
            channels_response = self.service.channels().list(
                mine=True, part="contentDetails"
            ).execute()

            uploads_playlist = channels_response["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

            # Get videos from uploads playlist
            playlist_response = self.service.playlistItems().list(
                playlistId=uploads_playlist,
                part="snippet,status",
                maxResults=max_results,
            ).execute()

            videos = []
            for item in playlist_response.get("items", []):
                snippet = item["snippet"]
                videos.append({
                    "video_id": snippet["resourceId"]["videoId"],
                    "title": snippet["title"],
                    "description": snippet["description"][:200],
                    "published_at": snippet["publishedAt"],
                    "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                    "url": f"https://youtube.com/shorts/{snippet['resourceId']['videoId']}",
                    "status": item.get("status", {}).get("privacyStatus", "unknown"),
                })

            return videos

        except Exception as e:
            logger.error("Failed to fetch channel videos: %s", e)
            return []

    def get_channel_analytics(self) -> dict:
        """Get basic channel statistics.

        Returns:
            Dict with subscriber count, view count, video count.
        """
        if not self._authenticated or not self.service:
            return {}

        try:
            response = self.service.channels().list(
                mine=True, part="statistics,snippet"
            ).execute()

            if response["items"]:
                stats = response["items"][0]["statistics"]
                snippet = response["items"][0]["snippet"]
                return {
                    "channel_name": snippet["title"],
                    "subscribers": int(stats.get("subscriberCount", 0)),
                    "total_views": int(stats.get("viewCount", 0)),
                    "video_count": int(stats.get("videoCount", 0)),
                    "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                }

            return {}

        except Exception as e:
            logger.error("Failed to fetch analytics: %s", e)
            return {}

    def _get_channel_info(self) -> dict:
        """Get basic channel info for auth confirmation."""
        try:
            response = self.service.channels().list(
                mine=True, part="snippet"
            ).execute()
            if response["items"]:
                return {
                    "channel_name": response["items"][0]["snippet"]["title"],
                    "channel_id": response["items"][0]["id"],
                }
        except Exception:
            pass
        return {"channel_name": "Unknown", "channel_id": ""}

    def _save_token(self, credentials):
        """Save OAuth credentials to file."""
        os.makedirs(Config.DATA_DIR, exist_ok=True)
        with open(TOKEN_FILE, "w") as f:
            f.write(credentials.to_json())

    def disconnect(self) -> bool:
        """Disconnect YouTube account by removing stored token."""
        if os.path.exists(TOKEN_FILE):
            os.remove(TOKEN_FILE)
        self.service = None
        self._authenticated = False
        return True

    @property
    def is_authenticated(self) -> bool:
        return self._authenticated
