"""
=============================================================================
JAMENDO MUSIC PROVIDER (providers/jamendo.py)
=============================================================================
Official Jamendo API v3.0 integration for Isaiify.
Features:
- Official REST API endpoints (https://api.jamendo.com/v3.0/)
- Creative Commons licensed music catalog
- Respects track-specific artist download permissions (audiodownload_allowed)
- Full attribution, Creative Commons license link, and Jamendo track link-back
"""

import os
import json
import urllib.request
import urllib.parse
from typing import List, Dict, Any, Optional
from .base import MusicProvider

class JamendoProvider(MusicProvider):
    name = "jamendo"
    display_name = "Jamendo Music"
    attribution_text = "Powered by Jamendo Music • Free & Legal Creative Commons"
    attribution_url = "https://www.jamendo.com/"

    def __init__(self):
        self.api_base = "https://api.jamendo.com/v3.0"
        self.user_agent = "Isaiify-MusicApp/2.5 (+https://isaiify-python.onrender.com/)"

    @property
    def client_id(self) -> str:
        return os.environ.get("JAMENDO_CLIENT_ID", "").strip()

    def is_configured(self) -> bool:
        """Returns True if a non-empty JAMENDO_CLIENT_ID environment variable is set."""
        return bool(self.client_id)

    def get_status(self) -> Dict[str, Any]:
        """Provides status, licensing rules, and configuration instructions."""
        configured = self.is_configured()
        return {
            "provider": self.name,
            "display_name": self.display_name,
            "configured": configured,
            "status": "Ready" if configured else "Awaiting Client ID",
            "can_stream": configured,
            "can_download": "Conditional (Permitted only when artist grants CC download rights via audiodownload_allowed)",
            "terms_url": "https://developer.jamendo.com/v3.0",
            "attribution": self.attribution_text,
            "license_type": "Creative Commons (CC BY, CC BY-SA, CC BY-NC-ND)",
            "setup_instructions": (
                "1. Register a free developer account at https://developer.jamendo.com\n"
                "2. Create an application to receive your Client ID\n"
                "3. Set JAMENDO_CLIENT_ID in your server environment variables or .env file"
            )
        }

    def _fetch_api(self, endpoint: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Safely fetch JSON from official Jamendo API v3.0."""
        if not self.is_configured():
            return None

        params["client_id"] = self.client_id
        params["format"] = "json"
        query_str = urllib.parse.urlencode(params)
        url = f"{self.api_base}/{endpoint.strip('/')}/?{query_str}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    headers = data.get("headers", {})
                    if headers.get("status") == "success":
                        return data
                    else:
                        print(f"[Jamendo API Warning] Status: {headers.get('status')}, Message: {headers.get('error_message')}")
                        return None
        except Exception as e:
            print(f"[Jamendo API Error] Failed fetching {endpoint}: {e}")
            return None

    def _normalize_track(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a Jamendo track item into Isaiify's unified catalog schema."""
        raw_id = str(item.get("id", ""))
        audio_url = item.get("audio", "")
        download_allowed = bool(item.get("audiodownload_allowed", False))
        audiodownload = item.get("audiodownload", "") if download_allowed else ""

        # Extract music genres and tags
        musicinfo = item.get("musicinfo", {}) or {}
        tags_dict = musicinfo.get("tags", {}) or {}
        genres = tags_dict.get("genres", [])
        vartags = tags_dict.get("vartags", [])
        combined_tags = ", ".join(genres[:3] + vartags[:2]) if (genres or vartags) else "Indie, Creative Commons"
        primary_category = genres[0].title() if genres else "Indie"

        artwork = item.get("image", "") or item.get("album_image", "")
        if not artwork:
            artwork = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80"

        # Link-back & license
        share_url = item.get("shareurl") or f"https://www.jamendo.com/track/{raw_id}"
        license_url = item.get("license_ccurl") or "https://creativecommons.org/licenses/"

        return {
            "id": f"jamendo_{raw_id}",
            "raw_id": raw_id,
            "title": item.get("name", "Untitled Jamendo Track"),
            "artist": item.get("artist_name", "Jamendo Artist"),
            "artist_id": f"jamendo_art_{item.get('artist_id', '')}" if item.get("artist_id") else "",
            "album": item.get("album_name", "Jamendo Single"),
            "album_id": f"jamendo_alb_{item.get('album_id', '')}" if item.get("album_id") else "",
            "duration_seconds": int(item.get("duration", 180) or 180),
            "audio_url": audio_url,
            "image_url": artwork,
            "artwork_url": artwork,
            "language": "GLOBAL",
            "category": primary_category,
            "tags": combined_tags,
            "provider": "jamendo",
            "provider_display_name": "Jamendo Music",
            "allow_download": 1 if (download_allowed and audiodownload) else 0,
            "download_url": audiodownload if download_allowed else "",
            "download_notes": "Creative Commons Free Download (Permitted by artist)" if download_allowed else "Streaming only under artist's Jamendo license",
            "license_url": license_url,
            "source_url": share_url,
            "attribution": "Jamendo Music (Creative Commons)",
            "is_favorite": 0
        }

    def search_tracks(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Search tracks via Jamendo API v3.0 /tracks/."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("tracks", {
            "search": query.strip(),
            "limit": limit,
            "audioformat": "mp32",
            "audiodlformat": "mp32",
            "include": "musicinfo+licenses"
        })

        if not data or "results" not in data:
            return []

        return [self._normalize_track(item) for item in data["results"] if item.get("audio")]

    def search_albums(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search albums via Jamendo API v3.0 /albums/."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("albums", {
            "namesearch": query.strip(),
            "limit": limit
        })

        if not data or "results" not in data:
            return []

        albums = []
        for item in data["results"]:
            raw_id = str(item.get("id", ""))
            artwork = item.get("image", "") or "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500"
            rel_date = item.get("releasedate", "2024")
            year = int(rel_date.split("-")[0]) if rel_date and rel_date[:4].isdigit() else 2024

            albums.append({
                "id": f"jamendo_alb_{raw_id}",
                "raw_id": raw_id,
                "title": item.get("name", "Jamendo Album"),
                "artist": item.get("artist_name", "Jamendo Artist"),
                "cover_art_url": artwork,
                "release_year": year,
                "language": "GLOBAL",
                "song_count": 0,
                "genre": "Creative Commons",
                "provider": "jamendo",
                "provider_display_name": "Jamendo Music",
                "source_url": item.get("shareurl") or f"https://www.jamendo.com/album/{raw_id}"
            })
        return albums

    def search_artists(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search artists via Jamendo API v3.0 /artists/."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("artists", {
            "namesearch": query.strip(),
            "limit": limit
        })

        if not data or "results" not in data:
            return []

        artists = []
        for item in data["results"]:
            raw_id = str(item.get("id", ""))
            artists.append({
                "id": f"jamendo_art_{raw_id}",
                "raw_id": raw_id,
                "name": item.get("name", "Jamendo Artist"),
                "image_url": item.get("image", "") or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500",
                "monthly_listeners": "Jamendo Independent Creator",
                "language": "GLOBAL",
                "bio": f"Independent creator on Jamendo Music. Joindate: {item.get('joindate', 'N/A')}",
                "provider": "jamendo",
                "source_url": item.get("shareurl") or f"https://www.jamendo.com/artist/{raw_id}"
            })
        return artists

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve single track by Jamendo track ID."""
        clean_id = track_id.replace("jamendo_", "").strip()
        data = self._fetch_api("tracks", {
            "id": clean_id,
            "audioformat": "mp32",
            "audiodlformat": "mp32",
            "include": "musicinfo+licenses"
        })
        if data and data.get("results"):
            return self._normalize_track(data["results"][0])
        return None

    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve album with tracks by Jamendo album ID."""
        clean_id = album_id.replace("jamendo_alb_", "").strip()
        data = self._fetch_api("albums/tracks", {
            "id": clean_id,
            "audioformat": "mp32",
            "audiodlformat": "mp32",
            "include": "musicinfo+licenses"
        })
        if not data or not data.get("results"):
            return None

        alb_data = data["results"][0]
        raw_id = str(alb_data.get("id", ""))
        rel_date = alb_data.get("releasedate", "2024")
        year = int(rel_date.split("-")[0]) if rel_date and rel_date[:4].isdigit() else 2024
        tracks_raw = alb_data.get("tracks", [])

        normalized_songs = []
        for t in tracks_raw:
            t["artist_name"] = alb_data.get("artist_name")
            t["artist_id"] = alb_data.get("artist_id")
            t["album_name"] = alb_data.get("name")
            t["album_id"] = raw_id
            t["album_image"] = alb_data.get("image")
            normalized_songs.append(self._normalize_track(t))

        return {
            "id": f"jamendo_alb_{raw_id}",
            "raw_id": raw_id,
            "title": alb_data.get("name", "Jamendo Album"),
            "artist": alb_data.get("artist_name", "Jamendo Artist"),
            "cover_art_url": alb_data.get("image") or "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500",
            "release_year": year,
            "language": "GLOBAL",
            "song_count": len(normalized_songs),
            "genre": "Creative Commons",
            "provider": "jamendo",
            "provider_display_name": "Jamendo Music",
            "source_url": alb_data.get("shareurl") or f"https://www.jamendo.com/album/{raw_id}",
            "songs": normalized_songs
        }
