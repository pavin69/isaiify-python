import os
import urllib.request
import urllib.parse
import json
from flask import Flask, render_template, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
import database

app = Flask(__name__, static_folder="static", template_folder="templates")

AUDIO_FOLDER = os.path.join(os.path.dirname(__file__), "static", "audio")
os.makedirs(AUDIO_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'm4a', 'ogg'}

# Initialize database on startup
database.init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/")
def index():
    return render_template("index.html")

# --- API ENDPOINTS ---

@app.route("/api/songs", methods=["GET"])
def get_songs():
    language = request.args.get("language", "ALL").upper()
    category = request.args.get("category")
    
    conn = database.get_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM songs WHERE 1=1"
    params = []
    
    if language in ["TAMIL", "ENGLISH"]:
        query += " AND language = ?"
        params.append(language)
        
    if category:
        query += " AND category = ?"
        params.append(category)
        
    cursor.execute(query, params)
    songs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "songs": songs})

@app.route("/api/quick-access", methods=["GET"])
def get_quick_access():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM songs ORDER BY play_count DESC LIMIT 6")
    songs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "songs": songs})

@app.route("/api/search", methods=["GET"])
def search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"success": True, "songs": [], "artists": [], "albums": []})
        
    term = f"%{q}%"
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR category LIKE ?",
                   (term, term, term, term))
    songs = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM artists WHERE name LIKE ?", (term,))
    artists = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM albums WHERE title LIKE ? OR artist LIKE ?", (term, term))
    albums = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return jsonify({
        "success": True,
        "query": q,
        "songs": songs,
        "artists": artists,
        "albums": albums
    })

import html

# --- ONLINE MUSIC API SEARCH (Full-length 320kbps Streams) ---
from Crypto.Cipher import DES
import base64

def decrypt_saavn_url(encrypted_url):
    try:
        cipher = DES.new(b"38346591", DES.MODE_ECB)
        decrypted = cipher.decrypt(base64.b64decode(encrypted_url))
        pad = decrypted[-1]
        if pad <= 8:
            decrypted = decrypted[:-pad]
        url = decrypted.decode("utf-8", errors="ignore").strip()
        # Upgrade to 320kbps studio quality
        return url.replace("_96.", "_320.").replace("_160.", "_320.").replace("_48.", "_320.")
    except Exception as e:
        print("Decryption error:", e)
        return ""

@app.route("/api/online-search", methods=["GET"])
def online_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"success": True, "results": []})

    results = []
    try:
        encoded_query = urllib.parse.quote(q)
        api_url = f"https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&n=15&q={encoded_query}"
        req = urllib.request.Request(api_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=6) as response:
            data = json.loads(response.read().decode('utf-8'))
            items = data.get("results", [])
            for item in items:
                enc_url = item.get("encrypted_media_url")
                if not enc_url:
                    continue
                    
                full_audio_url = decrypt_saavn_url(enc_url)
                if not full_audio_url:
                    continue

                img_url = item.get("image", "").replace("150x150", "500x500")
                if not img_url:
                    img_url = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500"

                lang_raw = item.get("language", "tamil").upper()
                music_lang = "TAMIL" if "TAMIL" in lang_raw else ("ENGLISH" if "ENG" in lang_raw else "TAMIL")

                title = html.unescape(item.get("song", "Unknown Title"))
                artist = html.unescape(item.get("singers") or item.get("primary_artists") or "Artist")
                album = html.unescape(item.get("album", "Single"))

                results.append({
                    "id": "online_" + str(item.get("id")),
                    "title": title,
                    "artist": artist,
                    "album": album,
                    "audio_url": full_audio_url,
                    "image_url": img_url,
                    "language": music_lang,
                    "duration_seconds": int(item.get("duration", 200) or 200),
                    "is_online": True
                })
    except Exception as e:
        print("Online search error:", e)

    return jsonify({"success": True, "results": results})

# --- UPLOAD & SCAN LOCAL MP3s ---
@app.route("/api/upload", methods=["POST"])
def upload_song():
    if 'audio' not in request.files:
        return jsonify({"success": False, "error": "No file uploaded"}), 400
        
    file = request.files['audio']
    if file.filename == '':
        return jsonify({"success": False, "error": "No file selected"}), 400
        
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        save_path = os.path.join(AUDIO_FOLDER, filename)
        file.save(save_path)
        
        # Determine title & artist from filename
        base_name = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
        title = request.form.get("title") or base_name.title()
        artist = request.form.get("artist") or "Local Artist"
        album = request.form.get("album") or "My Uploads"
        language = request.form.get("language", "TAMIL").upper()
        
        song_id = "loc_" + str(abs(hash(filename)) % 100000)
        audio_url = f"/static/audio/{filename}"
        image_url = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80"
        
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT OR REPLACE INTO songs (id, title, artist, album, language, category, duration_seconds, audio_url, image_url, is_favorite, play_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        """, (song_id, title, artist, album, language, "My Uploads", 210, audio_url, image_url))
        conn.commit()
        conn.close()
        
        return jsonify({
            "success": True,
            "message": f"Uploaded and added: {title}",
            "song": {
                "id": song_id,
                "title": title,
                "artist": artist,
                "audio_url": audio_url,
                "image_url": image_url,
                "language": language
            }
        })
    else:
        return jsonify({"success": False, "error": "Invalid audio file format"}), 400

@app.route("/api/favorites/<song_id>/toggle", methods=["POST"])
def toggle_favorite(song_id):
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT is_favorite FROM songs WHERE id = ?", (song_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "error": "Song not found"}), 404
        
    new_fav = 0 if row["is_favorite"] == 1 else 1
    cursor.execute("UPDATE songs SET is_favorite = ? WHERE id = ?", (new_fav, song_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "song_id": song_id, "is_favorite": new_fav})

@app.route("/api/favorites", methods=["GET"])
def get_favorites():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM songs WHERE is_favorite = 1")
    songs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "favorites": songs})

@app.route("/api/artists", methods=["GET"])
def get_artists():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM artists")
    artists = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "artists": artists})

@app.route("/api/albums", methods=["GET"])
def get_albums():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM albums")
    albums = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "albums": albums})

@app.route("/api/playlists", methods=["GET"])
def get_playlists():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM playlists")
    playlists = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "playlists": playlists})

@app.route("/api/history", methods=["POST"])
def record_history():
    data = request.json or {}
    song_id = data.get("song_id")
    if song_id:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO listening_history (song_id) VALUES (?)", (song_id,))
        cursor.execute("UPDATE songs SET play_count = play_count + 1 WHERE id = ?", (song_id,))
        conn.commit()
        conn.close()
    return jsonify({"success": True})

if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  [ISAIIFY] - Your Music. Your World.")
    print("  Spotify-Inspired Music Streaming App")
    print("=" * 55)
    port = int(os.environ.get("PORT", 5000))
    print(f"  Running on: http://127.0.0.1:{port}")
    print("  Open the above URL in your browser to start listening!")
    print("=" * 55 + "\n")
    app.run(host="0.0.0.0", port=port, debug=False)
