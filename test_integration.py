import sys
import os
import unittest
import json

# Ensure project root is in path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import database
from app import app
from providers import provider_manager
from providers.jamendo import JamendoProvider
from providers.soundcloud import SoundCloudProvider
from providers.freetouse import FreeToUseProvider

class TestJamendoSoundCloudIntegration(unittest.TestCase):

    def setUp(self):
        self.client = app.test_client()
        database.init_db()

    def test_01_provider_statuses(self):
        """Test provider status reporting and default unconfigured behavior."""
        statuses = provider_manager.get_provider_statuses()
        self.assertIn("isaiify", statuses)
        self.assertIn("freetouse", statuses)
        self.assertIn("jamendo", statuses)
        self.assertIn("soundcloud", statuses)

        # Free To Use status
        ftu = statuses["freetouse"]
        self.assertEqual(ftu["provider"], "freetouse")
        self.assertTrue(ftu["configured"])
        self.assertTrue(ftu["can_stream"])
        self.assertTrue(ftu["can_download"])

        # Isaiify Vault
        self.assertTrue(statuses["isaiify"]["configured"])
        self.assertTrue(statuses["isaiify"]["can_stream"])
        self.assertTrue(statuses["isaiify"]["can_download"])

        # Jamendo status
        jam = statuses["jamendo"]
        self.assertEqual(jam["provider"], "jamendo")
        self.assertIn("Creative Commons", jam["license_type"])
        self.assertIn("audiodownload_allowed", jam["can_download"])

        # SoundCloud status
        sc = statuses["soundcloud"]
        self.assertEqual(sc["provider"], "soundcloud")
        self.assertFalse(sc["can_download"])
        self.assertIn("prohibit", sc["download_restriction_reason"].lower())

    def test_02_status_endpoint(self):
        """Test GET /api/providers/status."""
        res = self.client.get("/api/providers/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertIn("jamendo", data["providers"])
        self.assertIn("soundcloud", data["providers"])
        self.assertIn("isaiify", data["providers"])

    def test_03_search_all_and_filtered(self):
        """Test search across providers."""
        # 1. Search 'all'
        res = self.client.get("/api/search?q=ready&provider=all")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertIn("songs", data)
        self.assertIn("provider_statuses", data)
        self.assertGreater(len(data["songs"]), 0)

        # 2. Search 'isaiify'
        res_local = self.client.get("/api/search?q=ready&provider=isaiify")
        self.assertEqual(res_local.status_code, 200)
        data_local = res_local.get_json()
        self.assertTrue(data_local["success"])
        for s in data_local["songs"]:
            self.assertEqual(s.get("provider", "isaiify"), "isaiify")

        # 3. Search unconfigured external provider (e.g., soundcloud without credentials)
        res_sc = self.client.get("/api/search?q=pop&provider=soundcloud")
        self.assertEqual(res_sc.status_code, 200)
        data_sc = res_sc.get_json()
        self.assertTrue(data_sc["success"])
        # With no credentials, it must gracefully return an empty list without crashing
        self.assertEqual(data_sc["songs"], [])

    def test_04_like_external_song_and_recommendations(self):
        """Test liking an external Jamendo/SoundCloud song persists metadata and updates recommendations."""
        test_user = "test_listener_abc123"
        ext_song = {
            "id": "jamendo_test_42001",
            "title": "Ambient Chill Horizons",
            "artist": "Solar Waves",
            "album": "Deep Space Ambient",
            "album_id": "jamendo_alb_9999",
            "audio_url": "https://example.com/audio.mp3",
            "image_url": "https://example.com/art.jpg",
            "language": "ENGLISH",
            "category": "Ambient Chill",
            "duration_seconds": 185,
            "tags": "ambient, chill, relaxing, synth",
            "allow_download": 1,
            "provider": "jamendo",
            "source_url": "https://www.jamendo.com/track/42001",
            "license_url": "https://creativecommons.org/licenses/by/4.0/"
        }

        # Toggle like with song_data payload
        res = self.client.post(
            f"/api/favorites/{ext_song['id']}/toggle",
            data=json.dumps({"song_data": ext_song, "user_id": test_user}),
            headers={"X-User-Id": test_user, "Content-Type": "application/json"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertEqual(data["is_favorite"], 1)

        # Check in database
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM songs WHERE id = ?", (ext_song["id"],))
        row = cursor.fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["provider"], "jamendo")
        self.assertEqual(row["source_url"], "https://www.jamendo.com/track/42001")
        self.assertEqual(row["allow_download"], 1)

        # Check favorites endpoint returns it
        fav_res = self.client.get("/api/favorites", headers={"X-User-Id": test_user})
        fav_data = fav_res.get_json()
        self.assertTrue(fav_data["success"])
        fav_ids = [s["id"] for s in fav_data["favorites"]]
        self.assertIn(ext_song["id"], fav_ids)

        # Check recommendations engine runs without crashing and uses preferences
        rec_res = self.client.get("/api/recommendations", headers={"X-User-Id": test_user})
        rec_data = rec_res.get_json()
        self.assertTrue(rec_data["success"])
        self.assertGreater(len(rec_data["recommendations"]), 0)

        # Cleanup test like
        self.client.post(
            f"/api/favorites/{ext_song['id']}/toggle",
            data=json.dumps({"user_id": test_user}),
            headers={"X-User-Id": test_user, "Content-Type": "application/json"}
        )
        conn.close()

    def test_05_soundcloud_download_prohibition(self):
        """SoundCloud normalization must strictly enforce allow_download = 0."""
        sc_provider = SoundCloudProvider()
        raw_track = {
            "id": 987654321,
            "title": "Live DJ Set",
            "user": {"username": "SoundCloudArtist"},
            "permalink_url": "https://soundcloud.com/artist/track",
            "artwork_url": "https://example.com/art.jpg",
            "duration": 240000,
            "genre": "Electronic",
            "tag_list": "techno house live",
            "media": {
                "transcodings": [
                    {
                        "format": {"protocol": "progressive", "mime_type": "audio/mpeg"},
                        "url": "https://api-v2.soundcloud.com/media/stream"
                    }
                ]
            }
        }
        normalized = sc_provider._normalize_track(raw_track)
        self.assertEqual(normalized["provider"], "soundcloud")
        self.assertEqual(normalized["allow_download"], 0, "SoundCloud tracks must NEVER allow download")
        self.assertEqual(normalized["source_url"], "https://soundcloud.com/artist/track")

    def test_06_jamendo_download_conditional(self):
        """Jamendo normalization must respect audiodownload_allowed."""
        jam_provider = JamendoProvider()
        # Track 1: Artist disabled downloads
        raw_restricted = {
            "id": "111",
            "name": "Restricted Song",
            "artist_name": "JamendoArtist1",
            "album_name": "Album 1",
            "album_id": "1",
            "audio": "https://audio.jamendo.com/stream.mp3",
            "audiodownload": "",
            "audiodownload_allowed": False,
            "shareurl": "https://www.jamendo.com/track/111",
            "image": "https://example.com/img.jpg",
            "duration": 180,
            "license_ccurl": "https://creativecommons.org/licenses/by/3.0/"
        }
        norm_restricted = jam_provider._normalize_track(raw_restricted)
        self.assertEqual(norm_restricted["allow_download"], 0)

        # Track 2: Artist allowed downloads
        raw_allowed = {
            "id": "222",
            "name": "Free CC Song",
            "artist_name": "JamendoArtist2",
            "album_name": "Album 2",
            "album_id": "2",
            "audio": "https://audio.jamendo.com/stream.mp3",
            "audiodownload": "https://audio.jamendo.com/download.mp3",
            "audiodownload_allowed": True,
            "shareurl": "https://www.jamendo.com/track/222",
            "image": "https://example.com/img.jpg",
            "duration": 200,
            "license_ccurl": "https://creativecommons.org/licenses/by/4.0/"
        }
        norm_allowed = jam_provider._normalize_track(raw_allowed)
        self.assertEqual(norm_allowed["allow_download"], 1)

    def test_07_freetouse_search_and_playback(self):
        """Test Free To Use provider search, normalization, and track properties."""
        ftu = FreeToUseProvider()
        tracks = ftu.search_tracks("lofi", limit=3)
        self.assertGreater(len(tracks), 0, "Free To Use should return tracks for 'lofi'")
        first = tracks[0]
        self.assertTrue(first["id"].startswith("freetouse_"))
        self.assertTrue(first["audio_url"].startswith("http"))
        self.assertTrue(first["image_url"].startswith("http"))
        self.assertEqual(first["provider"], "freetouse")
        self.assertEqual(first["allow_download"], 1)

        # Test search endpoint via Flask client
        res = self.client.get("/api/search?q=lofi&provider=freetouse")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])
        self.assertGreater(len(data["songs"]), 0)
        self.assertEqual(data["songs"][0]["provider"], "freetouse")

    def test_08_spotify_integration(self):
        """Test Spotify Web API integration, token authentication, and endpoints."""
        # 1. Provider status
        statuses = provider_manager.get_provider_statuses()
        self.assertIn("spotify", statuses)
        sp_status = statuses["spotify"]
        self.assertTrue(sp_status["configured"])
        self.assertTrue(sp_status["can_stream"])
        self.assertFalse(sp_status["can_download"])
        self.assertIn("pavin", sp_status["status"])

        # 2. GET /api/spotify/me
        me_res = self.client.get("/api/spotify/me")
        self.assertEqual(me_res.status_code, 200)
        me_data = me_res.get_json()
        self.assertTrue(me_data["success"])
        self.assertEqual(me_data["user"]["id"], "316ftwyy4es7x7oolqy6oeptajlu")
        self.assertEqual(me_data["user"]["display_name"], "pavin")

        # 3. GET /api/spotify/top-tracks
        top_res = self.client.get("/api/spotify/top-tracks")
        self.assertEqual(top_res.status_code, 200)
        top_data = top_res.get_json()
        self.assertTrue(top_data["success"])
        self.assertIn("tracks", top_data)
        self.assertGreater(len(top_data["tracks"]), 0)
        first_top = top_data["tracks"][0]
        self.assertTrue(first_top["id"].startswith("spotify_"))
        self.assertEqual(first_top["provider"], "spotify")
        self.assertEqual(first_top["allow_download"], 0)
        self.assertTrue(first_top["source_url"].startswith("https://open.spotify.com"))

        # 4. Search Spotify
        search_res = self.client.get("/api/search?q=ready&provider=spotify")
        self.assertEqual(search_res.status_code, 200)
        search_data = search_res.get_json()
        self.assertTrue(search_data["success"])
        self.assertGreater(len(search_data["songs"]), 0)
        first_sp = search_data["songs"][0]
        self.assertEqual(first_sp["provider"], "spotify")
        self.assertEqual(first_sp["allow_download"], 0)

    def test_09_spotify_openapi_and_auth_rules(self):
        """Test compliance with Spotify OpenAPI, PKCE, minimal scopes, and redirect URI rules."""
        sp = provider_manager.spotify

        # 1. PKCE Generator (RFC 7636)
        verifier, challenge = sp.generate_pkce_pair()
        self.assertEqual(len(verifier), 64, "Code verifier must be 64 characters")
        self.assertGreater(len(challenge), 40, "Code challenge must be a valid Base64URL string")
        self.assertNotIn("=", challenge, "Code challenge must not have padding")

        # 2. Redirect URI Rule: Never use localhost or wildcards, always HTTPS or 127.0.0.1
        local_uri = sp.get_redirect_uri("localhost:5000")
        self.assertNotIn("localhost", local_uri, "Redirect URI must never contain localhost")
        self.assertIn("127.0.0.1:5000", local_uri, "Local redirect URI must use 127.0.0.1")
        self.assertTrue(local_uri.startswith("http://127.0.0.1"), "Local redirect must use http://127.0.0.1")

        prod_uri = sp.get_redirect_uri("isaiify-python.onrender.com")
        self.assertTrue(prod_uri.startswith("https://"), "Production redirect URI must be HTTPS")
        self.assertNotIn("*", prod_uri, "Redirect URI must never use wildcard")

        # 3. Minimal Scopes Rule
        self.assertEqual(sp.get_status()["scopes"], ["user-read-private", "user-read-email", "user-top-read"])

        # 4. Authorization URL endpoint (GET /api/spotify/login)
        login_res = self.client.get("/api/spotify/login", headers={"X-User-Id": "test_pkce_user"})
        self.assertEqual(login_res.status_code, 200)
        login_data = login_res.get_json()
        self.assertTrue(login_data["success"])
        self.assertIn("accounts.spotify.com/authorize", login_data["auth_url"])
        self.assertIn("code_challenge_method=S256", login_data["auth_url"])
        self.assertIn("response_type=code", login_data["auth_url"])
        self.assertIn("state=", login_data["auth_url"])

        # 5. Token Management & Storage (database save, get, delete)
        test_uid = "test_listener_storage"
        database.save_spotify_auth(
            user_id=test_uid,
            access_token="test_access_token_123",
            refresh_token="test_refresh_token_456",
            expires_in=3600,
            scope="user-read-private user-top-read",
            spotify_user_id="sp_test_user",
            spotify_display_name="Test Spotify User"
        )
        stored = database.get_spotify_auth(test_uid)
        self.assertIsNotNone(stored)
        self.assertEqual(stored["access_token"], "test_access_token_123")
        self.assertEqual(stored["refresh_token"], "test_refresh_token_456")
        self.assertEqual(stored["spotify_user_id"], "sp_test_user")

        # Clean up
        database.delete_spotify_auth(test_uid)
        self.assertIsNone(database.get_spotify_auth(test_uid))

        # 6. Non-deprecated playlist items endpoint
        pl_res = self.client.get("/api/providers/spotify/playlists/test_pl_123/items")
        self.assertEqual(pl_res.status_code, 200)
        self.assertTrue(pl_res.get_json()["success"])

if __name__ == "__main__":
    unittest.main()
