"""Reddit scraper using PRAW to find viral/crazy stories."""

import json
import os
import time
import logging
from datetime import datetime, timezone

import praw
from praw.models import Submission

from config import Config

logger = logging.getLogger(__name__)


class RedditScraper:
    """Scrapes Reddit for viral, controversial, and wild stories."""

    def __init__(self):
        self.reddit = None
        self._init_reddit()
        self.cache_file = os.path.join(Config.DATA_DIR, "stories_cache.json")
        os.makedirs(Config.DATA_DIR, exist_ok=True)

    def _init_reddit(self):
        """Initialize PRAW Reddit instance."""
        if not Config.REDDIT_CLIENT_ID or not Config.REDDIT_CLIENT_SECRET:
            logger.warning("Reddit API credentials not configured. Using read-only mode.")
            return
        try:
            self.reddit = praw.Reddit(
                client_id=Config.REDDIT_CLIENT_ID,
                client_secret=Config.REDDIT_CLIENT_SECRET,
                user_agent=Config.REDDIT_USER_AGENT,
            )
            logger.info("Reddit API initialized successfully.")
        except Exception as e:
            logger.error("Failed to initialize Reddit API: %s", e)

    def _submission_to_dict(self, submission: Submission) -> dict:
        """Convert a PRAW Submission to a serializable dictionary."""
        return {
            "id": submission.id,
            "title": submission.title,
            "selftext": submission.selftext,
            "subreddit": str(submission.subreddit),
            "score": submission.score,
            "upvote_ratio": submission.upvote_ratio,
            "num_comments": submission.num_comments,
            "url": f"https://reddit.com{submission.permalink}",
            "created_utc": submission.created_utc,
            "author": str(submission.author) if submission.author else "[deleted]",
            "is_self": submission.is_self,
            "over_18": submission.over_18,
            "awards": submission.total_awards_received,
            "scraped_at": datetime.now(timezone.utc).isoformat(),
        }

    def scrape_subreddit(self, subreddit_name: str, sort: str = "hot",
                         time_filter: str = "week", limit: int = 25) -> list[dict]:
        """Scrape stories from a single subreddit.

        Args:
            subreddit_name: Name of the subreddit to scrape.
            sort: Sort method - 'hot', 'top', 'new', 'controversial'.
            time_filter: Time filter for 'top'/'controversial' - 'hour', 'day', 'week', 'month', 'year', 'all'.
            limit: Max number of posts to fetch.

        Returns:
            List of story dicts.
        """
        if not self.reddit:
            logger.error("Reddit API not initialized.")
            return []

        stories = []
        try:
            subreddit = self.reddit.subreddit(subreddit_name)
            if sort == "hot":
                submissions = subreddit.hot(limit=limit)
            elif sort == "top":
                submissions = subreddit.top(time_filter=time_filter, limit=limit)
            elif sort == "new":
                submissions = subreddit.new(limit=limit)
            elif sort == "controversial":
                submissions = subreddit.controversial(time_filter=time_filter, limit=limit)
            else:
                submissions = subreddit.hot(limit=limit)

            for submission in submissions:
                # Only text posts with substantial content
                if not submission.is_self:
                    continue
                if len(submission.selftext) < 200:
                    continue
                if submission.selftext in ("[removed]", "[deleted]"):
                    continue

                stories.append(self._submission_to_dict(submission))

            logger.info("Scraped %d stories from r/%s", len(stories), subreddit_name)

        except Exception as e:
            logger.error("Error scraping r/%s: %s", subreddit_name, e)

        return stories

    def scrape_all(self, sort: str = "top", time_filter: str = "week",
                   limit: int = 15) -> list[dict]:
        """Scrape stories from all configured subreddits.

        Returns:
            Combined list of stories from all subreddits, sorted by score.
        """
        all_stories = []
        for sub_name in Config.STORY_SUBREDDITS:
            stories = self.scrape_subreddit(sub_name, sort=sort,
                                            time_filter=time_filter, limit=limit)
            all_stories.extend(stories)
            time.sleep(0.5)  # Respect rate limits

        # Sort by score descending
        all_stories.sort(key=lambda s: s["score"], reverse=True)

        # Cache results
        self._save_cache(all_stories)

        logger.info("Total stories scraped: %d", len(all_stories))
        return all_stories

    def _save_cache(self, stories: list[dict]):
        """Save scraped stories to cache file."""
        try:
            with open(self.cache_file, "w") as f:
                json.dump(stories, f, indent=2)
        except Exception as e:
            logger.error("Failed to save cache: %s", e)

    def load_cache(self) -> list[dict]:
        """Load previously scraped stories from cache."""
        try:
            if os.path.exists(self.cache_file):
                with open(self.cache_file) as f:
                    return json.load(f)
        except Exception as e:
            logger.error("Failed to load cache: %s", e)
        return []

    def get_top_comments(self, post_id: str, limit: int = 10) -> list[dict]:
        """Get top comments from a specific post."""
        if not self.reddit:
            return []
        try:
            submission = self.reddit.submission(id=post_id)
            submission.comment_sort = "best"
            submission.comments.replace_more(limit=0)
            comments = []
            for comment in submission.comments[:limit]:
                comments.append({
                    "id": comment.id,
                    "body": comment.body,
                    "score": comment.score,
                    "author": str(comment.author) if comment.author else "[deleted]",
                })
            return comments
        except Exception as e:
            logger.error("Error fetching comments for %s: %s", post_id, e)
            return []
