"""
=============================================================================
SOUNDCLOUD MUSIC PROVIDER (providers/soundcloud.py)
=============================================================================
Official SoundCloud API integration for Isaiify.
Features:
- Official SoundCloud API endpoints (https://api.soundcloud.com)
- Respects SoundCloud Terms of Use: strictly NO downloading or local caching
- Full attribution and mandatory link-back to soundcloud.com
- Clear unconfigured / awaiting-credentials status reporting
"""

import os
import json
import urllib.request
import urllib.parse
from typing import List, Dict, Any, Optional
from .base import MusicProvider

class SoundCloudProvider(MusicProvider):
    name = "soundcloud"
    display_name = "SoundCloud"
    attribution_text = "Powered by SoundCloud"
    attribution_url = "https://soundcloud.com"

    def __init__(self):
        self.api_base = "https://api.soundcloud.com"
        self.user_agent = "Isaiify-MusicApp/2.5 (+https://isaiify-python.onrender.com/)"

    @property
    def client_id(self) -> str:
        return os.environ.get("SOUNDCLOUD_CLIENT_ID", "").strip()

    @property
    def client_secret(self) -> str:
        return os.environ.get("SOUNDCLOUD_CLIENT_SECRET", "").strip()

    def is_configured(self) -> bool:
        """Returns True only when a valid SOUNDCLOUD_CLIENT_ID is set."""
        return bool(self.client_id)

    def get_status(self) -> Dict[str, Any]:
        """Provides status, licensing rules, and configuration instructions."""
        configured = self.is_configured()
        return {
            "provider": self.name,
            "display_name": self.display_name,
            "configured": configured,
            "status": "Ready" if configured else "Awaiting Client ID / API Approval",
            "can_stream": configured,
            "can_download": False,
            "download_restriction_reason": "SoundCloud API Terms of Use strictly prohibit downloading or local caching of audio tracks.",
            "terms_url": "https://developers.soundcloud.com/docs/api/terms-of-use",
            "attribution": self.attribution_text,
            "setup_instructions": (
                "1. Apply for developer access at https://developers.soundcloud.com\n"
                "2. Register an application to receive your Client ID and Client Secret\n"
                "3. Set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET in your server environment variables or .env file"
            )
        }

    def _fetch_api(self, endpoint: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Safely fetch data from official SoundCloud API."""
        if not self.is_configured():
            return None

        params["client_id"] = self.client_id
        query_str = urllib.parse.urlencode(params)
        url = f"{self.api_base}/{endpoint.strip('/')}?{query_str}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=8) as response:
                if response.status == 200:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw)
        except urllib.error.HTTPError as he:
            if he.code == 401:
                print("[SoundCloud API Error] 401 Unauthorized: Invalid or unapproved SOUNDCLOUD_CLIENT_ID.")
            elif he.code == 429:
                print("[SoundCloud API Error] 429 Too Many Requests: Rate limit reached.")
            else:
                print(f"[SoundCloud API Error] HTTP {he.code}: {he.reason}")
            return None
        except Exception as e:
            print(f"[SoundCloud API Error] Request failed: {e}")
            return None

    def _normalize_track(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Convert a SoundCloud track item into Isaiify's unified catalog schema."""
        raw_id = str(item.get("id", ""))
        user = item.get("user") or {}
        artist_name = user.get("username") or "SoundCloud Artist"

        # Determine streaming URL (SoundCloud streaming endpoint with client_id)
        stream_url = item.get("stream_url", "")
        if stream_url and self.client_id:
            sep = "&" if "?" in stream_url else "?"
            playback_url = f"{stream_url}{sep}client_id={self.client_id}"
        else:
            playback_url = stream_url

        # High-resolution artwork conversion (SoundCloud defaults to -large, upgrade to -t500x500)
        art = item.get("artwork_url") or user.get("avatar_url") or ""
        if art and "-large" in art:
            artwork_url = art.replace("-large", "-t500x500")
        else:
            artwork_url = art or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80"

        # Duration in seconds (SoundCloud returns milliseconds)
        dur_ms = item.get("duration", 0)
        dur_sec = int(dur_ms / 1000) if dur_ms else 180

        # Permalinks and attribution
        permalink = item.get("permalink_url") or f"https://soundcloud.com"
        license_str = item.get("license") or "SoundCloud Terms of Service"

        return {
            "id": f"soundcloud_{raw_id}",
            "raw_id": raw_id,
            "title": item.get("title", "Untitled Track"),
            "artist": artist_name,
            "artist_id": f"soundcloud_user_{user.get('id', '')}" if user.get("id") else "",
            "album": "SoundCloud Release",
            "album_id": "",
            "duration_seconds": dur_sec,
            "audio_url": playback_url,
            "image_url": artwork_url,
            "artwork_url": artwork_url,
            "language": "GLOBAL",
            "category": item.get("genre") or "Electronic",
            "tags": item.get("tag_list") or "SoundCloud, Independent",
            "provider": "soundcloud",
            "provider_display_name": "SoundCloud",
            "allow_download": 0,  # CRITICAL: SoundCloud terms strictly prohibit offline downloading!
            "download_url": "",
            "download_notes": "SoundCloud API terms strictly prohibit offline downloading",
            "license_url": "https://developers.soundcloud.com/docs/api/terms-of-use",
            "source_url": permalink,
            "attribution": "SoundCloud",
            "is_favorite": 0
        }

    def search_tracks(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Search tracks via official SoundCloud API /tracks."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("tracks", {
            "q": query.strip(),
            "limit": limit,
            "linked_partitioning": 1
        })

        if not data:
            return []

        # Handle paginated or direct list response
        items = data.get("collection", []) if isinstance(data, dict) and "collection" in data else (data if isinstance(data, list) else [])
        results = []
        for item in items:
            if isinstance(item, dict) and item.get("streamable", True):
                results.append(self._normalize_track(item))
        return results

    def search_albums(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search playlists/albums via official SoundCloud API /playlists."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("playlists", {
            "q": query.strip(),
            "limit": limit
        })

        if not data:
            return []

        items = data.get("collection", []) if isinstance(data, dict) and "collection" in data else (data if isinstance(data, list) else [])
        albums = []
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_id = str(item.get("id", ""))
            art = item.get("artwork_url") or (item.get("user") or {}).get("avatar_url") or ""
            if art and "-large" in art:
                art = art.replace("-large", "-t500x500")

            albums.append({
                "id": f"soundcloud_alb_{raw_id}",
                "raw_id": raw_id,
                "title": item.get("title", "SoundCloud Playlist"),
                "artist": (item.get("user") or {}).get("username", "SoundCloud Artist"),
                "cover_art_url": art or "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500",
                "release_year": int((item.get("created_at") or "2024")[:4]) if item.get("created_at") else 2024,
                "language": "GLOBAL",
                "song_count": int(item.get("track_count", 0)),
                "genre": item.get("genre", "SoundCloud"),
                "provider": "soundcloud",
                "provider_display_name": "SoundCloud",
                "source_url": item.get("permalink_url") or f"https://soundcloud.com"
            })
        return albums

    def search_artists(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search users/artists via official SoundCloud API /users."""
        if not self.is_configured() or not query.strip():
            return []

        data = self._fetch_api("users", {
            "q": query.strip(),
            "limit": limit
        })

        if not data:
            return []

        items = data.get("collection", []) if isinstance(data, dict) and "collection" in data else (data if isinstance(data, list) else [])
        artists = []
        for item in items:
            if not isinstance(item, dict):
                continue
            raw_id = str(item.get("id", ""))
            avatar = item.get("avatar_url") or ""
            if avatar and "-large" in avatar:
                avatar = avatar.replace("-large", "-t500x500")

            followers = item.get("followers_count", 0)
            followers_str = f"{followers:,} followers" if followers else "SoundCloud Artist"

            artists.append({
                "id": f"soundcloud_art_{raw_id}",
                "raw_id": raw_id,
                "name": item.get("username", "SoundCloud User"),
                "image_url": avatar or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500",
                "monthly_listeners": followers_str,
                "language": "GLOBAL",
                "bio": item.get("description") or f"SoundCloud Creator from {item.get('city') or item.get('country') or 'Worldwide'}",
                "provider": "soundcloud",
                "source_url": item.get("permalink_url") or f"https://soundcloud.com"
            })
        return artists

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve single track by SoundCloud ID."""
        clean_id = track_id.replace("soundcloud_", "").strip()
        data = self._fetch_api(f"tracks/{clean_id}", {})
        if data and isinstance(data, dict):
            return self._normalize_track(data)
        return None

    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve playlist/album with tracks by SoundCloud ID."""
        clean_id = album_id.replace("soundcloud_alb_", "").strip()
        data = self._fetch_api(f"playlists/{clean_id}", {})
        if not data or not isinstance(data, dict):
            return None

        raw_id = str(data.get("id", ""))
        tracks_raw = data.get("tracks", [])
        normalized_songs = []
        for t in tracks_raw:
            if isinstance(t, dict):
                normalized_songs.append(self._normalize_track(t))

        art = data.get("artwork_url") or (data.get("user") or {}).get("avatar_url") or ""
        if art and "-large" in art:
            art = art.replace("-large", "-t500x500")

        return {
            "id": f"soundcloud_alb_{raw_id}",
            "raw_id": raw_id,
            "title": data.get("title", "SoundCloud Playlist"),
            "artist": (data.get("user") or {}).get("username", "SoundCloud Artist"),
            "cover_art_url": art or "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500",
            "release_year": int((data.get("created_at") or "2024")[:4]) if data.get("created_at") else 2024,
            "language": "GLOBAL",
            "song_count": len(normalized_songs),
            "genre": data.get("genre", "SoundCloud"),
            "provider": "soundcloud",
            "provider_display_name": "SoundCloud",
            "source_url": data.get("permalink_url") or f"https://soundcloud.com",
            "songs": normalized_songs
        }
