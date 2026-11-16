import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "isaiify.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
    CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        language TEXT NOT NULL,
        category TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        audio_url TEXT NOT NULL,
        image_url TEXT NOT NULL,
        is_favorite INTEGER DEFAULT 0,
        play_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS artists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        image_url TEXT NOT NULL,
        monthly_listeners TEXT NOT NULL,
        language TEXT NOT NULL,
        bio TEXT
    );

    CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        cover_art_url TEXT NOT NULL,
        release_year INTEGER NOT NULL,
        language TEXT NOT NULL,
        song_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
        playlist_id TEXT,
        song_id TEXT,
        PRIMARY KEY (playlist_id, song_id),
        FOREIGN KEY (playlist_id) REFERENCES playlists (id),
        FOREIGN KEY (song_id) REFERENCES songs (id)
    );

    CREATE TABLE IF NOT EXISTS listening_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id TEXT,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_id) REFERENCES songs (id)
    );

    CREATE TABLE IF NOT EXISTS user_likes (
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, song_id),
        FOREIGN KEY (song_id) REFERENCES songs (id)
    );

    CREATE TABLE IF NOT EXISTS listening_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        listened_seconds REAL DEFAULT 0,
        song_duration REAL DEFAULT 0,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_id) REFERENCES songs (id)
    );
    """)

    # Schema migration: ensure songs table has album_id, tags, allow_download, provider, source_url, license_url
    cursor.execute("PRAGMA table_info(songs)")
    columns = [row[1] for row in cursor.fetchall()]
    if "album_id" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN album_id TEXT DEFAULT ''")
    if "tags" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN tags TEXT DEFAULT ''")
    if "allow_download" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN allow_download INTEGER DEFAULT 1")
    if "provider" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN provider TEXT DEFAULT 'isaiify'")
    if "source_url" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN source_url TEXT DEFAULT ''")
    if "license_url" not in columns:
        cursor.execute("ALTER TABLE songs ADD COLUMN license_url TEXT DEFAULT ''")

    # Schema migration: ensure albums table has genre
    cursor.execute("PRAGMA table_info(albums)")
    album_columns = [row[1] for row in cursor.fetchall()]
    if "genre" not in album_columns:
        cursor.execute("ALTER TABLE albums ADD COLUMN genre TEXT DEFAULT 'Soundtrack'")

    # Seed or upgrade songs & albums
    upgrade_and_seed_catalog(cursor)

    conn.commit()
    conn.close()
    print("Database initialized & migrated successfully at:", DB_PATH)

def upgrade_and_seed_catalog(cursor):
    """Clean out dummy/placeholder tunes and albums; maintain verified artists & user library."""
    # Delete unnecessary placeholder/dummy wav songs and mock albums
    cursor.execute("DELETE FROM playlist_songs WHERE playlist_id = 'pl_01'")
    cursor.execute("DELETE FROM playlists WHERE id = 'pl_01'")
    cursor.execute("DELETE FROM songs WHERE audio_url LIKE '/static/audio/%.wav'")
    cursor.execute("DELETE FROM songs WHERE id LIKE '%test%'")
    cursor.execute("DELETE FROM user_likes WHERE song_id LIKE '%test%'")
    cursor.execute("DELETE FROM albums WHERE id LIKE 'alb_%'")

    # Verified Artists Directory
    artists = [
        ("art_01", "Anirudh Ravichander", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80", "18.4M monthly listeners", "TAMIL", "Leading music sensation of modern Indian cinema."),
        ("art_02", "A.R. Rahman", "https://images.unsplash.com/photo-1520523839898-50712213388b?w=500&auto=format&fit=crop&q=80", "24.1M monthly listeners", "TAMIL", "Oscar-winning legend, the Mozart of Madras."),
        ("art_03", "The Weeknd", "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80", "105.8M monthly listeners", "ENGLISH", "Global superstar redefining R&B and synth-pop."),
        ("art_04", "Yuvan Shankar Raja", "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80", "9.7M monthly listeners", "TAMIL", "Youth icon and maestro of soulful Tamil melodies."),
        ("art_05", "Taylor Swift", "https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=500&auto=format&fit=crop&q=80", "98.2M monthly listeners", "ENGLISH", "Global pop icon with timeless albums and storytelling."),
        ("art_06", "Ed Sheeran", "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80", "84.2M monthly listeners", "ENGLISH", "Record-breaking British singer-songwriter with timeless acoustic hits."),
        ("art_07", "Harry Styles", "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80", "62.5M monthly listeners", "ENGLISH", "Grammy-winning icon delivering infectious retro pop and indie anthems."),
        ("art_08", "Dhibu Ninan Thomas", "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=500&auto=format&fit=crop&q=80", "3.8M monthly listeners", "TAMIL", "Acclaimed composer behind modern Tamil romantic masterworks."),
    ]
    cursor.executemany("""
    INSERT OR REPLACE INTO artists VALUES (?, ?, ?, ?, ?, ?)
    """, artists)

# Helper query functions for app & admin workflow
def get_album_with_songs(album_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM albums WHERE id = ?", (album_id,))
    album_row = cursor.fetchone()
    if not album_row:
        conn.close()
        return None
    
    album = dict(album_row)
    cursor.execute("SELECT * FROM songs WHERE album_id = ? ORDER BY id ASC", (album_id,))
    album["songs"] = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return album

def add_song(song_dict):
    """Add or update a song easily in the catalog, including external provider tracks."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO songs (
        id, title, artist, album, album_id, language, category,
        duration_seconds, audio_url, image_url, is_favorite, play_count,
        tags, allow_download, provider, source_url, license_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        artist=excluded.artist,
        album=excluded.album,
        album_id=excluded.album_id,
        language=excluded.language,
        category=excluded.category,
        duration_seconds=excluded.duration_seconds,
        audio_url=excluded.audio_url,
        image_url=excluded.image_url,
        tags=excluded.tags,
        allow_download=excluded.allow_download,
        provider=excluded.provider,
        source_url=excluded.source_url,
        license_url=excluded.license_url
    """, (
        song_dict.get("id"),
        song_dict.get("title"),
        song_dict.get("artist"),
        song_dict.get("album", "Single"),
        song_dict.get("album_id", ""),
        song_dict.get("language", "TAMIL").upper(),
        song_dict.get("category", "General"),
        int(song_dict.get("duration_seconds", 200)),
        song_dict.get("audio_url"),
        song_dict.get("image_url", "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500"),
        int(song_dict.get("is_favorite", 0)),
        int(song_dict.get("play_count", 0)),
        song_dict.get("tags", ""),
        int(song_dict.get("allow_download", 1)),
        song_dict.get("provider", "isaiify"),
        song_dict.get("source_url", ""),
        song_dict.get("license_url", "")
    ))
    conn.commit()
    conn.close()

def add_album(album_dict):
    """Add or update an album in the catalog."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO albums (id, title, artist, cover_art_url, release_year, language, song_count, genre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        artist=excluded.artist,
        cover_art_url=excluded.cover_art_url,
        release_year=excluded.release_year,
        language=excluded.language,
        song_count=excluded.song_count,
        genre=excluded.genre
    """, (
        album_dict.get("id"),
        album_dict.get("title"),
        album_dict.get("artist"),
        album_dict.get("cover_art_url"),
        int(album_dict.get("release_year", 2024)),
        album_dict.get("language", "TAMIL"),
        int(album_dict.get("song_count", 1)),
        album_dict.get("genre", "Soundtrack")
    ))
    conn.commit()
    conn.close()

def toggle_user_like(user_id, song_id, song_data=None):
    """Toggle a like for a specific user. Supports saving external Jamendo/SoundCloud tracks."""
    if song_data and isinstance(song_data, dict):
        # Ensure song exists in songs table with provider attribution
        conn_check = get_connection()
        cursor_check = conn_check.cursor()
        cursor_check.execute("SELECT id FROM songs WHERE id = ?", (song_id,))
        exists = cursor_check.fetchone() is not None
        conn_check.close()
        if not exists:
            # Fallback values if needed
            song_payload = dict(song_data)
            song_payload["id"] = song_id
            add_song(song_payload)

    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT 1 FROM user_likes WHERE user_id = ? AND song_id = ?", (user_id, song_id))
    already_liked = cursor.fetchone() is not None
    
    if already_liked:
        cursor.execute("DELETE FROM user_likes WHERE user_id = ? AND song_id = ?", (user_id, song_id))
        is_liked = False
    else:
        cursor.execute("INSERT OR REPLACE INTO user_likes (user_id, song_id) VALUES (?, ?)", (user_id, song_id))
        is_liked = True
        
    # Also update songs.is_favorite cache for backward compatibility
    cursor.execute("UPDATE songs SET is_favorite = ? WHERE id = ?", (1 if is_liked else 0, song_id))
    
    conn.commit()
    conn.close()
    return is_liked

def get_user_likes(user_id):
    """Get all song objects liked by a specific user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.* FROM songs s
    INNER JOIN user_likes ul ON s.id = ul.song_id
    WHERE ul.user_id = ?
    ORDER BY ul.created_at DESC
    """, (user_id,))
    songs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return songs

def record_event(user_id, song_id, event_type, listened_seconds=0, song_duration=0):
    """Record a listening event (play_start, completed_play, like, unlike)."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO listening_events (user_id, song_id, event_type, listened_seconds, song_duration)
    VALUES (?, ?, ?, ?, ?)
    """, (user_id, song_id, event_type, listened_seconds, song_duration))
    
    # If completed play, increment play_count on the song
    if event_type == "completed_play":
        cursor.execute("UPDATE songs SET play_count = play_count + 1 WHERE id = ?", (song_id,))
        cursor.execute("INSERT INTO listening_history (song_id) VALUES (?)", (song_id,))
        
    conn.commit()
    conn.close()

def get_artist_with_content(artist_id):
    """Retrieve full artist profile including popular songs and albums."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM artists WHERE id = ?", (artist_id,))
    artist_row = cursor.fetchone()
    if not artist_row:
        conn.close()
        return None
    
    artist = dict(artist_row)
    # Match songs by artist name
    cursor.execute("""
    SELECT * FROM songs 
    WHERE artist LIKE ? 
    ORDER BY play_count DESC
    """, (f"%{artist['name']}%",))
    artist["songs"] = [dict(r) for r in cursor.fetchall()]

    # Match albums by artist name
    cursor.execute("""
    SELECT * FROM albums 
    WHERE artist LIKE ? 
    ORDER BY release_year DESC
    """, (f"%{artist['name']}%",))
    artist["albums"] = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return artist

def get_recently_played(user_id, limit=8):
    """Get songs recently played by user; fallback to top played songs."""
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT s.*, MAX(le.timestamp) as last_played
    FROM listening_events le
    JOIN songs s ON le.song_id = s.id
    WHERE le.user_id = ?
    GROUP BY s.id
    ORDER BY last_played DESC
    LIMIT ?
    """, (user_id, limit))
    songs = [dict(r) for r in cursor.fetchall()]

    if not songs:
        cursor.execute("SELECT * FROM songs ORDER BY play_count DESC LIMIT ?", (limit,))
        songs = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return songs

if __name__ == "__main__":
    init_db()
