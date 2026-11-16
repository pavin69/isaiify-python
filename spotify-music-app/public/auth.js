let CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID";
const SCOPES = "playlist-read-private playlist-read-collaborative user-read-private";

function getRedirectUri() {
  const origin = window.location.origin;
  // Spotify OpenAPI strictly requires 127.0.0.1 instead of localhost for local dev
  const cleanOrigin = origin.replace("localhost", "127.0.0.1");
  return `${cleanOrigin}/playlists.html`;
}

// Fetch client ID dynamically from server /api/config if not manually replaced
async function getClientId() {
  if (CLIENT_ID && CLIENT_ID !== "YOUR_SPOTIFY_CLIENT_ID") return CLIENT_ID;
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.clientId) {
      CLIENT_ID = data.clientId;
    }
  } catch (e) {
    console.warn("Could not load /api/config", e);
  }
  return CLIENT_ID;
}

// Generate random string for PKCE code verifier
function generateRandomString(length) {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

// SHA-256 hash & Base64URL encode for PKCE code challenge
async function generateCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function redirectToSpotifyLogin() {
  const clientId = await getClientId();
  const verifier = generateRandomString(64);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem("pkce_verifier", verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function handleCallbackAndGetToken() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");

  // Return existing token if already logged in
  if (!code) return localStorage.getItem("spotify_access_token");

  const clientId = await getClientId();
  const verifier = localStorage.getItem("pkce_verifier");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    }),
  });

  const data = await response.json();
  if (data.access_token) {
    localStorage.setItem("spotify_access_token", data.access_token);
    // Clean the ?code= parameter from the URL bar
    window.history.replaceState({}, document.title, window.location.pathname);
    return data.access_token;
  }
  return null;
}
