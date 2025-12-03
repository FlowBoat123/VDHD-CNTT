import json
from pathlib import Path
import sys

# Resolve paths relative to this script file so running from repository root works
base_dir = Path(__file__).resolve().parent
in_path = base_dir / "adversarial_test_results.json"
out_path = base_dir / "failed_cases.json"

if not in_path.exists():
    print(f"Input file not found: {in_path}", file=sys.stderr)
    sys.exit(1)

with in_path.open("r", encoding="utf-8") as f:
    data = json.load(f)

failed = []

intent_results = data.get("intent_results", {})

for intent_name, intent_info in intent_results.items():
    for tc in intent_info.get("test_cases", []):
        expected = tc.get("expected_intent")
        predicted = tc.get("predicted_intent")
        question = tc.get("question")

        if expected != predicted:
            failed.append({
                "question": question,
                "expected_intent": expected
            })

with out_path.open("w", encoding="utf-8") as f:
    json.dump(failed, f, indent=2, ensure_ascii=False)

print("Extracted:", len(failed), "->", out_path)
