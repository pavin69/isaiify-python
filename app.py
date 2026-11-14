import os
import urllib.request
import urllib.parse
import json
import html
from flask import Flask, render_template, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename
from Crypto.Cipher import DES
import base64

import database
import recommendations

app = Flask(__name__, static_folder="static", template_folder="templates")

AUDIO_FOLDER = os.path.join(os.path.dirname(__file__), "static", "audio")
os.makedirs(AUDIO_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'm4a', 'ogg'}

# Initialize database on startup
database.init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_current_user_id():
    """Extract user identifier from X-User-Id header, query param, or JSON body."""
    uid = request.headers.get("X-User-Id") or request.args.get("user_id")
    if not uid and request.is_json:
        uid = (request.json or {}).get("user_id")
    return uid.strip() if uid else "default_user"

@app.route("/")
def index():
    return render_template("index.html")

# --- API ENDPOINTS ---

@app.route("/api/songs", methods=["GET"])
def get_songs():
    language = request.args.get("language", "ALL").upper()
    category = request.args.get("category")
    album_id = request.args.get("album_id")
    user_id = get_current_user_id()
    
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

    if album_id:
        query += " AND album_id = ?"
        params.append(album_id)
        
    cursor.execute(query, params)
    songs = [dict(row) for row in cursor.fetchall()]

    # Decorate with user-specific like status and ensure artwork_url exists
    cursor.execute("SELECT song_id FROM user_likes WHERE user_id = ?", (user_id,))
    user_liked = {r["song_id"] for r in cursor.fetchall()}
    conn.close()

    for s in songs:
        if user_liked:
            s["is_favorite"] = 1 if s["id"] in user_liked else 0
        s["artwork_url"] = s.get("image_url", "")

    return jsonify({"success": True, "songs": songs})

@app.route("/api/quick-access", methods=["GET"])
def get_quick_access():
    user_id = get_current_user_id()
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM songs ORDER BY play_count DESC LIMIT 6")
    songs = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT song_id FROM user_likes WHERE user_id = ?", (user_id,))
    user_liked = {r["song_id"] for r in cursor.fetchall()}
    conn.close()

    for s in songs:
        if user_liked:
            s["is_favorite"] = 1 if s["id"] in user_liked else 0
        s["artwork_url"] = s.get("image_url", "")

    return jsonify({"success": True, "songs": songs})

@app.route("/api/search", methods=["GET"])
def search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"success": True, "songs": [], "artists": [], "albums": []})
        
    term = f"%{q}%"
    user_id = get_current_user_id()
    conn = database.get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM songs WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR category LIKE ? OR tags LIKE ?",
                   (term, term, term, term, term))
    songs = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM artists WHERE name LIKE ?", (term,))
    artists = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM albums WHERE title LIKE ? OR artist LIKE ? OR genre LIKE ?", (term, term, term))
    albums = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT song_id FROM user_likes WHERE user_id = ?", (user_id,))
    user_liked = {r["song_id"] for r in cursor.fetchall()}
    conn.close()

    for s in songs:
        if user_liked:
            s["is_favorite"] = 1 if s["id"] in user_liked else 0
        s["artwork_url"] = s.get("image_url", "")
    
    return jsonify({
        "success": True,
        "query": q,
        "songs": songs,
        "artists": artists,
        "albums": albums
    })

# --- ONLINE MUSIC API SEARCH ---
def decrypt_saavn_url(encrypted_url):
    try:
        cipher = DES.new(b"38346591", DES.MODE_ECB)
        decrypted = cipher.decrypt(base64.b64decode(encrypted_url))
        pad = decrypted[-1]
        if pad <= 8:
            decrypted = decrypted[:-pad]
        url = decrypted.decode("utf-8", errors="ignore").strip()
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
                    "album_id": "",
                    "audio_url": full_audio_url,
                    "image_url": img_url,
                    "artwork_url": img_url,
                    "language": music_lang,
                    "duration_seconds": int(item.get("duration", 200) or 200),
                    "tags": "online, streaming",
                    "allow_download": 0,  # Third party stream: offline download restricted
                    "is_online": True,
                    "is_favorite": 0
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
        
        base_name = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
        title = request.form.get("title") or base_name.title()
        artist = request.form.get("artist") or "Local Artist"
        album = request.form.get("album") or "My Uploads"
        language = request.form.get("language", "TAMIL").upper()
        
        song_id = "loc_" + str(abs(hash(filename)) % 100000)
        audio_url = f"/static/audio/{filename}"
        image_url = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop&q=80"
        
        song_obj = {
            "id": song_id,
            "title": title,
            "artist": artist,
            "album": album,
            "album_id": "alb_uploads",
            "language": language,
            "category": "My Uploads",
            "duration_seconds": 210,
            "audio_url": audio_url,
            "image_url": image_url,
            "tags": "user-upload, custom",
            "allow_download": 1,
            "is_favorite": 0,
            "play_count": 0
        }
        database.add_song(song_obj)
        
        return jsonify({
            "success": True,
            "message": f"Uploaded and added: {title}",
            "song": song_obj
        })
    else:
        return jsonify({"success": False, "error": "Invalid audio file format"}), 400

# --- LIKES & FAVORITES ---
@app.route("/api/favorites/<song_id>/toggle", methods=["POST"])
def toggle_favorite(song_id):
    user_id = get_current_user_id()
    is_liked = database.toggle_user_like(user_id, song_id)
    # Record event
    database.record_event(user_id, song_id, "like" if is_liked else "unlike")
    return jsonify({"success": True, "song_id": song_id, "is_favorite": 1 if is_liked else 0})

@app.route("/api/favorites", methods=["GET"])
def get_favorites():
    user_id = get_current_user_id()
    songs = database.get_user_likes(user_id)
    if not songs:
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM songs WHERE is_favorite = 1")
        songs = [dict(row) for row in cursor.fetchall()]
        conn.close()

    for s in songs:
        s["is_favorite"] = 1
        s["artwork_url"] = s.get("image_url", "")
    return jsonify({"success": True, "favorites": songs})

# --- ALBUMS & CATALOG EXTENSION ---
@app.route("/api/albums", methods=["GET"])
def get_albums():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM albums ORDER BY release_year DESC")
    albums = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "albums": albums})

@app.route("/api/albums/<album_id>", methods=["GET"])
def get_album_detail(album_id):
    user_id = get_current_user_id()
    album = database.get_album_with_songs(album_id)
    if not album:
        return jsonify({"success": False, "error": "Album not found"}), 404
        
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT song_id FROM user_likes WHERE user_id = ?", (user_id,))
    user_liked = {r["song_id"] for r in cursor.fetchall()}
    conn.close()

    for s in album.get("songs", []):
        if user_liked:
            s["is_favorite"] = 1 if s["id"] in user_liked else 0
        s["artwork_url"] = s.get("image_url", "")

    return jsonify({"success": True, "album": album})

@app.route("/api/admin/songs", methods=["POST"])
def admin_add_song():
    data = request.json or {}
    if not data.get("id") or not data.get("title") or not data.get("artist") or not data.get("audio_url"):
        return jsonify({"success": False, "error": "Fields id, title, artist, audio_url are required"}), 400
    database.add_song(data)
    return jsonify({"success": True, "message": f"Song '{data.get('title')}' added to catalog.", "song": data})

@app.route("/api/admin/albums", methods=["POST"])
def admin_add_album():
    data = request.json or {}
    if not data.get("id") or not data.get("title") or not data.get("artist") or not data.get("cover_art_url"):
        return jsonify({"success": False, "error": "Fields id, title, artist, cover_art_url are required"}), 400
    database.add_album(data)
    return jsonify({"success": True, "message": f"Album '{data.get('title')}' added to catalog.", "album": data})

@app.route("/api/artists", methods=["GET"])
def get_artists():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM artists")
    artists = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "artists": artists})

@app.route("/api/playlists", methods=["GET"])
def get_playlists():
    conn = database.get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM playlists")
    playlists = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return jsonify({"success": True, "playlists": playlists})

# --- LISTENING EVENTS & RECOMMENDATIONS ---
@app.route("/api/events", methods=["POST"])
def record_event_endpoint():
    data = request.json or {}
    user_id = data.get("user_id") or get_current_user_id()
    song_id = data.get("song_id")
    event_type = data.get("event_type", "play_start")
    listened_seconds = float(data.get("listened_seconds", 0))
    song_duration = float(data.get("song_duration", 0))

    if not song_id:
        return jsonify({"success": False, "error": "Missing song_id"}), 400

    # Avoid counting repeated short listens or quick skips as completed plays
    if event_type == "completed_play":
        # Must have actively listened for at least 10 seconds AND (>= 60% of track OR >= 30 seconds)
        if listened_seconds < 10:
            return jsonify({"success": True, "recorded": False, "reason": "Listen duration under threshold"})
        if song_duration > 0 and (listened_seconds / song_duration < 0.6) and listened_seconds < 30:
            return jsonify({"success": True, "recorded": False, "reason": "Completed play threshold not reached"})

    database.record_event(user_id, song_id, event_type, listened_seconds, song_duration)
    return jsonify({"success": True, "recorded": True, "event_type": event_type})

@app.route("/api/history", methods=["POST"])
def record_history():
    data = request.json or {}
    song_id = data.get("song_id")
    user_id = data.get("user_id") or get_current_user_id()
    if song_id:
        database.record_event(user_id, song_id, "play_start", 0, 0)
    return jsonify({"success": True})

@app.route("/api/recommendations", methods=["GET"])
def get_recommendations_endpoint():
    user_id = get_current_user_id()
    limit = int(request.args.get("limit", 8))
    recs = recommendations.get_recommendations_for_user(user_id, limit=limit)
    for s in recs:
        s["artwork_url"] = s.get("image_url", "")
    return jsonify({"success": True, "recommendations": recs})

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
