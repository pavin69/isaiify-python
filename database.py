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
    """)

    # Seed data if songs table is empty
    cursor.execute("SELECT COUNT(*) FROM songs")
    if cursor.fetchone()[0] == 0:
        seed_data(cursor)

    conn.commit()
    conn.close()
    print("Database initialized successfully at:", DB_PATH)

def seed_data(cursor):
    # Tamil Songs
    tamil_songs = [
        ("tam_01", "Naa Ready", "Anirudh Ravichander, Thalapathy Vijay", "Leo", "TAMIL", "Mass Hits", 248,
         "/static/audio/naa_ready.wav", "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80", 1, 1420),
        ("tam_02", "Hukum - Thalaivar Alappara", "Anirudh Ravichander", "Jailer", "TAMIL", "Mass Hits", 207,
         "/static/audio/hukum.wav", "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop&q=80", 0, 1180),
        ("tam_03", "Marakkuma Nenjam", "A.R. Rahman", "Vendhu Thanindhathu Kaadu", "TAMIL", "Melody", 255,
         "/static/audio/marakkuma_nenjam.wav", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80", 1, 980),
        ("tam_04", "Arabic Kuthu", "Anirudh Ravichander, Jonita Gandhi", "Beast", "TAMIL", "Party", 280,
         "/static/audio/arabic_kuthu.wav", "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=500&auto=format&fit=crop&q=80", 0, 890),
        ("tam_05", "Adiye", "Dhibu Ninan Thomas, Kapil Kapilan", "Bachelor", "TAMIL", "Romantic", 243,
         "/static/audio/adiye.wav", "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=500&auto=format&fit=crop&q=80", 0, 670),
    ]

    # English Songs
    english_songs = [
        ("eng_01", "Blinding Lights", "The Weeknd", "After Hours", "ENGLISH", "Synthwave Pop", 200,
         "/static/audio/blinding_lights.wav", "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80", 1, 3500),
        ("eng_02", "Starboy", "The Weeknd, Daft Punk", "Starboy", "ENGLISH", "Pop", 230,
         "/static/audio/starboy.wav", "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=500&auto=format&fit=crop&q=80", 0, 2900),
        ("eng_03", "Shape of You", "Ed Sheeran", "÷ (Divide)", "ENGLISH", "Pop", 233,
         "/static/audio/shape_of_you.wav", "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=500&auto=format&fit=crop&q=80", 0, 3100),
        ("eng_04", "As It Was", "Harry Styles", "Harry's House", "ENGLISH", "Indie Pop", 167,
         "/static/audio/as_it_was.wav", "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80", 1, 2400),
        ("eng_05", "Cruel Summer", "Taylor Swift", "Lover", "ENGLISH", "Pop", 178,
         "/static/audio/cruel_summer.wav", "https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=500&auto=format&fit=crop&q=80", 0, 2750),
    ]

    cursor.executemany("""
    INSERT INTO songs (id, title, artist, album, language, category, duration_seconds, audio_url, image_url, is_favorite, play_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, tamil_songs + english_songs)

    # Artists
    artists = [
        ("art_01", "Anirudh Ravichander", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80", "18.4M monthly listeners", "TAMIL", "Leading music sensation of modern Indian cinema."),
        ("art_02", "A.R. Rahman", "https://images.unsplash.com/photo-1520523839898-50712213388b?w=500&auto=format&fit=crop&q=80", "24.1M monthly listeners", "TAMIL", "Oscar-winning legend, the Mozart of Madras."),
        ("art_03", "The Weeknd", "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80", "105.8M monthly listeners", "ENGLISH", "Global superstar redefining R&B and synth-pop."),
        ("art_04", "Yuvan Shankar Raja", "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=500&auto=format&fit=crop&q=80", "9.7M monthly listeners", "TAMIL", "Youth icon and maestro of soulful Tamil melodies."),
        ("art_05", "Taylor Swift", "https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=500&auto=format&fit=crop&q=80", "98.2M monthly listeners", "ENGLISH", "Global pop icon with timeless albums and storytelling."),
    ]
    cursor.executemany("INSERT INTO artists VALUES (?, ?, ?, ?, ?, ?)", artists)

    # Albums
    albums = [
        ("alb_01", "Leo (Original Motion Picture Soundtrack)", "Anirudh Ravichander", "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop&q=80", 2023, "TAMIL", 6),
        ("alb_02", "After Hours", "The Weeknd", "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop&q=80", 2020, "ENGLISH", 14),
        ("alb_03", "Ponniyin Selvan 2", "A.R. Rahman", "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=500&auto=format&fit=crop&q=80", 2023, "TAMIL", 7),
        ("alb_04", "Midnights", "Taylor Swift", "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=500&auto=format&fit=crop&q=80", 2022, "ENGLISH", 13),
    ]
    cursor.executemany("INSERT INTO albums VALUES (?, ?, ?, ?, ?, ?, ?)", albums)

    # Default Playlist
    cursor.execute("INSERT INTO playlists VALUES ('pl_01', 'Tamil & English Favorites', 'Best handpicked tracks by Isaiify', CURRENT_TIMESTAMP)")
    cursor.execute("INSERT INTO playlist_songs VALUES ('pl_01', 'tam_01')")
    cursor.execute("INSERT INTO playlist_songs VALUES ('pl_01', 'eng_01')")
    cursor.execute("INSERT INTO playlist_songs VALUES ('pl_01', 'tam_03')")

if __name__ == "__main__":
    init_db()
