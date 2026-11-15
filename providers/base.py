"""
=============================================================================
ISAIIFY MUSIC PROVIDERS BASE INTERFACE (providers/base.py)
=============================================================================
Abstract base class defining the contract for all external and local music
catalog providers (Jamendo, SoundCloud, Isaiify Vault).
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class MusicProvider(ABC):
    """
    Common interface for music catalog and streaming providers.
    Every provider must implement configuration inspection, track search,
    album retrieval, and attribution metadata.
    """
    name: str = "base"
    display_name: str = "Base Provider"
    attribution_text: str = ""
    attribution_url: str = ""

    @abstractmethod
    def is_configured(self) -> bool:
        """Return True if required API credentials/keys are present."""
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """Return a dictionary describing configuration status, licensing terms, and setup guidance."""
        pass

    @abstractmethod
    def search_tracks(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Search for tracks matching the query."""
        pass

    @abstractmethod
    def search_albums(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for albums matching the query."""
        pass

    @abstractmethod
    def search_artists(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for artists matching the query."""
        pass

    @abstractmethod
    def get_track(self, track_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full metadata for a specific track by its provider ID."""
        pass

    @abstractmethod
    def get_album(self, album_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve full album metadata and its tracklist."""
        pass
