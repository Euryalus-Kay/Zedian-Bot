"""AI-powered story ranker using Claude to find the most viral stories."""

import json
import logging

import anthropic

from config import Config

logger = logging.getLogger(__name__)


class StoryRanker:
    """Uses Claude to analyze and rank Reddit stories by viral potential."""

    def __init__(self):
        self.client = None
        if Config.ANTHROPIC_API_KEY:
            self.client = anthropic.Anthropic(api_key=Config.ANTHROPIC_API_KEY)

    def rank_stories(self, stories: list[dict], top_n: int = 10) -> list[dict]:
        """Rank stories by viral potential using Claude.

        Args:
            stories: List of story dicts from the Reddit scraper.
            top_n: Number of top stories to return.

        Returns:
            List of stories with added 'viral_score' and 'viral_reason' fields.
        """
        if not self.client:
            logger.warning("Claude API not configured. Falling back to score-based ranking.")
            return self._fallback_rank(stories, top_n)

        # Prepare condensed story summaries for the AI
        story_summaries = []
        for i, story in enumerate(stories[:50]):  # Send max 50 to avoid token limits
            text_preview = story["selftext"][:500]
            story_summaries.append({
                "index": i,
                "title": story["title"],
                "subreddit": story["subreddit"],
                "preview": text_preview,
                "score": story["score"],
                "comments": story["num_comments"],
                "upvote_ratio": story["upvote_ratio"],
            })

        prompt = f"""You are an expert viral content curator for TikTok and YouTube Shorts. Your job is to identify Reddit stories that will generate the most views, engagement, and shares when turned into short-form videos.

Analyze these Reddit stories and rank them by viral potential. Consider:

1. **Hook Factor** - Does the title/opening grab attention instantly?
2. **Shock Value** - Is it surprising, outrageous, or unbelievable?
3. **Relatability** - Will viewers see themselves or someone they know?
4. **Controversy** - Does it spark debate? Will people comment to argue?
5. **Emotional Impact** - Does it trigger strong emotions (anger, joy, disbelief)?
6. **Narrative Arc** - Is there a clear story with a satisfying payoff?
7. **Shareability** - Would someone share this saying "you NEED to hear this"?
8. **Length Fit** - Can the core story be told in under 60 seconds?

Here are the stories to analyze:

{json.dumps(story_summaries, indent=2)}

Return a JSON array of the top {top_n} stories, ranked from most to least viral. Each entry should have:
- "index": the original index number
- "viral_score": 1-100 score
- "viral_reason": one-sentence explanation of why it's viral
- "hook": a suggested attention-grabbing opening line for the video
- "estimated_duration": estimated narration time in seconds

Return ONLY the JSON array, no other text."""

        try:
            response = self.client.messages.create(
                model=Config.CLAUDE_MODEL,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = response.content[0].text.strip()
            # Parse JSON from response (handle potential markdown wrapping)
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("```", 1)[0]

            rankings = json.loads(response_text)

            # Merge ranking data back into original stories
            ranked_stories = []
            for rank_data in rankings[:top_n]:
                idx = rank_data["index"]
                if idx < len(stories):
                    story = stories[idx].copy()
                    story["viral_score"] = rank_data.get("viral_score", 0)
                    story["viral_reason"] = rank_data.get("viral_reason", "")
                    story["hook"] = rank_data.get("hook", "")
                    story["estimated_duration"] = rank_data.get("estimated_duration", 45)
                    ranked_stories.append(story)

            logger.info("Ranked %d stories by viral potential.", len(ranked_stories))
            return ranked_stories

        except Exception as e:
            logger.error("Claude ranking failed: %s. Falling back to score-based.", e)
            return self._fallback_rank(stories, top_n)

    def generate_script(self, story: dict) -> dict:
        """Generate a narration script from a story, optimized for short-form video.

        Returns:
            Dict with 'title', 'script', 'hook', and 'tags'.
        """
        if not self.client:
            return self._fallback_script(story)

        prompt = f"""You are a viral TikTok/YouTube Shorts script writer. Transform this Reddit story into a compelling 30-55 second narration script.

RULES:
- Start with an INSANE hook that makes people stop scrolling (first 3 seconds are critical)
- Use dramatic pauses (indicated by "..." )
- Keep sentences short and punchy
- Build tension, then deliver the payoff
- Use conversational, engaging tone (like you're telling a friend)
- NO intro like "Hey guys" - jump straight into the story
- End with something that makes viewers comment (question, cliffhanger, or shock)
- Keep it under 150 words for ~55 seconds of speech
- Do NOT use emojis

Reddit Story Title: {story['title']}
Subreddit: r/{story['subreddit']}
Story:
{story['selftext'][:3000]}

Return a JSON object with:
- "hook": the opening hook line (first thing said)
- "script": the full narration script (including the hook)
- "title": a catchy YouTube Shorts title (under 70 chars)
- "description": YouTube description (2-3 sentences + hashtags)
- "tags": array of relevant tags for YouTube

Return ONLY the JSON object, no other text."""

        try:
            response = self.client.messages.create(
                model=Config.CLAUDE_MODEL,
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = response.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("```", 1)[0]

            result = json.loads(response_text)
            logger.info("Generated script for: %s", story["title"][:50])
            return result

        except Exception as e:
            logger.error("Script generation failed: %s", e)
            return self._fallback_script(story)

    def _fallback_rank(self, stories: list[dict], top_n: int) -> list[dict]:
        """Simple score-based ranking when Claude is unavailable."""
        sorted_stories = sorted(stories, key=lambda s: (
            s["score"] * s.get("upvote_ratio", 0.5) * (1 + s["num_comments"] / 100)
        ), reverse=True)

        for i, story in enumerate(sorted_stories[:top_n]):
            story["viral_score"] = max(10, 100 - i * 8)
            story["viral_reason"] = f"High engagement: {story['score']} upvotes, {story['num_comments']} comments"
            story["hook"] = story["title"]
            story["estimated_duration"] = min(55, max(20, len(story["selftext"]) // 25))

        return sorted_stories[:top_n]

    def _fallback_script(self, story: dict) -> dict:
        """Simple script generation when Claude is unavailable."""
        text = story["selftext"]
        # Truncate to ~150 words
        words = text.split()
        if len(words) > 150:
            text = " ".join(words[:145]) + "..."

        return {
            "hook": story.get("hook", story["title"]),
            "script": f"{story['title']}... {text}",
            "title": story["title"][:70],
            "description": f"Reddit story from r/{story['subreddit']}. #reddit #storytime #viral",
            "tags": ["reddit", "storytime", "viral", story["subreddit"]],
        }
