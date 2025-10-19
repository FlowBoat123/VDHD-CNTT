#!/usr/bin/env python3
"""
movie_recommender.py (simplified TMDB merge via imdbID)

- Builds TF-IDF content-based recommender from movies_metadata.csv
- Merges with links.csv via imdbID to get tmdbId
- Fetches poster/rating via TMDB /movie/{id}
- Exposes Flask POST /recommend_by_name and supports --test mode
"""

import os
import sys
import json
import argparse
import ast
import re
import time
from difflib import get_close_matches

import pandas as pd
import numpy as np
from joblib import dump, load
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from flask import Flask, request, jsonify
import requests

# -------- Config ----------
MOVIES_CSV = os.environ.get("MOVIES_CSV", "archive/movies_metadata.csv")
LINKS_CSV = os.environ.get("LINKS_CSV", "archive/links.csv")
MODEL_CACHE = os.environ.get("MODEL_CACHE", "model_movies.joblib")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", None)
TMDB_API = os.environ.get("TMDB_API", "https://api.themoviedb.org/3")
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
# --------------------------

app = Flask(__name__)

# Globals
_df = None
_vectorizer = None
_tfidf = None
_title_index = None
_TMDB_CACHE = {}

# ---------------- utilities ----------------
def parse_genres_field(s):
    if not isinstance(s, str) or not s.strip():
        return []
    try:
        parsed = ast.literal_eval(s)
        if isinstance(parsed, list):
            return [g.get("name") for g in parsed if isinstance(g, dict) and "name" in g]
    except Exception:
        names = re.findall(r"'name'\s*:\s*'([^']+)'", s)
        return names
    return []

def normalize_text(t):
    if t is None:
        return ""
    t = str(t).lower().strip()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    t = re.sub(r"\s+", " ", t)
    return t

def _normalize_imdb_tt(value):
    """Normalize imdbId like '114709' or 'tt0114709' -> 'tt0114709'."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    if s.startswith("tt"):
        s = s[2:]
    digits = "".join(ch for ch in s if ch.isdigit())
    if not digits:
        return None
    try:
        n = int(digits)
        return f"tt{n:07d}"
    except Exception:
        return None

# ---------------- model build ----------------
def build_model(csv_path=MOVIES_CSV, links_path=LINKS_CSV, cache_path=MODEL_CACHE, force=False):
    """Read CSVs, merge with links.csv via imdbID, build TF-IDF and cache."""
    global _df, _vectorizer, _tfidf, _title_index

    if not force and os.path.exists(cache_path):
        try:
            print("Loading model from cache:", cache_path)
            d = load(cache_path)
            _df, _vectorizer, _tfidf, _title_index = d["df"], d["vectorizer"], d["tfidf"], d["title_index"]
            return _df, _vectorizer, _tfidf
        except Exception as e:
            print("Failed to load cache, rebuilding. Error:", e)

    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    print("Reading movies CSV...")
    df = pd.read_csv(csv_path, low_memory=False)

    # ensure key columns
    for col in ["title", "overview", "genres", "imdb_id"]:
        if col not in df.columns:
            df[col] = ""

    df["genres_parsed"] = df["genres"].apply(parse_genres_field)
    df["overview"] = df["overview"].fillna("").astype(str)
    df["title"] = df["title"].fillna("").astype(str)

    # --- Load links.csv and merge via imdbId ---
    if os.path.exists(links_path):
        print("Loading links CSV and merging via imdbId...")
        links = pd.read_csv(links_path)

        if "imdbId" not in links.columns or "tmdbId" not in links.columns:
            raise ValueError("links.csv must contain columns: imdbId, tmdbId")

        # Normalize both imdbId and imdb_id to same format
        links["imdb_id_norm"] = links["imdbId"].apply(_normalize_imdb_tt)
        df["imdb_id_norm"] = df["imdb_id"].apply(_normalize_imdb_tt)

        df = df.merge(
            links[["imdb_id_norm", "tmdbId"]],
            how="left",
            on="imdb_id_norm"
        )

        df["tmdb_id"] = pd.to_numeric(df["tmdbId"], errors="coerce")
        df.drop(columns=["tmdbId"], inplace=True)

        resolved = int(df["tmdb_id"].notna().sum())
        print(f"✅ Mapped {resolved}/{len(df)} movies to TMDB IDs via imdbId")
    else:
        print("⚠️ Warning: links.csv not found, cannot map tmdbId.")
        df["tmdb_id"] = np.nan

    # combined field for TF-IDF
    df["doc"] = df["title"].astype(str) + " " + df["overview"].astype(str) + " " + df["genres_parsed"].apply(lambda g: " ".join(g))

    print("Vectorizing with TF-IDF...")
    vectorizer = TfidfVectorizer(max_features=25000, stop_words="english")
    docs = df["doc"].fillna("").tolist()
    tfidf = vectorizer.fit_transform(docs)

    df["title_norm"] = df["title"].apply(normalize_text)
    title_index = {t: idx for idx, t in enumerate(df["title_norm"].tolist())}

    _df, _vectorizer, _tfidf, _title_index = df, vectorizer, tfidf, title_index
    dump({"df": df, "vectorizer": vectorizer, "tfidf": tfidf, "title_index": title_index}, cache_path)
    print("Model built and cached ->", cache_path)
    return df, vectorizer, tfidf

# ---------------- TMDB fetch helpers ----------------
def fetch_tmdb_by_id(tmdb_id):
    print( tmdb_id)
    if not TMDB_API_KEY or not tmdb_id:
        return None
    key = f"id:{tmdb_id}"
    if key in _TMDB_CACHE:
        return _TMDB_CACHE[key]
    try:
        resp = requests.get(f"{TMDB_API}/movie/{tmdb_id}", params={"api_key": TMDB_API_KEY}, timeout=6)
        resp.raise_for_status()
        data = resp.json()
        _TMDB_CACHE[key] = data
        return data
    except Exception:
        return None

def fetch_tmdb_by_search(title):
    if not TMDB_API_KEY or not title:
        return None
    key = f"search:{title.lower()}"
    if key in _TMDB_CACHE:
        return _TMDB_CACHE[key]
    try:
        resp = requests.get(f"{TMDB_API}/search/movie", params={"api_key": TMDB_API_KEY, "query": title}, timeout=6)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("results", [None])[0]
        _TMDB_CACHE[key] = result
        return result
    except Exception:
        return None

# ---------------- recommendation logic ----------------
def find_movie_index_by_name(name, fuzzy_cutoff=0.7):
    global _df, _title_index
    if _df is None:
        build_model()
    norm = normalize_text(name)
    if norm in _title_index:
        return _title_index[norm], _df.loc[_title_index[norm], "title"]
    titles = list(_title_index.keys())
    matches = get_close_matches(norm, titles, n=3, cutoff=fuzzy_cutoff)
    if matches:
        best = matches[0]
        return _title_index[best], _df.loc[_title_index[best], "title"]
    for t, idx in _title_index.items():
        if norm in t:
            return idx, _df.loc[idx, "title"]
    return None, None

def recommend_similar_by_index(idx, top_n=5):
    global _df, _tfidf
    if _df is None or _tfidf is None:
        build_model()
    cosine_similarities = linear_kernel(_tfidf[idx:idx+1], _tfidf).flatten()
    cosine_similarities[idx] = -1
    top_idx = np.argsort(-cosine_similarities)[:top_n]
    results = []
    base_movie = _df.iloc[idx].to_dict()
    for i in top_idx:
        score = float(cosine_similarities[i])
        rec = _df.iloc[i].to_dict()

        tmdb = None
        if pd.notna(rec.get("tmdb_id")):
            try:
                tid = int(rec.get("tmdb_id"))
                tmdb = fetch_tmdb_by_id(tid)
            except Exception:
                tmdb = None
        print(f"TMDB data for {rec.get('title', '')}: {tmdb}")

        if tmdb is None:
            tmdb = fetch_tmdb_by_search(rec.get("title", "")) if TMDB_API_KEY else None

        poster = (TMDB_IMAGE_BASE + tmdb["poster_path"]) if tmdb and tmdb.get("poster_path") else None
        rating = tmdb.get("vote_average") if tmdb and tmdb.get("vote_average") is not None else None

        shared_genres = set(base_movie.get("genres_parsed", [])).intersection(set(rec.get("genres_parsed", [])))
        explanation = []
        if shared_genres:
            explanation.append("Shares genres: " + ", ".join(sorted(shared_genres)))
        explanation.append(f"Content similarity: {score:.3f}")

        results.append({
            "id": int(rec.get("id")) if pd.notna(rec.get("id")) else None,
            "title": rec.get("title"),
            "poster": poster,
            "rating": rating,
            "score": score,
            "explanation": "; ".join(explanation),
            "tmdb_id": int(rec.get("tmdb_id")) if pd.notna(rec.get("tmdb_id")) else None
        })
    return results

# --------- Flask endpoints ----------
@app.route("/recommend_by_name", methods=["POST"])
def recommend_by_name_endpoint():
    payload = request.get_json(force=True)
    if not payload:
        return jsonify({"ok": False, "error": "JSON body required"}), 400
    movie_name = payload.get("movie_name") or payload.get("title") or payload.get("query")
    if not movie_name:
        return jsonify({"ok": False, "error": "movie_name (or title/query) is required"}), 400
    n = int(payload.get("n", 5))
    idx, matched_title = find_movie_index_by_name(movie_name)
    if idx is None:
        return jsonify({"ok": False, "error": f"Movie not found for '{movie_name}'"}), 404
    recs = recommend_similar_by_index(idx, top_n=n)
    return jsonify({"ok": True, "matched_title": matched_title, "results": recs})

@app.route("/health")
def health():
    return jsonify({"ok": True, "msg": "alive"})

@app.route("/test_tmdb")
def test_tmdb():
    url = f"{TMDB_API}/movie/popular?api_key={TMDB_API_KEY}&language=en-US&page=1"
    res = requests.get(url)
    if res.status_code == 200:
        data = res.json().get("results", [])
        return jsonify({"ok": True, "message": "TMDB API working!", "sample": data[0] if data else {}})
    return jsonify({"ok": False, "error": res.text}), res.status_code

if __name__ == "__main__":
    # Nếu bạn muốn build model trước khi khởi động server, bật dòng dưới
    # build_model(force=True)

    print("🚀 Starting Flask server...")
    print("Model sẽ được build tự động khi có request đầu tiên (nếu chưa có cache).")

    # Chạy Flask
    app.run(host="0.0.0.0", port=5000, debug=True)
