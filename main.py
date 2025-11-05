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
import random

import pandas as pd
import numpy as np
from joblib import dump, load
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
from sklearn.neighbors import NearestNeighbors
from flask import Flask, request, jsonify
import requests
import firebase_admin
from firebase_admin import credentials, firestore
# import implicit
from scipy.sparse import coo_matrix, csr_matrix

# Cấu hình Firebase (thêm file service account key)
firebase_db = None
try:
    cred = credentials.Certificate("backend/serviceAccountKey.json")  # Thêm file này
    firebase_admin.initialize_app(cred)
    firebase_db = firestore.client()
    FIREBASE_ENABLED = True
    print("✅ Firebase connected successfully")
except Exception as e:
    print(f"⚠️ Firebase not available: {e}")
    FIREBASE_ENABLED = False

# -------- Config ----------
MOVIES_CSV = os.environ.get("MOVIES_CSV", "archive/movies_metadata.csv")
LINKS_CSV = os.environ.get("LINKS_CSV", "archive/links.csv")
KEYWORDS_CSV = os.environ.get("KEYWORDS_CSV", "archive/keywords.csv")
RATINGS_CSV = os.environ.get("RATINGS_CSV", "archive/ratings.csv")
# ---------------- IGNORE ----------------
FIREBASE_API= os.environ.get("FIREBASE_API", "backend/serviceAccountKey.json")
MODEL_CACHE = os.environ.get("MODEL_CACHE", "model_movies.joblib")
MERGED_RATINGS_CACHE = os.environ.get("MERGED_RATINGS_CACHE", "merged_ratings.joblib")
ALS_MODEL_CACHE = os.environ.get("ALS_MODEL_CACHE", "als_model.joblib")
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
_knn = None
_TMDB_CACHE = {}
movies_data = None
user_profiles = {} 
user_movie_ratings = None
als_model = None 

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
    global _df, _vectorizer, _tfidf, _title_index, _knn

    if not force and os.path.exists(cache_path):
        try:
            print("Loading model from cache:", cache_path)
            d = load(cache_path)
            _df, _vectorizer, _tfidf, _title_index, _knn = d["df"], d["vectorizer"], d["tfidf"], d["title_index"], d.get("knn")
            return _df, _vectorizer, _tfidf
        except Exception as e:
            print("Failed to load cache, rebuilding. Error:", e)

    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    print("Reading and preparing movies CSV...")
    # Prefer a more robust loader that includes keywords and prepares combined features
    # Load only necessary columns to save memory
    try:
        movies = pd.read_csv(csv_path, low_memory=False, usecols=["id", "title", "genres", "overview", "release_date", "imdb_id"])
    except Exception:
        # Fallback to full read if columns not present
        movies = pd.read_csv(csv_path, low_memory=False)

    # Drop rows without essential fields
    movies = movies.dropna(subset=["id", "title", "genres", "overview", "imdb_id"]) if set(["id","title","genres","overview","imdb_id"]).issubset(movies.columns) else movies

    # Clean id -> numeric
    if "id" in movies.columns:
        movies["id"] = pd.to_numeric(movies["id"], errors="coerce")
        movies = movies.dropna(subset=["id"]) 
        movies["id"] = movies["id"].astype(int)

    # Parse genres into space-separated string
    def extract_genre_names(g):
        try:
            parsed = ast.literal_eval(g) if isinstance(g, str) else []
            return " ".join([genre.get("name") for genre in parsed if isinstance(genre, dict) and genre.get("name")])
        except Exception:
            return ""

    if "genres" in movies.columns:
        movies["genres"] = movies["genres"].apply(extract_genre_names)

    # Load keywords.csv if present and merge
    if os.path.exists(KEYWORDS_CSV):
        try:
            keywords = pd.read_csv(KEYWORDS_CSV)
            keywords = keywords.dropna(subset=["id", "keywords"]) if set(["id","keywords"]).issubset(keywords.columns) else keywords
            keywords["id"] = pd.to_numeric(keywords["id"], errors="coerce")
            keywords = keywords.dropna(subset=["id"]) if "id" in keywords.columns else keywords
            keywords["id"] = keywords["id"].astype(int)

            def extract_keywords(kws):
                try:
                    data = ast.literal_eval(kws) if isinstance(kws, str) else []
                    return " ".join([kw.get("name") for kw in data if isinstance(kw, dict) and kw.get("name")])
                except Exception:
                    return ""

            if "keywords" in keywords.columns:
                keywords["keywords"] = keywords["keywords"].apply(extract_keywords)

            # merge on id if possible
            if "id" in movies.columns and "id" in keywords.columns:
                movies = movies.merge(keywords[["id", "keywords"]], on="id", how="left")
                movies["keywords"] = movies["keywords"].fillna("")
            else:
                movies["keywords"] = ""
        except Exception:
            movies["keywords"] = ""
    else:
        movies["keywords"] = ""

    # ensure overview and title columns exist
    if "overview" in movies.columns:
        movies["overview"] = movies["overview"].fillna("").astype(str)
    else:
        movies["overview"] = ""

    # Combined features for TF-IDF / KNN
    movies["combined_features"] = (movies.get("genres", "").fillna("") + " " + movies.get("keywords", "").fillna("") + " " + movies.get("overview", "").fillna(""))

    # Extract year
    if "release_date" in movies.columns:
        movies["year"] = pd.to_datetime(movies["release_date"], errors="coerce").dt.year
    else:
        movies["year"] = np.nan

    df = movies.reset_index(drop=True)

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
            links[["imdb_id_norm", "tmdbId", "movieId"]],
            how="left",
            on="imdb_id_norm"
        )

        df["tmdb_id"] = pd.to_numeric(df["tmdbId"], errors="coerce")
        df["movieId"] = pd.to_numeric(df["movieId"], errors="coerce")
        df.drop(columns=["tmdbId"], inplace=True)

        resolved = int(df["tmdb_id"].notna().sum())
        print(f"✅ Mapped {resolved}/{len(df)} movies to TMDB IDs via imdbId")
    else:
        print("⚠️ Warning: links.csv not found, cannot map tmdbId.")
        df["tmdb_id"] = np.nan

    # combined field for TF-IDF is the prepared combined_features
    df["doc"] = df.get("combined_features", df.get("title", "") + " " + df.get("overview", "")).astype(str)

    print("Vectorizing with TF-IDF...")
    vectorizer = TfidfVectorizer(max_features=25000, stop_words="english")
    docs = df["doc"].fillna("").tolist()
    tfidf = vectorizer.fit_transform(docs)

    # Build KNN on TF-IDF vectors for quick nearest neighbors lookup
    try:
        print("Building KNN index (NearestNeighbors, metric='cosine')...")
        knn = NearestNeighbors(n_neighbors=11, metric="cosine", n_jobs=-1)
        knn.fit(tfidf)
    except Exception as e:
        print("Failed to build KNN index:", e)
        knn = None

    df["title_norm"] = df["title"].apply(normalize_text)
    title_index = {t: idx for idx, t in enumerate(df["title_norm"].tolist())}

    _df, _vectorizer, _tfidf, _title_index, _knn = df, vectorizer, tfidf, title_index, knn
    dump({"df": df, "vectorizer": vectorizer, "tfidf": tfidf, "title_index": title_index, "knn": knn}, cache_path)
    print("Model built and cached ->", cache_path)
    return df, vectorizer, tfidf

# ---------------- TMDB fetch helpers ----------------
def fetch_tmdb_by_id(tmdb_id):
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
    global _df, _tfidf, _knn
    if _df is None or _tfidf is None:
        build_model()

    results = []
    base_movie = _df.iloc[idx].to_dict()

    # Prefer KNN (NearestNeighbors) if available
    neighbor_indices = []
    similarities = None
    if _knn is not None:
        try:
            # request extra neighbors to get up to 20 neighbors (include self)
            max_return = 21  # include the movie itself so we can exclude it
            k = min(getattr(_knn, 'n_neighbors', max_return) or max_return, max_return)
            neigh = _knn.kneighbors(_tfidf[idx], n_neighbors=k, return_distance=True)
            distances = neigh[0].flatten()
            indices = neigh[1].flatten()
            # convert cosine distance to similarity
            sims = 1.0 - distances
            # remove self (distance 0) if present, then take up to 20 neighbors
            pairs = [(int(i), float(s)) for i, s in zip(indices, sims) if int(i) != int(idx)]
            pairs = sorted(pairs, key=lambda x: -x[1])[:20]
            neighbor_indices = [p[0] for p in pairs]
            similarities = {p[0]: p[1] for p in pairs}
        except Exception as e:
            print("KNN lookup failed, falling back to cosine kernel:", e)
            neighbor_indices = []

    # Fallback: cosine similarity via linear_kernel — compute top 20
    if not neighbor_indices or len(neighbor_indices) < min(20, top_n):
        cosine_similarities = linear_kernel(_tfidf[idx:idx+1], _tfidf).flatten()
        cosine_similarities[idx] = -1
        top_idx = np.argsort(-cosine_similarities)[:20]
        neighbor_indices = [int(i) for i in top_idx]
        similarities = {int(i): float(cosine_similarities[int(i)]) for i in neighbor_indices}

    # Shuffle the top-20 neighbors, then pick the requested top_n from the shuffled list
    if neighbor_indices:
        shuffled = neighbor_indices.copy()
        random.shuffle(shuffled)
        selected = shuffled[:top_n]
    else:
        selected = []

    # ensure similarities map covers selected indices (it should)
    neighbor_indices = selected

    for i in neighbor_indices:
        score = float(similarities.get(int(i), 0.0))
        rec = _df.iloc[int(i)].to_dict()

        tmdb = None
        if pd.notna(rec.get("tmdb_id")):
            try:
                tid = int(rec.get("tmdb_id"))
                tmdb = fetch_tmdb_by_id(tid)
            except Exception:
                tmdb = None

        if tmdb is None:
            tmdb = fetch_tmdb_by_search(rec.get("title", "")) if TMDB_API_KEY else None

        poster = (TMDB_IMAGE_BASE + tmdb["poster_path"]) if tmdb and tmdb.get("poster_path") else None
        rating = tmdb.get("vote_average") if tmdb and tmdb.get("vote_average") is not None else None

        # shared genres: use parsed genres if available, otherwise try to split genres string
        shared_genres = set()
        try:
            base_genres = set(base_movie.get("genres_parsed", []) or [])
            rec_genres = set(rec.get("genres_parsed", []) or [])
            if not base_genres and isinstance(base_movie.get("genres"), str):
                base_genres = set([g.strip() for g in base_movie.get("genres", "").split() if g.strip()])
            if not rec_genres and isinstance(rec.get("genres"), str):
                rec_genres = set([g.strip() for g in rec.get("genres", "").split() if g.strip()])
            shared_genres = base_genres.intersection(rec_genres)
        except Exception:
            shared_genres = set()

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

def load_firebase_ratings():
    """Load ratings từ Firebase và convert về format chuẩn"""
    if not FIREBASE_ENABLED:
        return []
    print("🔄 Loading ratings from Firebase...")
    firebase_ratings = []
    user_profiles.clear()
    
    try:
        users_ref = firebase_db.collection('users')
        users = users_ref.stream()

        for user_doc in users:
            user_id = user_doc.id

            collections_ref = users_ref.document(user_id).collection('collections')
            collections = collections_ref.stream()

            for collection_doc in collections:
                collection_data = collection_doc.to_dict() or {}

                movie_id = collection_data.get('id', collection_doc.id)

                raw_rating = collection_data.get('rating')
                try:
                    rating_value = float(raw_rating)
                except (TypeError, ValueError):
                    rating_value = None

                if rating_value is None or rating_value <= 0:
                    continue

                firebase_ratings.append({
                    'user_id': user_id,
                    'movie_id': movie_id,
                    'rating': rating_value,
                    'timestamp': pd.Timestamp.now().timestamp()
                })

    except Exception as e:
        print(f"❌ Error in load_firebase_ratings: {e}")
    
    return firebase_ratings

def convert_movie_ids_to_tmdb(ratings_df):
    """Convert movieId to tmdb_id using _df from build_model"""
    global _df
    
    if _df is None:
        build_model()
    
    # Tạo mapping từ movieId to tmdb_id
    movieId_to_tmdb = {}
    for _, movie in _df.iterrows():
        movie_id = movie.get('movieId')
        tmdb_id = movie.get('tmdb_id')
        if pd.notna(movie_id) and pd.notna(tmdb_id):
            movieId_to_tmdb[str(int(movie_id))] = str(int(tmdb_id))
    
    # Convert movie_id trong ratings
    def convert_id(movie_id):
        movie_id_str = str(movie_id)
        # Nếu đã là tmdb_id format (numeric) thì giữ nguyên
        if movie_id_str.isdigit():
            return movie_id_str
        # Convert from movieId to tmdb_id
        return movieId_to_tmdb.get(movie_id_str, movie_id_str)
    
    ratings_df['movie_id'] = ratings_df['movie_id'].apply(convert_id)
    
    # Filter ra những movies có trong _df
    valid_tmdb_ids = set(_df['tmdb_id'].dropna().astype(int).astype(str))
    ratings_df = ratings_df[ratings_df['movie_id'].isin(valid_tmdb_ids)]
    
    return ratings_df

def load_and_merge_ratings(force=False):
    """Load và merge ratings từ cả CSV và Firebase, với cache"""
    global user_movie_ratings
    
    if not force and os.path.exists(MERGED_RATINGS_CACHE):
        try:
            print("Loading merged ratings from cache:", MERGED_RATINGS_CACHE)
            user_movie_ratings = load(MERGED_RATINGS_CACHE)
            print(f"✅ Loaded {len(user_movie_ratings)} merged ratings from cache")
            return user_movie_ratings
        except Exception as e:
            print("Failed to load merged ratings cache, rebuilding. Error:", e)
    
    print("🔄 Loading ratings from CSV and Firebase...")
    
    # 1. Load ratings từ CSV
    csv_ratings = pd.read_csv(RATINGS_CSV)
    csv_ratings = csv_ratings.rename(columns={
        'userId': 'user_id',
        'movieId': 'movie_id'
    })
    csv_ratings['source'] = 'csv'
    csv_ratings['user_id'] = csv_ratings['user_id'].astype(str)
    csv_ratings['movie_id'] = csv_ratings['movie_id'].astype(str)
    convert_movie_ids_to_tmdb(csv_ratings)
    print(f"📊 CSV ratings: {len(csv_ratings)} records")
    
    # 2. Load ratings từ Firebase
    firebase_ratings = []
    if FIREBASE_ENABLED:
        try:
            firebase_ratings = load_firebase_ratings()
            print(f"📊 Firebase ratings: {len(firebase_ratings)} records")
        except Exception as e:
            print(f"⚠️ Error loading Firebase ratings: {e}")
            firebase_ratings = []
    
    # 3. Merge ratings
    if firebase_ratings:
        firebase_df = pd.DataFrame(firebase_ratings)
        firebase_df['source'] = 'firebase'
        firebase_df['user_id'] = firebase_df['user_id'].astype(str)
        firebase_df['movie_id'] = firebase_df['movie_id'].astype(str)
        
        # Combine và remove duplicates (ưu tiên Firebase data)
        all_ratings = pd.concat([csv_ratings, firebase_df], ignore_index=True)
        
        # Remove duplicates: nếu user đã rate movie trong Firebase thì remove CSV rating
        all_ratings = all_ratings.drop_duplicates(
            subset=['user_id', 'movie_id'], 
            keep='last'  # Keep Firebase data (loaded last)
        )
    else:
        all_ratings = csv_ratings
    
    
    user_movie_ratings = all_ratings
    print(f"✅ Total merged ratings: {len(user_movie_ratings)} records")
    print(f"📊 Unique users: {user_movie_ratings['user_id'].nunique()}")
    print(f"📊 Unique movies: {user_movie_ratings['movie_id'].nunique()}")
    
    # Lưu cache
    try:
        dump(user_movie_ratings, MERGED_RATINGS_CACHE)
        print("Merged ratings cached ->", MERGED_RATINGS_CACHE)
    except Exception as e:
        print("Failed to cache merged ratings:", e)
    
    return user_movie_ratings

# ---------------- personalize recommendations ----------------
def recommend_personalization_logic(payload):
    """Logic để tạo personalized recommendations dựa trên user ratings từ Firebase."""
    global user_movie_ratings, _df, als_model

    if _df is None:
        build_model()
    
    # Load và merge ratings nếu chưa có
    if user_movie_ratings is None:
        load_and_merge_ratings()

    user_id = str(payload.get("user_id") or payload.get("userId"))
    if not user_id:
        return {"ok": False, "error": "user_id is required"}, 400

    # Load ratings của user từ Firebase: users/{user_id}/ratings
    user_ratings = []
    if FIREBASE_ENABLED:
        try:
            ratings_ref = firebase_db.collection('users').document(user_id).collection('ratings')
            ratings_docs = ratings_ref.stream()
            for doc in ratings_docs:
                data = doc.to_dict()
                movie_id = data.get('movieId') or doc.id
                rating = data.get('rating')
                if rating and movie_id:
                    user_ratings.append({
                        'movie_id': str(movie_id),
                        'rating': float(rating)
                    })
        except Exception as e:
            print(f"Error loading user ratings from Firebase: {e}")
            return {"ok": False, "error": "Failed to load user ratings"}, 500

    if not user_ratings:
        return {"ok": False, "error": "No ratings found for user"}, 400

    # Chuyển thành DataFrame
    user_ratings_df = pd.DataFrame(user_ratings)
    user_ratings_df['user_id'] = user_id

    # Kết hợp với ratings đã có
    combined_ratings = pd.concat([user_movie_ratings, user_ratings_df], ignore_index=True)

    # Tạo sparse matrix cho implicit model
    movie_ids = combined_ratings['movie_id'].astype(str).unique()
    movie_id_to_idx = {mid: idx for idx, mid in enumerate(movie_ids)}
    user_ids = combined_ratings['user_id'].astype(str).unique()
    user_id_to_idx = {uid: idx for idx, uid in enumerate(user_ids)}

    rows = combined_ratings['user_id'].map(user_id_to_idx).values
    cols = combined_ratings['movie_id'].map(movie_id_to_idx).values
    data = combined_ratings['rating'].values

    rating_matrix = coo_matrix((data, (rows, cols)), shape=(len(user_ids), len(movie_ids))).tocsr()

    force_retrain = payload.get("force_retrain", False)
    
    # Huấn luyện model implicit ALS nếu chưa có cache hoặc force
    if als_model is None or force_retrain:
        # Kiểm tra cache file
        if not force_retrain and os.path.exists(ALS_MODEL_CACHE):
            try:
                print("Loading ALS model from cache:", ALS_MODEL_CACHE)
                als_model = load(ALS_MODEL_CACHE)
                print("ALS model loaded from cache.")
            except Exception as e:
                print("Failed to load ALS model cache, retraining. Error:", e)
                als_model = None
        
        if als_model is None:
            print("Training ALS model...")
            als_model = implicit.als.AlternatingLeastSquares(factors=50, regularization=0.01, iterations=20)
            als_model.fit(rating_matrix)
            print("ALS model trained.")
            
            # Lưu cache
            try:
                dump(als_model, ALS_MODEL_CACHE)
                print("ALS model cached ->", ALS_MODEL_CACHE)
            except Exception as e:
                print("Failed to cache ALS model:", e)

    # Dự đoán cho user
    user_idx = user_id_to_idx[user_id]
    user_items = rating_matrix[user_idx]
    recommendations = als_model.recommend(user_idx, user_items, N=20, filter_already_liked_items=True)

    print(f"ALS recommended {len(recommendations[0])} movies for user {user_id}")

    # Chuyển recommendations thành list phim
    results = []
    for movie_idx, score in zip(recommendations[0], recommendations[1]):
        movie_id = movie_ids[movie_idx]
        
        # Tìm movie trong _df - thử cả tmdb_id và movieId
        movie_row = _df[_df['tmdb_id'] == pd.to_numeric(movie_id, errors='coerce')]
        
        # Nếu không tìm thấy bằng tmdb_id, thử tìm bằng movieId
        if movie_row.empty:
            movie_row = _df[_df['movieId'] == pd.to_numeric(movie_id, errors='coerce')]
        
        if not movie_row.empty:
            title = movie_row.iloc[0]['title']
            tmdb_id = movie_row.iloc[0].get('tmdb_id')
            
            # Fetch thông tin từ TMDB
            tmdb_data = None
            if pd.notna(tmdb_id):
                try:
                    tmdb_data = fetch_tmdb_by_id(int(tmdb_id))
                except Exception as e:
                    print(f"Error fetching TMDB data for {tmdb_id}: {e}")
            
            # Nếu không có tmdb_data, thử search by title
            if not tmdb_data:
                tmdb_data = fetch_tmdb_by_search(title)
            
            poster = (TMDB_IMAGE_BASE + tmdb_data["poster_path"]) if tmdb_data and tmdb_data.get("poster_path") else None
            rating = tmdb_data.get("vote_average") if tmdb_data else None
            
            results.append({
                "movie_id": movie_id,
                "title": title,
                "tmdb_id": int(tmdb_id) if pd.notna(tmdb_id) else None,
                "poster": poster,
                "rating": rating,
                "score": float(score),
                "explanation": f"Personalized recommendation based on your ratings (score: {score:.3f})"
            })
        else:
            print(f"Movie {movie_id} not found in _df")

    # Giới hạn 8
    results = results[:8]
    print(f"Returning {len(results)} recommendations")
    
    # ✅ FIX: Thêm return statement
    return {"ok": True, "user_id": user_id, "results": results}, 200

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

@app.route("/recommend_personalization", methods=["POST"])
def recommend_personalization_endpoint():
    """Flask endpoint wrapper for personalization recommendations.

    This function parses the incoming JSON and delegates to
    `recommend_personalization_logic(payload)` which returns (result, status_code).
    """
    payload = request.get_json(force=True) or {}
    result, status = recommend_personalization_logic(payload)
    return jsonify(result), status

@app.route("/test_merge", methods=["POST"])
def test_merge_endpoint():
    """Test endpoint để kiểm tra merge ratings từ CSV và Firebase"""
    try:
        force = request.args.get('force', 'false').lower() == 'true'
        merged_ratings = load_and_merge_ratings(force=force)
        firebase_samples = merged_ratings[merged_ratings['source'] == 'firebase'].head(5).to_dict('records')
        csv_samples = merged_ratings[merged_ratings['source'] == 'csv'].head(5).to_dict('records')
        return jsonify({
            "ok": True,
            "message": f"Merged {len(merged_ratings)} ratings",
            "firebase_samples": firebase_samples,
            "csv_samples": csv_samples,
            "total_firebase": len(firebase_samples),
            "total_csv": len(csv_samples),
            "total_merged": len(merged_ratings)
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Nếu bạn muốn build model trước khi khởi động server, bật dòng dưới
    # build_model(force=True)

    print("🚀 Starting Flask server...")
    print("Model sẽ được build tự động khi có request đầu tiên (nếu chưa có cache).")

    # Chạy Flask
    app.run(host="0.0.0.0", port=5000, debug=True)
