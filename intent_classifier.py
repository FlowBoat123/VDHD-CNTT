#!/usr/bin/env python3
"""
Intent Classifier using Sentence Transformers
Fast, offline, semantic intent classification for movie chatbot
"""

import os
import json
import numpy as np
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from joblib import dump, load

# Intent definitions with training examples
INTENT_EXAMPLES = {
    "movie_recommendation_request": [
        "gợi ý phim hành động",
        "phim kinh dị nào hay",
        "tìm phim hay để xem",
        "có phim nào đáng xem không",
        "phim gì hay hôm nay",
        "muốn xem phim tình cảm",
        "phim comedy nào vui",
        "gợi ý phim cho cuối tuần",
        "phim mới nào hot",
        "tìm phim bom tấn",
        "phim anime nào hay",
        "phim Hàn Quốc hay",
        "phim chiếu rạp",
        "action movie recommendations",
        "what movie should i watch",
        "suggest some good films",
        "best movies to watch tonight",
        "recommend thriller movies",
    ],
    "recommend_movie_by_name": [
        "gợi ý phim giống inception",
        "tìm phim tương tự titanic",
        "phim nào như avatar",
        "có phim nào giống interstellar",
        "phim kiểu như harry potter",
        "tìm phim tương tự the godfather",
        "gợi ý phim theo tên the dark knight",
        "phim giống phim parasite",
        "movies like inception",
        "similar to avengers",
        "films like star wars",
        "find movies similar to pulp fiction",
        "recommend based on the matrix",
        "something like forrest gump",
    ],
    "recommend_personalization": [
        "gợi ý phim cá nhân cho tôi",
        "phim phù hợp với sở thích tôi",
        "đề xuất phim cho mình",
        "phim dành cho tôi",
        "gợi ý dựa trên lịch sử xem",
        "phim theo đánh giá của tôi",
        "personalized recommendations",
        "movies for me",
        "based on my ratings",
        "recommend for my taste",
        "phim phù hợp với tôi",
        "gợi ý theo sở thích",
    ]
}

class SentenceTransformerIntentClassifier:
    """
    Semantic intent classifier using Sentence Transformers
    - Fast: ~20-50ms per query
    - Offline: No API calls
    - Accurate: Better than keyword matching
    """
    
    def __init__(self, model_name='paraphrase-multilingual-MiniLM-L12-v2', cache_path="models/intent_classifier.joblib"):
        """
        Initialize with multilingual model for Vietnamese + English support
        paraphrase-multilingual-MiniLM-L12-v2: Best for multilingual semantic similarity
        """
        self.model_name = model_name
        self.cache_path = cache_path
        self.model = None
        self.intent_embeddings = {}
        self.intent_names = []
        
        # Try load from cache
        if os.path.exists(cache_path):
            try:
                print(f"Loading intent classifier from cache: {cache_path}")
                cached = load(cache_path)
                self.model_name = cached['model_name']
                self.intent_embeddings = cached['intent_embeddings']
                self.intent_names = cached['intent_names']
                print(f"✅ Intent classifier loaded from cache ({len(self.intent_names)} intents)")
            except Exception as e:
                print(f"⚠️  Failed to load cache: {e}, will rebuild")
        
        # Load model
        print(f"Loading Sentence Transformer: {self.model_name}")
        self.model = SentenceTransformer(self.model_name)
        
        # Build embeddings if not cached
        if not self.intent_embeddings:
            self.build_intent_embeddings()
    
    def build_intent_embeddings(self):
        """Pre-compute embeddings for all intent examples"""
        print("🔄 Building intent embeddings...")
        
        for intent_name, examples in INTENT_EXAMPLES.items():
            print(f"  Encoding {len(examples)} examples for '{intent_name}'")
            
            # Encode all examples for this intent
            embeddings = self.model.encode(
                examples,
                batch_size=16,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=True  # Normalize for cosine similarity
            )
            
            # Store average embedding for this intent
            avg_embedding = np.mean(embeddings, axis=0)
            self.intent_embeddings[intent_name] = avg_embedding
            self.intent_names.append(intent_name)
        
        print(f"✅ Built embeddings for {len(self.intent_names)} intents")
        
        # Cache for future use
        try:
            os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
            dump({
                'model_name': self.model_name,
                'intent_embeddings': self.intent_embeddings,
                'intent_names': self.intent_names
            }, self.cache_path)
            print(f"Intent classifier cached -> {self.cache_path}")
        except Exception as e:
            print(f"Failed to cache intent classifier: {e}")
    
    def classify(self, query_text):
        """
        Classify intent of query text
        Returns: (intent_name, confidence_score)
        """
        if not query_text or not isinstance(query_text, str):
            return None, 0.0
        
        # Encode query
        query_embedding = self.model.encode(
            [query_text],
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True
        )[0]
        
        # Calculate cosine similarity with each intent
        similarities = {}
        for intent_name in self.intent_names:
            intent_emb = self.intent_embeddings[intent_name]
            similarity = float(np.dot(query_embedding, intent_emb))
            similarities[intent_name] = similarity
        
        # Get best match
        best_intent = max(similarities, key=similarities.get)
        best_score = similarities[best_intent]
        
        return best_intent, best_score
    
    def classify_batch(self, queries):
        """Classify multiple queries at once (more efficient)"""
        if not queries:
            return []
        
        # Encode all queries
        query_embeddings = self.model.encode(
            queries,
            batch_size=32,
            show_progress_bar=False,
            convert_to_numpy=True,
            normalize_embeddings=True
        )
        
        results = []
        for query_emb in query_embeddings:
            similarities = {}
            for intent_name in self.intent_names:
                intent_emb = self.intent_embeddings[intent_name]
                similarity = float(np.dot(query_emb, intent_emb))
                similarities[intent_name] = similarity
            
            best_intent = max(similarities, key=similarities.get)
            best_score = similarities[best_intent]
            results.append((best_intent, best_score))
        
        return results

# Singleton instance
_classifier = None

def get_classifier():
    """Get or create classifier instance"""
    global _classifier
    if _classifier is None:
        _classifier = SentenceTransformerIntentClassifier()
    return _classifier

def classify_intent(query_text):
    """
    Main function to classify intent
    Returns dict with intent and confidence
    """
    classifier = get_classifier()
    intent, confidence = classifier.classify(query_text)
    
    return {
        "intent": intent,
        "confidence": float(confidence),
        "method": "sentence_transformer"
    }

# CLI test
if __name__ == "__main__":
    import sys
    
    print("🧪 Testing Intent Classifier\n")
    
    # Test queries
    test_queries = [
        "Gợi ý phim hành động",
        "Tìm phim giống Inception",
        "Gợi ý phim cá nhân cho tôi",
        "Phim gì hay hôm nay",
        "Phim tương tự Avatar",
        "Đề xuất phim theo sở thích tôi",
        "Tôi buồn quá",
        "Cuối tuần xem gì",
        "What's the weather",
        "Action movies",
        "Similar to Titanic",
        "Movies for me",
    ]
    
    if len(sys.argv) > 1:
        # Test with command line arg
        test_queries = [" ".join(sys.argv[1:])]
    
    classifier = get_classifier()
    
    print("Testing queries:\n")
    for query in test_queries:
        result = classify_intent(query)
        print(f"Query: '{query}'")
        print(f"  → Intent: {result['intent']}")
        print(f"  → Confidence: {result['confidence']:.3f}")
        print()
