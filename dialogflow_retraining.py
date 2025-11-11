#!/usr/bin/env python3
"""
Dialogflow Agent Retraining System
Sử dụng fallback data để cải thiện Dialogflow chatbot
"""

import os
import json
import requests
from datetime import datetime
from typing import Dict, List, Tuple
from google.cloud import dialogflow_v2 as dialogflow
from google.oauth2 import service_account
from dotenv import load_dotenv

load_dotenv()

# Paths
DIALOGFLOW_KEY_PATH = os.getenv("DIALOGFLOW_KEY_PATH", "backend/key.json")
FALLBACK_SAMPLE_PATH = "logs/fallback_sample.json"
CLASSIFIED_SAMPLES_PATH = "logs/dialogflow_classified_samples.json"
TRAINING_PHRASES_PATH = "logs/dialogflow_training_phrases.json"

# DeepSeek API
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")

# Load Dialogflow credentials
credentials = service_account.Credentials.from_service_account_file(DIALOGFLOW_KEY_PATH)
PROJECT_ID = json.load(open(DIALOGFLOW_KEY_PATH))['project_id']

# Cache cho Dialogflow intents info
_DIALOGFLOW_INTENTS_CACHE = None


def fetch_dialogflow_intents_info():
    """
    Pull thông tin chi tiết từ Dialogflow về tất cả intents
    Bao gồm: display_name, training phrases examples, parameters/entities
    """
    global _DIALOGFLOW_INTENTS_CACHE
    
    if _DIALOGFLOW_INTENTS_CACHE is not None:
        return _DIALOGFLOW_INTENTS_CACHE
    
    print("\n🔄 Fetching intents info from Dialogflow...")
    
    intents_client = dialogflow.IntentsClient(credentials=credentials)
    entity_types_client = dialogflow.EntityTypesClient(credentials=credentials)
    parent = f"projects/{PROJECT_ID}/agent"
    
    intents_info = {}
    
    try:
        # Get all intents with full info
        intents = intents_client.list_intents(
            request={
                "parent": parent,
                "intent_view": dialogflow.IntentView.INTENT_VIEW_FULL
            }
        )
        
        for intent in intents:
            intent_name = intent.display_name
            
            # Skip default intents
            if intent_name in ["Default Fallback Intent", "Default Welcome Intent"]:
                continue
            
            # Extract training phrases examples (lấy 5 examples)
            training_examples = []
            for i, tp in enumerate(intent.training_phrases[:5]):
                phrase_text = "".join([part.text for part in tp.parts])
                training_examples.append(phrase_text)
            
            # Extract parameters/entities
            parameters = []
            for param in intent.parameters:
                param_info = {
                    "name": param.display_name,
                    "entity_type": param.entity_type_display_name,
                    "required": param.mandatory
                }
                parameters.append(param_info)
            
            # Get action/event
            action = intent.action or ""
            
            intents_info[intent_name] = {
                "display_name": intent_name,
                "action": action,
                "training_examples": training_examples,
                "parameters": parameters,
                "num_training_phrases": len(intent.training_phrases)
            }
            
            print(f"  ✓ {intent_name}: {len(training_examples)} examples, {len(parameters)} parameters")
        
        # Get entity types info
        entity_types = entity_types_client.list_entity_types(request={"parent": parent})
        entity_types_info = {}
        
        for et in entity_types:
            entity_name = et.display_name
            entities_list = [e.value for e in et.entities[:5]]  # Lấy 5 examples
            entity_types_info[entity_name] = {
                "display_name": entity_name,
                "kind": et.kind.name,
                "examples": entities_list
            }
        
        print(f"\n✅ Fetched {len(intents_info)} intents and {len(entity_types_info)} entity types")
        
        _DIALOGFLOW_INTENTS_CACHE = {
            "intents": intents_info,
            "entity_types": entity_types_info
        }
        
        # Save to cache file
        cache_file = "logs/dialogflow_intents_cache.json"
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(_DIALOGFLOW_INTENTS_CACHE, f, indent=2, ensure_ascii=False)
        print(f"✅ Cached to {cache_file}")
        
        return _DIALOGFLOW_INTENTS_CACHE
        
    except Exception as e:
        print(f"❌ Error fetching Dialogflow intents: {e}")
        
        # Try to load from cache file if exists
        cache_file = "logs/dialogflow_intents_cache.json"
        if os.path.exists(cache_file):
            print(f"⚠️ Loading from cache: {cache_file}")
            with open(cache_file, 'r', encoding='utf-8') as f:
                _DIALOGFLOW_INTENTS_CACHE = json.load(f)
            return _DIALOGFLOW_INTENTS_CACHE
        
        return {"intents": {}, "entity_types": {}}


def call_deepseek_classify_for_dialogflow(query: str, method: str, confidence: float, dialogflow_info: Dict = None) -> Dict:
    """
    Gọi DeepSeek API để phân loại query cho Dialogflow
    
    Returns:
        {
            "quality": "HIGH|MEDIUM|NOISE",
            "intent": "dialogflow_intent_name",
            "training_phrases": ["phrase1", "phrase2", ...],  # Paraphrases
            "reasoning": "Lý do phân loại",
            "entities": {...}
        }
    """
    if not DEEPSEEK_API_KEY:
        print("⚠️ DEEPSEEK_API_KEY not configured")
        return {"quality": "MEDIUM", "intent": None}
    
    # Get Dialogflow intents info
    if dialogflow_info is None:
        dialogflow_info = fetch_dialogflow_intents_info()
    
    intents = dialogflow_info.get("intents", {})
    entity_types = dialogflow_info.get("entity_types", {})
    
    # Build detailed intents description với examples
    intents_description = "**Các Intent trong Dialogflow:**\n\n"
    for intent_name, intent_info in intents.items():
        intents_description += f"### {intent_name}\n"
        
        # Training examples
        if intent_info.get("training_examples"):
            intents_description += "**Ví dụ training phrases:**\n"
            for ex in intent_info["training_examples"]:
                intents_description += f"  - \"{ex}\"\n"
        
        # Parameters/Entities
        if intent_info.get("parameters"):
            intents_description += "**Parameters cần thiết:**\n"
            for param in intent_info["parameters"]:
                required = "BẮT BUỘC" if param["required"] else "tùy chọn"
                intents_description += f"  - {param['name']} ({param['entity_type']}) - {required}\n"
        
        intents_description += "\n"
    
    # Build entity types description
    entities_description = "**Entity Types có sẵn:**\n\n"
    for entity_name, entity_info in entity_types.items():
        entities_description += f"- @{entity_name}: {', '.join(entity_info.get('examples', [])[:3])}\n"
    
    prompt = f"""Bạn là chuyên gia Dialogflow training data với kiến thức sâu về chatbot gợi ý phim.

{intents_description}

{entities_description}

---

**Query cần phân loại:** "{query}"
**Method detect:** {method}  
**Confidence:** {confidence}

---

**Nhiệm vụ:**

1. **Phân loại chất lượng (QUAN TRỌNG):**
   
   - **HIGH**: Query RÕ RÀNG, ĐẦY ĐỦ, có thể dùng TRỰC TIẾP làm training phrase
     * Có đủ thông tin cần thiết cho intent
     * Entities (nếu cần) được đề cập rõ ràng
     * Ví dụ: "Gợi ý phim giống Inception" (có tên phim cụ thể)
     * → Sẽ được THÊM TRỰC TIẾP vào Dialogflow
   
   - **MEDIUM**: Query CHƯA ĐỦ RÕ RÀNG, cần CHỈNH SỬA trước khi thêm
     * Thiếu thông tin hoặc quá chung chung
     * Entities không rõ ràng
     * Ví dụ: "Phim gì hay" (thiếu thể loại, tâm trạng)
     * → CẦN CHỈNH SỬA, đề xuất cách hoàn thiện query
   
   - **NOISE**: KHÔNG LIÊN QUAN đến gợi ý phim
     * Spam, gibberish, hoặc off-topic
     * Ví dụ: "Tôi đói quá", "asdfgh"
     * → LOẠI BỎ, không thêm vào Dialogflow

2. **Xác định Intent:** So sánh query với training examples ở trên, chọn intent PHÙ HỢP NHẤT

3. **Extract Entities:** Trích xuất các entities theo parameters của intent đó

4. **Tạo Training Phrases (CHỈ KHI HIGH):**
   - Nếu quality = HIGH: Tạo 3-5 paraphrases (cách nói khác) 
   - Nếu quality = MEDIUM/NOISE: Để rỗng []

5. **Suggested Edits (CHỈ KHI MEDIUM):**
   - Nếu quality = MEDIUM: Đề xuất cách chỉnh sửa query để đạt HIGH
   - Ví dụ: "Phim gì hay" → "Gợi ý phim hành động hay" hoặc "Phim tình cảm nào đáng xem"

---

**Trả về JSON:**
{{
    "quality": "HIGH|MEDIUM|NOISE",
    "intent": "exact_intent_name_from_list_above hoặc null",
    "training_phrases": ["paraphrase 1", "paraphrase 2", ...] (CHỈ khi HIGH),
    "reasoning": "Giải thích chi tiết tại sao chọn quality này",
    "entities": {{"@entity_type": "value"}},
    "suggested_edits": ["edit 1", "edit 2", ...] (CHỈ khi MEDIUM),
    "missing_info": "Thông tin còn thiếu" (CHỈ khi MEDIUM)
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
                    {"role": "system", "content": "Bạn là chuyên gia Dialogflow. LUÔN trả về JSON hợp lệ."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.3,
                "max_tokens": 500,
                "response_format": {"type": "json_object"}
            },
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            content = data['choices'][0]['message']['content']
            result = json.loads(content)
            return result
        else:
            print(f"⚠️ DeepSeek API error: {response.status_code}")
            return {"quality": "MEDIUM", "intent": None}
            
    except Exception as e:
        print(f"❌ Error calling DeepSeek: {e}")
        return {"quality": "MEDIUM", "intent": None}


def classify_fallback_for_dialogflow():
    """
    Phân loại fallback samples cho Dialogflow training
    """
    if not os.path.exists(FALLBACK_SAMPLE_PATH):
        print(f"❌ File not found: {FALLBACK_SAMPLE_PATH}")
        return
    
    with open(FALLBACK_SAMPLE_PATH, 'r', encoding='utf-8') as f:
        fallback_data = json.load(f)
    
    # Fetch Dialogflow intents info TRƯỚC
    print("\n" + "="*60)
    print("📋 STEP 0: Fetching Dialogflow Intents Info")
    print("="*60)
    dialogflow_info = fetch_dialogflow_intents_info()
    
    if not dialogflow_info.get("intents"):
        print("❌ No intents found in Dialogflow. Please check connection.")
        return
    
    classified = {
        "metadata": {
            "classified_at": datetime.now().isoformat(),
            "total_samples": 0,
            "by_quality": {"HIGH": 0, "MEDIUM": 0, "NOISE": 0},
            "by_intent": {},
            "ready_for_dialogflow": 0
        },
        "samples": []
    }
    
    print("\n" + "="*60)
    print("📋 STEP 1: Classifying Samples with DeepSeek")
    print("="*60)
    
    total = 0
    for method, intents_dict in fallback_data.get("samples", {}).items():
        for intent, samples in intents_dict.items():
            for sample in samples:
                total += 1
                query = sample['query']
                confidence = sample.get('confidence', 0)
                timestamp = sample.get('timestamp', '')
                
                print(f"\n[{total}] Classifying: {query[:50]}...")
                
                # Call DeepSeek với Dialogflow info
                classification = call_deepseek_classify_for_dialogflow(
                    query=query,
                    method=method,
                    confidence=confidence,
                    dialogflow_info=dialogflow_info
                )
                
                quality = classification.get('quality', 'MEDIUM')
                dialogflow_intent = classification.get('intent')
                training_phrases = classification.get('training_phrases', [])
                suggested_edits = classification.get('suggested_edits', [])
                missing_info = classification.get('missing_info', '')
                
                # CHỈ HIGH được coi là ready for Dialogflow
                if quality == 'HIGH' and dialogflow_intent:
                    classified["metadata"]["ready_for_dialogflow"] += 1
                
                classified_sample = {
                    "query": query,
                    "original_intent": intent,
                    "dialogflow_intent": dialogflow_intent,
                    "quality": quality,
                    "training_phrases": training_phrases,  # CHỈ có nếu HIGH
                    "reasoning": classification.get('reasoning', ''),
                    "entities": classification.get('entities', {}),
                    "suggested_edits": suggested_edits,  # CHỈ có nếu MEDIUM
                    "missing_info": missing_info,  # CHỈ có nếu MEDIUM
                    "method": method,
                    "confidence": confidence,
                    "timestamp": timestamp
                }
                
                classified["samples"].append(classified_sample)
                classified["metadata"]["by_quality"][quality] += 1
                
                if dialogflow_intent:
                    classified["metadata"]["by_intent"][dialogflow_intent] = \
                        classified["metadata"]["by_intent"].get(dialogflow_intent, 0) + 1
                
                # Display result
                print(f"✓ Quality: {quality} | Intent: {dialogflow_intent}")
                
                if quality == 'HIGH' and training_phrases:
                    print(f"  ✅ Ready to add! {len(training_phrases)} training phrases")
                elif quality == 'MEDIUM':
                    print(f"  ⚠️ Needs editing! Suggested edits: {len(suggested_edits)}")
                    if suggested_edits:
                        print(f"     → {suggested_edits[0]}")
                elif quality == 'NOISE':
                    print(f"  🚫 Rejected (noise)")
    
    classified["metadata"]["total_samples"] = total
    
    # Save
    with open(CLASSIFIED_SAMPLES_PATH, 'w', encoding='utf-8') as f:
        json.dump(classified, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Classified {total} samples -> {CLASSIFIED_SAMPLES_PATH}")
    print(f"   Ready for Dialogflow: {classified['metadata']['ready_for_dialogflow']}")
    print("\n📊 Quality Distribution:")
    for quality, count in classified["metadata"]["by_quality"].items():
        percentage = (count / total * 100) if total > 0 else 0
        print(f"  {quality}: {count} ({percentage:.1f}%)")
    
    return classified


def prepare_dialogflow_training_data(classified_data: Dict = None):
    """
    Chuẩn bị training phrases cho Dialogflow từ classified samples
    CHỈ HIGH quality được thêm vào training data
    MEDIUM cần được review và edit trong CSV
    """
    if classified_data is None:
        if not os.path.exists(CLASSIFIED_SAMPLES_PATH):
            print("❌ No classified samples. Run classify_fallback_for_dialogflow() first.")
            return
        with open(CLASSIFIED_SAMPLES_PATH, 'r', encoding='utf-8') as f:
            classified_data = json.load(f)
    
    training_data = {}  # {intent_name: [training_phrases]}
    medium_samples = []  # Track MEDIUM samples for review
    
    for sample in classified_data.get("samples", []):
        quality = sample["quality"]
        intent = sample["dialogflow_intent"]
        
        # CHỈ HIGH quality được thêm vào training data
        if quality == "HIGH" and intent:
            if intent not in training_data:
                training_data[intent] = []
            
            # Add original query
            training_data[intent].append({
                "text": sample["query"],
                "type": "original",
                "quality": quality
            })
            
            # Add paraphrases (CHỈ HIGH có paraphrases)
            for phrase in sample.get("training_phrases", []):
                training_data[intent].append({
                    "text": phrase,
                    "type": "paraphrase",
                    "quality": quality
                })
        
        # Track MEDIUM samples để review
        elif quality == "MEDIUM" and intent:
            medium_samples.append({
                "query": sample["query"],
                "intent": intent,
                "suggested_edits": sample.get("suggested_edits", []),
                "missing_info": sample.get("missing_info", "")
            })
    
    # Save training data
    output = {
        "metadata": {
            "created_at": datetime.now().isoformat(),
            "total_intents": len(training_data),
            "total_phrases": sum(len(phrases) for phrases in training_data.values()),
            "high_quality_only": True,
            "medium_samples_count": len(medium_samples)
        },
        "training_data": training_data,
        "medium_samples_for_review": medium_samples
    }
    
    with open(TRAINING_PHRASES_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ Training data prepared -> {TRAINING_PHRASES_PATH}")
    print(f"  ✅ HIGH quality (ready): {output['metadata']['total_phrases']} phrases across {output['metadata']['total_intents']} intents")
    
    for intent, phrases in training_data.items():
        print(f"     {intent}: {len(phrases)} phrases")
    
    if medium_samples:
        print(f"\n  ⚠️ MEDIUM quality (needs review): {len(medium_samples)} samples")
        print(f"     These will be exported to CSV for manual editing")
    
    return training_data


def get_dialogflow_intent_id(intent_display_name: str) -> str:
    """Lấy Intent ID từ display name"""
    intents_client = dialogflow.IntentsClient(credentials=credentials)
    parent = f"projects/{PROJECT_ID}/agent"
    
    intents = intents_client.list_intents(request={"parent": parent})
    
    for intent in intents:
        if intent.display_name == intent_display_name:
            return intent.name
    
    return None


def add_training_phrases_to_dialogflow(training_data: Dict = None, dry_run: bool = True):
    """
    Thêm training phrases vào Dialogflow intents
    
    Args:
        training_data: Dict of {intent_name: [phrases]}
        dry_run: Nếu True, chỉ show preview không update thật
    """
    if training_data is None:
        if not os.path.exists(TRAINING_PHRASES_PATH):
            print("❌ No training data. Run prepare_dialogflow_training_data() first.")
            return
        with open(TRAINING_PHRASES_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            training_data = data['training_data']
    
    intents_client = dialogflow.IntentsClient(credentials=credentials)
    parent = f"projects/{PROJECT_ID}/agent"
    
    print("\n" + "="*60)
    if dry_run:
        print("🔍 DRY RUN - Preview changes (not applying)")
    else:
        print("🚀 UPDATING DIALOGFLOW")
    print("="*60)
    
    for intent_name, phrases_list in training_data.items():
        print(f"\n📋 Intent: {intent_name}")
        
        # Get intent ID
        intent_id = get_dialogflow_intent_id(intent_name)
        
        if not intent_id:
            print(f"  ⚠️ Intent '{intent_name}' not found in Dialogflow")
            print(f"  💡 Please create this intent in Dialogflow first")
            continue
        
        # Get current intent
        intent = intents_client.get_intent(request={"name": intent_id})
        
        # Current training phrases
        existing_phrases = {tp.parts[0].text.lower() for tp in intent.training_phrases}
        
        # New phrases to add
        new_phrases = []
        for phrase_obj in phrases_list:
            phrase_text = phrase_obj['text']
            if phrase_text.lower() not in existing_phrases:
                new_phrases.append(phrase_text)
        
        print(f"  Current phrases: {len(existing_phrases)}")
        print(f"  New phrases: {len(new_phrases)}")
        
        if not new_phrases:
            print(f"  ✓ No new phrases to add")
            continue
        
        # Preview
        print(f"\n  📝 New training phrases to add:")
        for i, phrase in enumerate(new_phrases[:5], 1):
            print(f"    {i}. {phrase}")
        if len(new_phrases) > 5:
            print(f"    ... and {len(new_phrases) - 5} more")
        
        if not dry_run:
            # Add training phrases
            for phrase_text in new_phrases:
                training_phrase = dialogflow.Intent.TrainingPhrase()
                part = dialogflow.Intent.TrainingPhrase.Part()
                part.text = phrase_text
                training_phrase.parts.append(part)
                intent.training_phrases.append(training_phrase)
            
            # Update intent
            try:
                update_mask = {"paths": ["training_phrases"]}
                updated_intent = intents_client.update_intent(
                    request={"intent": intent, "update_mask": update_mask}
                )
                print(f"  ✅ Updated intent: {len(new_phrases)} phrases added")
            except Exception as e:
                print(f"  ❌ Error updating intent: {e}")
    
    print("\n" + "="*60)
    if dry_run:
        print("✅ DRY RUN COMPLETE - Review changes above")
        print("   To apply changes, run: add_training_phrases_to_dialogflow(dry_run=False)")
    else:
        print("✅ DIALOGFLOW UPDATED")
        print("   Go to Dialogflow console to train agent")
    print("="*60)


def export_dialogflow_training_csv():
    """
    Export training data to CSV for manual review
    Bao gồm cả HIGH (ready) và MEDIUM (needs editing)
    """
    if not os.path.exists(TRAINING_PHRASES_PATH):
        print("❌ No training data found")
        return
    
    with open(TRAINING_PHRASES_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    import pandas as pd
    
    rows = []
    
    # HIGH quality phrases (ready to add)
    for intent, phrases_list in data.get('training_data', {}).items():
        for phrase_obj in phrases_list:
            rows.append({
                'quality': 'HIGH',
                'intent': intent,
                'original_query': phrase_obj['text'],
                'edited_query': phrase_obj['text'],  # Same as original for HIGH
                'type': phrase_obj['type'],
                'suggested_edits': '',
                'missing_info': '',
                'approved': 'yes',  # AUTO-APPROVE HIGH quality
                'notes': 'AUTO-APPROVED (HIGH quality)'
            })
    
    # MEDIUM quality samples (needs manual editing)
    for medium_sample in data.get('medium_samples_for_review', []):
        suggested_edits = medium_sample.get('suggested_edits', [])
        suggested_edit_text = suggested_edits[0] if suggested_edits else ''
        
        rows.append({
            'quality': 'MEDIUM',
            'intent': medium_sample['intent'],
            'original_query': medium_sample['query'],
            'edited_query': suggested_edit_text,  # Pre-fill với suggestion
            'type': 'original',
            'suggested_edits': ' | '.join(suggested_edits),
            'missing_info': medium_sample.get('missing_info', ''),
            'approved': '',  # NEEDS MANUAL APPROVAL
            'notes': 'NEEDS EDITING - Review edited_query and approve'
        })
    
    df = pd.DataFrame(rows)
    
    # Sort: HIGH first (already approved), then MEDIUM (needs review)
    df = df.sort_values('quality', ascending=False)
    
    output_path = "logs/dialogflow_training_review.csv"
    df.to_csv(output_path, index=False, encoding='utf-8-sig')
    
    high_count = len(df[df['quality'] == 'HIGH'])
    medium_count = len(df[df['quality'] == 'MEDIUM'])
    
    print(f"\n✅ Exported for review -> {output_path}")
    print(f"   ✅ HIGH quality (auto-approved): {high_count} phrases")
    print(f"   ⚠️ MEDIUM quality (needs review): {medium_count} samples")
    print(f"\n📝 Instructions:")
    print(f"   1. HIGH quality phrases are AUTO-APPROVED (approved='yes')")
    print(f"   2. MEDIUM quality samples:")
    print(f"      - Review 'edited_query' column (pre-filled with suggestion)")
    print(f"      - Edit if needed")
    print(f"      - Mark 'approved'='yes' when satisfied")
    print(f"   3. Import approved phrases: import_approved_phrases()")


def import_approved_phrases():
    """
    Import approved phrases from CSV
    Sử dụng 'edited_query' column (đã được chỉnh sửa từ MEDIUM → HIGH)
    """
    csv_path = "logs/dialogflow_training_review.csv"
    
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return
    
    import pandas as pd
    df = pd.read_csv(csv_path, encoding='utf-8-sig')
    
    # Filter approved only
    approved = df[df['approved'].str.lower() == 'yes']
    
    if len(approved) == 0:
        print("⚠️ No approved phrases found")
        return
    
    # Group by intent
    training_data = {}
    high_count = 0
    medium_edited_count = 0
    
    for _, row in approved.iterrows():
        intent = row['intent']
        quality = row['quality']
        
        # Sử dụng 'edited_query' (có thể đã được chỉnh sửa)
        phrase_text = row['edited_query']
        
        if pd.isna(phrase_text) or phrase_text.strip() == '':
            # Fallback to original_query if edited is empty
            phrase_text = row['original_query']
        
        if intent not in training_data:
            training_data[intent] = []
        
        training_data[intent].append({
            'text': phrase_text,
            'type': row['type'],
            'quality': quality,
            'was_edited': (row['original_query'] != phrase_text)
        })
        
        if quality == 'HIGH':
            high_count += 1
        elif quality == 'MEDIUM':
            medium_edited_count += 1
    
    print(f"\n✅ Imported {len(approved)} approved phrases")
    print(f"   ✅ HIGH quality: {high_count}")
    print(f"   ✅ MEDIUM → edited: {medium_edited_count}")
    
    for intent, phrases in training_data.items():
        edited_count = sum(1 for p in phrases if p.get('was_edited'))
        print(f"   {intent}: {len(phrases)} phrases ({edited_count} edited)")
    
    return training_data


def main():
    """
    Main workflow cho Dialogflow retraining
    """
    print("=" * 60)
    print("🔄 DIALOGFLOW AGENT RETRAINING")
    print("=" * 60)
    
    # Step 1: Classify
    print("\n📋 STEP 1: Classifying fallback samples for Dialogflow...")
    classified_data = classify_fallback_for_dialogflow()
    
    if not classified_data or not classified_data.get("samples"):
        print("❌ No samples to process")
        return
    
    # Step 2: Prepare training data
    print("\n📋 STEP 2: Preparing Dialogflow training phrases...")
    training_data = prepare_dialogflow_training_data(classified_data)
    
    # Step 3: Export for review
    print("\n📋 STEP 3: Exporting for manual review...")
    export_dialogflow_training_csv()
    
    # Step 4: Preview update
    print("\n📋 STEP 4: Preview Dialogflow update...")
    add_training_phrases_to_dialogflow(training_data, dry_run=True)
    
    print("\n" + "=" * 60)
    print("✅ RETRAINING PREPARATION COMPLETE!")
    print("=" * 60)
    print("\n📝 Next steps:")
    print("1. Review: logs/dialogflow_training_review.csv")
    print("2. Mark approved phrases with 'yes' in 'approved' column")
    print("3. Run: add_training_phrases_to_dialogflow(dry_run=False)")
    print("4. Train agent in Dialogflow console")
    print("=" * 60)


if __name__ == "__main__":
    main()
