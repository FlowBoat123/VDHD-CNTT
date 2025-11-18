"""
Test script cho /classify_intent_deepseek endpoint
Kiểm tra prerequisites và gọi endpoint
"""

import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

# Check prerequisites
print("="*60)
print("🔍 CHECKING PREREQUISITES")
print("="*60)

# 1. Check DEEPSEEK_API_KEY
deepseek_key = os.getenv("DEEPSEEK_API_KEY")
if deepseek_key:
    print(f"✅ DEEPSEEK_API_KEY: {deepseek_key[:10]}...")
else:
    print("❌ DEEPSEEK_API_KEY: NOT SET")

# 2. Check dialogflow_intent_analysis.json
analysis_file = "logs/dialogflow_intent_analysis.json"
if os.path.exists(analysis_file):
    with open(analysis_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f"✅ dialogflow_intent_analysis.json: {len(data.get('intents', {}))} intents")
else:
    print(f"❌ dialogflow_intent_analysis.json: NOT FOUND")
    print("   Run: python dialogflow_intent_analyzer.py")

# 3. Check Flask server
print("\n" + "="*60)
print("🔍 TESTING FLASK ENDPOINT")
print("="*60)

try:
    health_resp = requests.get("http://localhost:5000/health", timeout=2)
    if health_resp.status_code == 200:
        print("✅ Flask server is running")
    else:
        print(f"⚠️ Flask server returned: {health_resp.status_code}")
except Exception as e:
    print(f"❌ Flask server not reachable: {e}")
    print("   Run: python main.py")
    exit(1)

# 4. Test endpoint
print("\n" + "="*60)
print("🧪 TESTING /classify_intent_deepseek")
print("="*60)

test_queries = [
    "Gợi ý phim hành động hay",
    "Tìm phim giống Inception",
    "Phim nào phù hợp với tôi"
]

for query in test_queries:
    print(f"\n📝 Query: {query}")
    
    try:
        resp = requests.post(
            "http://localhost:5000/classify_intent_deepseek",
            json={"query": query},
            timeout=30
        )
        
        print(f"   Status: {resp.status_code}")
        
        data = resp.json()
        
        if data.get("ok"):
            print(f"   ✅ Intent: {data.get('intent')}")
            print(f"   📊 Confidence: {data.get('confidence'):.2f}")
            print(f"   💡 Reasoning: {data.get('reasoning', '')[:80]}...")
        else:
            print(f"   ❌ Error: {data.get('error')}")
            if data.get('debug'):
                print(f"   🐛 Debug: {json.dumps(data['debug'], ensure_ascii=False)[:200]}")
        
    except Exception as e:
        print(f"   ❌ Exception: {e}")

print("\n" + "="*60)
print("✅ TEST COMPLETE")
print("="*60)
