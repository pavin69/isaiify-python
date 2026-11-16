"""
=============================================================================
PROVIDER MANAGER (providers/manager.py)
=============================================================================
Central coordinator managing music providers (Jamendo, SoundCloud, Isaiify Vault).
Supports unified multi-provider search, provider-specific filtering, track/album
routing, and status reporting.
"""

from typing import List, Dict, Any, Optional
from .jamendo import JamendoProvider
from .soundcloud import SoundCloudProvider
from .freetouse import FreeToUseProvider

class ProviderManager:
    def __init__(self):
        self.jamendo = JamendoProvider()
        self.soundcloud = SoundCloudProvider()
        self.freetouse = FreeToUseProvider()

    def get_provider_statuses(self) -> Dict[str, Any]:
        """Return the configuration and readiness state of all external providers."""
        return {
            "isaiify": {
                "provider": "isaiify",
                "display_name": "Isaiify Vault",
                "configured": True,
                "status": "Ready",
                "can_stream": True,
                "can_download": True,
                "attribution": "Isaiify Original Catalog",
                "terms_url": "/static/README.md"
            },
            "freetouse": self.freetouse.get_status(),
            "jamendo": self.jamendo.get_status(),
            "soundcloud": self.soundcloud.get_status()
        }

    def search_tracks(self, query: str, provider_filter: str = "all", limit: int = 15) -> List[Dict[str, Any]]:
        """
        Search tracks across enabled providers according to provider_filter.
        provider_filter options: 'all', 'isaiify', 'freetouse', 'jamendo', 'soundcloud'.
        """
        results: List[Dict[str, Any]] = []
        if not query.strip():
            return results

        filter_clean = provider_filter.lower().strip()

        # Query Free To Use if requested (no auth needed)
        if filter_clean in ("all", "freetouse"):
            try:
                ftu_tracks = self.freetouse.search_tracks(query, limit=limit)
                results.extend(ftu_tracks)
            except Exception as e:
                print(f"[ProviderManager] FreeToUse track search error: {e}")

        # Query Jamendo if requested and configured
        if filter_clean in ("all", "jamendo") and self.jamendo.is_configured():
            try:
                jam_tracks = self.jamendo.search_tracks(query, limit=limit)
                results.extend(jam_tracks)
            except Exception as e:
                print(f"[ProviderManager] Jamendo track search error: {e}")

        # Query SoundCloud if requested and configured
        if filter_clean in ("all", "soundcloud") and self.soundcloud.is_configured():
            try:
                sc_tracks = self.soundcloud.search_tracks(query, limit=limit)
                results.extend(sc_tracks)
            except Exception as e:
                print(f"[ProviderManager] SoundCloud track search error: {e}")

        return results

    def search_albums(self, query: str, provider_filter: str = "all", limit: int = 10) -> List[Dict[str, Any]]:
        """Search albums across external providers."""
        results: List[Dict[str, Any]] = []
        if not query.strip():
            return results

        filter_clean = provider_filter.lower().strip()

        if filter_clean in ("all", "freetouse"):
            try:
                ftu_albums = self.freetouse.search_albums(query, limit=limit)
                results.extend(ftu_albums)
            except Exception as e:
                print(f"[ProviderManager] FreeToUse album search error: {e}")

        if filter_clean in ("all", "jamendo") and self.jamendo.is_configured():
            try:
                jam_albums = self.jamendo.search_albums(query, limit=limit)
                results.extend(jam_albums)
            except Exception as e:
                print(f"[ProviderManager] Jamendo album search error: {e}")

        if filter_clean in ("all", "soundcloud") and self.soundcloud.is_configured():
            try:
                sc_albums = self.soundcloud.search_albums(query, limit=limit)
                results.extend(sc_albums)
            except Exception as e:
                print(f"[ProviderManager] SoundCloud album search error: {e}")

        return results

    def search_artists(self, query: str, provider_filter: str = "all", limit: int = 10) -> List[Dict[str, Any]]:
        """Search artists across external providers."""
        results: List[Dict[str, Any]] = []
        if not query.strip():
            return results

        filter_clean = provider_filter.lower().strip()

        if filter_clean in ("all", "freetouse"):
            try:
                ftu_artists = self.freetouse.search_artists(query, limit=limit)
                results.extend(ftu_artists)
            except Exception as e:
                print(f"[ProviderManager] FreeToUse artist search error: {e}")

        if filter_clean in ("all", "jamendo") and self.jamendo.is_configured():
            try:
                jam_artists = self.jamendo.search_artists(query, limit=limit)
                results.extend(jam_artists)
            except Exception as e:
                print(f"[ProviderManager] Jamendo artist search error: {e}")

        if filter_clean in ("all", "soundcloud") and self.soundcloud.is_configured():
            try:
                sc_artists = self.soundcloud.search_artists(query, limit=limit)
                results.extend(sc_artists)
            except Exception as e:
                print(f"[ProviderManager] SoundCloud artist search error: {e}")

        return results

    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Route track lookup to the appropriate external provider if prefixed."""
        if track_id.startswith("freetouse_"):
            return self.freetouse.get_track(track_id)
        elif track_id.startswith("jamendo_"):
            return self.jamendo.get_track(track_id)
        elif track_id.startswith("soundcloud_"):
            return self.soundcloud.get_track(track_id)
        return None

    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        """Route album lookup to the appropriate external provider if prefixed."""
        if album_id.startswith("freetouse_alb_"):
            return self.freetouse.get_album(album_id)
        elif album_id.startswith("jamendo_alb_"):
            return self.jamendo.get_album(album_id)
        elif album_id.startswith("soundcloud_alb_"):
            return self.soundcloud.get_album(album_id)
        return None

# Singleton instance
provider_manager = ProviderManager()
