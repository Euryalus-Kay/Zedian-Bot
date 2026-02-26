"""Video editor - composites background video, captions, and audio into final vertical video."""

import logging
import os
import uuid

from moviepy import (
    VideoFileClip,
    AudioFileClip,
    TextClip,
    CompositeVideoClip,
    ColorClip,
    concatenate_videoclips,
)

from config import Config

logger = logging.getLogger(__name__)


class VideoEditor:
    """Creates vertical short-form videos from components."""

    def __init__(self):
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)

    def create_video(self, audio_path: str, background_path: str,
                     captions: list[dict], output_name: str = None) -> dict:
        """Create a complete vertical video with background, audio, and captions.

        Args:
            audio_path: Path to the narration audio file.
            background_path: Path to the background gameplay video.
            captions: List of caption dicts with 'text', 'start', 'end'.
            output_name: Optional output filename (without extension).

        Returns:
            Dict with paths to 'video', 'audio_only', 'video_no_audio'.
        """
        if not output_name:
            output_name = f"viral_{uuid.uuid4().hex[:8]}"

        video_path = os.path.join(Config.OUTPUT_DIR, f"{output_name}.mp4")
        audio_only_path = audio_path  # Already have the audio
        video_no_audio_path = os.path.join(Config.OUTPUT_DIR, f"{output_name}_noaudio.mp4")

        logger.info("Creating video: %s", output_name)

        try:
            # Load audio to get duration
            audio_clip = AudioFileClip(audio_path)
            duration = audio_clip.duration

            # Enforce max duration
            if duration > Config.MAX_VIDEO_DURATION:
                logger.warning("Audio duration %.1fs exceeds max %ds. Trimming.",
                               duration, Config.MAX_VIDEO_DURATION)
                duration = Config.MAX_VIDEO_DURATION
                audio_clip = audio_clip.with_subclip(0, duration)

            # Load and prepare background video
            bg_clip = self._prepare_background(background_path, duration)

            # Create caption clips
            caption_clips = self._create_caption_clips(captions, duration)

            # Composite: background + captions
            all_clips = [bg_clip] + caption_clips
            final_video = CompositeVideoClip(all_clips, size=(Config.VIDEO_WIDTH, Config.VIDEO_HEIGHT))
            final_video = final_video.with_duration(duration)

            # Version with audio
            final_with_audio = final_video.with_audio(audio_clip)
            final_with_audio.write_videofile(
                video_path,
                fps=Config.VIDEO_FPS,
                codec="libx264",
                audio_codec="aac",
                preset="medium",
                threads=4,
                logger=None,
            )

            # Version without audio
            final_video.write_videofile(
                video_no_audio_path,
                fps=Config.VIDEO_FPS,
                codec="libx264",
                preset="medium",
                threads=4,
                logger=None,
            )

            # Clean up
            audio_clip.close()
            bg_clip.close()
            final_video.close()
            final_with_audio.close()
            for clip in caption_clips:
                clip.close()

            logger.info("Video created successfully: %s", video_path)

            return {
                "video": video_path,
                "audio_only": audio_only_path,
                "video_no_audio": video_no_audio_path,
                "duration": duration,
                "output_name": output_name,
            }

        except Exception as e:
            logger.error("Video creation failed: %s", e)
            raise

    def _prepare_background(self, bg_path: str, target_duration: float) -> VideoFileClip:
        """Load and prepare background video for vertical format.

        Crops/resizes to 1080x1920, loops if shorter than target duration.
        """
        bg = VideoFileClip(bg_path)

        # Get a random starting point if video is longer than needed
        if bg.duration > target_duration:
            import random
            max_start = bg.duration - target_duration
            start = random.uniform(0, max_start)
            bg = bg.with_subclip(start, start + target_duration)
        elif bg.duration < target_duration:
            # Loop the video
            loops_needed = int(target_duration / bg.duration) + 1
            clips = [bg] * loops_needed
            bg = concatenate_videoclips(clips)
            bg = bg.with_subclip(0, target_duration)

        # Resize to fill vertical frame (crop to center)
        bg_w, bg_h = bg.size
        target_ratio = Config.VIDEO_WIDTH / Config.VIDEO_HEIGHT  # 9:16

        current_ratio = bg_w / bg_h
        if current_ratio > target_ratio:
            # Video is wider - crop sides
            new_w = int(bg_h * target_ratio)
            x_offset = (bg_w - new_w) // 2
            bg = bg.cropped(x1=x_offset, x2=x_offset + new_w)
        elif current_ratio < target_ratio:
            # Video is taller - crop top/bottom
            new_h = int(bg_w / target_ratio)
            y_offset = (bg_h - new_h) // 2
            bg = bg.cropped(y1=y_offset, y2=y_offset + new_h)

        bg = bg.resized((Config.VIDEO_WIDTH, Config.VIDEO_HEIGHT))
        return bg

    def _create_caption_clips(self, captions: list[dict],
                              video_duration: float) -> list:
        """Create animated text caption clips for overlay.

        Each caption appears at the center of the screen with a bold,
        high-contrast style and colored highlight box behind the text,
        typical of viral short-form content.
        """
        clips = []
        y_position = Config.VIDEO_HEIGHT * 0.45  # Center-ish, slightly above middle

        for cap in captions:
            if cap["start"] >= video_duration:
                break

            end_time = min(cap["end"], video_duration)
            duration = end_time - cap["start"]
            if duration <= 0:
                continue

            try:
                # Main text (bold with thick stroke)
                txt_clip = TextClip(
                    text=cap["text"],
                    font_size=Config.CAPTION_FONT_SIZE,
                    color=Config.CAPTION_COLOR,
                    font=Config.CAPTION_FONT,
                    stroke_color=Config.CAPTION_STROKE_COLOR,
                    stroke_width=Config.CAPTION_STROKE_WIDTH,
                    method="caption",
                    size=(Config.VIDEO_WIDTH - 100, None),
                    text_align="center",
                    horizontal_align="center",
                )

                if Config.CAPTION_HIGHLIGHT:
                    # Create a colored highlight box behind the text
                    txt_w, txt_h = txt_clip.size
                    pad = Config.CAPTION_HIGHLIGHT_PADDING
                    box_w = txt_w + pad * 2
                    box_h = txt_h + pad * 2

                    highlight_box = ColorClip(
                        size=(box_w, box_h),
                        color=Config.CAPTION_HIGHLIGHT_COLOR,
                    )
                    highlight_box = highlight_box.with_opacity(
                        Config.CAPTION_HIGHLIGHT_OPACITY
                    )
                    highlight_box = highlight_box.with_duration(duration)
                    highlight_box = highlight_box.with_start(cap["start"])

                    # Center the box at the caption position
                    box_x = (Config.VIDEO_WIDTH - box_w) // 2
                    box_y = int(y_position - pad)
                    highlight_box = highlight_box.with_position((box_x, box_y))

                    clips.append(highlight_box)

                txt_clip = txt_clip.with_duration(duration)
                txt_clip = txt_clip.with_start(cap["start"])
                txt_clip = txt_clip.with_position(("center", y_position))

                clips.append(txt_clip)

            except Exception as e:
                logger.warning("Failed to create caption clip: %s", e)
                continue

        logger.info("Created %d caption clips.", len(clips))
        return clips

    def create_thumbnail(self, video_path: str, timestamp: float = 2.0) -> str:
        """Extract a frame from the video as a thumbnail.

        Args:
            video_path: Path to the video file.
            timestamp: Time in seconds to extract the frame.

        Returns:
            Path to the saved thumbnail image.
        """
        thumb_path = video_path.replace(".mp4", "_thumb.jpg")
        try:
            clip = VideoFileClip(video_path)
            frame = clip.get_frame(min(timestamp, clip.duration - 0.1))
            from PIL import Image
            img = Image.fromarray(frame)
            img.save(thumb_path, "JPEG", quality=90)
            clip.close()
            logger.info("Thumbnail saved: %s", thumb_path)
            return thumb_path
        except Exception as e:
            logger.error("Thumbnail creation failed: %s", e)
            return ""
