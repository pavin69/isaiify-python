// ISAIIFY MUSIC PLAYER ENGINE

let allSongs = [];
let currentPlaylist = [];
let currentTrackIndex = 0;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let currentLanguage = "ALL";
let isMuted = false;
let prevVolume = 0.8;

// DOM Elements
const audio = document.getElementById("audioPlayer");
const playPauseBtn = document.getElementById("playPauseBtn");
const playerTitle = document.getElementById("playerTitle");
const playerArtist = document.getElementById("playerArtist");
const playerArtwork = document.getElementById("playerArtwork");
const playerFavoriteBtn = document.getElementById("playerFavoriteBtn");
const playerLangBadge = document.getElementById("playerLangBadge");
const progressBar = document.getElementById("progressBar");
const currentTimeLabel = document.getElementById("currentTime");
const totalTimeLabel = document.getElementById("totalTime");
const volumeSlider = document.getElementById("volumeSlider");
const muteBtn = document.getElementById("muteBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const repeatBtn = document.getElementById("repeatBtn");
const greetingText = document.getElementById("greetingText");

// Initialize on Load
document.addEventListener("DOMContentLoaded", () => {
    updateGreeting();
    loadAllData();
    setupAudioListeners();
});

function updateGreeting() {
    const hour = new Date().getHours();
    let text = "Good evening";
    if (hour >= 4 && hour < 12) text = "Good morning";
    else if (hour >= 12 && hour < 17) text = "Good afternoon";
    if (greetingText) greetingText.innerText = text;
}

// Fetch Songs, Artists, and Albums from Python Backend
async function loadAllData() {
    try {
        const [songsRes, quickRes, artistsRes, albumsRes] = await Promise.all([
            fetch("/api/songs"),
            fetch("/api/quick-access"),
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
            renderAlbums(albumsData.albums);
        }
    } catch (err) {
        console.error("Failed to load music data:", err);
        showToast("Error connecting to server. Is app.py running?");
    }
}

// Render Top 6 Quick Cards (Spotify style)
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

// Render Carousels
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
}

function createSongCardHtml(song) {
    const badgeClass = song.language === "TAMIL" ? "badge-tamil" : "badge-english";
    const onlineBadge = song.is_online ? '<span style="background:#1DB954; color:#000; font-size:9px; font-weight:800; padding:2px 5px; border-radius:3px; margin-left:4px;">CLOUD</span>' : '';
    
    // Safely encode song object if it's an online stream
    return `
        <div class="music-card" onclick="handleCardClick('${song.id}')">
            <div class="card-img-wrap">
                <img src="${song.image_url}" alt="${song.title}">
                <span class="lang-badge ${badgeClass}">${song.language}</span>
                <button class="card-play-btn"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${song.title} ${onlineBadge}</div>
            <div class="card-sub">${song.artist}</div>
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

function renderAlbums(albums) {
    const carousel = document.getElementById("albumsCarousel");
    if (!carousel) return;
    carousel.innerHTML = albums.map(alb => `
        <div class="music-card" onclick="showToast('Album: ${alb.title}')">
            <div class="card-img-wrap">
                <img src="${alb.cover_art_url}" alt="${alb.title}">
                <button class="card-play-btn"><i class="fa-solid fa-play"></i></button>
            </div>
            <div class="card-title">${alb.title}</div>
            <div class="card-sub">${alb.artist} • ${alb.release_year}</div>
        </div>
    `).join("");
}

// AUDIO CONTROLS
function loadTrack(index, autoPlay = true) {
    if (currentPlaylist.length === 0) return;
    currentTrackIndex = (index + currentPlaylist.length) % currentPlaylist.length;
    const track = currentPlaylist[currentTrackIndex];

    audio.src = track.audio_url;
    audio.load();

    playerTitle.innerText = track.title;
    playerArtist.innerText = track.artist;
    playerArtwork.src = track.image_url;
    
    playerLangBadge.innerText = track.language;
    playerLangBadge.style.backgroundColor = track.language === "TAMIL" ? "var(--badge-tamil)" : "var(--badge-english)";

    updateFavoriteIcon(track.is_favorite === 1);

    if (autoPlay) {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPauseIcon();
            recordPlayHistory(track.id);
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

// Audio progress bar listeners
function setupAudioListeners() {
    audio.addEventListener("timeupdate", () => {
        if (!audio.duration) return;
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${progressPercent}%`;
        currentTimeLabel.innerText = formatTime(audio.currentTime);
        totalTimeLabel.innerText = formatTime(audio.duration);
    });

    audio.addEventListener("ended", () => {
        if (!isRepeat) {
            playNext();
        }
    });

    audio.addEventListener("play", () => {
        isPlaying = true;
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

// FAVORITES
async function toggleCurrentFavorite() {
    const track = currentPlaylist[currentTrackIndex];
    if (!track) return;

    try {
        const res = await fetch(`/api/favorites/${track.id}/toggle`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            track.is_favorite = data.is_favorite;
            updateFavoriteIcon(data.is_favorite === 1);
            showToast(data.is_favorite === 1 ? "Added to Liked Songs ❤️" : "Removed from Liked Songs");
        }
    } catch (err) {
        console.error(err);
    }
}

function updateFavoriteIcon(isFav) {
    if (isFav) {
        playerFavoriteBtn.innerHTML = '<i class="fa-solid fa-heart" style="color: #1DB954;"></i>';
    } else {
        playerFavoriteBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

// FILTER BY LANGUAGE
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
        showToast("Showing All Songs");
    }
}

// SEARCH FUNCTIONALITY (LOCAL + LIVE ONLINE CLOUD MUSIC API)
let searchTimeout = null;
function handleSearch(query) {
    const clearBtn = document.getElementById("clearSearchBtn");
    clearBtn.style.display = query ? "block" : "none";

    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        const trimmed = query.trim();
        const searchSection = document.getElementById("searchResultsSection");
        const resultsGrid = document.getElementById("searchResultsGrid");
        const countSpan = document.getElementById("searchResultCount");
        const onlineHeader = document.getElementById("onlineSearchHeader");

        if (!trimmed) {
            searchSection.style.display = "none";
            return;
        }

        searchSection.style.display = "block";
        resultsGrid.innerHTML = "<p style='color:#1DB954; padding:20px;'>Searching library and online music cloud...</p>";

        try {
            // Run both local search and online cloud search in parallel
            const [localRes, onlineRes] = await Promise.allSettled([
                fetch(`/api/search?q=${encodeURIComponent(trimmed)}`),
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
                    onlineHeader.style.display = "block";
                    // Add online songs to current session memory
                    onlineData.results.forEach(onlineSong => {
                        if (!allSongs.some(s => s.id === onlineSong.id)) {
                            allSongs.push(onlineSong);
                        }
                        mergedSongs.push(onlineSong);
                    });
                }
            }

            countSpan.innerText = `${mergedSongs.length} songs found`;

            if (mergedSongs.length === 0) {
                resultsGrid.innerHTML = "<p style='color:#B3B3B3; padding:20px;'>No songs found. Try uploading your own MP3 or searching another artist!</p>";
            } else {
                resultsGrid.innerHTML = mergedSongs.map(s => createSongCardHtml(s)).join("");
            }
        } catch (err) {
            console.error("Search error:", err);
            resultsGrid.innerHTML = "<p style='color:#E91429;'>Search failed. Please check internet connection for cloud songs.</p>";
        }
    }, 300);
}

function clearSearch() {
    const input = document.getElementById("searchInput");
    input.value = "";
    document.getElementById("clearSearchBtn").style.display = "none";
    document.getElementById("searchResultsSection").style.display = "none";
}

function focusSearch() {
    const input = document.getElementById("searchInput");
    input.focus();
    showToast("Type any Tamil or English song name!");
}

function switchView(view) {
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    const favSection = document.getElementById("favoritesSection");

    if (view === "favorites") {
        favSection.style.display = "block";
        loadFavoritesView();
        showToast("Your Liked Songs");
    } else {
        favSection.style.display = "none";
        showToast("Showing Home");
    }
}

async function loadFavoritesView() {
    try {
        const res = await fetch("/api/favorites");
        const data = await res.json();
        const grid = document.getElementById("favoritesGrid");
        if (data.success && grid) {
            if (data.favorites.length === 0) {
                grid.innerHTML = "<p style='color:#B3B3B3;'>No liked songs yet. Tap the heart icon on any song to add!</p>";
            } else {
                grid.innerHTML = data.favorites.map(s => createSongCardHtml(s)).join("");
            }
        }
    } catch (err) {
        console.error(err);
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
            loadTrack(0, true); // Play immediately!
        } else {
            showToast("Upload failed: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        console.error(err);
        showToast("Upload failed. Check app.py console.");
    }

    // Reset input
    event.target.value = "";
}

async function recordPlayHistory(songId) {
    try {
        await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ song_id: songId })
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
