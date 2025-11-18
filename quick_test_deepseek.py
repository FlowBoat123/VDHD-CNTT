import requests
import json

query = "Gợi ý phim hành động hay"

print(f"Testing query: {query}")

try:
    resp = requests.post(
        "http://localhost:5000/classify_intent_deepseek",
        json={"query": query},
        timeout=30
    )
    
    print(f"Status: {resp.status_code}\n")
    print("Response:")
    print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
    
except Exception as e:
    print(f"Error: {e}")
