import requests
import json

API_URL = "http://localhost:5000/classify_intent_deepseek"

test_queries = [
    {
        "name": "Movie Recommendation by Genre",
        "query": "Gợi ý phim hành động hay",
        "expected_intent": "movie_recommendation_request"
    },
    {
        "name": "Movie by Name",
        "query": "Tìm phim giống Inception",
        "expected_intent": "recommend_movie_by_name"
    },
    {
        "name": "Ambiguous Query",
        "query": "Phim gì hay?",
        "expected_intent": "movie_recommendation_request"
    },
    {
        "name": "Personalization",
        "query": "Gợi ý phim phù hợp với sở thích của tôi",
        "expected_intent": "recommend_personalization"
    },
    {
        "name": "Complex Query",
        "query": "Có phim nào giống Titanic mà phù hợp với tôi không?",
        "expected_intent": "recommend_movie_by_name"
    }
]

print("=" * 60)
print("Testing /classify_intent_deepseek Endpoint")
print("=" * 60)

for i, test in enumerate(test_queries, 1):
    print(f"\n[Test {i}] {test['name']}")
    print(f"Query: {test['query']}")
    
    try:
        response = requests.post(
            API_URL,
            json={"query": test['query']},
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            intent = data.get('intent')
            confidence = data.get('confidence')
            reasoning = data.get('reasoning', '')[:80]
            
            match = "✅ MATCH" if intent == test['expected_intent'] else "❌ MISMATCH"
            
            print(f"  Intent: {intent} {match}")
            print(f"  Expected: {test['expected_intent']}")
            print(f"  Confidence: {confidence:.2f}")
            print(f"  Reasoning: {reasoning}...")
            
            if data.get('missing_info'):
                print(f"  Missing Info: {data['missing_info']}")
        else:
            print(f"  ❌ Error: {response.status_code}")
            print(f"  {response.text[:200]}")
            
    except Exception as e:
        print(f"  ❌ Exception: {e}")

print("\n" + "=" * 60)
print("All tests completed!")
print("=" * 60)
