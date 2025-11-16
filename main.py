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
import implicit
from scipy.sparse import coo_matrix, csr_matrix
from sentence_transformers import SentenceTransformer
import faiss

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
MODEL_CACHE = os.environ.get("MODEL_CACHE", "models/model_movies.joblib")
MERGED_RATINGS_CACHE = os.environ.get("MERGED_RATINGS_CACHE", "models/merged_ratings.joblib")
ALS_MODEL_CACHE = os.environ.get("ALS_MODEL_CACHE", "models/als_model.joblib")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", None)
TMDB_API = os.environ.get("TMDB_API", "https://api.themoviedb.org/3")
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
# --------------------------

app = Flask(__name__)

# Ensure models directory exists for caching model files
MODELS_DIR = os.path.dirname(MODEL_CACHE) or "models"
if not os.path.exists(MODELS_DIR):
    try:
        os.makedirs(MODELS_DIR, exist_ok=True)
        print(f"Created models directory: {MODELS_DIR}")
    except Exception as e:
        print(f"Failed to create models directory {MODELS_DIR}: {e}")

# Globals
_df = None
_vectorizer = None
_tfidf = None
_title_index = None
_knn = None
_sentence_model = None
_faiss_index = None
_movie_embeddings = None
_TMDB_CACHE = {}
movies_data = None
user_profiles = {} 
user_movie_ratings = None
als_model = None 
ensemble_models = {}  # ✨ THÊM: Dictionary chứa các models
thompson_bandits = {}  # ✨ THÊM: Thompson Sampling state

# ✨ THÊM: Class Sentence Transformer Recommender
class SentenceTransformerRecommender:
    """
    Deep content-based recommender using Sentence Transformers
    - Better semantic understanding than TF-IDF
    - Fast similarity search with FAISS
    """
    def __init__(self, model_name='paraphrase-MiniLM-L6-v2'):
        print(f"Loading Sentence Transformer: {model_name}")
        self.model = SentenceTransformer(model_name)
        self.index = None
        self.embeddings = None
        self.movie_ids = []
    
    def build_index(self, movies_df, cache_path="models/sentence_embeddings.joblib"):
        """Build FAISS index for fast similarity search"""
        
        # Try load from cache
        if os.path.exists(cache_path):
            try:
                print("Loading sentence embeddings from cache:", cache_path)
                cached = load(cache_path)
                self.embeddings = cached['embeddings']
                self.movie_ids = cached['movie_ids']
                self._build_faiss_index()
                print(f"✅ Loaded {len(self.movie_ids)} movie embeddings from cache")
                return
            except Exception as e:
                print("Failed to load cache, rebuilding. Error:", e)
        
        print("🔄 Encoding movies with Sentence Transformer...")
        
        # Combine features với trọng số
        texts = []
        valid_indices = []
        
        for idx, row in movies_df.iterrows():
            title = str(row.get('title', ''))
            genres = str(row.get('genres', ''))
            keywords = str(row.get('keywords', ''))
            overview = str(row.get('overview', ''))
            
            if not title:
                continue
            
            # Weighted combination
            text = (
                f"{title} " * 2 +
                f"{genres} " * 3 +
                f"{keywords} " * 2 +
                f"{overview}"
            )
            texts.append(text)
            valid_indices.append(idx)
        
        # Encode batch (nhanh hơn)
        print(f"Encoding {len(texts)} movies...")
        self.embeddings = self.model.encode(
            texts,
            batch_size=32,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True  # Normalize for cosine similarity
        )
        
        self.movie_ids = [movies_df.iloc[idx]['id'] for idx in valid_indices]
        
        # Build FAISS index
        self._build_faiss_index()
        
        # Cache embeddings
        try:
            dump({
                'embeddings': self.embeddings,
                'movie_ids': self.movie_ids
            }, cache_path)
            print("Sentence embeddings cached ->", cache_path)
        except Exception as e:
            print("Failed to cache embeddings:", e)
    
    def _build_faiss_index(self):
        """Build FAISS index from embeddings"""
        dimension = self.embeddings.shape[1]
        
        # Use IndexFlatIP for Inner Product (= cosine similarity with normalized vectors)
        self.index = faiss.IndexFlatIP(dimension)
        self.index.add(self.embeddings.astype('float32'))
        
        print(f"✅ FAISS index built: {len(self.movie_ids)} movies, {dimension}D embeddings")
    
    def find_similar(self, movie_idx, top_k=20):
        """Tìm phim tương tự bằng FAISS"""
        if self.index is None:
            raise ValueError("Index not built yet")
        
        # Get embedding của movie
        query_embedding = self.embeddings[movie_idx:movie_idx+1].astype('float32')
        
        # Search
        distances, indices = self.index.search(query_embedding, top_k + 1)
        
        # Remove self và return
        results = []
        for idx, dist in zip(indices[0], distances[0]):
            if idx != movie_idx:
                results.append((int(idx), float(dist)))
        
        return results[:top_k]

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
    """Read CSVs, merge with links.csv via imdbID, build TF-IDF and Sentence Transformers."""
    global _df, _vectorizer, _tfidf, _title_index, _knn, _sentence_model, _faiss_index

    if not force and os.path.exists(cache_path):
        try:
            print("Loading model from cache:", cache_path)
            d = load(cache_path)
            _df, _vectorizer, _tfidf, _title_index, _knn = d["df"], d["vectorizer"], d["tfidf"], d["title_index"], d.get("knn")
            
            # ✨ THÊM: Load Sentence Transformer
            _sentence_model = SentenceTransformerRecommender()
            _sentence_model.build_index(_df)
            
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
    
    # ✨ THÊM: Build Sentence Transformer index
    _sentence_model = SentenceTransformerRecommender()
    _sentence_model.build_index(_df)
    
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

# ✨ CẢI THIỆN: Recommend với Sentence Transformers
def recommend_similar_by_index(idx, top_n=5, use_semantic=True):
    """
    Recommend similar movies
    use_semantic=True: Use Sentence Transformers (better semantic)
    use_semantic=False: Use TF-IDF (fallback)
    """
    global _df, _tfidf, _knn, _sentence_model

    if _df is None or _tfidf is None:
        build_model()

    results = []
    base_movie = _df.iloc[idx].to_dict()

    # ✨ CẢI THIỆN: Use Sentence Transformers nếu available
    neighbor_indices = []
    similarities = {}
    
    if use_semantic and _sentence_model is not None:
        try:
            print("Using Sentence Transformer for semantic search...")
            semantic_results = _sentence_model.find_similar(idx, top_k=20)
            neighbor_indices = [i for i, _ in semantic_results]
            similarities = {i: s for i, s in semantic_results}
            print(f"✅ Found {len(neighbor_indices)} semantic neighbors")
        except Exception as e:
            print(f"Sentence Transformer failed, falling back to TF-IDF: {e}")
            use_semantic = False
    
    # Fallback to TF-IDF/KNN
    if not use_semantic or not neighbor_indices:
        if _knn is not None:
            try:
                max_return = 21
                k = min(getattr(_knn, 'n_neighbors', max_return) or max_return, max_return)
                neigh = _knn.kneighbors(_tfidf[idx], n_neighbors=k, return_distance=True)
                distances = neigh[0].flatten()
                indices = neigh[1].flatten()
                sims = 1.0 - distances
                pairs = [(int(i), float(s)) for i, s in zip(indices, sims) if int(i) != int(idx)]
                pairs = sorted(pairs, key=lambda x: -x[1])[:20]
                neighbor_indices = [p[0] for p in pairs]
                similarities = {p[0]: p[1] for p in pairs}
            except Exception as e:
                print("KNN lookup failed, falling back to cosine kernel:", e)
                neighbor_indices = []

        if not neighbor_indices:
            cosine_similarities = linear_kernel(_tfidf[idx:idx+1], _tfidf).flatten()
            cosine_similarities[idx] = -1
            top_idx = np.argsort(-cosine_similarities)[:20]
            neighbor_indices = [int(i) for i in top_idx]
            similarities = {int(i): float(cosine_similarities[int(i)]) for i in neighbor_indices}

    # Shuffle và pick top_n
    if neighbor_indices:
        shuffled = neighbor_indices.copy()
        random.shuffle(shuffled)
        selected = shuffled[:top_n]
    else:
        selected = []

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
        
        # ✨ THÊM: Explain method used
        method = "Semantic similarity" if use_semantic and _sentence_model else "Content similarity"
        explanation.append(f"{method}: {score:.3f}")

        results.append({
            "id": int(rec.get("id")) if pd.notna(rec.get("id")) else None,
            "title": rec.get("title"),
            "poster": poster,
            "rating": rating,
            "score": score,
            "explanation": "; ".join(explanation),
            "tmdb_id": int(rec.get("tmdb_id")) if pd.notna(rec.get("tmdb_id")) else None,
            "method": method  # ✨ THÊM metadata
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
class ThompsonSamplingRecommender:
    """
    Multi-armed bandit cho exploration/exploitation balance
    Mỗi phim = 1 arm với Beta distribution
    """
    def __init__(self):
        self.alpha = {}  # Successes (clicks, high ratings)
        self.beta_param = {}  # Failures (skips, low ratings)
    
    def update(self, movie_id, reward):
        """
        Update belief về movie dựa trên feedback
        reward: 1 if liked (rating >= 3.5), 0 if disliked
        """
        if movie_id not in self.alpha:
            self.alpha[movie_id] = 1  # Prior
            self.beta_param[movie_id] = 1
        
        if reward > 0.5:
            self.alpha[movie_id] += 1
        else:
            self.beta_param[movie_id] += 1
    
    def sample_movies(self, candidate_movies, n_samples=10, explore_rate=0.2):
        """
        Sample movies từ Beta distribution
        explore_rate: tỷ lệ phim explore (mới, ít người xem)
        """
        n_explore = int(n_samples * explore_rate)
        n_exploit = n_samples - n_explore
        
        # 1. Exploitation: Sample từ Beta distribution
        exploit_scores = {}
        for movie_id in candidate_movies:
            if movie_id not in self.alpha:
                self.alpha[movie_id] = 1
                self.beta_param[movie_id] = 1
            
            # Sample từ Beta(alpha, beta)
            sampled_score = np.random.beta(
                self.alpha[movie_id], 
                self.beta_param[movie_id]
            )
            exploit_scores[movie_id] = sampled_score
        
        # Top-K exploitation
        exploit_recs = sorted(exploit_scores.items(), key=lambda x: -x[1])[:n_exploit]
        
        # 2. Exploration: Random sample phim mới/ít được xem
        low_confidence_movies = [
            m for m in candidate_movies 
            if (self.alpha.get(m, 1) + self.beta_param.get(m, 1)) < 10  # Ít feedback
        ]
        
        if low_confidence_movies and n_explore > 0:
            explore_sample = np.random.choice(
                low_confidence_movies, 
                min(n_explore, len(low_confidence_movies)), 
                replace=False
            )
            explore_recs = [(m, 0.5) for m in explore_sample]
        else:
            explore_recs = []
        
        # 3. Combine
        all_recs = exploit_recs + explore_recs
        random.shuffle(all_recs)
        
        return [movie_id for movie_id, _ in all_recs]

# ✨ CẢI THIỆN: Train Ensemble ALS models
def train_ensemble_als_models(rating_matrix, force=False):
    """
    Train ensemble of 3 models: ALS, BPR, LMF
    Returns dictionary of trained models
    """
    global ensemble_models
    
    ensemble_cache = "models/ensemble_models.joblib"
    
    # if not force and os.path.exists(ensemble_cache):
    #     try:
    #         print("Loading ensemble models from cache:", ensemble_cache)
    #         ensemble_models = load(ensemble_cache)
    #         print("✅ Ensemble models loaded from cache")
    #         return ensemble_models
    #     except Exception as e:
    #         print("Failed to load ensemble cache, retraining. Error:", e)
    
    # print("🔄 Training ensemble models (ALS + BPR + LMF)...")
    
    models = {
        'als': implicit.als.AlternatingLeastSquares(
            factors=100,          # ✨ Tăng factors
            regularization=0.05,  # ✨ Tăng regularization
            iterations=30,        # ✨ Tăng iterations
            use_gpu=False,
            calculate_training_loss=True
        ),
        'bpr': implicit.bpr.BayesianPersonalizedRanking(
            factors=100,
            learning_rate=0.01,
            regularization=0.01,
            iterations=100,
            use_gpu=False
        ),
        'lmf': implicit.lmf.LogisticMatrixFactorization(
            factors=50,
            learning_rate=1.0,
            regularization=0.6,
            iterations=30,
            use_gpu=False
        )
    }
    
    trained_models = {}
    for name, model in models.items():
        try:
            print(f"Training {name.upper()}...")
            start = time.time()
            model.fit(rating_matrix)
            elapsed = time.time() - start
            trained_models[name] = model
            print(f"✅ {name.upper()} trained in {elapsed:.1f}s")
        except Exception as e:
            print(f"❌ Failed to train {name}: {e}")
    
    ensemble_models = trained_models
    
    # Lưu cache
    try:
        dump(ensemble_models, ensemble_cache)
        print("Ensemble models cached ->", ensemble_cache)
    except Exception as e:
        print("Failed to cache ensemble models:", e)
    
    return ensemble_models

# ✨ CẢI THIỆN: Ensemble recommendations
def ensemble_recommendations(user_idx, user_items, movie_ids, N=20):
    """
    Ensemble predictions từ nhiều models với weighted voting
    """
    global ensemble_models
    
    all_recs = {}
    weights = {'als': 0.5, 'bpr': 0.3, 'lmf': 0.2}  # Trọng số models
    
    # ✨ FIX: Validate user_idx và matrix shape
    n_users = user_items.shape[0] if hasattr(user_items, 'shape') else 1
    n_movies = len(movie_ids)
    
    print(f"Debug: user_idx={user_idx}, matrix_users={n_users}, matrix_movies={n_movies}")
    
    for name, model in ensemble_models.items():
        try:
            # ✨ FIX: Kiểm tra xem user_idx có valid không
            if user_idx >= model.user_factors.shape[0]:
                print(f"⚠️ {name}: user_idx {user_idx} >= model users {model.user_factors.shape[0]}, skipping")
                continue
            
            # ✨ FIX: Kiểm tra shape của user_items
            if hasattr(user_items, 'shape'):
                if user_items.shape[1] != model.item_factors.shape[0]:
                    print(f"⚠️ {name}: user_items shape {user_items.shape} != model items {model.item_factors.shape[0]}, skipping")
                    continue
            
            recs = model.recommend(
                user_idx, 
                user_items, 
                N=min(N*2, model.item_factors.shape[0]),  # ✨ FIX: Limit N by available items
                filter_already_liked_items=True
            )
            
            for movie_idx, score in zip(recs[0], recs[1]):
                if movie_idx not in all_recs:
                    all_recs[movie_idx] = 0
                all_recs[movie_idx] += weights[name] * score
            
            print(f"✅ {name}: recommended {len(recs[0])} movies")
                
        except Exception as e:
            print(f"❌ Error with {name}: {e}")
            import traceback
            traceback.print_exc()
    
    # ✨ FIX: Fallback nếu không có recommendations
    if not all_recs:
        print("⚠️ No ensemble recommendations, using fallback")
        # Fallback: Return popular items
        return [], []
    
    # Sort by ensemble score
    sorted_recs = sorted(all_recs.items(), key=lambda x: -x[1])[:N]
    movie_indices = [idx for idx, _ in sorted_recs]
    scores = [score for _, score in sorted_recs]
    
    return movie_indices, scores

def recommend_personalization_logic(payload):
    """Logic để tạo personalized recommendations với Ensemble + Thompson Sampling."""
    global user_movie_ratings, _df, ensemble_models, thompson_bandits
    
    ensemble_cache = "models/ensemble_models.joblib"
    print("Loading ensemble models from cache:", ensemble_cache)
    ensemble_models = load(ensemble_cache)
    print("✅ Ensemble models loaded from cache")

    if _df is None:
        build_model()
    
    if user_movie_ratings is None:
        load_and_merge_ratings()

    user_id = str(payload.get("user_id") or payload.get("userId"))
    if not user_id:
        return {"ok": False, "error": "user_id is required"}, 400

    # ✨ THÊM: Initialize Thompson Sampling cho user này
    if user_id not in thompson_bandits:
        thompson_bandits[user_id] = ThompsonSamplingRecommender()
        
        # Pre-populate bandit với historical ratings
        user_history = user_movie_ratings[user_movie_ratings['user_id'] == user_id]
        for _, row in user_history.iterrows():
            movie_id = str(row['movie_id'])
            rating = float(row['rating'])
            reward = 1 if rating >= 3.5 else 0
            thompson_bandits[user_id].update(movie_id, reward)

    # Load ratings của user từ Firebase
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
                    # ✨ Update Thompson Sampling
                    reward = 1 if float(rating) >= 3.5 else 0
                    thompson_bandits[user_id].update(str(movie_id), reward)
        except Exception as e:
            print(f"Error loading user ratings from Firebase: {e}")
            return {"ok": False, "error": "Failed to load user ratings"}, 500

    if not user_ratings:
        return {"ok": False, "error": "No ratings found for user"}, 400

    user_ratings_df = pd.DataFrame(user_ratings)
    user_ratings_df['user_id'] = user_id

    combined_ratings = pd.concat([user_movie_ratings, user_ratings_df], ignore_index=True)

    # Tạo sparse matrix
    movie_ids = combined_ratings['movie_id'].astype(str).unique()
    movie_id_to_idx = {mid: idx for idx, mid in enumerate(movie_ids)}
    user_ids = combined_ratings['user_id'].astype(str).unique()
    user_id_to_idx = {uid: idx for idx, uid in enumerate(user_ids)}

    rows = combined_ratings['user_id'].map(user_id_to_idx).values
    cols = combined_ratings['movie_id'].map(movie_id_to_idx).values
    data = combined_ratings['rating'].values

    rating_matrix = coo_matrix((data, (rows, cols)), shape=(len(user_ids), len(movie_ids))).tocsr()

    force_retrain = payload.get("force_retrain", False)
    
    # ✨ CẢI THIỆN: Train ensemble models thay vì single ALS
    # ✨ FIX: Kiểm tra xem cached model có compatible với current matrix không
    need_retrain = force_retrain or not ensemble_models
    
    if ensemble_models and not force_retrain:
        # Kiểm tra shape compatibility
        try:
            first_model = list(ensemble_models.values())[0]
            if (first_model.user_factors.shape[0] != len(user_ids) or 
                first_model.item_factors.shape[0] != len(movie_ids)):
                print(f"⚠️ Model shape mismatch: model users={first_model.user_factors.shape[0]} vs current={len(user_ids)}")
                print(f"⚠️ Model shape mismatch: model movies={first_model.item_factors.shape[0]} vs current={len(movie_ids)}")
                need_retrain = True
        except Exception as e:
            print(f"⚠️ Error checking model compatibility: {e}")
            need_retrain = True
    
    if need_retrain:
        print("🔄 Training/Retraining ensemble models...")
        ensemble_models = train_ensemble_als_models(rating_matrix, force=True)

    # ✨ CẢI THIỆN: Get ensemble recommendations
    user_idx = user_id_to_idx[user_id]
    user_items = rating_matrix[user_idx]
    
    print(f"Debug: Calling ensemble_recommendations with user_idx={user_idx}, n_movies={len(movie_ids)}")
    
    movie_indices, scores = ensemble_recommendations(
        user_idx, 
        user_items, 
        movie_ids, 
        N=40  # Get more candidates for Thompson Sampling
    )

    print(f"Ensemble recommended {len(movie_indices)} movies for user {user_id}")

    # ✨ FIX: Fallback nếu ensemble không trả về recommendations
    if not movie_indices:
        print("⚠️ No ensemble recommendations, using content-based fallback")
        # Fallback: Recommend popular movies user chưa xem
        user_rated_movies = set(user_ratings_df['movie_id'].tolist())
        
        # Get popular movies từ _df
        popular_movies = _df[_df['tmdb_id'].notna()].copy()
        popular_movies['popularity_score'] = popular_movies.get('vote_count', 0).fillna(0)
        popular_movies = popular_movies.sort_values('popularity_score', ascending=False)
        
        # Filter movies user chưa xem
        candidate_movie_ids = []
        for _, movie in popular_movies.iterrows():
            tmdb_id = str(int(movie['tmdb_id']))
            if tmdb_id not in user_rated_movies:
                candidate_movie_ids.append(tmdb_id)
            if len(candidate_movie_ids) >= 40:
                break
        
        print(f"Fallback: Found {len(candidate_movie_ids)} popular unwatched movies")
    else:
        # ✨ THÊM: Apply Thompson Sampling cho diversity
        candidate_movie_ids = [movie_ids[idx] for idx in movie_indices]
    
    sampled_movie_ids = thompson_bandits[user_id].sample_movies(
        candidate_movie_ids, 
        n_samples=min(20, len(candidate_movie_ids)),
        explore_rate=0.2  # 20% exploration
    )
    
    print(f"Thompson Sampling selected {len(sampled_movie_ids)} movies (20% exploration)")

    # Build results từ sampled movies
    results = []
    for movie_id in sampled_movie_ids:
        # ✨ FIX: Handle case where movie_id might not be in movie_id_to_idx (fallback case)
        if movie_id in movie_id_to_idx:
            movie_idx = movie_id_to_idx[movie_id]
            score = scores[movie_indices.index(movie_idx)] if movie_idx in movie_indices else 0.5
        else:
            # Fallback case: movie from popular recommendations
            movie_idx = None
            score = 0.5
        
        movie_row = _df[_df['tmdb_id'] == pd.to_numeric(movie_id, errors='coerce')]
        if movie_row.empty:
            movie_row = _df[_df['movieId'] == pd.to_numeric(movie_id, errors='coerce')]
        
        if not movie_row.empty:
            title = movie_row.iloc[0]['title']
            tmdb_id = movie_row.iloc[0].get('tmdb_id')
            
            tmdb_data = None
            if pd.notna(tmdb_id):
                try:
                    tmdb_data = fetch_tmdb_by_id(int(tmdb_id))
                except Exception as e:
                    print(f"Error fetching TMDB data for {tmdb_id}: {e}")
            
            if not tmdb_data:
                tmdb_data = fetch_tmdb_by_search(title)
            
            poster = (TMDB_IMAGE_BASE + tmdb_data["poster_path"]) if tmdb_data and tmdb_data.get("poster_path") else None
            rating = tmdb_data.get("vote_average") if tmdb_data else None
            
            # ✨ THÊM: Explanation chi tiết hơn
            bandit_state = thompson_bandits[user_id]
            total_feedback = bandit_state.alpha.get(movie_id, 1) + bandit_state.beta_param.get(movie_id, 1) - 2
            confidence = bandit_state.alpha.get(movie_id, 1) / (bandit_state.alpha.get(movie_id, 1) + bandit_state.beta_param.get(movie_id, 1))
            
            explanation_parts = [
                f"Ensemble score: {score:.3f}",
                f"Confidence: {confidence:.2f} ({total_feedback} ratings)"
            ]
            
            results.append({
                "movie_id": movie_id,
                "title": title,
                "tmdb_id": int(tmdb_id) if pd.notna(tmdb_id) else None,
                "poster": poster,
                "rating": rating,
                "score": float(score),
                "explanation": " | ".join(explanation_parts),
                "is_exploration": total_feedback < 5  # ✨ Flag exploration movies
            })

    results = results[:8]
    print(f"Returning {len(results)} recommendations ({sum(1 for r in results if r['is_exploration'])} exploration)")
    
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

@app.route("/classify_intent", methods=["POST"])
def classify_intent_endpoint():
    """
    Classify intent using LOCAL Sentence Transformers (fast, semantic)
    POST body: {"query": "gợi ý phim hành động"}
    Returns: {"intent": "movie_recommendation_request", "confidence": 0.95, "method": "sentence_transformer"}
    """
    try:
        from intent_classifier import classify_intent
        
        payload = request.get_json(force=True) or {}
        query = payload.get("query") or payload.get("text")
        
        if not query:
            return jsonify({"ok": False, "error": "Missing 'query' field"}), 400
        
        result = classify_intent(query)
        result["ok"] = True
        
        return jsonify(result), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            "ok": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@app.route("/classify_intent_deepseek", methods=["POST"])
def classify_intent_deepseek_endpoint():
    """
    Classify intent using DEEPSEEK API via evaluate_query_against_intents
    (Uses Dialogflow intent analysis data for context-aware classification)
    """
    try:
        # Import function từ dialogflow_intent_analyzer
        from dialogflow_intent_analyzer import evaluate_query_against_intents
        
        payload = request.get_json(force=True) or {}
        query = payload.get("query") or payload.get("text")
        
        if not query:
            return jsonify({"ok": False, "error": "Missing 'query' field"}), 400
        
        # Call evaluate_query_against_intents
        print(f"🔍 Evaluating query with Dialogflow context: {query}")
        
        try:
            evaluation_result = evaluate_query_against_intents(query)
        except Exception as eval_err:
            print(f"❌ evaluate_query_against_intents error: {eval_err}")
            import traceback
            traceback.print_exc()
            return jsonify({
                "ok": False,
                "error": f"Evaluation failed: {str(eval_err)}",
                "traceback": traceback.format_exc()
            }), 500
        
        if not evaluation_result:
            return jsonify({
                "ok": False,
                "error": "Failed to evaluate query - empty result"
            }), 500
        
        print(f"📊 Evaluation result: {json.dumps(evaluation_result, ensure_ascii=False)[:200]}")
        
        top_matches = evaluation_result.get("top_matches", [])
        overall_analysis = evaluation_result.get("overall_analysis", "")
        
        # Get best match
        if top_matches and len(top_matches) > 0:
            best_match = top_matches[0]
            intent = best_match.get("intent")
            score = best_match.get("score", 0)
            reasoning = best_match.get("reasoning", "")
            missing_info = best_match.get("missing_info", "")
            confidence_level = best_match.get("confidence", "medium")
            
            # Convert score (0-100) to confidence (0-1)
            confidence = score / 100.0
            
            # Map confidence level to numeric threshold
            confidence_map = {
                "high": 0.8,
                "medium": 0.6,
                "low": 0.4
            }
            
            # Use the higher of score-based or level-based confidence
            confidence = max(confidence, confidence_map.get(confidence_level, 0.5))
            
            result = {
                "ok": True,
                "intent": intent,
                "confidence": confidence,
                "score": score,
                "reasoning": reasoning,
                "missing_info": missing_info if missing_info else None,
                "confidence_level": confidence_level,
                "method": "deepseek_dialogflow_context",
                "query": query,
                "top_matches": top_matches,
                "overall_analysis": overall_analysis
            }
            
            print(f"✅ Best match: {intent} (score: {score}, confidence: {confidence:.2f})")
            
            return jsonify(result), 200
        
        else:
            # No matches found
            print(f"⚠️ No matches found. Overall analysis: {overall_analysis}")
            return jsonify({
                "ok": False,
                "error": "No intent matches found",
                "overall_analysis": overall_analysis,
                "query": query,
                "debug": {
                    "evaluation_result": evaluation_result
                }
            }), 400
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return jsonify({
            "ok": False,
            "error": "dialogflow_intent_analyzer module not found",
            "details": str(e)
        }), 500
    except Exception as e:
        import traceback
        print(f"❌ Unexpected error: {e}")
        traceback.print_exc()
        return jsonify({
            "ok": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@app.route("/recommend_personalization", methods=["POST"])
def recommend_personalization_endpoint():
    """Flask endpoint wrapper for personalization recommendations.

    This function parses the incoming JSON and delegates to
    `recommend_personalization_logic(payload)` which returns (result, status_code).
    """
    payload = request.get_json(force=True) or {}
    result, status = recommend_personalization_logic(payload)
    return jsonify(result), status

if __name__ == "__main__":
    # Nếu bạn muốn build model trước khi khởi động server, bật dòng dưới
    # build_model(force=True)

    print("🚀 Starting Flask server...")
    print("Model sẽ được build tự động khi có request đầu tiên (nếu chưa có cache).")

    # Chạy Flask
    app.run(host="0.0.0.0", port=5000, debug=True)
