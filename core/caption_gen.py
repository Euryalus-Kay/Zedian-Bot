"""Caption generator for word-level animated captions (TikTok style)."""

import logging
import os
import re

from config import Config

logger = logging.getLogger(__name__)


def _ticks_to_seconds(ticks: int) -> float:
    """Convert edge-tts tick units (100-nanosecond intervals) to seconds."""
    return ticks / 10_000_000


class CaptionGenerator:
    """Generates word-level caption data for video overlay."""

    def __init__(self):
        self.words_per_group = Config.CAPTION_WORDS_PER_GROUP

    def generate_from_tts_timestamps(self, word_timestamps: list[dict]) -> list[dict]:
        """Generate caption groups from edge-tts word boundary timestamps.

        Groups words together (e.g., 3 at a time) for readable captions.

        Args:
            word_timestamps: List of dicts with 'text', 'offset', 'duration' from edge-tts.

        Returns:
            List of caption dicts with 'text', 'start', 'end' in seconds.
        """
        if not word_timestamps:
            return []

        captions = []
        group = []

        for word_data in word_timestamps:
            text = word_data["text"]
            start = _ticks_to_seconds(word_data["offset"])
            end = start + _ticks_to_seconds(word_data["duration"])

            group.append({
                "word": text,
                "start": start,
                "end": end,
            })

            # Group words together, also split on sentence boundaries
            is_sentence_end = text.rstrip().endswith((".", "!", "?", "...", ","))
            if len(group) >= self.words_per_group or is_sentence_end:
                caption_text = " ".join(w["word"] for w in group)
                captions.append({
                    "text": caption_text.upper(),
                    "start": group[0]["start"],
                    "end": group[-1]["end"],
                    "words": group.copy(),
                })
                group = []

        # Handle remaining words
        if group:
            caption_text = " ".join(w["word"] for w in group)
            captions.append({
                "text": caption_text.upper(),
                "start": group[0]["start"],
                "end": group[-1]["end"],
                "words": group.copy(),
            })

        logger.info("Generated %d caption groups from %d words.",
                     len(captions), len(word_timestamps))
        return captions

    def generate_from_vtt(self, vtt_path: str) -> list[dict]:
        """Parse a VTT subtitle file into caption groups.

        Args:
            vtt_path: Path to the .vtt subtitle file.

        Returns:
            List of caption dicts.
        """
        if not os.path.exists(vtt_path):
            logger.error("VTT file not found: %s", vtt_path)
            return []

        with open(vtt_path) as f:
            content = f.read()

        captions = []
        # Parse VTT timestamps: 00:00:01.234 --> 00:00:02.567
        pattern = r"(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\s*\n(.+?)(?:\n\n|\Z)"
        matches = re.findall(pattern, content, re.DOTALL)

        for start_str, end_str, text in matches:
            start = self._parse_vtt_time(start_str)
            end = self._parse_vtt_time(end_str)
            clean_text = text.strip().replace("\n", " ").upper()
            if clean_text:
                captions.append({
                    "text": clean_text,
                    "start": start,
                    "end": end,
                })

        logger.info("Parsed %d captions from VTT file.", len(captions))
        return captions

    @staticmethod
    def _parse_vtt_time(time_str: str) -> float:
        """Parse VTT timestamp to seconds."""
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        sec_parts = parts[2].split(".")
        seconds = int(sec_parts[0])
        milliseconds = int(sec_parts[1])
        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
