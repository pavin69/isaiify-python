import express from "express";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.static("public"));

let cachedToken = null;
let tokenExpiry = 0;

// 1. Get or refresh the Spotify Access Token using Client Credentials Flow
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const authHeader = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`Spotify Auth Error: ${data.error_description || data.error}`);
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// 2. Search endpoint for frontend (max limit is 10)
app.get("/api/search", async (req, res) => {
  try {
    const query = req.query.q || "daft punk";
    const token = await getAccessToken();

    const spotifyRes = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const rawText = await spotifyRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { error: { message: rawText } };
    }

    if (!spotifyRes.ok) {
      const errMsg = data.error?.message || data.error || rawText;
      console.warn(`[Spotify API] Status ${spotifyRes.status} (${errMsg}). Falling back to Free To Use catalog.`);

      // Fallback to FreeToUse API when Spotify account lacks Premium or encounters errors
      try {
        const ftuUrl = query
          ? `https://api.freetouse.com/v3/music/tracks/search?query=${encodeURIComponent(query)}&limit=10`
          : `https://api.freetouse.com/v3/music/tracks/all?limit=10`;
        const ftuRes = await fetch(ftuUrl);
        const ftuData = await ftuRes.json();
        const ftuItems = (ftuData.data || []).map(t => ({
          id: `ftu_${t.id}`,
          name: t.title || "Untitled Track",
          artists: [{ name: (t.artists && t.artists[0]?.name) || "Free To Use Artist" }],
          album: {
            images: [
              { url: t.thumbnails?.lg || t.thumbnails?.md || "" },
              { url: t.thumbnails?.md || "" },
              { url: t.thumbnails?.sm || t.thumbnails?.md || "" }
            ]
          },
          audio_url: t.files?.mp3 || ""
        }));

        if (ftuItems.length > 0) {
          return res.json(ftuItems);
        }
      } catch (ftuErr) {
        console.warn("[FreeToUse Fallback] Error:", ftuErr.message);
      }

      return res.status(spotifyRes.status).json({
        error: `Spotify API Error (${spotifyRes.status})`,
        details: errMsg
      });
    }

    res.json(data.tracks?.items || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tracks from Spotify", details: err.message });
  }
});

// 3. Client configuration for PKCE authorization flow
app.get("/api/config", (req, res) => {
  const host = req.get("host") || "";
  const isLocal = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  const protocol = isLocal ? "http" : (req.headers["x-forwarded-proto"] || "https");
  const cleanHost = host.replace("localhost", "127.0.0.1");
  const redirectUri = `${protocol}://${cleanHost}/playlists.html`;

  res.json({
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    redirectUri: redirectUri
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running at http://127.0.0.1:${PORT}`));
