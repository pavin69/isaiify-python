"""
ISAIIFY PROVIDERS PACKAGE
Exposes the central provider_manager and provider classes.
"""

from .base import MusicProvider
from .jamendo import JamendoProvider
from .soundcloud import SoundCloudProvider
from .manager import provider_manager, ProviderManager

__all__ = [
    "MusicProvider",
    "JamendoProvider",
    "SoundCloudProvider",
    "provider_manager",
    "ProviderManager"
]
