#!/usr/bin/env python3
"""
Dialogflow Intent & Entity Analyzer
Phân tích chi tiết intents và entities từ Dialogflow với chiến lược sampling thông minh
Sử dụng LLM để hiểu mục tiêu và đặc điểm của từng intent/entity
"""

import os
import json
import random
import requests
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from google.cloud import dialogflow_v2 as dialogflow
from google.oauth2 import service_account
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()

# Paths     
DIALOGFLOW_KEY_PATH = os.getenv("DIALOGFLOW_KEY_PATH", "backend/key.json")
INTENT_ANALYSIS_PATH = "logs/dialogflow_intent_analysis.json"

# DeepSeek API
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")

# Load Dialogflow credentials
credentials = service_account.Credentials.from_service_account_file(DIALOGFLOW_KEY_PATH)
PROJECT_ID = json.load(open(DIALOGFLOW_KEY_PATH))['project_id']


def extract_entities_from_training_phrase(training_phrase) -> List[str]:
    """
    Trích xuất các entity types được sử dụng trong một training phrase
    """
    entities = []
    for part in training_phrase.parts:
        if part.entity_type:
            # Lấy tên entity type (bỏ prefix nếu có)
            entity_type = part.entity_type.split('/')[-1]
            if entity_type.startswith('@'):
                entity_type = entity_type[1:]
            entities.append(entity_type)
    return entities


def get_training_phrase_text(training_phrase) -> str:
    """
    Lấy text đầy đủ từ training phrase
    """
    return "".join([part.text for part in training_phrase.parts])


def categorize_training_phrases_by_entities(training_phrases, required_params: List[str]) -> Dict:
    """
    Phân loại training phrases dựa trên entities
    
    Returns:
        {
            "missing_required": [...],  # Thiếu entity bắt buộc
            "has_required": [...],      # Đủ entity bắt buộc
            "no_entities": [...],       # Không có entity
            "sorted_by_entity_count": [...],  # Sort theo số lượng entity
        }
    """
    missing_required = []
    has_required = []
    no_entities = []
    with_entities = []
    
    required_params_set = set(required_params)
    
    for tp in training_phrases:
        entities_in_phrase = extract_entities_from_training_phrase(tp)
        entities_set = set(entities_in_phrase)
        phrase_text = get_training_phrase_text(tp)
        
        phrase_data = {
            "text": phrase_text,
            "entities": entities_in_phrase,
            "entity_count": len(entities_in_phrase)
        }
        
        if not entities_in_phrase:
            no_entities.append(phrase_data)
        else:
            # Check if has all required params
            if required_params_set and required_params_set.issubset(entities_set):
                has_required.append(phrase_data)
            elif required_params_set:
                missing_required.append(phrase_data)
            else:
                # Không có required params nhưng có entities
                with_entities.append(phrase_data)
    
    # Sort by entity count (ascending: ít entity → nhiều entity)
    sorted_by_count = sorted(with_entities, key=lambda x: x['entity_count'])
    
    return {
        "missing_required": missing_required,
        "has_required": has_required,
        "no_entities": no_entities,
        "sorted_by_entity_count": sorted_by_count
    }


def smart_sample_training_phrases(training_phrases, required_params: List[str]) -> List[Dict]:
    """
    Lấy training phrases theo chiến lược thông minh
    
    Quy tắc:
    - Có required params: 2 thiếu + 3 đủ + 5 ngẫu nhiên
    - Không có required nhưng có entities: từ ít → nhiều entity (đa dạng)
    - Không có entities: 10 ngẫu nhiên
    """
    categorized = categorize_training_phrases_by_entities(training_phrases, required_params)
    
    samples = []
    
    if required_params:
        # Intent có required params
        # 2 câu thiếu required
        missing = categorized["missing_required"]
        samples.extend(random.sample(missing, min(2, len(missing))))
        
        # 3 câu đủ required
        has_req = categorized["has_required"]
        samples.extend(random.sample(has_req, min(3, len(has_req))))
        
        # 5 câu ngẫu nhiên (từ tất cả)
        all_phrases = [
            {"text": get_training_phrase_text(tp), 
             "entities": extract_entities_from_training_phrase(tp),
             "entity_count": len(extract_entities_from_training_phrase(tp))}
            for tp in training_phrases
        ]
        # Loại trừ những câu đã lấy
        sampled_texts = {s["text"] for s in samples}
        remaining = [p for p in all_phrases if p["text"] not in sampled_texts]
        samples.extend(random.sample(remaining, min(5, len(remaining))))
        
    elif categorized["sorted_by_entity_count"]:
        # Intent không có required nhưng có entities
        # Lấy từ ít entity → nhiều entity để thể hiện độ phức tạp
        sorted_phrases = categorized["sorted_by_entity_count"]
        
        # Strategy: lấy đều từ ít → nhiều
        total = len(sorted_phrases)
        if total <= 10:
            samples.extend(sorted_phrases)
        else:
            # Lấy 10 câu đều đặn từ ít → nhiều
            step = total / 10
            indices = [int(i * step) for i in range(10)]
            samples.extend([sorted_phrases[i] for i in indices])
    
    else:
        # Intent không có entities
        # Lấy 10 ngẫu nhiên
        no_ent = categorized["no_entities"]
        samples.extend(random.sample(no_ent, min(10, len(no_ent))))
    
    return samples


def smart_sample_entity_values(entity_type) -> List[Dict]:
    """
    Lấy 10 entity values đa dạng để thể hiện rõ mục tiêu của entity
    
    Strategy:
    - Nếu có synonym: lấy entities có nhiều synonyms (thể hiện độ đa dạng)
    - Lấy đều từ đầu, giữa, cuối danh sách
    - Ưu tiên entities có tên dài/ngắn khác nhau
    """
    entities = list(entity_type.entities)
    
    if len(entities) <= 10:
        return [{
            "value": e.value,
            "synonyms": list(e.synonyms)
        } for e in entities]
    
    # Sort by diversity (có nhiều synonyms + độ dài value)
    scored = []
    for e in entities:
        diversity_score = len(e.synonyms) * 2 + len(e.value)
        scored.append({
            "entity": e,
            "score": diversity_score
        })
    
    # Sort descending (most diverse first)
    scored.sort(key=lambda x: x["score"], reverse=True)
    
    # Lấy 10 đa dạng: 5 top diverse + 5 random
    samples = []
    
    # Top 5 diverse
    top_diverse = scored[:5]
    samples.extend([{
        "value": s["entity"].value,
        "synonyms": list(s["entity"].synonyms)
    } for s in top_diverse])
    
    # 5 random từ phần còn lại
    remaining = scored[5:]
    if remaining:
        random_picks = random.sample(remaining, min(5, len(remaining)))
        samples.extend([{
            "value": s["entity"].value,
            "synonyms": list(s["entity"].synonyms)
        } for s in random_picks])
    
    return samples


def fetch_dialogflow_intents_detailed():
    """
    Fetch chi tiết intents từ Dialogflow với smart sampling
    """
    print("\n" + "="*70)
    print("🔍 FETCHING DIALOGFLOW INTENTS & ENTITIES (Smart Sampling)")
    print("="*70)
    
    intents_client = dialogflow.IntentsClient(credentials=credentials)
    entity_types_client = dialogflow.EntityTypesClient(credentials=credentials)
    parent = f"projects/{PROJECT_ID}/agent"
    
    intents_data = {}
    entity_types_data = {}
    
    # ============================================
    # STEP 1: Fetch Intents
    # ============================================
    print("\n📋 STEP 1: Fetching Intents...")
    
    try:
        intents = intents_client.list_intents(
            request={
                "parent": parent,
                "intent_view": dialogflow.IntentView.INTENT_VIEW_FULL
            }
        )
        
        for intent in intents:
            intent_name = intent.display_name
            
            # Skip default intents
            if intent_name in ["Default Fallback Intent", "Default Welcome Intent", "default_fallback"]:
                continue
            
            print(f"\n  🎯 Processing: {intent_name}")
            
            # Extract required parameters
            required_params = []
            all_params = []
            
            for param in intent.parameters:
                param_info = {
                    "name": param.display_name,
                    "entity_type": param.entity_type_display_name,
                    "required": param.mandatory
                }
                all_params.append(param_info)
                
                if param.mandatory:
                    # Lấy entity type name (bỏ @ nếu có)
                    entity_type_name = param.entity_type_display_name
                    if entity_type_name.startswith('@'):
                        entity_type_name = entity_type_name[1:]
                    required_params.append(entity_type_name)
            
            # Smart sampling training phrases
            training_phrases_list = list(intent.training_phrases)
            sampled_phrases = smart_sample_training_phrases(
                training_phrases_list, 
                required_params
            )
            
            print(f"     Total training phrases: {len(training_phrases_list)}")
            print(f"     Required params: {required_params}")
            print(f"     Sampled: {len(sampled_phrases)} phrases")
            
            # Display sample distribution
            if required_params:
                missing_count = sum(1 for p in sampled_phrases 
                                   if not set(required_params).issubset(set(p.get("entities", []))))
                has_count = len(sampled_phrases) - missing_count
                print(f"       → {missing_count} missing required, {has_count} has required")
            else:
                entity_counts = [p.get("entity_count", 0) for p in sampled_phrases]
                if entity_counts and max(entity_counts) > 0:
                    print(f"       → Entity counts: {min(entity_counts)} to {max(entity_counts)}")
                else:
                    print(f"       → No entities")
            
            intents_data[intent_name] = {
                "display_name": intent_name,
                "action": intent.action or "",
                "parameters": all_params,
                "required_parameters": required_params,
                "total_training_phrases": len(training_phrases_list),
                "sampled_training_phrases": sampled_phrases,
                "sampling_strategy": "smart"
            }
        
        print(f"\n  ✅ Fetched {len(intents_data)} intents")
        
    except Exception as e:
        print(f"  ❌ Error fetching intents: {e}")
        return None
    
    # ============================================
    # STEP 2: Fetch Entity Types
    # ============================================
    print("\n📋 STEP 2: Fetching Entity Types...")
    
    try:
        entity_types = entity_types_client.list_entity_types(request={"parent": parent})
        
        for et in entity_types:
            entity_name = et.display_name
            
            print(f"\n  🏷️  Processing: {entity_name}")
            
            # Smart sampling entity values
            sampled_entities = smart_sample_entity_values(et)
            
            print(f"     Total entities: {len(et.entities)}")
            print(f"     Sampled: {len(sampled_entities)} entities")
            
            # Show diversity
            with_synonyms = sum(1 for e in sampled_entities if e["synonyms"])
            print(f"       → {with_synonyms} entities with synonyms")
            
            entity_types_data[entity_name] = {
                "display_name": entity_name,
                "kind": et.kind.name,
                "total_entities": len(et.entities),
                "sampled_entities": sampled_entities,
                "sampling_strategy": "diverse"
            }
        
        print(f"\n  ✅ Fetched {len(entity_types_data)} entity types")
        
    except Exception as e:
        print(f"  ❌ Error fetching entity types: {e}")
    
    return {
        "intents": intents_data,
        "entity_types": entity_types_data
    }


def call_llm_analyze_intent(intent_name: str, intent_data: Dict) -> Dict:
    """
    Gọi LLM để phân tích mục tiêu và đặc điểm của intent
    """
    if not DEEPSEEK_API_KEY:
        return {"goal": "N/A", "characteristics": [], "reasoning": "API not configured"}
    
    # Build prompt
    params_desc = "\n".join([
        f"  - {p['name']} (@{p['entity_type']}) {'[BẮT BUỘC]' if p['required'] else '[tùy chọn]'}"
        for p in intent_data["parameters"]
    ])
    
    phrases_desc = "\n".join([
        f"  - \"{p['text']}\" (entities: {', '.join(p.get('entities', [])) or 'none'})"
        for p in intent_data["sampled_training_phrases"][:10]
    ])
    
    prompt = f"""Phân tích Intent trong hệ thống chatbot gợi ý phim.

**Intent:** {intent_name}

**Parameters:**
{params_desc if params_desc else "  (Không có parameters)"}

**Training Phrases Examples:**
{phrases_desc}

---

**Nhiệm vụ:** Phân tích ĐẶC ĐIỂM và MỤC TIÊU của intent này.

Trả về JSON:
{{
    "goal": "Mục tiêu chính của intent (1-2 câu ngắn gọn)",
    "characteristics": [
        "Đặc điểm 1: Miêu tả cách user thường hỏi",
        "Đặc điểm 2: Thông tin nào là bắt buộc/tùy chọn",
        "Đặc điểm 3: Context/tình huống sử dụng"
    ],
    "key_patterns": [
        "Pattern 1: Mẫu câu đặc trưng",
        "Pattern 2: Từ khóa quan trọng"
    ],
    "entity_usage": "Cách sử dụng entities trong intent này",
    "examples_fit_score": {{
        "high_quality": ["example 1", "example 2"],
        "medium_quality": ["example 3"],
        "reasoning": "Tại sao examples này phù hợp/không phù hợp"
    }},
    "matching_criteria": "Tiêu chí để đánh giá câu hỏi mới có khớp intent này (điểm mạnh, điểm yếu)"
}}"""

    try:
        response = requests.post(
            DEEPSEEK_API_URL,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": "Bạn là chuyên gia phân tích Dialogflow Intent. LUÔN trả về JSON hợp lệ."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2,
                "max_tokens": 800,
                "response_format": {"type": "json_object"}
            },
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            content = data['choices'][0]['message']['content']
            return json.loads(content)
        else:
            print(f"    ⚠️ LLM API error: {response.status_code}")
            return {"goal": "Error", "characteristics": []}
    
    except Exception as e:
        print(f"    ❌ Error calling LLM: {e}")
        return {"goal": "Error", "characteristics": []}


def call_llm_analyze_entity(entity_name: str, entity_data: Dict) -> Dict:
    """
    Gọi LLM để phân tích mục tiêu và đặc điểm của entity type
    """
    if not DEEPSEEK_API_KEY:
        return {"goal": "N/A", "characteristics": [], "reasoning": "API not configured"}
    
    # Build prompt - escape special characters
    entities_desc_list = []
    for e in entity_data["sampled_entities"][:10]:
        # Escape quotes and backslashes in value and synonyms
        safe_value = e['value'].replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ')
        safe_synonyms = [s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', ' ') 
                        for s in e['synonyms'][:3]]
        
        if safe_synonyms:
            entities_desc_list.append(f'  - "{safe_value}" (synonyms: {", ".join(safe_synonyms)})')
        else:
            entities_desc_list.append(f'  - "{safe_value}" (no synonyms)')
    
    entities_desc = "\n".join(entities_desc_list)
    
    prompt = f"""Phân tích Entity Type trong hệ thống chatbot gợi ý phim.

**Entity Type:** @{entity_name}
**Kind:** {entity_data['kind']}
**Total Values:** {entity_data['total_entities']}

**Sample Values:**
{entities_desc}

---

**Nhiệm vụ:** Phân tích MỤC TIÊU và ĐẶC ĐIỂM của entity type này trong chatbot.

Trả về JSON:
{{
    "goal": "Mục tiêu/vai trò của entity type này trong chatbot (1-2 câu)",
    "characteristics": [
        "Đặc điểm 1: Kiểu dữ liệu (genre, person, date, rating, etc.)",
        "Đặc điểm 2: Độ đa dạng (có nhiều synonyms? chuẩn hóa?)",
        "Đặc điểm 3: Use cases"
    ],
    "value_patterns": [
        "Pattern 1: Định dạng giá trị",
        "Pattern 2: Synonyms strategy"
    ],
    "usage_context": "Context nào entity này thường xuất hiện",
    "matching_strategy": "Cách match user input với entity values (exact, fuzzy, synonyms, etc.)"
}}"""

    try:
        response = requests.post(
            DEEPSEEK_API_URL,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": "Bạn là chuyên gia phân tích Dialogflow Entity. LUÔN trả về JSON hợp lệ."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2,
                "max_tokens": 600,
                "response_format": {"type": "json_object"}
            },
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            content = data['choices'][0]['message']['content']
            return json.loads(content)
        else:
            print(f"    ⚠️ LLM API error: {response.status_code}")
            return {"goal": "Error", "characteristics": []}
    
    except json.JSONDecodeError as e:
        print(f"    ❌ JSON decode error: {e}")
        print(f"    📝 Entity: @{entity_name}")
        return {"goal": "JSON Parse Error", "characteristics": []}
    except Exception as e:
        print(f"    ❌ Error calling LLM: {e}")
        return {"goal": "Error", "characteristics": []}


def analyze_all_intents_and_entities():
    """
    Main function: Fetch + Analyze all intents and entities
    """
    print("\n" + "="*70)
    print("🚀 DIALOGFLOW INTENT & ENTITY ANALYZER")
    print("="*70)
    
    # Step 1: Fetch data
    dialogflow_data = fetch_dialogflow_intents_detailed()
    
    if not dialogflow_data:
        print("❌ Failed to fetch Dialogflow data")
        return
    
    # Step 2: Analyze intents with LLM
    print("\n" + "="*70)
    print("🧠 STEP 3: Analyzing Intents with LLM...")
    print("="*70)
    
    intents_analysis = {}
    for i, (intent_name, intent_data) in enumerate(dialogflow_data["intents"].items(), 1):
        print(f"\n  [{i}/{len(dialogflow_data['intents'])}] Analyzing: {intent_name}")
        
        analysis = call_llm_analyze_intent(intent_name, intent_data)
        
        intents_analysis[intent_name] = {
            **intent_data,
            "llm_analysis": analysis
        }
        
        print(f"     ✓ Goal: {analysis.get('goal', 'N/A')[:60]}...")
    
    # Step 3: Analyze entities with LLM
    print("\n" + "="*70)
    print("🧠 STEP 4: Analyzing Entity Types with LLM...")
    print("="*70)
    
    entities_analysis = {}
    for i, (entity_name, entity_data) in enumerate(dialogflow_data["entity_types"].items(), 1):
        print(f"\n  [{i}/{len(dialogflow_data['entity_types'])}] Analyzing: @{entity_name}")
        
        analysis = call_llm_analyze_entity(entity_name, entity_data)
        
        entities_analysis[entity_name] = {
            **entity_data,
            "llm_analysis": analysis
        }
        
        print(f"     ✓ Goal: {analysis.get('goal', 'N/A')[:60]}...")
    
    # Step 4: Save results
    output = {
        "metadata": {
            "analyzed_at": datetime.now().isoformat(),
            "project_id": PROJECT_ID,
            "total_intents": len(intents_analysis),
            "total_entity_types": len(entities_analysis)
        },
        "intents": intents_analysis,
        "entity_types": entities_analysis
    }
    
    with open(INTENT_ANALYSIS_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*70)
    print(f"✅ ANALYSIS COMPLETE!")
    print("="*70)
    print(f"\n📄 Saved to: {INTENT_ANALYSIS_PATH}")
    print(f"   📊 {len(intents_analysis)} intents analyzed")
    print(f"   🏷️  {len(entities_analysis)} entity types analyzed")
    print("\n💡 Use this data to:")
    print("   - Evaluate new queries against intent goals")
    print("   - Score intent matching based on characteristics")
    print("   - Understand entity usage patterns")
    print("="*70)
    
    return output


# ...existing code...

def evaluate_query_against_intents(query: str, analysis_data: Dict = None) -> Dict:  # ✨ FIX: Return Dict
    """
    Đánh giá câu hỏi mới với các intents đã phân tích
    """
    if analysis_data is None:
        if not os.path.exists(INTENT_ANALYSIS_PATH):
            print("⚠️ No analysis data found. Running analysis first...")
            try:
                analysis_data = analyze_all_intents_and_entities()
                if not analysis_data:
                    return {"top_matches": [], "overall_analysis": "Failed to analyze intents"}
            except Exception as e:
                print(f"❌ Error running analysis: {e}")
                return {"top_matches": [], "overall_analysis": f"Error: {str(e)}"}
        else:
            with open(INTENT_ANALYSIS_PATH, 'r', encoding='utf-8') as f:
                print("📄 Loading analysis data from file...")
                analysis_data = json.load(f)
    
    intents = analysis_data.get("intents", {})
    
    if not DEEPSEEK_API_KEY:
        print("⚠️ DEEPSEEK_API_KEY not configured")
        return {"top_matches": [], "overall_analysis": "API key not configured"}
    
    if not intents:
        print("⚠️ No intents found in analysis data")
        return {"top_matches": [], "overall_analysis": "No intents configured"}
    
    # ✨ FIX: Build context với proper escaping - lấy thông tin chi tiết từ llm_analysis
    intents_summary = []
    for intent_name, intent_info in intents.items():
        llm_analysis = intent_info.get("llm_analysis", {})
        
        # Lấy thông tin chi tiết từ llm_analysis
        goal = llm_analysis.get('goal', 'N/A')
        characteristics = llm_analysis.get('characteristics', [])
        key_patterns = llm_analysis.get('key_patterns', [])
        matching_criteria = llm_analysis.get('matching_criteria', '')
        
        # Lấy high quality examples từ examples_fit_score
        examples_fit_score = llm_analysis.get('examples_fit_score', {})
        high_quality_examples = examples_fit_score.get('high_quality', [])
        
        # Fallback: nếu không có high_quality_examples, lấy từ sampled_training_phrases
        if not high_quality_examples:
            sampled = intent_info.get('sampled_training_phrases', [])[:3]
            high_quality_examples = [p['text'] for p in sampled]
        
        # Build intent summary với thông tin đầy đủ
        intent_summary = {
            "intent": intent_name,
            "goal": goal,
            "characteristics": characteristics[:2] if len(characteristics) > 2 else characteristics,  # Lấy 2 đặc điểm quan trọng nhất
            "key_patterns": key_patterns,
            "examples": high_quality_examples[:3],  # Top 3 examples chất lượng cao
            "matching_criteria": matching_criteria,
            "required_params": intent_info.get('required_parameters', [])
        }
        
        intents_summary.append(intent_summary)
    
    # ✨ FIX: Improved prompt với context đầy đủ
    prompt_context = []
    for idx, intent_sum in enumerate(intents_summary, 1):
        intent_block = f"""
Intent {idx}: {intent_sum['intent']}
- Mục tiêu: {intent_sum['goal']}
- Đặc điểm chính:
  {chr(10).join(['  • ' + c for c in intent_sum.get('characteristics', [])])}
- Key patterns: {', '.join(intent_sum.get('key_patterns', []))}
- Examples: {', '.join([f'"{ex}"' for ex in intent_sum.get('examples', [])])}
- Matching criteria: {intent_sum.get('matching_criteria', 'N/A')}
- Required params: {', '.join(intent_sum.get('required_params', [])) or 'None'}
"""
        prompt_context.append(intent_block.strip())
    
    prompt = f"""Classify user query into one of the available intents based on detailed analysis.

Query: "{query}"

Available Intents:
{''.join([f'\n{ctx}\n---' for ctx in prompt_context])}

Task:
1. Analyze the query semantically based on intent goals and characteristics
2. Match against key patterns and examples
3. Consider matching criteria for each intent
4. Score each match (0-100) based on:
   - Goal alignment (40%)
   - Pattern match (30%)
   - Example similarity (20%)
   - Required params presence (10%)

Return JSON with top 3 intents (score > 30):
{{
    "top_matches": [
        {{
            "intent": "intent_name",
            "score": 95,
            "reasoning": "Detailed reasoning based on goal, patterns, and examples",
            "missing_info": "Missing required params if any",
            "confidence": "high/medium/low"
        }}
    ],
    "overall_analysis": "Brief semantic analysis of the query"
}}

Sort by score descending. Return ONLY valid JSON."""

    try:
        response = requests.post(
            DEEPSEEK_API_URL,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": "You are an intent classifier. ALWAYS return valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.2,
                "max_tokens": 600,
                "response_format": {"type": "json_object"}
            },
            timeout=30
        )
        
        print(f"DeepSeek API response status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            content = data['choices'][0]['message']['content']
            
            # ✨ FIX: Better JSON parsing with error handling
            try:
                result = json.loads(content)
                
                # Validate structure
                if not isinstance(result, dict):
                    raise ValueError("Response is not a dict")
                
                if "top_matches" not in result:
                    result["top_matches"] = []
                
                if "overall_analysis" not in result:
                    result["overall_analysis"] = "No analysis provided"
                
                print(f"✅ Parsed result: {len(result.get('top_matches', []))} matches")
                return result
                
            except json.JSONDecodeError as e:
                print(f"❌ JSON parse error: {e}")
                print(f"Raw content: {content[:200]}")
                return {
                    "top_matches": [],
                    "overall_analysis": f"JSON parse error: {str(e)}",
                    "raw_response": content[:500]
                }
        else:
            print(f"⚠️ LLM API error: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return {
                "top_matches": [],
                "overall_analysis": f"API error: {response.status_code}",
                "error_details": response.text[:200]
            }
    
    except requests.exceptions.Timeout:
        print("❌ DeepSeek API timeout")
        return {"top_matches": [], "overall_analysis": "API timeout"}
    
    except Exception as e:
        print(f"❌ Error evaluating query: {e}")
        import traceback
        traceback.print_exc()
        return {
            "top_matches": [],
            "overall_analysis": f"Error: {str(e)}"
        }

# ...existing code...

def test_query_evaluation():
    """
    Test function để đánh giá một số queries mẫu
    """
    test_queries = [
        "Gợi ý phim hành động hay như Inception",
        "Tôi muốn xem phim tình cảm buồn",
        "Phim nào của Leonardo DiCaprio hay nhất?",
        "Cho tôi xem collection phim kinh dị",
        "Phim gì đang hot?"
    ]
    
    print("\n" + "="*70)
    print("🧪 TESTING QUERY EVALUATION")
    print("="*70)
    
    for query in test_queries:
        print(f"\n📝 Query: {query}")
        result = evaluate_query_against_intents(query)
        
        print(f"\n   {result.get('overall_analysis', 'N/A')}")
        print(f"\n   Top Matches:")
        for match in result.get('top_matches', []):
            print(f"     🎯 {match['intent']} (score: {match['score']}, confidence: {match['confidence']})")
            print(f"        → {match['reasoning']}")
            if match.get('missing_info'):
                print(f"        ⚠️ Missing: {match['missing_info']}")


if __name__ == "__main__":
    # Run full analysis
    analysis_data = analyze_all_intents_and_entities()
    
    # Test evaluation
    if analysis_data:
        print("\n" + "="*70)
        input("Press Enter to run test query evaluation...")
        test_query_evaluation()
