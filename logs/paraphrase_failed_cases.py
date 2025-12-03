import json
import os
import sys
import time
from pathlib import Path
from collections import defaultdict

import requests

# Config
WRITE_DEBUG = False  # không cần debug, để False
BASE_DIR = Path(__file__).resolve().parent
IN_PATH = BASE_DIR / "failed_cases.json"
OUT_PATH = BASE_DIR / "dialogflow_enriched_training_data.json"

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")

DEFAULT_UNKNOWN_INTENT = "unknown_intent"

def _load_env_file(path: Path):
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and val and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass

# Try load .env if API key not in environment
if not DEEPSEEK_API_KEY:
    repo_root = Path(__file__).resolve().parents[1] if len(Path(__file__).resolve().parents) > 1 else Path(__file__).resolve().parent
    for candidate in (repo_root / ".env", repo_root / "backend" / ".env", repo_root / "backend" / ".env.local"):
        _load_env_file(candidate)
    DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

if not IN_PATH.exists():
    print(f"Input file not found: {IN_PATH}", file=sys.stderr)
    sys.exit(1)

if not DEEPSEEK_API_KEY:
    print("DEEPSEEK_API_KEY not set. Set it in environment or .env and re-run.", file=sys.stderr)
    sys.exit(1)

def paraphrase(sentence, n_retries=2, timeout=30):
    prompt = f'''
Rewrite the following Vietnamese sentence into 3 different paraphrases.
Keep the same meaning and same intent.
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

# Load input file
with IN_PATH.open("r", encoding="utf-8") as f:
    try:
        failed = json.load(f)
    except Exception as e:
        print(f"Failed to parse {IN_PATH}: {e}", file=sys.stderr)
        sys.exit(1)

intent_map = defaultdict(list)

total = len(failed)
print(f"Processing {total} items...")

for idx, item in enumerate(failed, 1):
    q = item.get("question") or item.get("text") or item.get("utterance")
    intent = item.get("expected_intent") or item.get("intent") or item.get("label")
    if not q:
        print(f"Skipping item {idx}: no question-like field", file=sys.stderr)
        continue
    if not intent:
        intent = DEFAULT_UNKNOWN_INTENT
        if intent is None:
            print(f"Skipping item {idx}: intent missing and DEFAULT_UNKNOWN_INTENT is None", file=sys.stderr)
            continue

    paras = paraphrase(q)
    combined = [q] + paras
    combined = unique_preserve_order(combined)

    # extend the intent map
    intent_map[intent].extend(combined)

    if idx % 10 == 0 or idx == total:
        print(f"  Progress: {idx}/{total}")

# Deduplicate per intent while preserving order and build final_map
final_map = {}
for intent, phrases in intent_map.items():
    deduped = unique_preserve_order(phrases)
    if deduped:
        final_map[intent] = deduped

# Write final output as the mapping intent -> list of phrases (no debug)
try:
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(final_map, f, indent=2, ensure_ascii=False)
    print("Wrote:", OUT_PATH)
except Exception as e:
    print("Failed to write output:", e, file=sys.stderr)

print("Finished.")
