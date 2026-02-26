"""Text-to-Speech engine using edge-tts (free, no API key needed)."""

import asyncio
import logging
import os
import uuid

import edge_tts

from config import Config

logger = logging.getLogger(__name__)

# Available high-quality voices for narration
VOICE_OPTIONS = {
    "male_us": "en-US-ChristopherNeural",
    "male_us_guy": "en-US-GuyNeural",
    "female_us": "en-US-JennyNeural",
    "female_us_aria": "en-US-AriaNeural",
    "male_uk": "en-GB-RyanNeural",
    "female_uk": "en-GB-SoniaNeural",
    "male_aus": "en-AU-WilliamNeural",
    "female_aus": "en-AU-NatashaNeural",
}


class TTSEngine:
    """Generates speech audio from text using Microsoft Edge TTS."""

    def __init__(self, voice: str = None, rate: str = None):
        self.voice = voice or Config.TTS_VOICE
        self.rate = rate or Config.TTS_RATE
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)

    async def _generate_async(self, text: str, output_path: str,
                              subtitle_path: str = None) -> dict:
        """Generate TTS audio asynchronously.

        Args:
            text: Text to convert to speech.
            output_path: Path to save the audio file.
            subtitle_path: Optional path to save VTT subtitles.

        Returns:
            Dict with 'audio_path', 'subtitle_path', and 'word_timestamps'.
        """
        communicate = edge_tts.Communicate(text, self.voice, rate=self.rate)

        word_timestamps = []

        if subtitle_path:
            sub_maker = edge_tts.SubMaker()
            with open(output_path, "wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        sub_maker.feed(chunk)
                        word_timestamps.append({
                            "text": chunk["text"],
                            "offset": chunk["offset"],
                            "duration": chunk["duration"],
                        })

            with open(subtitle_path, "w") as sub_file:
                sub_file.write(sub_maker.generate_subs())
        else:
            with open(output_path, "wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        word_timestamps.append({
                            "text": chunk["text"],
                            "offset": chunk["offset"],
                            "duration": chunk["duration"],
                        })

        return {
            "audio_path": output_path,
            "subtitle_path": subtitle_path,
            "word_timestamps": word_timestamps,
        }

    def generate(self, text: str, filename: str = None) -> dict:
        """Generate TTS audio from text.

        Args:
            text: Text to convert to speech.
            filename: Optional filename (without extension).

        Returns:
            Dict with audio path, subtitle path, and word timestamps.
        """
        if not filename:
            filename = f"tts_{uuid.uuid4().hex[:8]}"

        audio_path = os.path.join(Config.OUTPUT_DIR, f"{filename}.mp3")
        subtitle_path = os.path.join(Config.OUTPUT_DIR, f"{filename}.vtt")

        logger.info("Generating TTS audio: %s", filename)

        result = asyncio.run(
            self._generate_async(text, audio_path, subtitle_path)
        )

        logger.info("TTS audio saved: %s", audio_path)
        return result

    def set_voice(self, voice_key: str):
        """Change the TTS voice.

        Args:
            voice_key: Key from VOICE_OPTIONS or a full voice name.
        """
        if voice_key in VOICE_OPTIONS:
            self.voice = VOICE_OPTIONS[voice_key]
        else:
            self.voice = voice_key
        logger.info("TTS voice set to: %s", self.voice)

    @staticmethod
    def list_voices() -> dict:
        """Return available voice options."""
        return VOICE_OPTIONS.copy()
