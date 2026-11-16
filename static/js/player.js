// ISAIIFY MUSIC PLAYER ENGINE - v2.5
// Premium Dark Design & Unified Streaming Architecture

let allSongs = [];
let allAlbums = [];
let allArtists = [];
let currentPlaylist = [];
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let currentLanguage = "ALL";
let isMuted = false;
let prevVolume = 0.8;

// Navigation & Active View State
let currentView = "home";
let viewHistory = ["home"];
let currentAlbum = null;
let currentArtist = null;
let isQueueOpen = false;

// Provider Integration State (Jamendo, SoundCloud, Isaiify Vault)
let selectedSearchProvider = "all";
let cachedProviderStatuses = null;
let lastSearchResults = { songs: [], albums: [], artists: [] };

// User Identity & Preference State
function getUserId() {
    let uid = localStorage.getItem("isaiify_user_id");
    if (!uid) {
        uid = "listener_" + Math.random().toString(36).substring(2, 9);
        localStorage.setItem("isaiify_user_id", uid);
    }
    return uid;
}

function authHeaders() {
    return {
        "X-User-Id": getUserId(),
        "Content-Type": "application/json"
    };
}

// Completed Play & Event Tracking State
let currentActiveListenSeconds = 0;
let lastListenCheckTime = null;
const completedPlayCooldown = new Set();

// Offline IndexedDB Storage State
const DB_NAME = "isaiify_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "downloaded_songs";
let downloadedSongIds = new Set();
let downloadingSongIds = new Set();

// DOM Elements
const audio = document.getElementById("audioPlayer");
const playPauseBtn = document.getElementById("playPauseBtn");
const playerTitle = document.getElementById("playerTitle");
const playerArtist = document.getElementById("playerArtist");
const playerArtwork = document.getElementById("playerArtwork");
const playerEqualizer = document.getElementById("playerEqualizer");
const playerFavoriteBtn = document.getElementById("playerFavoriteBtn");
const playerDownloadBtn = document.getElementById("playerDownloadBtn");
const playerQueueBtn = document.getElementById("playerQueueBtn");
const playerLangBadge = document.getElementById("playerLangBadge");
const progressBar = document.getElementById("progressBar");
const currentTimeLabel = document.getElementById("currentTime");
const totalTimeLabel = document.getElementById("totalTime");
const volumeSlider = document.getElementById("volumeSlider");
const muteBtn = document.getElementById("muteBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const greetingText = document.getElementById("greetingText");
const userNameLabel = document.getElementById("userNameLabel");
const offlineBanner = document.getElementById("offlineBanner");
const queueDrawer = document.getElementById("queueDrawer");

// Initialize App on DOM Load
document.addEventListener("DOMContentLoaded", async () => {
    checkUrlAuthStatus();
    updateGreeting();
    initUserDisplay();
    setupNetworkListeners();
    setupKeyboardShortcuts();
    renderCategoriesGrid();

    await fetchProviderStatuses();
    await initOfflineDB();
    await loadAllData();
    await loadSpotifyTopTracks();
    await loadRecommendations();
    await loadRecentlyPlayed();
    setupAudioListeners();
});

function checkUrlAuthStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("spotify_status") === "connected") {
        const user = params.get("spotify_user") || "Spotify user";
        showToast(`Spotify account connected successfully (@${user})!`);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("spotify_error")) {
        const err = params.get("spotify_error");
        showToast(`Spotify authorization notice: ${err}`);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

function initUserDisplay() {
    const uid = getUserId();
    const shortId = uid.replace("listener_", "").substring(0, 5).toUpperCase();
    if (userNameLabel) {
        userNameLabel.innerText = `Listener #${shortId}`;
    }
}

function setupNetworkListeners() {
    function handleOnlineStatus() {
        if (!navigator.onLine) {
            if (offlineBanner) offlineBanner.style.display = "flex";
            showToast("Offline mode active &mdash; playing from local downloads.");
        } else {
            if (offlineBanner) offlineBanner.style.display = "none";
        }
    }
    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);
    handleOnlineStatus();
}

function updateGreeting() {
    const hour = new Date().getHours();
    let text = "Good evening";
    let overline = "DISCOVER TONIGHT";
    if (hour >= 4 && hour < 12) {
        text = "Good morning";
        overline = "START YOUR DAY WITH MUSIC";
    } else if (hour >= 12 && hour < 17) {
        text = "Good afternoon";
        overline = "AFTERNOON ENERGY BOOST";
    }
    if (greetingText) greetingText.innerText = text;
    const overlineEl = document.getElementById("greetingOverline");
    if (overlineEl) overlineEl.innerText = overline;
}

// =============================================================================
// OFFLINE STORAGE ENGINE (IndexedDB)
// =============================================================================

function openOfflineDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function initOfflineDB() {
    try {
        await refreshDownloadedSongsCache();
    } catch (err) {
        console.warn("IndexedDB init note:", err);
    }
}

async function refreshDownloadedSongsCache() {
    const list = await getAllDownloadedSongs();
    downloadedSongIds = new Set(list.map(item => item.id));
    updateSidebarDownloadBadge(downloadedSongIds.size);
    updateDownloadButtonsInDOM();
}

function updateSidebarDownloadBadge(count) {
    const badge = document.getElementById("downloadBadge");
    if (!badge) return;
    if (count > 0) {
        badge.innerText = count;
        badge.style.display = "inline-block";
    } else {
        badge.style.display = "none";
    }
}

async function getDownloadedSong(id) {
    try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}

async function getAllDownloadedSongs() {
    try {
        const db = await openOfflineDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    } catch (e) {
        return [];
    }
}

async function saveDownloadedSong(record) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

async function deleteDownloadedSong(id) {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

async function clearAllDownloadedSongs() {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

async function toggleSongDownload(songId, event) {
    if (event) event.stopPropagation();

    if (downloadedSongIds.has(songId)) {
        await removeDownload(songId);
        return;
    }
    if (downloadingSongIds.has(songId)) return;

    // Find song metadata across all active sources
    const song = allSongs.find(s => s.id === songId) || 
                 (currentAlbum && currentAlbum.songs ? currentAlbum.songs.find(s => s.id === songId) : null) ||
                 (currentArtist && currentArtist.songs ? currentArtist.songs.find(s => s.id === songId) : null) ||
                 (lastSearchResults && lastSearchResults.songs ? lastSearchResults.songs.find(s => s.id === songId) : null) ||
                 currentPlaylist.find(s => s.id === songId);

    if (!song) {
        showToast("Song metadata not found.");
        return;
    }

    if (song.provider === "soundcloud") {
        showToast("Offline downloads disabled: SoundCloud API Terms of Use prohibit downloading or caching.");
        return;
    }

    if (song.allow_download === 0 || song.is_online || (song.provider === "jamendo" && song.allow_download !== 1)) {
        showToast("Streaming only: Artist has not granted Creative Commons download rights for this track.");
        return;
    }

    downloadingSongIds.add(songId);
    updateSongDownloadButtonUI(songId, "downloading");
    showToast(`Downloading '${song.title}' for offline listening...`);

    try {
        const response = await fetch(song.audio_url);
        if (!response.ok) throw new Error("Audio download network fetch failed");
        const blob = await response.blob();

        const record = {
            id: song.id,
            song: { ...song },
            audioBlob: blob,
            sizeBytes: blob.size,
            downloadedAt: new Date().toISOString()
        };

        await saveDownloadedSong(record);
        downloadingSongIds.delete(songId);
        downloadedSongIds.add(songId);

        updateSidebarDownloadBadge(downloadedSongIds.size);
        updateSongDownloadButtonUI(songId, "downloaded");
        showToast(`Saved '${song.title}' to Offline Downloads! 📥`);

        if (currentView === "downloads") {
            loadDownloadsView();
        }
    } catch (err) {
        console.error("Offline download failed:", err);
        downloadingSongIds.delete(songId);
        updateSongDownloadButtonUI(songId, "idle");
        showToast(`Download failed for '${song.title}'. Please check connection.`);
    }
}

async function removeDownload(songId, event) {
    if (event) event.stopPropagation();
    try {
        await deleteDownloadedSong(songId);
        downloadedSongIds.delete(songId);
        updateSidebarDownloadBadge(downloadedSongIds.size);
        updateSongDownloadButtonUI(songId, "idle");
        showToast("Removed from Downloads.");

        if (currentView === "downloads") {
            loadDownloadsView();
        }
    } catch (err) {
        console.error("Remove download error:", err);
    }
}

async function clearAllDownloads() {
    if (!confirm("Are you sure you want to remove all downloaded songs from offline storage?")) return;
    try {
        await clearAllDownloadedSongs();
        downloadedSongIds.clear();
        updateSidebarDownloadBadge(0);
        updateDownloadButtonsInDOM();
        showToast("All offline downloads cleared.");
        loadDownloadsView();
    } catch (err) {
        console.error(err);
    }
}

function updateSongDownloadButtonUI(songId, state) {
    const btns = document.querySelectorAll(`[data-dl-id="${songId}"]`);
    btns.forEach(btn => {
        btn.classList.remove("downloaded", "downloading");
        if (state === "downloaded") {
            btn.classList.add("downloaded");
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            btn.title = "Downloaded (Offline ready)";
        } else if (state === "downloading") {
            btn.classList.add("downloading");
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btn.title = "Downloading...";
        } else {
            btn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            btn.title = "Download for offline listening";
        }
    });

    const currentTrack = currentPlaylist[currentTrackIndex];
    if (currentTrack && currentTrack.id === songId && playerDownloadBtn) {
        if (state === "downloaded") {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10B981;"></i>';
            playerDownloadBtn.title = "Downloaded (Offline ready)";
        } else if (state === "downloading") {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#F59E0B;"></i>';
            playerDownloadBtn.title = "Downloading...";
        } else {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            playerDownloadBtn.title = "Download for Offline";
        }
    }
}

function updateDownloadButtonsInDOM() {
    document.querySelectorAll("[data-dl-id]").forEach(btn => {
        const id = btn.getAttribute("data-dl-id");
        if (downloadedSongIds.has(id)) {
            btn.classList.add("downloaded");
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            btn.title = "Downloaded (Offline ready)";
        } else {
            btn.classList.remove("downloaded", "downloading");
            btn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            btn.title = "Download for offline listening";
        }
    });

    const currentTrack = currentPlaylist[currentTrackIndex];
    if (currentTrack && playerDownloadBtn) {
        if (downloadedSongIds.has(currentTrack.id)) {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10B981;"></i>';
            playerDownloadBtn.title = "Downloaded (Offline ready)";
        } else {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-arrow-down"></i>';
            playerDownloadBtn.title = "Download for Offline";
        }
    }
}

function toggleCurrentDownload() {
    const track = currentPlaylist[currentTrackIndex];
    if (track) {
        toggleSongDownload(track.id);
    }
}

// =============================================================================
// DATA FETCHING & RENDERING
// =============================================================================

async function loadAllData() {
    const skeleton = document.getElementById("skeletonContainer");
    if (skeleton) skeleton.style.display = "block";

    try {
        const [songsRes, quickRes, artistsRes, albumsRes] = await Promise.all([
            fetch("/api/songs", { headers: authHeaders() }),
            fetch("/api/quick-access", { headers: authHeaders() }),
            fetch("/api/artists"),
            fetch("/api/albums")
        ]);

        const songsData = await songsRes.json();
        const quickData = await quickRes.json();
        const artistsData = await artistsRes.json();
        const albumsData = await albumsRes.json();

        if (skeleton) skeleton.style.display = "none";

        if (songsData.success) {
            allSongs = songsData.songs;
            currentPlaylist = [...allSongs];
            renderCarousels(allSongs);
            updateLikedCountBadge();
            if (allSongs.length > 0) {
                loadTrack(0, false); // Load first track paused
            }
        }

        if (quickData.success) {
            renderQuickAccess(quickData.songs);
        }

        if (artistsData.success) {
            allArtists = artistsData.artists;
            renderArtists(allArtists);
            renderAllArtistsView(allArtists);
        }

        if (albumsData.success) {
            allAlbums = albumsData.albums;
            renderAlbums(allAlbums);
        }
    } catch (err) {
        if (skeleton) skeleton.style.display = "none";
        console.error("Failed to load music data:", err);
        showToast("Notice: Running in offline/fallback mode.");
    }
}

async function loadRecentlyPlayed() {
    try {
        const res = await fetch("/api/recently-played", { headers: authHeaders() });
        const data = await res.json();
        const sec = document.getElementById("recentlyPlayedSection");
        const carousel = document.getElementById("recentlyPlayedCarousel");

        if (data.success && data.songs.length > 0 && carousel) {
            sec.style.display = "block";
            carousel.innerHTML = data.songs.map(s => createSongCardHtml(s)).join("");
            updateDownloadButtonsInDOM();
        }
    } catch (e) {
        console.warn("Recent plays note:", e);
    }
}

async function loadRecommendations() {
    try {
        const res = await fetch("/api/recommendations", { headers: authHeaders() });
        const data = await res.json();
        const carousel = document.getElementById("recommendationsCarousel");
        const section = document.getElementById("recommendationsSection");

        if (data.success && carousel && data.recommendations.length > 0) {
            section.style.display = "block";
            carousel.innerHTML = data.recommendations.map(s => createSongCardHtml(s)).join("");
            updateDownloadButtonsInDOM();
        }
    } catch (e) {
        console.warn("Recommendations note:", e);
    }
}

async function loadSpotifyTopTracks() {
    try {
        const res = await fetch("/api/spotify/top-tracks", { headers: authHeaders() });
        const data = await res.json();
        const sec = document.getElementById("spotifySection");
        const carousel = document.getElementById("spotifyCarousel");
        const subtitle = document.getElementById("spotifySubtitle");

        const tracks = data.top_tracks || data.tracks || [];
        if (data.success && tracks.length > 0 && carousel) {
            if (sec) sec.style.display = "block";
            if (subtitle && data.user) {
                subtitle.innerText = `Top listening picks & chart hits for @${data.user.display_name || 'pavin'}`;
            }
            carousel.innerHTML = tracks.map(s => createSongCardHtml(s)).join("");
            updateDownloadButtonsInDOM();

            // If local songs catalog is empty, populate currentPlaylist from Spotify tracks so player is ready
            if (allSongs.length === 0 && currentPlaylist.length === 0) {
                currentPlaylist = [...tracks];
                loadTrack(0, false);
            }
        }
    } catch (e) {
        console.warn("Spotify top tracks note:", e);
    }
}

function updateLikedCountBadge() {
    const badge = document.getElementById("likedCountBadge");
    if (!badge) return;
    const likedCount = allSongs.filter(s => s.is_favorite === 1).length;
    if (likedCount > 0) {
        badge.innerText = likedCount;
        badge.style.display = "inline-block";
    } else {
        badge.style.display = "none";
    }
}

// Render Top 6 Quick Cards
function renderQuickAccess(songs) {
    const grid = document.getElementById("quickAccessGrid");
    if (!grid) return;
    grid.innerHTML = songs.map(s => `
        <div class="quick-card" onclick="playSongById('${s.id}')">
            <img src="${s.image_url}" alt="${s.title}" loading="lazy">
            <span class="quick-card-title">${s.title}</span>
            <button class="play-btn" title="Play ${s.title}" aria-label="Play ${s.title}"><i class="fa-solid fa-play"></i></button>
        </div>
    `).join("");
}

// Render Song Carousels
function renderCarousels(songs) {
    const tamilCarousel = document.getElementById("tamilCarousel");
    const englishCarousel = document.getElementById("englishCarousel");
    const tamilSec = document.getElementById("tamilSection");
    const englishSec = document.getElementById("englishSection");

    const tamilSongs = songs.filter(s => s.language === "TAMIL");
    const englishSongs = songs.filter(s => s.language === "ENGLISH");

    if (tamilSec) tamilSec.style.display = tamilSongs.length > 0 ? "block" : "none";
    if (englishSec) englishSec.style.display = englishSongs.length > 0 ? "block" : "none";

    if (tamilCarousel && tamilSongs.length > 0) {
        tamilCarousel.innerHTML = tamilSongs.map(s => createSongCardHtml(s)).join("");
    }
    if (englishCarousel && englishSongs.length > 0) {
        englishCarousel.innerHTML = englishSongs.map(s => createSongCardHtml(s)).join("");
    }
    updateDownloadButtonsInDOM();
}

function createSongCardHtml(song) {
    const badgeClass = song.language === "TAMIL" ? "badge-tamil" : "badge-english";
    const onlineBadge = song.is_online ? '<span class="provider-pill pill-sm" style="background:#10B981; color:#041E15;">CLOUD</span>' : '';
    const isLiked = song.is_favorite === 1;
    const isDownloaded = downloadedSongIds.has(song.id);
    const isDownloading = downloadingSongIds.has(song.id);

    // Provider badge
    let providerBadgeHtml = '';
    if (song.provider === 'freetouse') {
        providerBadgeHtml = `<span class="provider-pill pill-freetouse pill-sm" title="Free To Use Royalty-Free Music"><i class="fa-solid fa-compact-disc"></i> Free To Use</span>`;
    } else if (song.provider === 'jamendo') {
        providerBadgeHtml = `<span class="provider-pill pill-jamendo pill-sm" title="Creative Commons License"><i class="fa-brands fa-creative-commons"></i> Jamendo</span>`;
    } else if (song.provider === 'soundcloud') {
        providerBadgeHtml = `<span class="provider-pill pill-soundcloud pill-sm" title="SoundCloud Stream"><i class="fa-brands fa-soundcloud"></i> SoundCloud</span>`;
    } else if (song.provider === 'spotify') {
        providerBadgeHtml = `<span class="provider-pill pill-spotify pill-sm" title="Spotify Web API Track"><i class="fa-brands fa-spotify"></i> Spotify</span>`;
    }

    // Source link-back icon
    let sourceLinkHtml = '';
    if (song.source_url) {
        sourceLinkHtml = `<a href="${song.source_url}" target="_blank" rel="noopener noreferrer" class="card-ext-link" title="Open original on ${song.provider || 'source'}" onclick="event.stopPropagation()"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`;
    }

    // Download button according to licensing & provider policy
    let downloadBtnHtml = '';
    if (song.provider === 'soundcloud' || song.provider === 'spotify') {
        const termsName = song.provider === 'spotify' ? 'Spotify Developer Terms' : 'SoundCloud terms';
        const termsMsg = song.provider === 'spotify'
            ? 'Spotify Developer Terms strictly prohibit downloading, caching or offline saving of audio tracks.'
            : 'SoundCloud terms strictly prohibit offline downloading or caching.';
        downloadBtnHtml = `
            <button class="card-action-btn dl-restricted" 
                    title="Offline downloads disabled (${termsName} prohibit downloading or caching)" 
                    onclick="handleRestrictedDownload('${termsMsg}', event)"
                    aria-label="Downloads disabled for ${song.provider}">
                <i class="fa-solid fa-ban"></i>
            </button>
        `;
    } else if (song.allow_download === 0 || (song.provider === 'jamendo' && song.allow_download !== 1)) {
        downloadBtnHtml = `
            <button class="card-action-btn dl-restricted" 
                    title="Streaming only (Artist has not enabled CC download permission)" 
                    onclick="handleRestrictedDownload('Artist has not granted Creative Commons download rights for this track.', event)"
                    aria-label="Streaming only">
                <i class="fa-solid fa-ban"></i>
            </button>
        `;
    } else {
        downloadBtnHtml = `
            <button class="card-action-btn ${isDownloaded ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}" 
                    data-dl-id="${song.id}"
                    title="${isDownloaded ? 'Downloaded (Offline)' : 'Download for offline'}" 
                    onclick="toggleSongDownload('${song.id}', event)"
                    aria-label="Download ${song.title}">
                <i class="${isDownloaded ? 'fa-solid fa-circle-check' : (isDownloading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-down')}"></i>
            </button>
        `;
    }

    const recBadge = song.recommendation_reason ? 
        `<div class="rec-reason-badge" title="${song.recommendation_reason}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${song.recommendation_reason}</div>` : '';

    return `
        <div class="music-card" onclick="handleCardClick('${song.id}')">
            <div class="card-img-wrap">
                <img src="${song.image_url}" alt="${song.title}" loading="lazy">
                <span class="lang-badge ${badgeClass}">${song.language || 'MUSIC'}</span>
                <button class="card-play-btn" aria-label="Play ${song.title}"><i class="fa-solid fa-play"></i></button>

                <div class="card-actions-hover">
                    <button class="card-action-btn ${isLiked ? 'liked' : ''}" 
                            data-fav-id="${song.id}"
                            title="${isLiked ? 'Unlike' : 'Like'}" 
                            onclick="toggleLikeSong('${song.id}', event)"
                            aria-label="Like ${song.title}">
                        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
                    </button>
                    ${downloadBtnHtml}
                </div>
            </div>
            <div class="card-title-row">
                <div class="card-title">${song.title} ${onlineBadge}</div>
                ${sourceLinkHtml}
            </div>
            <div class="card-sub" onclick="openArtistByName('${song.artist.split(',')[0].trim()}', event)" title="View Artist Profile">${song.artist}</div>
            ${providerBadgeHtml ? `<div class="card-provider-row">${providerBadgeHtml}</div>` : ''}
            ${recBadge}
        </div>
    `;
}

function renderArtists(artists) {
    const carousel = document.getElementById("artistsCarousel");
    if (!carousel) return;
    carousel.innerHTML = artists.map(a => `
        <div class="music-card artist-card" onclick="openArtistView('${a.id}')">
            <div class="card-img-wrap">
                <img src="${a.image_url}" alt="${a.name}" loading="lazy">
            </div>
            <div class="card-title">${a.name}</div>
            <div class="card-sub">${a.monthly_listeners}</div>
        </div>
    `).join("");
}

function renderAllArtistsView(artists) {
    const grid = document.getElementById("allArtistsGrid");
    if (!grid) return;
    grid.innerHTML = artists.map(a => `
        <div class="music-card artist-card" onclick="openArtistView('${a.id}')">
            <div class="card-img-wrap">
                <img src="${a.image_url}" alt="${a.name}" loading="lazy">
            </div>
            <div class="card-title">${a.name}</div>
            <div class="card-sub">${a.monthly_listeners}</div>
        </div>
    `).join("");
}

// Render Featured Albums
function renderAlbums(albums) {
    const sec = document.getElementById("albumsSection");
    if (sec) sec.style.display = (albums && albums.length > 0) ? "block" : "none";
    const carousel = document.getElementById("albumsCarousel");
    if (!carousel) return;
    carousel.innerHTML = albums.map(alb => createAlbumCardHtml(alb)).join("");
}

function createAlbumCardHtml(alb) {
    return `
        <div class="music-card" onclick="openAlbumView('${alb.id}')">
            <div class="card-img-wrap">
                <img src="${alb.cover_art_url}" alt="${alb.title}" loading="lazy">
                <button class="card-play-btn" aria-label="Play ${alb.title}"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${alb.title}</div>
            <div class="card-sub">${alb.artist} • ${alb.release_year}</div>
        </div>
    `;
}

// =============================================================================
// ALBUM DETAIL VIEW
// =============================================================================

async function openAlbumView(albumId) {
    try {
        let endpoint = `/api/albums/${encodeURIComponent(albumId)}`;
        if (albumId.startsWith("jamendo_alb_")) {
            endpoint = `/api/providers/jamendo/albums/${encodeURIComponent(albumId)}`;
        } else if (albumId.startsWith("freetouse_alb_")) {
            endpoint = `/api/providers/freetouse/albums/${encodeURIComponent(albumId)}`;
        } else if (albumId.startsWith("spotify_alb_")) {
            endpoint = `/api/providers/spotify/albums/${encodeURIComponent(albumId)}`;
        }
        const res = await fetch(endpoint, { headers: authHeaders() });
        const data = await res.json();
        if (!data.success) {
            showToast("Failed to load album details.");
            return;
        }

        currentAlbum = data.album;
        renderAlbumDetail(currentAlbum);
        switchView("albumDetail");
    } catch (err) {
        console.error("Open album error:", err);
        showToast("Error opening album.");
    }
}

function renderAlbumDetail(album) {
    const hero = document.getElementById("albumHero");
    const tracklistRows = document.getElementById("albumTracklistRows");
    if (!hero || !tracklistRows) return;

    const totalDurationSeconds = album.songs.reduce((acc, s) => acc + (s.duration_seconds || 0), 0);
    const totalMins = Math.floor(totalDurationSeconds / 60);
    const totalSecs = totalDurationSeconds % 60;
    const durationLabel = `${totalMins} min ${totalSecs > 0 ? totalSecs + ' sec' : ''}`;

    hero.innerHTML = `
        <img src="${album.cover_art_url}" alt="${album.title}" class="album-hero-art">
        <div class="album-hero-info">
            <span class="album-hero-type">Album</span>
            <h1 class="album-hero-title">${album.title}</h1>
            <div class="album-hero-meta">
                <span class="artist-highlight" onclick="openArtistByName('${album.artist}', event)">${album.artist}</span>
                <span class="meta-dot">•</span>
                <span>${album.release_year}</span>
                <span class="meta-dot">•</span>
                <span>${album.songs.length} track${album.songs.length === 1 ? '' : 's'}</span>
                <span class="meta-dot">•</span>
                <span>${durationLabel}</span>
                <span class="album-genre-pill">${album.genre || album.language}</span>
            </div>
        </div>
    `;

    tracklistRows.innerHTML = album.songs.map((s, idx) => {
        const isLiked = s.is_favorite === 1;
        const isDownloaded = downloadedSongIds.has(s.id);
        const isDownloading = downloadingSongIds.has(s.id);
        const isActive = currentPlaylist[currentTrackIndex] && currentPlaylist[currentTrackIndex].id === s.id;

        return `
            <div class="track-row ${isActive ? 'active' : ''}" onclick="playSongInAlbum(${idx})">
                <div class="col-num">
                    <span class="track-num-text">${idx + 1}</span>
                    <i class="fa-solid fa-play track-play-icon"></i>
                </div>
                <div class="col-title">
                    <span class="track-main-title">${s.title}</span>
                    <span class="track-main-artist" onclick="openArtistByName('${s.artist.split(',')[0].trim()}', event)">${s.artist}</span>
                </div>
                <div class="col-genre">${s.category || s.tags || 'Soundtrack'}</div>
                <div class="col-time">${formatTime(s.duration_seconds || 200)}</div>
                <div class="col-actions">
                    <button class="btn-track-action ${isLiked ? 'liked' : ''}" 
                            data-fav-id="${s.id}"
                            title="${isLiked ? 'Unlike' : 'Like'}"
                            onclick="toggleLikeSong('${s.id}', event)"
                            aria-label="Like ${s.title}">
                        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
                    </button>
                    ${s.allow_download !== 0 ? `
                    <button class="btn-track-action ${isDownloaded ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}"
                            data-dl-id="${s.id}"
                            title="${isDownloaded ? 'Downloaded' : 'Download for offline'}"
                            onclick="toggleSongDownload('${s.id}', event)"
                            aria-label="Download ${s.title}">
                        <i class="${isDownloaded ? 'fa-solid fa-circle-check' : (isDownloading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-down')}"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join("");
}

function playSongInAlbum(index) {
    if (!currentAlbum || !currentAlbum.songs || !currentAlbum.songs[index]) return;
    currentPlaylist = [...currentAlbum.songs];
    loadTrack(index, true);
    renderAlbumDetail(currentAlbum);
    renderQueue();
}

function playCurrentAlbum() {
    if (!currentAlbum || !currentAlbum.songs || currentAlbum.songs.length === 0) return;
    currentPlaylist = [...currentAlbum.songs];
    loadTrack(0, true);
    renderAlbumDetail(currentAlbum);
    renderQueue();
    showToast(`Playing '${currentAlbum.title}'`);
}

function shuffleCurrentAlbum() {
    if (!currentAlbum || !currentAlbum.songs || currentAlbum.songs.length === 0) return;
    currentPlaylist = [...currentAlbum.songs].sort(() => Math.random() - 0.5);
    loadTrack(0, true);
    renderAlbumDetail(currentAlbum);
    renderQueue();
    showToast(`Shuffled '${currentAlbum.title}'`);
}

async function downloadCurrentAlbum() {
    if (!currentAlbum || !currentAlbum.songs) return;
    showToast(`Downloading all tracks from '${currentAlbum.title}'...`);
    for (const song of currentAlbum.songs) {
        if (!downloadedSongIds.has(song.id) && song.allow_download !== 0) {
            await toggleSongDownload(song.id);
        }
    }
}

function renderAllAlbumsView() {
    const grid = document.getElementById("allAlbumsGrid");
    if (!grid) return;
    grid.innerHTML = allAlbums.map(alb => createAlbumCardHtml(alb)).join("");
}

// =============================================================================
// ARTIST DETAIL VIEW (New Premium Screen)
// =============================================================================

async function openArtistView(artistId) {
    try {
        const res = await fetch(`/api/artists/${artistId}`, { headers: authHeaders() });
        const data = await res.json();
        if (!data.success) {
            showToast("Failed to load artist profile.");
            return;
        }

        currentArtist = data.artist;
        renderArtistDetail(currentArtist);
        switchView("artistDetail");
    } catch (err) {
        console.error("Open artist error:", err);
        showToast("Error opening artist.");
    }
}

function openArtistByName(name, event) {
    if (event) event.stopPropagation();
    const matched = allArtists.find(a => name.toLowerCase().includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(name.toLowerCase()));
    if (matched) {
        openArtistView(matched.id);
    } else {
        showToast(`Artist: ${name}`);
    }
}

function handleCurrentArtistClick() {
    const track = currentPlaylist[currentTrackIndex];
    if (track) {
        openArtistByName(track.artist.split(",")[0].trim());
    }
}

function renderArtistDetail(artist) {
    const hero = document.getElementById("artistHero");
    const tracksContainer = document.getElementById("artistTracklistRows");
    const albumsCarousel = document.getElementById("artistAlbumsCarousel");
    if (!hero || !tracksContainer) return;

    hero.innerHTML = `
        <img src="${artist.image_url}" alt="${artist.name}" class="artist-hero-art">
        <div class="artist-hero-info">
            <span class="verified-badge"><i class="fa-solid fa-circle-check"></i> Verified Artist</span>
            <h1 class="artist-hero-name">${artist.name}</h1>
            <p class="artist-hero-listeners">${artist.monthly_listeners}</p>
            <p class="artist-hero-bio">${artist.bio || 'Renowned music creator and composer.'}</p>
        </div>
    `;

    tracksContainer.innerHTML = (artist.songs || []).map((s, idx) => {
        const isLiked = s.is_favorite === 1;
        const isDownloaded = downloadedSongIds.has(s.id);
        const isDownloading = downloadingSongIds.has(s.id);
        const isActive = currentPlaylist[currentTrackIndex] && currentPlaylist[currentTrackIndex].id === s.id;

        return `
            <div class="track-row ${isActive ? 'active' : ''}" onclick="playSongInArtist(${idx})">
                <div class="col-num">
                    <span class="track-num-text">${idx + 1}</span>
                    <i class="fa-solid fa-play track-play-icon"></i>
                </div>
                <div class="col-title">
                    <span class="track-main-title">${s.title}</span>
                    <span class="track-main-artist">${s.album}</span>
                </div>
                <div class="col-genre">${s.category || 'Soundtrack'}</div>
                <div class="col-time">${formatTime(s.duration_seconds || 200)}</div>
                <div class="col-actions">
                    <button class="btn-track-action ${isLiked ? 'liked' : ''}" 
                            data-fav-id="${s.id}"
                            title="${isLiked ? 'Unlike' : 'Like'}"
                            onclick="toggleLikeSong('${s.id}', event)"
                            aria-label="Like ${s.title}">
                        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
                    </button>
                    ${s.allow_download !== 0 ? `
                    <button class="btn-track-action ${isDownloaded ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}"
                            data-dl-id="${s.id}"
                            title="${isDownloaded ? 'Downloaded' : 'Download for offline'}"
                            onclick="toggleSongDownload('${s.id}', event)"
                            aria-label="Download ${s.title}">
                        <i class="${isDownloaded ? 'fa-solid fa-circle-check' : (isDownloading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-down')}"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join("");

    if (albumsCarousel) {
        if (artist.albums && artist.albums.length > 0) {
            albumsCarousel.innerHTML = artist.albums.map(alb => createAlbumCardHtml(alb)).join("");
        } else {
            albumsCarousel.innerHTML = "<p style='color:var(--text-muted); padding:10px;'>No full albums cataloged yet.</p>";
        }
    }
}

function playSongInArtist(index) {
    if (!currentArtist || !currentArtist.songs || !currentArtist.songs[index]) return;
    currentPlaylist = [...currentArtist.songs];
    loadTrack(index, true);
    renderArtistDetail(currentArtist);
    renderQueue();
}

function playCurrentArtist() {
    if (!currentArtist || !currentArtist.songs || currentArtist.songs.length === 0) return;
    currentPlaylist = [...currentArtist.songs];
    loadTrack(0, true);
    renderArtistDetail(currentArtist);
    renderQueue();
    showToast(`Playing ${currentArtist.name}`);
}

function shuffleCurrentArtist() {
    if (!currentArtist || !currentArtist.songs || currentArtist.songs.length === 0) return;
    currentPlaylist = [...currentArtist.songs].sort(() => Math.random() - 0.5);
    loadTrack(0, true);
    renderArtistDetail(currentArtist);
    renderQueue();
    showToast(`Shuffled ${currentArtist.name}`);
}

// =============================================================================
// LIKES & EVENT RECORDING
// =============================================================================

async function toggleLikeSong(songId, event) {
    if (event) event.stopPropagation();

    // Look for song object to persist full metadata for external provider tracks
    const songObj = allSongs.find(s => s.id === songId) || 
                    currentPlaylist.find(s => s.id === songId) ||
                    (lastSearchResults && lastSearchResults.songs ? lastSearchResults.songs.find(s => s.id === songId) : null);

    try {
        const payload = { user_id: getUserId() };
        if (songObj) {
            payload.song_data = songObj;
        }

        const res = await fetch(`/api/favorites/${songId}/toggle`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            const isFav = data.is_favorite === 1;

            allSongs.forEach(s => {
                if (s.id === songId) s.is_favorite = data.is_favorite;
            });
            currentPlaylist.forEach(s => {
                if (s.id === songId) s.is_favorite = data.is_favorite;
            });

            document.querySelectorAll(`[data-fav-id="${songId}"]`).forEach(btn => {
                btn.classList.toggle("liked", isFav);
                btn.innerHTML = isFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
                btn.title = isFav ? "Unlike" : "Like";
            });

            const currentTrack = currentPlaylist[currentTrackIndex];
            if (currentTrack && currentTrack.id === songId) {
                updateFavoriteIcon(isFav);
            }

            updateLikedCountBadge();
            showToast(isFav ? "Saved to Liked Songs ❤️" : "Removed from Liked Songs");

            loadRecommendations();

            if (currentView === "favorites") {
                loadFavoritesView();
            }
        }
    } catch (err) {
        console.error("Like toggle error:", err);
    }
}

async function toggleCurrentFavorite() {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) return;
    toggleLikeSong(track.id);
}

function updateFavoriteIcon(isFav) {
    if (!playerFavoriteBtn) return;
    if (isFav) {
        playerFavoriteBtn.innerHTML = '<i class="fa-solid fa-heart" style="color: #10B981;"></i>';
    } else {
        playerFavoriteBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

// Completed Play Tracking
function resetPlaybackTracker() {
    currentActiveListenSeconds = 0;
    lastListenCheckTime = Date.now();
}

function updatePlaybackTracker() {
    if (!audio.paused && !audio.ended && lastListenCheckTime) {
        const now = Date.now();
        const deltaSec = (now - lastListenCheckTime) / 1000;
        if (deltaSec > 0 && deltaSec < 3) {
            currentActiveListenSeconds += deltaSec;
        }
    }
    lastListenCheckTime = Date.now();
}

async function checkAndRecordCompletedPlay() {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) return;

    const dur = audio.duration || track.duration_seconds || 15;
    const isCompleted = (currentActiveListenSeconds >= 10) && 
        ((currentActiveListenSeconds / dur >= 0.6) || currentActiveListenSeconds >= 30);

    if (isCompleted && !completedPlayCooldown.has(track.id)) {
        completedPlayCooldown.add(track.id);
        setTimeout(() => completedPlayCooldown.delete(track.id), 60000);

        try {
            await fetch("/api/events", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                    user_id: getUserId(),
                    song_id: track.id,
                    event_type: "completed_play",
                    listened_seconds: Math.round(currentActiveListenSeconds),
                    song_duration: Math.round(dur)
                })
            });
            loadRecommendations();
            loadRecentlyPlayed();
        } catch (e) {}
    }
}

// =============================================================================
// PLAYBACK QUEUE DRAWER
// =============================================================================

function toggleQueueDrawer() {
    isQueueOpen = !isQueueOpen;
    if (queueDrawer) queueDrawer.classList.toggle("open", isQueueOpen);
    if (playerQueueBtn) playerQueueBtn.classList.toggle("active", isQueueOpen);
    if (isQueueOpen) renderQueue();
}

function renderQueue() {
    const nowPlayingBox = document.getElementById("queueNowPlaying");
    const queueList = document.getElementById("queueList");
    const countBadge = document.getElementById("queueCountBadge");
    if (!queueList || currentPlaylist.length === 0) return;

    const currentTrack = currentPlaylist[currentTrackIndex];
    if (nowPlayingBox && currentTrack) {
        nowPlayingBox.innerHTML = `
            <img src="${currentTrack.image_url}" class="queue-item-art" alt="${currentTrack.title}">
            <div class="queue-item-meta">
                <div class="queue-item-title" style="color:var(--accent-emerald); font-weight:700;">${currentTrack.title}</div>
                <div class="queue-item-artist">${currentTrack.artist}</div>
            </div>
            <div class="playing-equalizer-bars" style="position:relative; width:24px; height:20px; background:transparent;">
                <span></span><span></span><span></span>
            </div>
        `;
    }

    const upcoming = [];
    for (let i = currentTrackIndex + 1; i < currentPlaylist.length; i++) {
        upcoming.push({ track: currentPlaylist[i], originalIndex: i });
    }

    if (countBadge) countBadge.innerText = `${upcoming.length} upcoming`;

    if (upcoming.length === 0) {
        queueList.innerHTML = `
            <div class="empty-state-box" style="padding: 24px 12px;">
                <i class="fa-solid fa-list-check empty-state-icon" style="font-size:32px;"></i>
                <div class="empty-state-title" style="font-size:14px;">Queue is clear</div>
                <p class="empty-state-desc" style="font-size:12px;">Play an album or playlist to load upcoming tracks.</p>
            </div>
        `;
        return;
    }

    queueList.innerHTML = upcoming.map(item => `
        <div class="queue-item" onclick="jumpToQueueTrack(${item.originalIndex})">
            <img src="${item.track.image_url}" class="queue-item-art" alt="${item.track.title}">
            <div class="queue-item-meta">
                <div class="queue-item-title">${item.track.title}</div>
                <div class="queue-item-artist">${item.track.artist}</div>
            </div>
            <span style="font-size:11px; color:var(--text-muted);">${formatTime(item.track.duration_seconds || 200)}</span>
        </div>
    `).join("");
}

function jumpToQueueTrack(index) {
    loadTrack(index, true);
    renderQueue();
}

// =============================================================================
// OFFLINE DOWNLOADS VIEW
// =============================================================================

async function loadDownloadsView() {
    const grid = document.getElementById("downloadsGrid");
    const storageTag = document.getElementById("downloadsStorageTag");
    if (!grid) return;

    const downloadedItems = await getAllDownloadedSongs();
    const totalBytes = downloadedItems.reduce((acc, item) => acc + (item.sizeBytes || 0), 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    if (storageTag) {
        storageTag.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${totalMB} MB stored offline`;
    }

    if (downloadedItems.length === 0) {
        grid.innerHTML = `
            <div class="empty-state-box">
                <i class="fa-solid fa-circle-arrow-down empty-state-icon"></i>
                <h3 class="empty-state-title">No offline songs yet</h3>
                <p class="empty-state-desc">Tap the download arrow on any song or album to save tracks directly to your browser for offline playback without using data.</p>
                <button class="btn-empty-action" onclick="switchView('home')">Browse Music</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = downloadedItems.map(item => {
        const s = item.song;
        const mb = ((item.sizeBytes || 0) / (1024 * 1024)).toFixed(1);
        return `
            <div class="music-card" onclick="playDownloadedSong('${s.id}')">
                <div class="card-img-wrap">
                    <img src="${s.image_url}" alt="${s.title}" loading="lazy">
                    <span class="lang-badge" style="background:#10B981; color:#041E15; font-weight:800;">OFFLINE</span>
                    <button class="card-play-btn" aria-label="Play ${s.title} offline"><i class="fa-solid fa-play"></i></button>
                    <div class="card-actions-hover" style="opacity:1;">
                        <button class="card-action-btn" title="Remove Download" onclick="removeDownload('${s.id}', event)" aria-label="Remove download">
                            <i class="fa-solid fa-trash-can" style="color:#EF4444;"></i>
                        </button>
                    </div>
                </div>
                <div class="card-title">${s.title}</div>
                <div class="card-sub">${s.artist} • ${mb} MB</div>
            </div>
        `;
    }).join("");
}

async function playDownloadedSong(id) {
    const offlineItem = await getDownloadedSong(id);
    if (!offlineItem) {
        showToast("Downloaded song not found in local storage.");
        return;
    }

    let index = currentPlaylist.findIndex(s => s.id === id);
    if (index === -1) {
        currentPlaylist.unshift(offlineItem.song);
        index = 0;
    }
    loadTrack(index, true);
    renderQueue();
}

// =============================================================================
// AUDIO CONTROLS & LISTENERS
// =============================================================================

async function loadTrack(index, autoPlay = true) {
    if (currentPlaylist.length === 0) return;

    await checkAndRecordCompletedPlay();
    resetPlaybackTracker();

    currentTrackIndex = (index + currentPlaylist.length) % currentPlaylist.length;
    const track = currentPlaylist[currentTrackIndex];

    const offlineRecord = await getDownloadedSong(track.id);
    if (offlineRecord && offlineRecord.audioBlob) {
        audio.src = URL.createObjectURL(offlineRecord.audioBlob);
    } else {
        if (!navigator.onLine) {
            showToast(`Offline notice: '${track.title}' is not cached. Choose from Downloads!`);
            return;
        }
        audio.src = track.audio_url;
    }

    audio.load();

    playerTitle.innerText = track.title;
    playerArtist.innerText = track.artist;
    playerArtwork.src = track.image_url;

    playerLangBadge.innerText = track.language || "MUSIC";
    playerLangBadge.style.backgroundColor = track.language === "TAMIL" ? "var(--badge-tamil)" : "var(--badge-english)";

    updateFavoriteIcon(track.is_favorite === 1);
    updateDownloadButtonsInDOM();

    // Update bottom player provider badge and external link
    const providerBadge = document.getElementById("playerProviderBadge");
    const sourceLink = document.getElementById("playerSourceLink");
    if (providerBadge) {
        if (track.provider === "freetouse") {
            providerBadge.style.display = "inline-flex";
            providerBadge.className = "provider-pill pill-freetouse pill-sm";
            providerBadge.innerHTML = '<i class="fa-solid fa-compact-disc"></i> Free To Use';
            providerBadge.title = "Free To Use Royalty-Free Music";
        } else if (track.provider === "jamendo") {
            providerBadge.style.display = "inline-flex";
            providerBadge.className = "provider-pill pill-jamendo pill-sm";
            providerBadge.innerHTML = '<i class="fa-brands fa-creative-commons"></i> Jamendo';
            providerBadge.title = "Jamendo Creative Commons Catalog";
        } else if (track.provider === "soundcloud") {
            providerBadge.style.display = "inline-flex";
            providerBadge.className = "provider-pill pill-soundcloud pill-sm";
            providerBadge.innerHTML = '<i class="fa-brands fa-soundcloud"></i> SoundCloud';
            providerBadge.title = "Official SoundCloud Stream";
        } else if (track.provider === "spotify") {
            providerBadge.style.display = "inline-flex";
            providerBadge.className = "provider-pill pill-spotify pill-sm";
            providerBadge.innerHTML = '<i class="fa-brands fa-spotify"></i> Spotify';
            providerBadge.title = "Official Spotify Web API Track";
        } else {
            providerBadge.style.display = "none";
        }
    }
    if (sourceLink) {
        if (track.source_url) {
            sourceLink.style.display = "inline-flex";
            sourceLink.href = track.source_url;
            sourceLink.title = `Listen original on ${track.provider || 'source'}`;
        } else {
            sourceLink.style.display = "none";
        }
    }

    // Update player download button based on provider permissions
    if (playerDownloadBtn) {
        if (track.provider === "soundcloud" || track.provider === "spotify") {
            const isSpot = track.provider === "spotify";
            playerDownloadBtn.style.opacity = "0.4";
            playerDownloadBtn.title = isSpot
                ? "Offline downloads disabled (Spotify Terms prohibit downloading or caching)"
                : "Offline downloads disabled (SoundCloud terms prohibit downloading or caching)";
            playerDownloadBtn.onclick = () => showToast(
                isSpot
                    ? "Spotify Terms strictly prohibit downloading or caching audio"
                    : "SoundCloud terms forbid offline downloading or caching"
            );
        } else if (track.allow_download === 0 || (track.provider === "jamendo" && track.allow_download !== 1)) {
            playerDownloadBtn.style.opacity = "0.4";
            playerDownloadBtn.title = "Streaming only (Artist has not enabled CC download permission)";
            playerDownloadBtn.onclick = () => showToast("Artist has not enabled offline download rights for this track");
        } else {
            playerDownloadBtn.style.opacity = "1";
            playerDownloadBtn.title = "Download for Offline";
            playerDownloadBtn.onclick = toggleCurrentDownload;
        }
    }

    if (autoPlay) {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPauseIcon();
            recordPlayStart(track.id);
        }).catch(err => {
            console.warn("Autoplay notice:", err);
        });
    }
}

function togglePlayPause() {
    if (audio.paused) {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPauseIcon();
        }).catch(err => console.log("Play failed:", err));
    } else {
        audio.pause();
        isPlaying = false;
        updatePlayPauseIcon();
    }
}

function updatePlayPauseIcon() {
    if (!playPauseBtn) return;
    playPauseBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    if (playerEqualizer) {
        playerEqualizer.style.display = isPlaying ? "flex" : "none";
    }
}

function playNext() {
    if (isShuffle) {
        currentTrackIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
        currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    }
    loadTrack(currentTrackIndex, true);
    renderQueue();
}

function playPrevious() {
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    loadTrack(currentTrackIndex, true);
    renderQueue();
}

function handleCardClick(id) {
    playSongById(id);
}

function playSongById(id) {
    const index = currentPlaylist.findIndex(s => s.id === id);
    if (index !== -1) {
        loadTrack(index, true);
    } else {
        const song = allSongs.find(s => s.id === id) || 
                     (lastSearchResults && lastSearchResults.songs ? lastSearchResults.songs.find(s => s.id === id) : null);
        if (song) {
            currentPlaylist.push(song);
            loadTrack(currentPlaylist.length - 1, true);
        }
    }
    renderQueue();
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle("active", isShuffle);
    showToast(isShuffle ? "Shuffle On" : "Shuffle Off");
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    repeatBtn.classList.toggle("active", isRepeat);
    audio.loop = isRepeat;
    showToast(isRepeat ? "Repeat On" : "Repeat Off");
}

function setupAudioListeners() {
    audio.addEventListener("timeupdate", () => {
        if (!audio.duration) return;
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${progressPercent}%`;
        currentTimeLabel.innerText = formatTime(audio.currentTime);
        totalTimeLabel.innerText = formatTime(audio.duration);
        updatePlaybackTracker();
    });

    audio.addEventListener("ended", () => {
        checkAndRecordCompletedPlay();
        if (!isRepeat) {
            playNext();
        }
    });

    audio.addEventListener("play", () => {
        isPlaying = true;
        lastListenCheckTime = Date.now();
        updatePlayPauseIcon();
    });

    audio.addEventListener("pause", () => {
        isPlaying = false;
        updatePlayPauseIcon();
    });
}

function seekAudio(e) {
    const container = document.getElementById("progressContainer");
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const duration = audio.duration;
    if (duration) {
        audio.currentTime = (clickX / width) * duration;
    }
}

function changeVolume(val) {
    audio.volume = val;
    isMuted = val == 0;
    updateMuteIcon();
}

function toggleMute() {
    if (isMuted) {
        audio.volume = prevVolume || 0.8;
        volumeSlider.value = audio.volume;
        isMuted = false;
    } else {
        prevVolume = audio.volume;
        audio.volume = 0;
        volumeSlider.value = 0;
        isMuted = true;
    }
    updateMuteIcon();
}

function updateMuteIcon() {
    if (isMuted || audio.volume === 0) {
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else {
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// =============================================================================
// NAVIGATION & VIEWS
// =============================================================================

function switchView(view) {
    if (view !== currentView) {
        viewHistory.push(view);
    }
    currentView = view;

    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const navBtnMap = {
        home: "navHome",
        search: "navSearch",
        albums: "navAlbums",
        artists: "navArtists",
        favorites: "navFavorites",
        downloads: "navDownloads"
    };
    if (navBtnMap[view]) {
        const btn = document.getElementById(navBtnMap[view]);
        if (btn) btn.classList.add("active");
    }

    const welcomeSec = document.getElementById("welcomeSection");
    const quickSec = document.getElementById("quickAccessSection");
    const recSec = document.getElementById("recommendationsSection");
    const recentSec = document.getElementById("recentlyPlayedSection");
    const tamilSec = document.getElementById("tamilSection");
    const englishSec = document.getElementById("englishSection");
    const albumsSec = document.getElementById("albumsSection");
    const artistsSec = document.getElementById("artistsSection");

    const searchSec = document.getElementById("searchResultsSection");
    const albumDetailSec = document.getElementById("albumDetailSection");
    const artistDetailSec = document.getElementById("artistDetailSection");
    const albumsViewSec = document.getElementById("albumsViewSection");
    const artistsViewSec = document.getElementById("artistsViewSection");
    const favoritesSec = document.getElementById("favoritesSection");
    const downloadsSec = document.getElementById("downloadsSection");

    // Hide all sub-views
    if (albumDetailSec) albumDetailSec.style.display = "none";
    if (artistDetailSec) artistDetailSec.style.display = "none";
    if (albumsViewSec) albumsViewSec.style.display = "none";
    if (artistsViewSec) artistsViewSec.style.display = "none";
    if (favoritesSec) favoritesSec.style.display = "none";
    if (downloadsSec) downloadsSec.style.display = "none";
    if (searchSec && view !== "search") searchSec.style.display = "none";

    const isHome = view === "home";
    if (welcomeSec) welcomeSec.style.display = isHome ? "block" : "none";
    if (quickSec) quickSec.style.display = isHome ? "block" : "none";
    if (recSec) recSec.style.display = isHome ? "block" : "none";
    if (recentSec) recentSec.style.display = isHome ? "block" : "none";
    if (tamilSec) tamilSec.style.display = isHome ? "block" : "none";
    if (englishSec) englishSec.style.display = isHome ? "block" : "none";
    if (albumsSec) albumsSec.style.display = isHome ? "block" : "none";
    if (artistsSec) artistsSec.style.display = isHome ? "block" : "none";

    if (view === "search") {
        if (searchSec) searchSec.style.display = "block";
        const searchInput = document.getElementById("searchInput");
        const categoriesContainer = document.getElementById("browseCategoriesContainer");
        if (categoriesContainer) {
            categoriesContainer.style.display = (!searchInput || !searchInput.value.trim()) ? "block" : "none";
        }
    } else if (view === "albums") {
        if (albumsViewSec) albumsViewSec.style.display = "block";
        renderAllAlbumsView();
    } else if (view === "artists") {
        if (artistsViewSec) artistsViewSec.style.display = "block";
        renderAllArtistsView(allArtists);
    } else if (view === "albumDetail") {
        if (albumDetailSec) albumDetailSec.style.display = "block";
    } else if (view === "artistDetail") {
        if (artistDetailSec) artistDetailSec.style.display = "block";
    } else if (view === "favorites") {
        if (favoritesSec) favoritesSec.style.display = "block";
        loadFavoritesView();
    } else if (view === "downloads") {
        if (downloadsSec) downloadsSec.style.display = "block";
        loadDownloadsView();
    }

    const scrollContainer = document.getElementById("mainScroll");
    if (scrollContainer) scrollContainer.scrollTop = 0;
}

function navigateBack() {
    if (viewHistory.length > 1) {
        viewHistory.pop();
        const prev = viewHistory.pop();
        switchView(prev || "home");
    } else {
        switchView("home");
    }
}

function navigateForward() {
    // For SPA forward navigation
    switchView("home");
}

function filterLanguage(lang) {
    currentLanguage = lang;
    document.querySelectorAll(".chip").forEach(c => {
        c.classList.toggle("active", c.getAttribute("data-lang") === lang);
    });

    const tamilSection = document.getElementById("tamilSection");
    const englishSection = document.getElementById("englishSection");

    if (lang === "TAMIL") {
        if (tamilSection) tamilSection.style.display = "block";
        if (englishSection) englishSection.style.display = "none";
        currentPlaylist = allSongs.filter(s => s.language === "TAMIL");
        showToast("Filtered: தமிழ் (Tamil) Hits");
    } else if (lang === "ENGLISH") {
        if (tamilSection) tamilSection.style.display = "none";
        if (englishSection) englishSection.style.display = "block";
        currentPlaylist = allSongs.filter(s => s.language === "ENGLISH");
        showToast("Filtered: Global English Hits");
    } else {
        if (tamilSection) tamilSection.style.display = "block";
        if (englishSection) englishSection.style.display = "block";
        currentPlaylist = [...allSongs];
        showToast("Showing All Music");
    }
}

async function loadFavoritesView() {
    try {
        const res = await fetch("/api/favorites", { headers: authHeaders() });
        const data = await res.json();
        const grid = document.getElementById("favoritesGrid");
        const desc = document.getElementById("likedSongsDesc");

        if (data.success && grid) {
            if (desc) desc.innerText = `${data.favorites.length} song${data.favorites.length === 1 ? '' : 's'} saved to your collection`;
            if (data.favorites.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state-box">
                        <i class="fa-solid fa-heart-crack empty-state-icon"></i>
                        <h3 class="empty-state-title">No liked songs yet</h3>
                        <p class="empty-state-desc">Tap the heart icon on any song, card, or album row to collect your personal favorites here.</p>
                        <button class="btn-empty-action" onclick="switchView('home')">Explore Tracks</button>
                    </div>
                `;
            } else {
                grid.innerHTML = data.favorites.map(s => createSongCardHtml(s)).join("");
                updateDownloadButtonsInDOM();
            }
        }
    } catch (err) {
        console.error(err);
    }
}

// =============================================================================
// SEARCH & BROWSE CATEGORIES
// =============================================================================

function renderCategoriesGrid() {
    const grid = document.getElementById("categoriesGrid");
    if (!grid) return;

    const categories = [
        { name: "Mass Hits 🔥", query: "Mass", bg: "linear-gradient(135deg, #B45309, #D97706)", icon: "fa-fire" },
        { name: "Synthwave Pop 🌆", query: "Synthwave", bg: "linear-gradient(135deg, #4C1D95, #7C3AED)", icon: "fa-city" },
        { name: "Soulful Melodies 🌿", query: "Melody", bg: "linear-gradient(135deg, #065F46, #10B981)", icon: "fa-feather" },
        { name: "Dance & Party ⚡", query: "Party", bg: "linear-gradient(135deg, #BE185D, #EC4899)", icon: "fa-bolt" },
        { name: "Romantic Hits 💖", query: "Romantic", bg: "linear-gradient(135deg, #831843, #BE123C)", icon: "fa-heart" },
        { name: "Global Chartbusters 🌍", query: "Pop", bg: "linear-gradient(135deg, #0369A1, #06B6D4)", icon: "fa-globe" },
    ];

    grid.innerHTML = categories.map(cat => `
        <div class="category-tile" style="background:${cat.bg};" onclick="searchByCategory('${cat.query}')">
            <span>${cat.name}</span>
            <i class="fa-solid ${cat.icon}"></i>
        </div>
    `).join("");
}

function searchByCategory(query) {
    const input = document.getElementById("searchInput");
    if (input) input.value = query;
    handleSearch(query);
}

let searchTimeout = null;
function handleSearch(query) {
    const clearBtn = document.getElementById("clearSearchBtn");
    if (clearBtn) clearBtn.style.display = query ? "block" : "none";

    const categoriesContainer = document.getElementById("browseCategoriesContainer");

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const trimmed = query.trim();
        const resultsGrid = document.getElementById("searchResultsGrid");
        const countSpan = document.getElementById("searchResultCount");
        const onlineHeader = document.getElementById("onlineSearchHeader");
        const searchHeading = document.getElementById("searchHeading");

        if (!trimmed) {
            if (categoriesContainer) categoriesContainer.style.display = "block";
            if (resultsGrid) resultsGrid.innerHTML = "";
            if (countSpan) countSpan.innerText = "";
            if (searchHeading) searchHeading.innerText = "Browse Catalog";
            if (onlineHeader) onlineHeader.style.display = "none";
            return;
        }

        switchView("search");
        if (categoriesContainer) categoriesContainer.style.display = "none";
        if (searchHeading) searchHeading.innerText = `Results for "${trimmed}"`;
        if (resultsGrid) resultsGrid.innerHTML = "<p style='color:var(--accent-emerald); padding:24px;'><i class='fa-solid fa-spinner fa-spin'></i> Searching music catalogs...</p>";

        try {
            const searchUrl = `/api/search?q=${encodeURIComponent(trimmed)}&provider=${encodeURIComponent(selectedSearchProvider)}`;
            const res = await fetch(searchUrl, { headers: authHeaders() });
            const data = await res.json();

            let mergedSongs = [];
            let albums = [];
            let artists = [];

            if (data.success) {
                mergedSongs = data.songs || [];
                albums = data.albums || [];
                artists = data.artists || [];
                lastSearchResults = { songs: mergedSongs, albums, artists };
            }

            if (countSpan) {
                countSpan.innerText = `${mergedSongs.length} track${mergedSongs.length === 1 ? '' : 's'}${albums.length > 0 ? `, ${albums.length} album${albums.length === 1 ? '' : 's'}` : ''}`;
            }

            if (mergedSongs.length === 0 && albums.length === 0 && artists.length === 0) {
                if (resultsGrid) {
                    let helperHint = "";
                    if (selectedSearchProvider === "jamendo" && cachedProviderStatuses && !cachedProviderStatuses.jamendo.configured) {
                        helperHint = `<p style="margin-top:12px; color:#F59E0B; font-size:13px;"><i class="fa-solid fa-circle-info"></i> Jamendo search is awaiting a configured <code>JAMENDO_CLIENT_ID</code>. Click 'Music Sources' in the sidebar to view setup steps.</p>`;
                    } else if (selectedSearchProvider === "soundcloud" && cachedProviderStatuses && !cachedProviderStatuses.soundcloud.configured) {
                        helperHint = `<p style="margin-top:12px; color:#F59E0B; font-size:13px;"><i class="fa-solid fa-circle-info"></i> SoundCloud search requires approved developer credentials. Click 'Music Sources' to view setup steps.</p>`;
                    }

                    resultsGrid.innerHTML = `
                        <div class="empty-state-box">
                            <i class="fa-solid fa-magnifying-glass empty-state-icon"></i>
                            <h3 class="empty-state-title">No matches found</h3>
                            <p class="empty-state-desc">We couldn't find any tracks or albums matching "${trimmed}". Try searching another title or artist.</p>
                            ${helperHint}
                            <button class="btn-empty-action" onclick="clearSearch()">View Categories</button>
                        </div>
                    `;
                }
            } else {
                let html = "";
                // If albums were returned by search
                if (albums.length > 0) {
                    html += `
                        <div class="search-albums-row" style="grid-column: 1 / -1; margin-bottom: 16px;">
                            <h3 style="font-size:16px; font-weight:700; margin-bottom:12px; color:var(--text-primary);"><i class="fa-solid fa-record-vinyl text-emerald"></i> Matching Albums</h3>
                            <div class="cards-carousel">${albums.map(alb => createAlbumCardHtml(alb)).join("")}</div>
                        </div>
                    `;
                }

                html += mergedSongs.map(s => createSongCardHtml(s)).join("");
                if (resultsGrid) resultsGrid.innerHTML = html;
                updateDownloadButtonsInDOM();
            }
        } catch (err) {
            console.error("Search error:", err);
            if (resultsGrid) resultsGrid.innerHTML = "<p style='color:#EF4444; padding:20px;'>Search encountered an error. Please check your connection.</p>";
        }
    }, 280);
}

// =============================================================================
// PROVIDER INTEGRATIONS & LICENSING CONTROLS
// =============================================================================

function handleRestrictedDownload(message, event) {
    if (event) event.stopPropagation();
    showToast(message || "This track cannot be downloaded under licensing terms.");
}

async function fetchProviderStatuses() {
    try {
        const res = await fetch("/api/providers/status");
        const data = await res.json();
        if (data.success) {
            cachedProviderStatuses = data.providers;
            updateSidebarProviderBadge();
        }
        return cachedProviderStatuses;
    } catch (err) {
        console.warn("Could not fetch provider statuses:", err);
        return null;
    }
}

function updateSidebarProviderBadge() {
    const badge = document.getElementById("providersActiveBadge");
    if (!badge || !cachedProviderStatuses) return;
    const spotReady = cachedProviderStatuses.spotify && cachedProviderStatuses.spotify.configured;
    const ftuReady = cachedProviderStatuses.freetouse && cachedProviderStatuses.freetouse.configured;
    const jamReady = cachedProviderStatuses.jamendo && cachedProviderStatuses.jamendo.configured;
    const scReady = cachedProviderStatuses.soundcloud && cachedProviderStatuses.soundcloud.configured;
    let count = 0;
    if (spotReady) count++;
    if (ftuReady) count++;
    if (jamReady) count++;
    if (scReady) count++;
    if (count > 0) {
        badge.innerText = `${count} Active`;
        badge.style.background = "rgba(16, 185, 129, 0.2)";
        badge.style.color = "#10B981";
    } else {
        badge.innerText = "Setup";
        badge.style.background = "rgba(245, 158, 11, 0.2)";
        badge.style.color = "#F59E0B";
    }
}

function selectSearchProvider(provider) {
    selectedSearchProvider = provider;
    document.querySelectorAll(".provider-chip").forEach(chip => {
        chip.classList.toggle("active", chip.getAttribute("data-provider") === provider);
    });

    const alertBox = document.getElementById("providerStatusAlert");
    if (alertBox && cachedProviderStatuses) {
        if (provider === "jamendo" && !cachedProviderStatuses.jamendo.configured) {
            alertBox.style.display = "flex";
            alertBox.className = "provider-status-alert alert-warning";
            alertBox.innerHTML = `
                <div class="alert-content">
                    <strong><i class="fa-solid fa-circle-exclamation"></i> Jamendo Client ID Required:</strong>
                    <span>Jamendo API search is awaiting credentials. Set <code>JAMENDO_CLIENT_ID</code> in server environment or .env.</span>
                </div>
                <button class="btn-alert-action" onclick="openProvidersModal()">Setup Instructions</button>
            `;
        } else if (provider === "soundcloud" && !cachedProviderStatuses.soundcloud.configured) {
            alertBox.style.display = "flex";
            alertBox.className = "provider-status-alert alert-warning";
            alertBox.innerHTML = `
                <div class="alert-content">
                    <strong><i class="fa-solid fa-circle-exclamation"></i> SoundCloud API Credentials Required:</strong>
                    <span>SoundCloud requires developer approval and credentials. Set <code>SOUNDCLOUD_CLIENT_ID</code> and <code>SOUNDCLOUD_CLIENT_SECRET</code>.</span>
                </div>
                <button class="btn-alert-action" onclick="openProvidersModal()">Setup Instructions</button>
            `;
        } else if (provider === "spotify" && !cachedProviderStatuses.spotify.configured) {
            alertBox.style.display = "flex";
            alertBox.className = "provider-status-alert alert-warning";
            alertBox.innerHTML = `
                <div class="alert-content">
                    <strong><i class="fa-brands fa-spotify"></i> Spotify Authorization Token Required:</strong>
                    <span>Set <code>SPOTIFY_TOKEN</code> in server environment or .env file to enable Spotify Web API.</span>
                </div>
                <button class="btn-alert-action" onclick="openProvidersModal()">Setup Instructions</button>
            `;
        } else {
            alertBox.style.display = "none";
        }
    }

    const input = document.getElementById("searchInput");
    if (input && input.value.trim()) {
        handleSearch(input.value);
    }
}

async function openProvidersModal() {
    const modal = document.getElementById("providersModal");
    const body = document.getElementById("providersModalBody");
    if (!modal || !body) return;

    modal.style.display = "flex";
    body.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Checking music providers...</div>';

    const statuses = await fetchProviderStatuses();
    if (!statuses) {
        body.innerHTML = '<p style="color:#EF4444; padding:20px;">Could not connect to provider status endpoint.</p>';
        return;
    }

    const ftu = statuses.freetouse || {};
    const jam = statuses.jamendo || {};
    const sc = statuses.soundcloud || {};
    const vault = statuses.isaiify || {};
    const spot = statuses.spotify || {};

    body.innerHTML = `
        <div class="provider-modal-grid">
            <!-- Spotify Web API -->
            <div class="provider-card ${spot.configured ? 'active-card' : 'unconfigured-card'}">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        <i class="fa-brands fa-spotify" style="color:#1DB954;"></i>
                        <span>${spot.display_name || "Spotify Web API"}</span>
                    </div>
                    <span class="provider-badge-status ${spot.configured ? 'badge-ready' : 'badge-pending'}">
                        ${spot.configured ? (spot.connected_user ? `Connected (@${spot.connected_user})` : 'Connected') : 'Awaiting Authorization'}
                    </span>
                </div>
                <p class="provider-card-desc">Official Spotify OpenAPI schema & user top tracks streaming.</p>
                <div class="provider-card-details">
                    <div><strong>Connected User:</strong> ${spot.connected_user || "pavin"}</div>
                    <div><strong>Streaming:</strong> Official Previews & Spotify Deep Links</div>
                    <div><strong>Offline Downloads:</strong> <span style="color:#EF4444; font-weight:700;">Strictly Prohibited</span> (Spotify Terms strictly forbid downloading or caching audio)</div>
                    <div><strong>OpenAPI Schema:</strong> <a href="${spot.openapi_schema || 'https://developer.spotify.com/reference/web-api/open-api-schema.yaml'}" target="_blank" rel="noopener noreferrer">open-api-schema.yaml</a></div>
                    <div><strong>Developer Portal:</strong> <a href="${spot.terms_url || 'https://developer.spotify.com'}" target="_blank" rel="noopener noreferrer">developer.spotify.com</a></div>
                </div>
                <div style="margin-top:12px; display:flex; gap:10px; align-items:center;">
                    <a href="/api/spotify/login?redirect=1" class="btn-connect-spotify" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; background:#1DB954; color:#041E15; font-weight:700; border-radius:18px; text-decoration:none; font-size:12px;">
                        <i class="fa-brands fa-spotify"></i> ${spot.configured ? 'Authorize Account via PKCE' : 'Connect Account'}
                    </a>
                    ${spot.configured ? `
                    <button onclick="disconnectSpotify()" style="padding:6px 12px; background:rgba(239,68,68,0.2); color:#EF4444; border:1px solid rgba(239,68,68,0.4); border-radius:14px; cursor:pointer; font-size:12px; font-weight:600;">
                        <i class="fa-solid fa-link-slash"></i> Disconnect
                    </button>
                    ` : ''}
                </div>
            </div>

            <!-- Isaiify Vault -->
            <div class="provider-card active-card">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        <i class="fa-solid fa-vault text-emerald"></i>
                        <span>${vault.display_name || "Isaiify Vault"}</span>
                    </div>
                    <span class="provider-badge-status badge-ready">Connected</span>
                </div>
                <p class="provider-card-desc">Local curated master catalog and your user MP3 uploads.</p>
                <div class="provider-card-details">
                    <div><strong>Streaming:</strong> Allowed</div>
                    <div><strong>Offline Downloads:</strong> Allowed</div>
                    <div><strong>Catalog Source:</strong> Local Database & Server Storage</div>
                </div>
            </div>

            <!-- Free To Use Music -->
            <div class="provider-card active-card">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        <i class="fa-solid fa-compact-disc" style="color:#A78BFA;"></i>
                        <span>${ftu.display_name || "Free To Use Music"}</span>
                    </div>
                    <span class="provider-badge-status badge-ready">Connected</span>
                </div>
                <p class="provider-card-desc">Official Free To Use v3.0 REST API catalog (Human-made Lofi, Chill, and Ambient beats).</p>
                <div class="provider-card-details">
                    <div><strong>Streaming:</strong> Enabled (Open Access)</div>
                    <div><strong>Offline Downloads:</strong> Allowed (Royalty-free with attribution)</div>
                    <div><strong>API Endpoint:</strong> <code>https://api.freetouse.com/v3/music/tracks/search</code></div>
                    <div><strong>Website:</strong> <a href="https://freetouse.com" target="_blank" rel="noopener noreferrer">freetouse.com</a></div>
                </div>
            </div>

            <!-- Jamendo -->
            <div class="provider-card ${jam.configured ? 'active-card' : 'unconfigured-card'}">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        <i class="fa-brands fa-creative-commons" style="color:#10B981;"></i>
                        <span>${jam.display_name || "Jamendo Music"}</span>
                    </div>
                    <span class="provider-badge-status ${jam.configured ? 'badge-ready' : 'badge-pending'}">
                        ${jam.configured ? 'Connected' : 'Awaiting Client ID'}
                    </span>
                </div>
                <p class="provider-card-desc">Official Jamendo v3.0 REST API catalog under Creative Commons.</p>
                <div class="provider-card-details">
                    <div><strong>Streaming:</strong> ${jam.configured ? 'Enabled (Official API)' : 'Awaiting JAMENDO_CLIENT_ID'}</div>
                    <div><strong>Offline Downloads:</strong> Conditional (Allowed only when track artist permits CC download)</div>
                    <div><strong>Developer Portal:</strong> <a href="${jam.terms_url || 'https://developer.jamendo.com'}" target="_blank" rel="noopener noreferrer">developer.jamendo.com</a></div>
                </div>
                ${!jam.configured ? `
                    <div class="provider-setup-box">
                        <strong>How to enable Jamendo:</strong>
                        <ol>
                            <li>Register at <a href="https://developer.jamendo.com" target="_blank">developer.jamendo.com</a></li>
                            <li>Create an application to obtain your free Client ID</li>
                            <li>Set <code>JAMENDO_CLIENT_ID</code> in Render dashboard or your local <code>.env</code> file</li>
                        </ol>
                    </div>
                ` : ''}
            </div>

            <!-- SoundCloud -->
            <div class="provider-card ${sc.configured ? 'active-card' : 'unconfigured-card'}">
                <div class="provider-card-header">
                    <div class="provider-card-title">
                        <i class="fa-brands fa-soundcloud" style="color:#FF5500;"></i>
                        <span>${sc.display_name || "SoundCloud"}</span>
                    </div>
                    <span class="provider-badge-status ${sc.configured ? 'badge-ready' : 'badge-pending'}">
                        ${sc.configured ? 'Connected' : 'Awaiting API Approval'}
                    </span>
                </div>
                <p class="provider-card-desc">Official SoundCloud API streaming integration.</p>
                <div class="provider-card-details">
                    <div><strong>Streaming:</strong> ${sc.configured ? 'Enabled (Official API)' : 'Awaiting SOUNDCLOUD_CLIENT_ID'}</div>
                    <div><strong>Offline Downloads:</strong> <span style="color:#EF4444; font-weight:700;">Strictly Prohibited</span> (SoundCloud API Terms of Use forbid downloading and caching)</div>
                    <div><strong>Developer Portal:</strong> <a href="https://developers.soundcloud.com" target="_blank" rel="noopener noreferrer">developers.soundcloud.com</a></div>
                </div>
                ${!sc.configured ? `
                    <div class="provider-setup-box">
                        <strong>How to enable SoundCloud:</strong>
                        <ol>
                            <li>Request developer access at <a href="https://developers.soundcloud.com" target="_blank">developers.soundcloud.com</a></li>
                            <li>Receive your Client ID and Client Secret upon approval</li>
                            <li>Set <code>SOUNDCLOUD_CLIENT_ID</code> and <code>SOUNDCLOUD_CLIENT_SECRET</code> in Render / <code>.env</code></li>
                        </ol>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

async function disconnectSpotify() {
    if (!confirm("Are you sure you want to disconnect your Spotify account?")) return;
    try {
        const res = await fetch("/api/spotify/disconnect", { method: "POST", headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            showToast("Spotify account disconnected.");
            await fetchProviderStatuses();
            openProvidersModal();
        }
    } catch (e) {
        showToast("Error disconnecting Spotify account.");
    }
}

function closeProvidersModal(event) {
    if (event && event.target !== document.getElementById("providersModal")) return;
    const modal = document.getElementById("providersModal");
    if (modal) modal.style.display = "none";
}

function clearSearch() {
    const input = document.getElementById("searchInput");
    if (input) input.value = "";
    const clearBtn = document.getElementById("clearSearchBtn");
    if (clearBtn) clearBtn.style.display = "none";
    handleSearch("");
}

function focusSearch() {
    switchView("search");
    const input = document.getElementById("searchInput");
    if (input) {
        input.focus();
    }
}

// =============================================================================
// KEYBOARD SHORTCUTS
// =============================================================================

function setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
        // Ignore if user is currently typing in an input
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
            if (e.key === "Escape") {
                e.target.blur();
                clearSearch();
            }
            return;
        }

        if (e.code === "Space") {
            e.preventDefault();
            togglePlayPause();
        } else if (e.code === "ArrowRight") {
            e.preventDefault();
            if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        } else if (e.code === "ArrowLeft") {
            e.preventDefault();
            if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
        } else if (e.code === "ArrowUp") {
            e.preventDefault();
            changeVolume(Math.min(1, audio.volume + 0.05));
            volumeSlider.value = audio.volume;
        } else if (e.code === "ArrowDown") {
            e.preventDefault();
            changeVolume(Math.max(0, audio.volume - 0.05));
            volumeSlider.value = audio.volume;
        } else if (e.key === "m" || e.key === "M") {
            toggleMute();
        } else if (e.key === "l" || e.key === "L") {
            toggleCurrentFavorite();
        } else if (e.key === "q" || e.key === "Q") {
            toggleQueueDrawer();
        } else if (e.key === "?") {
            openShortcutsModal();
        } else if (e.key === "Escape") {
            if (isQueueOpen) toggleQueueDrawer();
            closeShortcutsModal();
        }
    });
}

function openShortcutsModal() {
    const modal = document.getElementById("shortcutsModal");
    if (modal) modal.style.display = "flex";
}

function closeShortcutsModal(e) {
    if (e && e.target && e.target.id !== "shortcutsModal" && !e.target.closest(".btn-icon")) return;
    const modal = document.getElementById("shortcutsModal");
    if (modal) modal.style.display = "none";
}

// UPLOAD MP3 FILE
async function handleSongUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast(`Uploading: ${file.name}...`);
    const formData = new FormData();
    formData.append("audio", file);
    formData.append("title", file.name.replace(/\.[^/.]+$/, ""));
    formData.append("artist", "My Uploads");
    formData.append("language", "TAMIL");

    try {
        const res = await fetch("/api/upload", {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Uploaded '${data.song.title}'! Playing now...`);
            allSongs.unshift(data.song);
            currentPlaylist.unshift(data.song);
            renderCarousels(allSongs);
            loadTrack(0, true);
        } else {
            showToast("Upload failed: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        console.error(err);
        showToast("Upload failed. Check app console.");
    }

    event.target.value = "";
}

async function recordPlayStart(songId) {
    try {
        await fetch("/api/events", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                user_id: getUserId(),
                song_id: songId,
                event_type: "play_start"
            })
        });
    } catch (e) {}
}

// TOAST NOTIFIER
function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}
