import json
import os
import sys
import time
from pathlib import Path
from collections import defaultdict
import requests

# --- .env loader: try python-dotenv first, fallback to simple loader ---
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_PATH)
    _DOTENV_USED = "python-dotenv"
except Exception:
    # fallback small loader
    def _simple_load_dotenv(dotenv_path: Path):
        if not dotenv_path.exists():
            return False
        with dotenv_path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' not in line:
                    continue
                key, val = line.split('=', 1)
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key] = val
        return True
    _simple_load_dotenv(ENV_PATH)
    _DOTENV_USED = "simple-fallback"

# Config
WRITE_DEBUG = False
IN_PATH = BASE_DIR / "failed_cases.json"
OUT_PATH = BASE_DIR / "dialogflow_enriched_training_data.json"

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")

if not DEEPSEEK_API_KEY:
    print(f"[ERROR] DEEPSEEK_API_KEY not set. Tried loader: {_DOTENV_USED}")
    print("Create a .env file with a line: DEEPSEEK_API_KEY=your_key_here")
    sys.exit(1)

DEFAULT_UNKNOWN_INTENT = "unknown_intent"

if not IN_PATH.exists():
    print(f"Input file not found: {IN_PATH}", file=sys.stderr)
    sys.exit(1)

if not DEEPSEEK_API_KEY:
    print("DEEPSEEK_API_KEY not set. Set it in environment or .env and re-run.", file=sys.stderr)
    sys.exit(1)


def paraphrase(sentence, n_retries=2, timeout=30, entities_used=None):
    ent_lines = ""
    if entities_used:
        ent_lines = "Entities to preserve:\n"
        for e in entities_used:
            ent_lines += f"- {e.get('entity')}: '{e.get('value')}'\n"
        ent_lines += "\n"

    prompt = f'''
Rewrite the following Vietnamese sentence into 3 different paraphrases.
Keep the same meaning and same intent.
Do NOT change or paraphrase the following substrings — they are entity values and must appear exactly as-is in every paraphrase.
{ent_lines}
Output ONLY a JSON array of strings.

Sentence: "{sentence}"
'''
    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": prompt}]
    }
    headers = {"Authorization": f"Bearer {DEEPSEEK_API_KEY}", "Content-Type": "application/json"}

    for attempt in range(1, n_retries + 1):
        try:
            resp = requests.post(DEEPSEEK_API_URL, json=payload, headers=headers, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
            if not content:
                print(f"[WARN] Empty content for sentence: {sentence!r}", file=sys.stderr)
                return []
            try:
                parsed = json.loads(content)
                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if isinstance(x, str) and x.strip()]
            except json.JSONDecodeError:
                import re
                m = re.search(r"(\[.*\])", content, flags=re.DOTALL)
                if m:
                    try:
                        parsed = json.loads(m.group(1))
                        if isinstance(parsed, list):
                            return [str(x).strip() for x in parsed if isinstance(x, str) and x.strip()]
                    except Exception:
                        pass
                print(f"[WARN] Could not parse LLM output as JSON for sentence {sentence!r}. Content starts: {content[:200]!r}", file=sys.stderr)
                return []
        except requests.RequestException as e:
            print(f"[ERROR] Request error (attempt {attempt}) for sentence {sentence!r}: {e}", file=sys.stderr)
            if attempt < n_retries:
                time.sleep(1 + attempt)
                continue
            return []
        except Exception as e:
            print(f"[ERROR] Unexpected error for sentence {sentence!r}: {e}", file=sys.stderr)
            return []
    return []


def unique_preserve_order(seq):
    seen = set()
    out = []
    for s in seq:
        if not isinstance(s, str):
            continue
        s = s.strip()
        if not s:
            continue
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def normalize_entities_from_input(raw_entities):
    """
    Normalize flexible input entity shapes into a list of {"entity": name, "value": value}
    """
    out = []
    if not raw_entities:
        return out
    if isinstance(raw_entities, dict):
        for k, v in raw_entities.items():
            if isinstance(v, str) and v.strip():
                out.append({"entity": k, "value": v.strip()})
    elif isinstance(raw_entities, list):
        for e in raw_entities:
            if isinstance(e, dict) and e.get("value"):
                out.append({"entity": e.get("entity") or e.get("type") or "entity", "value": e.get("value")})
    return out


def find_entity_positions(text, entities):
    """
    For a given text and entities list (each with 'entity' and 'value'),
    return list of dicts: {entity, value, start, end, alias, entity_type, found}
    - matching is case-insensitive; returns first non-overlapping match
    """
    results = []
    text_low = text.lower()
    used_ranges = set()
    for e in entities:
        val = e.get("value")
        name = e.get("entity") or "entity"
        alias = e.get("alias") if e.get("alias") else name
        entity_type = e.get("entity_type") if e.get("entity_type") else None

        found = False
        start = -1
        end = -1
        if isinstance(val, str) and val.strip():
            v = val.strip()
            v_low = v.lower()
            # try exact find
            idx = text_low.find(v_low)
            if idx >= 0:
                start = idx
                end = idx + len(v_low)
                found = True
            else:
                # try looser match: strip punctuation around words and search
                import re
                safe_v = re.escape(v_low)
                m = re.search(safe_v, text_low)
                if m:
                    start = m.start()
                    end = m.end()
                    found = True

        results.append({
            "entity": name,
            "value": val,
            "start": start if found else None,
            "end": end if found else None,
            "alias": alias,
            "entity_type": entity_type,
            "found": found
        })
    return results


# Load input file
with IN_PATH.open("r", encoding="utf-8") as f:
    try:
        inputs = json.load(f)
    except Exception as e:
        print(f"Failed to parse {IN_PATH}: {e}", file=sys.stderr)
        sys.exit(1)

intent_map = defaultdict(list)
total = len(inputs)
print(f"Processing {total} items...")

for idx, item in enumerate(inputs, 1):
    q = item.get("question") or item.get("text") or item.get("utterance")
    intent = item.get("expected_intent") or item.get("intent") or item.get("label")
    if not q:
        print(f"Skipping item {idx}: no question-like field", file=sys.stderr)
        continue
    if not intent:
        intent = DEFAULT_UNKNOWN_INTENT

    # Normalize entities from input
    raw_entities = item.get("entities_used") or item.get("entities") or item.get("entity")
    entities_used = normalize_entities_from_input(raw_entities)

    # Lightweight fallback for quoted substring if no entities provided
    if not entities_used:
        import re
        m = re.search(r'["\'«](.+?)["\'»]', q)
        if m:
            entities_used = [{"entity": "quoted_text", "value": m.group(1)}]

    # Generate paraphrases
    paras = paraphrase(q, entities_used=entities_used)
    combined = [q] + paras
    combined = unique_preserve_order(combined)

    # For each combined sentence, compute positions of entities
    for sent in combined:
        ent_positions = find_entity_positions(sent, entities_used)
        # store object with text and entities list
        intent_map[intent].append({
            "text": sent,
            "entities": ent_positions
        })

    if idx % 10 == 0 or idx == total:
        print(f"  Progress: {idx}/{total}")

# Deduplicate per intent by text, preserving order
final_map = {}
for intent, objs in intent_map.items():
    seen = set()
    out_list = []
    for o in objs:
        t = o.get("text", "").strip()
        if not t or t in seen:
            continue
        seen.add(t)
        out_list.append(o)
    if out_list:
        final_map[intent] = out_list

# Write final output
try:
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(final_map, f, indent=2, ensure_ascii=False)
    print("Wrote:", OUT_PATH)
except Exception as e:
    print("Failed to write output:", e, file=sys.stderr)

print("Finished.")
