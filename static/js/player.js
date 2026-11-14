// ISAIIFY MUSIC PLAYER ENGINE - v2.0
// Features: Albums & Catalog, Likes & Recommendations, Offline Listening (IndexedDB)

let allSongs = [];
let allAlbums = [];
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
const playerFavoriteBtn = document.getElementById("playerFavoriteBtn");
const playerDownloadBtn = document.getElementById("playerDownloadBtn");
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

// Initialize App on DOM Load
document.addEventListener("DOMContentLoaded", async () => {
    updateGreeting();
    initUserDisplay();
    setupNetworkListeners();
    await initOfflineDB();
    await loadAllData();
    await loadRecommendations();
    setupAudioListeners();
});

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
            showToast("Offline mode active: playing from downloads.");
        } else {
            if (offlineBanner) offlineBanner.style.display = "none";
            showToast("Back online! Streaming reconnected.");
        }
    }
    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);
    handleOnlineStatus();
}

function updateGreeting() {
    const hour = new Date().getHours();
    let text = "Good evening";
    if (hour >= 4 && hour < 12) text = "Good morning";
    else if (hour >= 12 && hour < 17) text = "Good afternoon";
    if (greetingText) greetingText.innerText = text;
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
        console.warn("IndexedDB initialization note:", err);
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

    // Find song metadata from catalog, album, or current playlist
    const song = allSongs.find(s => s.id === songId) || 
                 (currentAlbum && currentAlbum.songs ? currentAlbum.songs.find(s => s.id === songId) : null) ||
                 currentPlaylist.find(s => s.id === songId);

    if (!song) {
        showToast("Song metadata not found.");
        return;
    }

    // License check: verify if offline download is allowed
    if (song.allow_download === 0 || song.is_online) {
        showToast("Stream-only track: Offline download is not permitted by license.");
        return;
    }

    downloadingSongIds.add(songId);
    updateSongDownloadButtonUI(songId, "downloading");
    showToast(`Downloading '${song.title}' for offline listening...`);

    try {
        const response = await fetch(song.audio_url);
        if (!response.ok) throw new Error("Audio network fetch failed");
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
        showToast(`Saved '${song.title}' to Downloads! 📥`);

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
    if (!confirm("Remove all downloaded songs from offline storage?")) return;
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

    // Also update bottom player download icon if current track matches
    const currentTrack = currentPlaylist[currentTrackIndex];
    if (currentTrack && currentTrack.id === songId && playerDownloadBtn) {
        if (state === "downloaded") {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#1DB954;"></i>';
            playerDownloadBtn.title = "Downloaded (Offline ready)";
        } else if (state === "downloading") {
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:#f39c12;"></i>';
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
            playerDownloadBtn.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#1DB954;"></i>';
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

        if (songsData.success) {
            allSongs = songsData.songs;
            currentPlaylist = [...allSongs];
            renderCarousels(allSongs);
            if (allSongs.length > 0) {
                loadTrack(0, false); // Load first track paused
            }
        }

        if (quickData.success) {
            renderQuickAccess(quickData.songs);
        }

        if (artistsData.success) {
            renderArtists(artistsData.artists);
        }

        if (albumsData.success) {
            allAlbums = albumsData.albums;
            renderAlbums(allAlbums);
        }
    } catch (err) {
        console.error("Failed to load music data:", err);
        showToast("Error connecting to server. Is app.py running?");
    }
}

// Load Recommendations from Python Recommendation Engine
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
        console.warn("Recommendations load error:", e);
    }
}

// Render Top 6 Quick Cards
function renderQuickAccess(songs) {
    const grid = document.getElementById("quickAccessGrid");
    if (!grid) return;
    grid.innerHTML = songs.map(s => `
        <div class="quick-card" onclick="playSongById('${s.id}')">
            <img src="${s.image_url}" alt="${s.title}">
            <span class="quick-card-title">${s.title}</span>
            <button class="play-btn"><i class="fa-solid fa-play"></i></button>
        </div>
    `).join("");
}

// Render Song Carousels
function renderCarousels(songs) {
    const tamilCarousel = document.getElementById("tamilCarousel");
    const englishCarousel = document.getElementById("englishCarousel");

    const tamilSongs = songs.filter(s => s.language === "TAMIL");
    const englishSongs = songs.filter(s => s.language === "ENGLISH");

    if (tamilCarousel) {
        tamilCarousel.innerHTML = tamilSongs.map(s => createSongCardHtml(s)).join("");
    }
    if (englishCarousel) {
        englishCarousel.innerHTML = englishSongs.map(s => createSongCardHtml(s)).join("");
    }
    updateDownloadButtonsInDOM();
}

function createSongCardHtml(song) {
    const badgeClass = song.language === "TAMIL" ? "badge-tamil" : "badge-english";
    const onlineBadge = song.is_online ? '<span style="background:#1DB954; color:#000; font-size:9px; font-weight:800; padding:2px 5px; border-radius:3px; margin-left:4px;">CLOUD</span>' : '';
    const isLiked = song.is_favorite === 1;
    const isDownloaded = downloadedSongIds.has(song.id);
    const isDownloading = downloadingSongIds.has(song.id);

    const recBadge = song.recommendation_reason ? 
        `<div class="rec-reason-badge" title="${song.recommendation_reason}"><i class="fa-solid fa-wand-magic-sparkles"></i> ${song.recommendation_reason}</div>` : '';

    return `
        <div class="music-card" onclick="handleCardClick('${song.id}')">
            <div class="card-img-wrap">
                <img src="${song.image_url}" alt="${song.title}" loading="lazy">
                <span class="lang-badge ${badgeClass}">${song.language}</span>
                <button class="card-play-btn"><i class="fa-solid fa-play"></i></button>

                <div class="card-actions-hover">
                    <button class="card-action-btn ${isLiked ? 'liked' : ''}" 
                            data-fav-id="${song.id}"
                            title="${isLiked ? 'Unlike' : 'Like'}" 
                            onclick="toggleLikeSong('${song.id}', event)">
                        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
                    </button>
                    ${song.allow_download !== 0 ? `
                    <button class="card-action-btn ${isDownloaded ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}" 
                            data-dl-id="${song.id}"
                            title="${isDownloaded ? 'Downloaded (Offline)' : 'Download for offline'}" 
                            onclick="toggleSongDownload('${song.id}', event)">
                        <i class="${isDownloaded ? 'fa-solid fa-circle-check' : (isDownloading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-down')}"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            <div class="card-title">${song.title} ${onlineBadge}</div>
            <div class="card-sub">${song.artist}</div>
            ${recBadge}
        </div>
    `;
}

function renderArtists(artists) {
    const carousel = document.getElementById("artistsCarousel");
    if (!carousel) return;
    carousel.innerHTML = artists.map(a => `
        <div class="music-card artist-card" onclick="showToast('Artist: ${a.name}')">
            <div class="card-img-wrap">
                <img src="${a.image_url}" alt="${a.name}">
            </div>
            <div class="card-title">${a.name}</div>
            <div class="card-sub">${a.monthly_listeners}</div>
        </div>
    `).join("");
}

// Render Featured Albums
function renderAlbums(albums) {
    const carousel = document.getElementById("albumsCarousel");
    if (!carousel) return;
    carousel.innerHTML = albums.map(alb => createAlbumCardHtml(alb)).join("");
}

function createAlbumCardHtml(alb) {
    return `
        <div class="music-card" onclick="openAlbumView('${alb.id}')">
            <div class="card-img-wrap">
                <img src="${alb.cover_art_url}" alt="${alb.title}">
                <button class="card-play-btn"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${alb.title}</div>
            <div class="card-sub">${alb.artist} • ${alb.release_year}</div>
        </div>
    `;
}

// =============================================================================
// ALBUM DETAIL VIEW (Feature 1)
// =============================================================================

async function openAlbumView(albumId) {
    try {
        const res = await fetch(`/api/albums/${albumId}`, { headers: authHeaders() });
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

    // Calculate total duration
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
                <span class="artist-highlight">${album.artist}</span>
                <span class="meta-dot">•</span>
                <span>${album.release_year}</span>
                <span class="meta-dot">•</span>
                <span>${album.songs.length} song${album.songs.length === 1 ? '' : 's'}</span>
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
                    <span class="track-main-artist">${s.artist}</span>
                </div>
                <div class="col-genre">${s.category || s.tags || 'Soundtrack'}</div>
                <div class="col-time">${formatTime(s.duration_seconds || 200)}</div>
                <div class="col-actions">
                    <button class="btn-track-action ${isLiked ? 'liked' : ''}" 
                            data-fav-id="${s.id}"
                            title="${isLiked ? 'Unlike' : 'Like'}"
                            onclick="toggleLikeSong('${s.id}', event)">
                        <i class="${isLiked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'}"></i>
                    </button>
                    ${s.allow_download !== 0 ? `
                    <button class="btn-track-action ${isDownloaded ? 'downloaded' : ''} ${isDownloading ? 'downloading' : ''}"
                            data-dl-id="${s.id}"
                            title="${isDownloaded ? 'Downloaded' : 'Download for offline'}"
                            onclick="toggleSongDownload('${s.id}', event)">
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
}

function playCurrentAlbum() {
    if (!currentAlbum || !currentAlbum.songs || currentAlbum.songs.length === 0) return;
    currentPlaylist = [...currentAlbum.songs];
    loadTrack(0, true);
    renderAlbumDetail(currentAlbum);
    showToast(`Playing '${currentAlbum.title}'`);
}

function shuffleCurrentAlbum() {
    if (!currentAlbum || !currentAlbum.songs || currentAlbum.songs.length === 0) return;
    currentPlaylist = [...currentAlbum.songs].sort(() => Math.random() - 0.5);
    loadTrack(0, true);
    renderAlbumDetail(currentAlbum);
    showToast(`Shuffled '${currentAlbum.title}'`);
}

function renderAllAlbumsView() {
    const grid = document.getElementById("allAlbumsGrid");
    if (!grid) return;
    grid.innerHTML = allAlbums.map(alb => createAlbumCardHtml(alb)).join("");
}

// =============================================================================
// LIKES & EVENT RECORDING (Feature 2)
// =============================================================================

async function toggleLikeSong(songId, event) {
    if (event) event.stopPropagation();

    try {
        const res = await fetch(`/api/favorites/${songId}/toggle`, {
            method: "POST",
            headers: authHeaders()
        });
        const data = await res.json();
        if (data.success) {
            const isFav = data.is_favorite === 1;

            // Sync all matching songs in memory
            allSongs.forEach(s => {
                if (s.id === songId) s.is_favorite = data.is_favorite;
            });
            currentPlaylist.forEach(s => {
                if (s.id === songId) s.is_favorite = data.is_favorite;
            });

            // Update all favorite buttons with this data-fav-id
            document.querySelectorAll(`[data-fav-id="${songId}"]`).forEach(btn => {
                btn.classList.toggle("liked", isFav);
                btn.innerHTML = isFav ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
                btn.title = isFav ? "Unlike" : "Like";
            });

            // Update bottom player bar if playing this song
            const currentTrack = currentPlaylist[currentTrackIndex];
            if (currentTrack && currentTrack.id === songId) {
                updateFavoriteIcon(isFav);
            }

            showToast(isFav ? "Added to Liked Songs ❤️" : "Removed from Liked Songs");

            // Refresh recommendations to reflect updated taste profile
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
        playerFavoriteBtn.innerHTML = '<i class="fa-solid fa-heart" style="color: #1DB954;"></i>';
    } else {
        playerFavoriteBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

// Completed Play & Event Tracking
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
        setTimeout(() => completedPlayCooldown.delete(track.id), 60000); // 60s cooldown

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
            // Positive listening signal: refresh recommendations
            loadRecommendations();
        } catch (e) {}
    }
}

// =============================================================================
// OFFLINE DOWNLOADS VIEW (Feature 3)
// =============================================================================

async function loadDownloadsView() {
    const grid = document.getElementById("downloadsGrid");
    const storageTag = document.getElementById("downloadsStorageTag");
    if (!grid) return;

    const downloadedItems = await getAllDownloadedSongs();
    const totalBytes = downloadedItems.reduce((acc, item) => acc + (item.sizeBytes || 0), 0);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

    if (storageTag) {
        storageTag.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${totalMB} MB cached`;
    }

    if (downloadedItems.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">
                <i class="fa-solid fa-circle-down" style="font-size: 40px; margin-bottom: 12px; color: var(--text-subtle);"></i>
                <p>No downloaded songs yet.</p>
                <p style="font-size: 13px; margin-top: 6px;">Tap the download icon on any song to save it for offline playback.</p>
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
                    <img src="${s.image_url}" alt="${s.title}">
                    <span class="lang-badge badge-tamil" style="background:#1DB954; color:#000;">OFFLINE</span>
                    <button class="card-play-btn"><i class="fa-solid fa-play"></i></button>
                    <div class="card-actions-hover" style="opacity:1;">
                        <button class="card-action-btn" title="Remove Download" onclick="removeDownload('${s.id}', event)">
                            <i class="fa-solid fa-trash-can" style="color:#ff5252;"></i>
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
        showToast("Downloaded song not found in storage.");
        return;
    }

    // Insert or find in currentPlaylist
    let index = currentPlaylist.findIndex(s => s.id === id);
    if (index === -1) {
        currentPlaylist.unshift(offlineItem.song);
        index = 0;
    }
    loadTrack(index, true);
}

// =============================================================================
// AUDIO CONTROLS & LISTENERS
// =============================================================================

async function loadTrack(index, autoPlay = true) {
    if (currentPlaylist.length === 0) return;

    // Check completed play on previous track before switching
    await checkAndRecordCompletedPlay();
    resetPlaybackTracker();

    currentTrackIndex = (index + currentPlaylist.length) % currentPlaylist.length;
    const track = currentPlaylist[currentTrackIndex];

    // Check if this track is cached offline in IndexedDB
    const offlineRecord = await getDownloadedSong(track.id);
    if (offlineRecord && offlineRecord.audioBlob) {
        // Play directly from offline IndexedDB blob! Zero network dependency!
        audio.src = URL.createObjectURL(offlineRecord.audioBlob);
    } else {
        if (!navigator.onLine) {
            showToast(`Offline: '${track.title}' is not downloaded. Choose a track from Downloads!`);
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
}

function playNext() {
    if (isShuffle) {
        currentTrackIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
        currentTrackIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    }
    loadTrack(currentTrackIndex, true);
}

function playPrevious() {
    currentTrackIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    loadTrack(currentTrackIndex, true);
}

function handleCardClick(id) {
    playSongById(id);
}

function playSongById(id) {
    const index = currentPlaylist.findIndex(s => s.id === id);
    if (index !== -1) {
        loadTrack(index, true);
    } else {
        const song = allSongs.find(s => s.id === id);
        if (song) {
            currentPlaylist.push(song);
            loadTrack(currentPlaylist.length - 1, true);
        }
    }
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

    // Reset navigation button active states
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const navBtnMap = {
        home: "navHome",
        search: "navSearch",
        albums: "navAlbums",
        favorites: "navFavorites",
        downloads: "navDownloads"
    };
    if (navBtnMap[view]) {
        const btn = document.getElementById(navBtnMap[view]);
        if (btn) btn.classList.add("active");
    }

    // Toggle content sections
    const welcomeSec = document.getElementById("welcomeSection");
    const quickSec = document.getElementById("quickAccessSection");
    const recSec = document.getElementById("recommendationsSection");
    const tamilSec = document.getElementById("tamilSection");
    const englishSec = document.getElementById("englishSection");
    const albumsSec = document.getElementById("albumsSection");
    const artistsSec = document.getElementById("artistsSection");

    const searchSec = document.getElementById("searchResultsSection");
    const albumDetailSec = document.getElementById("albumDetailSection");
    const albumsViewSec = document.getElementById("albumsViewSection");
    const favoritesSec = document.getElementById("favoritesSection");
    const downloadsSec = document.getElementById("downloadsSection");

    // Hide all secondary views
    if (albumDetailSec) albumDetailSec.style.display = "none";
    if (albumsViewSec) albumsViewSec.style.display = "none";
    if (favoritesSec) favoritesSec.style.display = "none";
    if (downloadsSec) downloadsSec.style.display = "none";
    if (searchSec && view !== "search") searchSec.style.display = "none";

    // Show/hide home sections
    const isHome = view === "home";
    if (welcomeSec) welcomeSec.style.display = isHome ? "block" : "none";
    if (quickSec) quickSec.style.display = isHome ? "block" : "none";
    if (recSec) recSec.style.display = isHome ? "block" : "none";
    if (tamilSec) tamilSec.style.display = isHome ? "block" : "none";
    if (englishSec) englishSec.style.display = isHome ? "block" : "none";
    if (albumsSec) albumsSec.style.display = isHome ? "block" : "none";
    if (artistsSec) artistsSec.style.display = isHome ? "block" : "none";

    if (view === "albums") {
        if (albumsViewSec) albumsViewSec.style.display = "block";
        renderAllAlbumsView();
    } else if (view === "albumDetail") {
        if (albumDetailSec) albumDetailSec.style.display = "block";
    } else if (view === "favorites") {
        if (favoritesSec) favoritesSec.style.display = "block";
        loadFavoritesView();
    } else if (view === "downloads") {
        if (downloadsSec) downloadsSec.style.display = "block";
        loadDownloadsView();
    }

    // Scroll to top of content
    const scrollContainer = document.getElementById("mainScroll");
    if (scrollContainer) scrollContainer.scrollTop = 0;
}

function navigateBack() {
    if (viewHistory.length > 1) {
        viewHistory.pop(); // Remove current view
        const prev = viewHistory.pop();
        switchView(prev || "home");
    } else {
        switchView("home");
    }
}

// Filter by language
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

// Favorites View Loader
async function loadFavoritesView() {
    try {
        const res = await fetch("/api/favorites", { headers: authHeaders() });
        const data = await res.json();
        const grid = document.getElementById("favoritesGrid");
        const desc = document.getElementById("likedSongsDesc");

        if (data.success && grid) {
            if (desc) desc.innerText = `${data.favorites.length} liked song${data.favorites.length === 1 ? '' : 's'}`;
            if (data.favorites.length === 0) {
                grid.innerHTML = "<p style='color:#B3B3B3; padding:20px;'>No liked songs yet. Tap the heart icon on any song to add!</p>";
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
// SEARCH FUNCTIONALITY (LOCAL + LIVE ONLINE CLOUD MUSIC API)
// =============================================================================

let searchTimeout = null;
function handleSearch(query) {
    const clearBtn = document.getElementById("clearSearchBtn");
    if (clearBtn) clearBtn.style.display = query ? "block" : "none";

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const trimmed = query.trim();
        const searchSection = document.getElementById("searchResultsSection");
        const resultsGrid = document.getElementById("searchResultsGrid");
        const countSpan = document.getElementById("searchResultCount");
        const onlineHeader = document.getElementById("onlineSearchHeader");

        if (!trimmed) {
            if (searchSection) searchSection.style.display = "none";
            return;
        }

        if (searchSection) searchSection.style.display = "block";
        if (resultsGrid) resultsGrid.innerHTML = "<p style='color:#1DB954; padding:20px;'>Searching library and online cloud...</p>";

        try {
            const [localRes, onlineRes] = await Promise.allSettled([
                fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { headers: authHeaders() }),
                fetch(`/api/online-search?q=${encodeURIComponent(trimmed)}`)
            ]);

            let mergedSongs = [];

            if (localRes.status === "fulfilled") {
                const localData = await localRes.value.json();
                if (localData.success) {
                    mergedSongs.push(...localData.songs);
                }
            }

            if (onlineRes.status === "fulfilled") {
                const onlineData = await onlineRes.value.json();
                if (onlineData.success && onlineData.results.length > 0) {
                    if (onlineHeader) onlineHeader.style.display = "block";
                    onlineData.results.forEach(onlineSong => {
                        if (!allSongs.some(s => s.id === onlineSong.id)) {
                            allSongs.push(onlineSong);
                        }
                        mergedSongs.push(onlineSong);
                    });
                }
            }

            if (countSpan) countSpan.innerText = `${mergedSongs.length} songs found`;

            if (mergedSongs.length === 0) {
                if (resultsGrid) resultsGrid.innerHTML = "<p style='color:#B3B3B3; padding:20px;'>No songs found. Try uploading your own MP3 or searching another artist!</p>";
            } else {
                if (resultsGrid) resultsGrid.innerHTML = mergedSongs.map(s => createSongCardHtml(s)).join("");
                updateDownloadButtonsInDOM();
            }
        } catch (err) {
            console.error("Search error:", err);
            if (resultsGrid) resultsGrid.innerHTML = "<p style='color:#E91429;'>Search failed. Please check internet connection for cloud songs.</p>";
        }
    }, 300);
}

function clearSearch() {
    const input = document.getElementById("searchInput");
    if (input) input.value = "";
    const clearBtn = document.getElementById("clearSearchBtn");
    if (clearBtn) clearBtn.style.display = "none";
    const searchSection = document.getElementById("searchResultsSection");
    if (searchSection) searchSection.style.display = "none";
}

function focusSearch() {
    const input = document.getElementById("searchInput");
    if (input) {
        input.focus();
        showToast("Type any Tamil or English song name!");
    }
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
            showToast(`Uploaded: ${data.song.title}! Playing now...`);
            allSongs.unshift(data.song);
            currentPlaylist.unshift(data.song);
            renderCarousels(allSongs);
            loadTrack(0, true);
        } else {
            showToast("Upload failed: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        console.error(err);
        showToast("Upload failed. Check app.py console.");
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
    }, 2500);
}
