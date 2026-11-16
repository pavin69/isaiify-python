# Spotify Music App

A Node.js & Express application integrated with the official Spotify Web API.

## Features
- **Client Credentials Flow:** Server-side token management for searching tracks (`/api/search`, clamped limit: 10).
- **PKCE Authorization Code Flow:** Client-side secure authentication for user playlists and profile access (no client secrets exposed in frontend).
- **Embedded Player:** Embedded Spotify Web Player iframe for official playback.
- **Playlists Browser:** Fetches user playlists and tracks using the official `/v1/playlists/{id}/items` endpoint.

## Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure `.env`:**
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   PORT=3000
   ```

3. **Spotify Developer Dashboard Configuration:**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - In your app settings, add the redirect URI:
     `http://127.0.0.1:3000/playlists.html`
   - Note: Do NOT use `localhost` or wildcards as per Spotify OpenAPI requirements.

4. **Start the server:**
   ```bash
   npm start
   # or
   node server.js
   ```

5. **Open in browser:**
   - Track Search: `http://127.0.0.1:3000/`
   - User Playlists: `http://127.0.0.1:3000/playlists.html`
