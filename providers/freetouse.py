"""
=============================================================================
FREE TO USE MUSIC PROVIDER (providers/freetouse.py)
=============================================================================
Official Free To Use v3.0 REST API integration for Isaiify.
Features:
- Open access public API (https://api.freetouse.com/v3)
- No API key or client secret required (ready out of the box)
- Real human-made royalty-free background music catalog (Lofi, Chill, Ambient, Upbeat, etc.)
- Direct high-quality MP3 streaming & offline downloads for free tracks
- Full artist attribution and link-back to freetouse.com
=============================================================================
"""

import json
import urllib.request
import urllib.parse
from typing import List, Dict, Any, Optional
from .base import MusicProvider

class FreeToUseProvider(MusicProvider):
    name = "freetouse"
    display_name = "Free To Use Music"
    attribution_text = "Powered by Free To Use (freetouse.com) • Royalty-Free Music"
    attribution_url = "https://freetouse.com"

    def __init__(self):
        self.api_base = "https://api.freetouse.com/v3"
        self.user_agent = "Isaiify-MusicApp/2.5 (+https://isaiify-python.onrender.com/)"

    def is_configured(self) -> bool:
        """Free To Use is an open-access public API that requires no authentication."""
        return True

    def get_status(self) -> Dict[str, Any]:
        """Provides status, licensing rules, and catalog capability."""
        return {
            "provider": self.name,
            "display_name": self.display_name,
            "configured": True,
            "status": "Ready",
            "can_stream": True,
            "can_download": True,
            "terms_url": "https://freetouse.com",
            "attribution": self.attribution_text,
            "license_type": "Royalty-Free Human Artists (Non-AI)",
            "setup_instructions": "Free To Use API requires no API keys or setup — ready immediately for streaming and offline downloads."
        }

    def _fetch_api(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Safely fetch JSON from official Free To Use API v3."""
        clean_endpoint = endpoint.strip("/")
        if params:
            query_str = urllib.parse.urlencode(params)
            url = f"{self.api_base}/{clean_endpoint}?{query_str}"
        else:
            url = f"{self.api_base}/{clean_endpoint}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    if isinstance(data, dict) and data.get("ok", True):
                        return data
        except Exception as e:
            print(f"[FreeToUse API Error] Failed fetching {endpoint}: {e}")
            return None
        return None

    def _normalize_track(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a Free To Use track item into Isaiify's unified catalog schema."""
        raw_id = str(item.get("id", ""))
        files = item.get("files", {}) or {}
        audio_url = files.get("mp3", "")

        # Extract artist names from nested [[order, {id, name}], ...] structure
        artists_raw = item.get("artists", [])
        artist_names = []
        for entry in artists_raw:
            if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], dict):
                artist_names.append(entry[1].get("name", ""))
            elif isinstance(entry, dict):
                artist_names.append(entry.get("name", ""))
            elif isinstance(entry, str):
                artist_names.append(entry)
        artist_str = ", ".join([a for a in artist_names if a]) or "Free To Use Artist"

        # Extract categories & tags
        cat_raw = item.get("categories", [])
        cat_names = []
        for entry in cat_raw:
            if isinstance(entry, list) and len(entry) > 1 and isinstance(entry[1], dict):
                cat_names.append(entry[1].get("name", ""))
            elif isinstance(entry, dict):
                cat_names.append(entry.get("name", ""))
            elif isinstance(entry, str):
                cat_names.append(entry)

        tags_raw = item.get("tags", [])
        tag_names = []
        for entry in tags_raw:
            if isinstance(entry, list) and len(entry) > 1:
                tag_names.append(str(entry[1]))
            elif isinstance(entry, str):
                tag_names.append(entry)

        primary_category = cat_names[0] if cat_names else (item.get("genre") or "Royalty-Free")
        combined_tags = ", ".join(cat_names + tag_names) if (cat_names or tag_names) else (item.get("genre") or "Lofi, Royalty-Free")

        # Extract thumbnails
        thumbs = item.get("thumbnails", {}) or {}
        artwork = thumbs.get("lg") or thumbs.get("md") or thumbs.get("sm") or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500"

        # Duration
        try:
            duration_sec = int(float(item.get("duration", 180) or 180))
        except (ValueError, TypeError):
            duration_sec = 180

        is_premium = bool(item.get("is_premium", False))
        label = item.get("record_label") or "Free To Use Collection"

        return {
            "id": f"freetouse_{raw_id}",
            "raw_id": raw_id,
            "title": item.get("title", "Untitled Track"),
            "artist": artist_str,
            "artist_id": f"freetouse_art_{artist_names[0].lower().replace(' ', '_')}" if artist_names else "",
            "album": label,
            "album_id": "",
            "duration_seconds": duration_sec,
            "audio_url": audio_url,
            "image_url": artwork,
            "artwork_url": artwork,
            "language": "GLOBAL",
            "category": primary_category,
            "tags": combined_tags,
            "provider": self.name,
            "provider_display_name": self.display_name,
            "allow_download": 0 if is_premium else 1,
            "download_url": audio_url if not is_premium else "",
            "download_notes": "Royalty-Free Free To Use (Attribution required for commercial use)" if not is_premium else "Requires Commercial License",
            "license_url": "https://freetouse.com",
            "source_url": f"https://freetouse.com",
            "attribution": self.attribution_text,
            "is_favorite": 0
        }

    def search_tracks(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """
        Search tracks via Free To Use API v3.
        Supports both query search (/music/tracks/search?query=...) and catalog browse (/music/tracks/all).
        """
        q = query.strip()
        if not q or q.lower() == "all":
            data = self._fetch_api("music/tracks/all", {"limit": limit})
        else:
            data = self._fetch_api("music/tracks/search", {"query": q, "limit": limit})

        if not data or "data" not in data or not isinstance(data["data"], list):
            return []

        tracks = []
        for item in data["data"]:
            if item.get("files", {}).get("mp3"):
                tracks.append(self._normalize_track(item))
        return tracks

    def search_albums(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Search curated category albums (e.g. Lofi, Ambient, Chill, Aesthetic).
        """
        data = self._fetch_api("music/categories/all")
        if not data or "data" not in data or not isinstance(data["data"], list):
            return []

        q_lower = query.strip().lower()
        matched = []
        for cat in data["data"]:
            name = cat.get("name", "")
            if not q_lower or q_lower in name.lower():
                raw_id = str(cat.get("id", ""))
                matched.append({
                    "id": f"freetouse_alb_{raw_id}",
                    "raw_id": raw_id,
                    "title": f"{name} Moods & Beats",
                    "artist": "Free To Use Curated",
                    "cover_art_url": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500",
                    "release_year": 2024,
                    "language": "GLOBAL",
                    "song_count": 0,
                    "genre": name,
                    "provider": self.name,
                    "provider_display_name": self.display_name,
                    "source_url": "https://freetouse.com"
                })
                if len(matched) >= limit:
                    break
        return matched

    def search_artists(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search artists via Free To Use API v3."""
        data = self._fetch_api("music/artists/all")
        if not data or "data" not in data or not isinstance(data["data"], list):
            return []

        q_lower = query.strip().lower()
        artists = []
        for art in data["data"]:
            name = art.get("name", "")
            if not q_lower or q_lower in name.lower():
                raw_id = str(art.get("id", ""))
                artists.append({
                    "id": f"freetouse_art_{raw_id}",
                    "raw_id": raw_id,
                    "name": name,
                    "image_url": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500",
                    "monthly_listeners": "Free To Use Creator",
                    "language": "GLOBAL",
                    "bio": f"Creator portfolio on Free To Use Music ({name}).",
                    "provider": self.name,
                    "source_url": "https://freetouse.com"
                })
                if len(artists) >= limit:
                    break
        return artists

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve single track by Free To Use track ID."""
        clean_id = track_id.replace("freetouse_", "").strip()
        data = self._fetch_api(f"music/tracks/{clean_id}")
        if data and data.get("data"):
            return self._normalize_track(data["data"])
        return None

    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve album/category tracks by category ID."""
        clean_id = album_id.replace("freetouse_alb_", "").strip()
        data = self._fetch_api(f"music/categories/{clean_id}/tracks", {"limit": 20})
        if not data or "data" not in data or not isinstance(data["data"], list):
            return None

        tracks = []
        for item in data["data"]:
            if item.get("files", {}).get("mp3"):
                tracks.append(self._normalize_track(item))

        first_track = tracks[0] if tracks else {}
        album_title = first_track.get("category", "Free To Use Collection")

        return {
            "id": f"freetouse_alb_{clean_id}",
            "raw_id": clean_id,
            "title": f"{album_title} Collection",
            "artist": "Free To Use Curated",
            "cover_art_url": first_track.get("image_url", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500"),
            "release_year": 2024,
            "language": "GLOBAL",
            "song_count": len(tracks),
            "genre": album_title,
            "provider": self.name,
            "provider_display_name": self.display_name,
            "source_url": "https://freetouse.com",
            "songs": tracks
        }
