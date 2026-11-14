"""
=============================================================================
ISAIIFY RECOMMENDATION ENGINE (recommendations.py)
=============================================================================
This module computes personalized song recommendations for Isaiify listeners.

Algorithm Details:
------------------
1. Signal Collection:
   - Positive explicit signal: Songs liked by the user (weight = 3.0).
   - Positive implicit signal: Completed plays (weight = 1.5). Short listens
     and skips are deliberately excluded from recommendation signals.
2. User Preference Profile:
   - Aggregates frequency distributions of the user's preferred:
     * Artists (e.g., Anirudh Ravichander, The Weeknd)
     * Categories / Genres (e.g., Mass Hits, Synthwave Pop)
     * Semantic Tags (e.g., dance, synth, soulful, energetic)
3. Candidate Filtering:
   - Excludes songs the user has ALREADY liked (to promote discovery).
4. Affinity Scoring:
   - Candidate Score =
       (artist_match_weight * 3.0) +
       (category_match_weight * 2.0) +
       (tag_overlap_count * 1.2) +
       (log10(play_count + 1) * 0.15)
5. Explainability:
   - Each recommended song includes a clear, human-understandable `reason`
     (e.g., "Because you like Anirudh Ravichander", "Based on your love for Synthwave Pop").
6. Cold-Start / Fallback:
   - New listeners with zero likes receive a curated, diverse set of top-played
     tracks spanning Tamil and English popular genres.

Future Improvements / Extensibility:
------------------------------------
- Collaborative filtering (matrix factorization / ALS) when user base scales.
- Vector embeddings (e.g. Gemini embedding models) on lyrics/audio timbre.
- Dynamic time-of-day contextual boosts (morning acoustic, evening party).
=============================================================================
"""

import math
import database

def get_recommendations_for_user(user_id=None, limit=8):
    """
    Generate personalized recommendations for a given user.
    
    Args:
        user_id (str): Unique user identifier.
        limit (int): Number of recommendations to return.
        
    Returns:
        list[dict]: Ranked list of song dicts with an added 'recommendation_reason'.
    """
    conn = database.get_connection()
    cursor = conn.cursor()

    # If no user_id or empty, return diverse cold-start fallback
    if not user_id:
        return get_cold_start_fallback(cursor, limit)

    # 1. Fetch user's liked song IDs
    cursor.execute("SELECT song_id FROM user_likes WHERE user_id = ?", (user_id,))
    liked_song_ids = {row["song_id"] for row in cursor.fetchall()}

    # 2. Fetch completed play song IDs
    cursor.execute("""
        SELECT song_id, COUNT(*) as count 
        FROM listening_events 
        WHERE user_id = ? AND event_type = 'completed_play'
        GROUP BY song_id
    """, (user_id,))
    completed_plays = {row["song_id"]: row["count"] for row in cursor.fetchall()}

    # Cold start check: if user has no likes and no completed plays, fallback
    if not liked_song_ids and not completed_plays:
        return get_cold_start_fallback(cursor, limit)

    # 3. Fetch all catalog songs to build profile & candidate set
    cursor.execute("SELECT * FROM songs")
    all_songs = [dict(r) for r in cursor.fetchall()]

    # Map songs by ID
    song_map = {s["id"]: s for s in all_songs}

    # 4. Build User Preference Profile
    artist_weights = {}
    category_weights = {}
    tag_weights = {}

    def extract_artists(artist_string):
        return [a.strip() for a in artist_string.replace("&", ",").split(",") if a.strip()]

    def extract_tags(tag_string):
        return [t.strip().lower() for t in tag_string.split(",") if t.strip()]

    # Process likes (weight = 3.0)
    for sid in liked_song_ids:
        if sid in song_map:
            song = song_map[sid]
            for artist in extract_artists(song["artist"]):
                artist_weights[artist] = artist_weights.get(artist, 0) + 3.0
            category = song.get("category", "")
            if category:
                category_weights[category] = category_weights.get(category, 0) + 3.0
            for tag in extract_tags(song.get("tags", "")):
                tag_weights[tag] = tag_weights.get(tag, 0) + 3.0

    # Process completed plays (weight = 1.5 per play, capped at 3 plays)
    for sid, count in completed_plays.items():
        if sid in song_map:
            song = song_map[sid]
            effective_weight = min(count, 3) * 1.5
            for artist in extract_artists(song["artist"]):
                artist_weights[artist] = artist_weights.get(artist, 0) + effective_weight
            category = song.get("category", "")
            if category:
                category_weights[category] = category_weights.get(category, 0) + effective_weight
            for tag in extract_tags(song.get("tags", "")):
                tag_weights[tag] = tag_weights.get(tag, 0) + effective_weight

    # 5. Score unliked candidates
    candidates = []
    for s in all_songs:
        # Exclude songs already liked by user to encourage discovery
        if s["id"] in liked_song_ids:
            continue

        score = 0.0
        reasons = []

        # Artist score
        song_artists = extract_artists(s["artist"])
        matched_artists = [a for a in song_artists if a in artist_weights]
        if matched_artists:
            best_artist = max(matched_artists, key=lambda a: artist_weights[a])
            score += artist_weights[best_artist] * 3.0
            reasons.append(f"Because you listen to {best_artist}")

        # Category / Genre score
        cat = s.get("category", "")
        if cat in category_weights:
            score += category_weights[cat] * 2.0
            if not reasons:
                reasons.append(f"Similar genre: {cat}")

        # Tag overlap score
        song_tags = extract_tags(s.get("tags", ""))
        matched_tags = [t for t in song_tags if t in tag_weights]
        if matched_tags:
            score += len(matched_tags) * 1.2
            if not reasons:
                reasons.append(f"Vibes: {', '.join(matched_tags[:2])}")

        # Popularity bias
        play_count = s.get("play_count", 0)
        score += math.log10(play_count + 1) * 0.2

        if not reasons:
            reasons.append("Trending on Isaiify")

        s_copy = dict(s)
        s_copy["recommendation_score"] = round(score, 2)
        s_copy["recommendation_reason"] = reasons[0]
        candidates.append(s_copy)

    # Sort candidates by score descending
    candidates.sort(key=lambda x: x["recommendation_score"], reverse=True)
    conn.close()

    # If candidates list is empty (e.g. user liked everything), fallback
    if not candidates:
        return get_cold_start_fallback(cursor, limit)

    return candidates[:limit]

def get_cold_start_fallback(cursor=None, limit=8):
    """
    Curated fallback for new listeners or guests without listening history.
    Picks top streamed songs with language and category diversity.
    """
    should_close = False
    if cursor is None:
        conn = database.get_connection()
        cursor = conn.cursor()
        should_close = True

    cursor.execute("""
    SELECT * FROM songs 
    ORDER BY play_count DESC 
    LIMIT ?
    """, (limit * 2,))
    rows = [dict(r) for r in cursor.fetchall()]

    if should_close:
        conn.close()

    # Interleave Tamil and English for broad discovery
    tamil = [r for r in rows if r.get("language") == "TAMIL"]
    english = [r for r in rows if r.get("language") == "ENGLISH"]

    mixed = []
    i = 0
    while len(mixed) < limit and (i < len(tamil) or i < len(english)):
        if i < len(tamil):
            t = dict(tamil[i])
            t["recommendation_reason"] = f"Popular in Tamil • {t.get('category', 'Hits')}"
            mixed.append(t)
        if i < len(english) and len(mixed) < limit:
            e = dict(english[i])
            e["recommendation_reason"] = f"Global Hit • {e.get('category', 'Pop')}"
            mixed.append(e)
        i += 1

    return mixed[:limit]
