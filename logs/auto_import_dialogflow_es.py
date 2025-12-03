#!/usr/bin/env python3
"""
Auto import training phrases into Dialogflow ES.

Supports input entries:
- plain strings (single TrainingPhrase part)
- dict with {"text": "...", "entities": [...]} where each entity may include:
    { "entity": "<name>", "value": "<text>", "start": int, "end": int,
      "alias": "...", "entity_type": "<@...>" }
- dict with {"parts": [...]} or {"parts_json": "..."} (legacy)

This variant PREFERS the following custom entities (uses @<name>):
  date_comparator, genre, movie_name, parameter, publish_date, rating_comparator

And will use system entities for number and person when appropriate:
  @sys.number, @sys.person

Run with --dry-run to preview.
"""
from __future__ import annotations
import argparse, json, os, sys, time, re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# try import dialogflow
try:
    from google.cloud import dialogflow_v2 as dialogflow
    from google.api_core.exceptions import GoogleAPICallError
except Exception:
    print("Missing google-cloud-dialogflow. Install with: pip install google-cloud-dialogflow")
    raise

# .env loader fallback
BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_PATH)
except Exception:
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k,v = line.split("=",1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# --------- Configuration: preferred/custom entities ----------
PREFERRED_ENTITY_NAMES = {
    "date_comparator",
    "genre",
    "movie_name",
    "parameter",
    "publish_date",
    "rating_comparator"
}
SYS_NUMBER = "@sys.number"
SYS_PERSON = "@sys.person"
SYS_ANY = "@sys.any"

# ---------------- helpers ----------------
def normalize_phrase(p: str) -> str:
    return " ".join(p.strip().split()).lower()

def load_input_json(path: Path) -> Dict[str, List[Any]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Input must be a JSON object mapping intent -> list")
    out: Dict[str, List[Any]] = {}
    for k, v in data.items():
        if not isinstance(v, list):
            continue
        out[k] = [item for item in v if (isinstance(item, str) and item.strip()) or isinstance(item, dict)]
    return out

# ---------------- entity inference ----------------
def looks_like_number(s: str) -> bool:
    if not s:
        return False
    s = s.strip()
    # percent, range, digits, decimals
    if re.fullmatch(r'[-+]?\d+(\.\d+)?', s):
        return True
    if "%" in s:
        return True
    if re.search(r'\d+\s*-\s*\d+', s):
        return True
    return False

def looks_like_person_alias_or_value(alias: Optional[str], value: str) -> bool:
    # heuristic: alias contains actor/diễn viên/person/name OR value has two capitalized words (simple)
    if alias:
        a = alias.lower()
        if any(x in a for x in ("person","actor","diễn viên","name","person_name","actor_name")):
            return True
    # value heuristic: has at least 2 words starting with uppercase or Vietnamese name tokens (very rough)
    if value:
        tokens = value.strip().split()
        caps = sum(1 for t in tokens if t[:1].isalpha() and t[0].isupper())
        if len(tokens) >= 2 and caps >= 1:
            return True
    return False

def infer_entity_type_from_alias_or_value(alias: Optional[str], value: str, entity_map: Dict[str, List[str]]) -> str:
    """
    Priority:
      1) If alias exactly equals one of preferred custom names -> @alias
      2) If alias exactly matches any entity_map key -> @alias
      3) If value exactly matches entity_map entries for a preferred entity -> @preferred
      4) If value matches any entity_map entry -> that entity
      5) Heuristics: number -> @sys.number ; person-like -> @sys.person
      6) Guess from alias (date etc.)
      7) fallback @sys.any
    """
    # 1) alias preferred
    if alias:
        a = alias.strip()
        if a in PREFERRED_ENTITY_NAMES:
            return f"@{a}"
        if a in entity_map:
            return f"@{a}"

    val = (value or "").strip()
    val_low = val.lower()

    # 3) exact match in entity_map with priority for preferred types
    if entity_map:
        # first check exact matches for preferred names
        for pref in PREFERRED_ENTITY_NAMES:
            syns = entity_map.get(pref, [])
            for s in syns:
                if s and s.strip().lower() == val_low:
                    return f"@{pref}"
        # then check any entity type exact match
        for et_name, syns in entity_map.items():
            for s in syns:
                if s and s.strip().lower() == val_low:
                    return f"@{et_name}"
        # loose contains/inclusion: prefer preferred entities first
        for pref in PREFERRED_ENTITY_NAMES:
            syns = entity_map.get(pref, [])
            for s in syns:
                if s and (s.strip().lower() in val_low or val_low in s.strip().lower()):
                    return f"@{pref}"
        for et_name, syns in entity_map.items():
            for s in syns:
                if s and (s.strip().lower() in val_low or val_low in s.strip().lower()):
                    return f"@{et_name}"

    # 5) numeric / person heuristics
    if looks_like_number(val):
        return SYS_NUMBER
    if looks_like_person_alias_or_value(alias, val):
        return SYS_PERSON

    # 6) alias-based guess for common sys types
    if alias:
        al = alias.lower()
        if "date" in al or "ngày" in al:
            return "@sys.date"
        if "time" in al:
            return "@sys.time"
        if "number" in al or "số" in al:
            return SYS_NUMBER
        if "phone" in al or "sdt" in al or "điện thoại" in al:
            return "@sys.phone-number"
        if "email" in al:
            return "@sys.email"

    # fallback
    return SYS_ANY

# ---------------- build parts (robust) ----------------
def build_parts_from_item(item: Any, entity_map: Dict[str, List[str]]) -> List[dialogflow.Intent.TrainingPhrase.Part]:
    parts: List[dialogflow.Intent.TrainingPhrase.Part] = []

    # plain string
    if isinstance(item, str):
        return [dialogflow.Intent.TrainingPhrase.Part(text=item)]

    # legacy parts / parts_json
    if isinstance(item, dict):
        parts_list = None
        if "parts" in item and isinstance(item["parts"], list):
            parts_list = item["parts"]
        elif "parts_json" in item:
            try:
                parts_list = json.loads(item["parts_json"])
            except Exception:
                parts_list = None

        if parts_list:
            for p in parts_list:
                text = str(p.get("text", "")).strip() if p else ""
                if not text:
                    continue
                if p.get("is_entity") or p.get("entity_type") or p.get("alias"):
                    et = p.get("entity_type")
                    alias = p.get("alias") or p.get("entity")
                    if not et and alias:
                        # prefer preferred names
                        if alias in PREFERRED_ENTITY_NAMES:
                            et = f"@{alias}"
                        else:
                            et = f"@{alias}"
                    part = dialogflow.Intent.TrainingPhrase.Part(
                        text=text,
                        entity_type=et if et else None,
                        alias=alias if alias else None,
                        user_defined=True
                    )
                else:
                    part = dialogflow.Intent.TrainingPhrase.Part(text=text)
                parts.append(part)
            if parts:
                return parts

        # robust handling for {"text": "...", "entities": [...]}
        if "text" in item and isinstance(item["text"], str) and isinstance(item.get("entities"), list):
            text: str = item["text"]
            ents = item.get("entities", [])
            text_lower = text.lower()
            used_spans: List[Tuple[int,int]] = []

            def find_next_nonoverlap(substr: str, start_search=0) -> Optional[Tuple[int,int]]:
                if not substr:
                    return None
                s = text_lower.find(substr.lower(), start_search)
                while s != -1:
                    e = s + len(substr)
                    overlap = False
                    for (us, ue) in used_spans:
                        if not (e <= us or s >= ue):
                            overlap = True
                            break
                    if not overlap:
                        return (s, e)
                    s = text_lower.find(substr.lower(), s+1)
                pattern = r'\b' + re.escape(substr) + r'\b'
                m = re.search(pattern, text, flags=re.IGNORECASE)
                if m:
                    s, e = m.start(), m.end()
                    for (us, ue) in used_spans:
                        if not (e <= us or s >= ue):
                            return None
                    return (s, e)
                return None

            def ent_key(e):
                try:
                    return (int(e.get("start")) if e.get("start") is not None else 10**9, -(len(str(e.get("value") or ""))))
                except Exception:
                    return (10**9, 0)

            try:
                ents_sorted = sorted(ents, key=ent_key)
            except Exception:
                ents_sorted = ents

            spans = []
            for e in ents_sorted:
                s = None
                t = None
                try:
                    if e.get("start") is not None:
                        s = int(e.get("start"))
                    if e.get("end") is not None:
                        t = int(e.get("end"))
                except Exception:
                    s = None
                    t = None
                val = str(e.get("value") or "").strip()
                ok = False
                if s is not None and t is not None and 0 <= s < t <= len(text):
                    sample = text[s:t]
                    if val and sample.strip().lower() != val.lower():
                        ok = False
                    else:
                        ok = True
                if not ok and val:
                    found = find_next_nonoverlap(val, 0)
                    if found:
                        s, t = found
                        ok = True
                if not ok and val:
                    found = find_next_nonoverlap(val, 0)
                    if found:
                        s, t = found
                        ok = True
                if ok:
                    spans.append((s, t, e))
                    used_spans.append((s, t))
                else:
                    # skip if not locatable
                    continue

            spans.sort(key=lambda x: x[0])
            cursor = 0
            for s, t, e in spans:
                if cursor < s:
                    pre = text[cursor:s]
                    if pre:
                        parts.append(dialogflow.Intent.TrainingPhrase.Part(text=pre))
                ent_text = text[s:t]
                alias = e.get("alias") or e.get("entity") or None
                provided_et = e.get("entity_type") or None
                if provided_et:
                    entity_type = provided_et
                else:
                    entity_type = infer_entity_type_from_alias_or_value(alias, e.get("value") or ent_text, entity_map)
                if entity_type is None:
                    entity_type = SYS_ANY
                part = dialogflow.Intent.TrainingPhrase.Part(
                    text=ent_text,
                    entity_type=entity_type,
                    alias=alias if alias else None,
                    user_defined=True
                )
                parts.append(part)
                cursor = t
            if cursor < len(text):
                tail = text[cursor:]
                if tail:
                    parts.append(dialogflow.Intent.TrainingPhrase.Part(text=tail))
            if parts:
                return parts

    # fallback
    return [dialogflow.Intent.TrainingPhrase.Part(text=str(item))]

# ---------------- Dialogflow importer ----------------
class DFImporter:
    def __init__(self, project_id: str, language_code: str = "vi"):
        self.project_id = project_id
        self.language = language_code
        self.intents_client = dialogflow.IntentsClient()
        self.parent = f"projects/{project_id}/agent"
        try:
            self.entity_client = dialogflow.EntityTypesClient()
        except Exception:
            self.entity_client = None
        self.entity_map: Dict[str, List[str]] = {}

    def list_intents(self) -> List[dialogflow.Intent]:
        return list(self.intents_client.list_intents(request={"parent": self.parent}))

    def get_intent_full(self, name: str) -> dialogflow.Intent:
        return self.intents_client.get_intent(request={"name": name, "intent_view": dialogflow.IntentView.INTENT_VIEW_FULL})

    def load_entity_map_from_df(self) -> Dict[str, List[str]]:
        emap: Dict[str, List[str]] = {}
        if not self.entity_client:
            return emap
        try:
            for et in self.entity_client.list_entity_types(request={"parent": self.parent}):
                key = et.display_name
                vals: List[str] = []
                for ent in getattr(et, "entities", []) or []:
                    v = getattr(ent, "value", None)
                    if v:
                        vals.append(str(v))
                    for s in getattr(ent, "synonyms", []) or []:
                        if s:
                            vals.append(str(s))
                seen = set()
                clean = []
                for v in vals:
                    vv = v.strip()
                    if not vv:
                        continue
                    lk = vv.lower()
                    if lk in seen:
                        continue
                    seen.add(lk)
                    clean.append(vv)
                if clean:
                    emap[key] = clean
        except Exception:
            emap = {}
        # ensure preferred keys exist (so alias lookup works even if entity empty)
        for pref in PREFERRED_ENTITY_NAMES:
            emap.setdefault(pref, emap.get(pref, []))
        self.entity_map = emap
        return emap

    def find_intent_by_display_name(self, name: str, intents: List[dialogflow.Intent]) -> Optional[dialogflow.Intent]:
        for it in intents:
            if it.display_name == name:
                return it
        return None

    def create_intent(self, display_name: str, items: List[Any]) -> dialogflow.Intent:
        tp_objs = []
        for it in items:
            parts = build_parts_from_item(it, self.entity_map)
            tp_objs.append(dialogflow.Intent.TrainingPhrase(parts=parts))
        intent = dialogflow.Intent(
            display_name=display_name,
            training_phrases=tp_objs,
            messages=[dialogflow.Intent.Message(text=dialogflow.Intent.Message.Text(text=[""]))]
        )
        return self.intents_client.create_intent(request={"parent": self.parent, "intent": intent, "language_code": self.language})

    def update_intent_add_phrases(self, intent: dialogflow.Intent, items: List[Any]) -> Tuple[List[str], int, int]:
        from google.protobuf import field_mask_pb2
        try:
            fetched = self.get_intent_full(intent.name)
        except Exception:
            fetched = intent
        existing_norm: Set[str] = set()
        existing_tp_objs = []
        if getattr(fetched, "training_phrases", None):
            for tp in fetched.training_phrases:
                txt = "".join([part.text for part in tp.parts])
                existing_norm.add(normalize_phrase(txt))
                existing_tp_objs.append(tp)
        added_texts: List[str] = []
        for it in items:
            if isinstance(it, str):
                key = normalize_phrase(it)
            else:
                if isinstance(it, dict):
                    if "parts" in it and isinstance(it["parts"], list):
                        combined = "".join([p.get("text", "") for p in it["parts"] if p.get("text")])
                        key = normalize_phrase(combined)
                    elif "parts_json" in it:
                        try:
                            pl = json.loads(it["parts_json"])
                            combined = "".join([p.get("text", "") for p in pl if p.get("text")])
                            key = normalize_phrase(combined)
                        except Exception:
                            key = normalize_phrase(json.dumps(it, ensure_ascii=False))
                    elif "text" in it and isinstance(it["text"], str):
                        key = normalize_phrase(it["text"])
                    else:
                        key = normalize_phrase(json.dumps(it, ensure_ascii=False))
                else:
                    key = normalize_phrase(str(it))
            if key in existing_norm:
                continue
            parts = build_parts_from_item(it, self.entity_map)
            tp = dialogflow.Intent.TrainingPhrase(parts=parts)
            existing_tp_objs.append(tp)
            existing_norm.add(key)
            added_texts.append(key)
        if not added_texts:
            return [], len(getattr(fetched, "training_phrases", [])), len(existing_tp_objs)
        new_intent = dialogflow.Intent(name=fetched.name, training_phrases=existing_tp_objs)
        update_mask = field_mask_pb2.FieldMask(paths=["training_phrases"])
        updated = self.intents_client.update_intent(request={"intent": new_intent, "language_code": self.language, "update_mask": update_mask})
        before = len(getattr(fetched, "training_phrases", []) or [])
        after = len(existing_tp_objs)
        return added_texts, before, after

# ---------------- CLI ----------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--language", default="vi")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-delay", type=float, default=0.2)
    parser.add_argument("--annotate-from-entities", action="store_true",
                        help="Load entity types from Dialogflow and use them to infer entity_type for entities in input")
    args = parser.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print("Input file not found:", inp)
        sys.exit(1)

    data = load_input_json(inp)
    importer = DFImporter(args.project_id, args.language)

    if args.annotate_from_entities:
        print("Loading entity map from Dialogflow...")
        emap = importer.load_entity_map_from_df()
        print(f"Loaded {len(emap)} entity types")
    else:
        importer.entity_map = {k: [] for k in PREFERRED_ENTITY_NAMES}

    intents = importer.list_intents()
    print(f"Found {len(intents)} intents in project {args.project_id}")

    created = []
    updated = []
    skipped = []

    for intent_name, items in data.items():
        # dedupe input items by textual repr
        seen = set()
        unique = []
        for it in items:
            if isinstance(it, str):
                key = normalize_phrase(it)
            elif isinstance(it, dict):
                if "parts" in it and isinstance(it["parts"], list):
                    combined = "".join([p.get("text", "") for p in it["parts"] if p.get("text")])
                    key = normalize_phrase(combined)
                elif "parts_json" in it:
                    try:
                        pl = json.loads(it["parts_json"])
                        combined = "".join([p.get("text", "") for p in pl if p.get("text")])
                        key = normalize_phrase(combined)
                    except Exception:
                        key = normalize_phrase(json.dumps(it, ensure_ascii=False))
                elif "text" in it and isinstance(it["text"], str):
                    key = normalize_phrase(it["text"])
                else:
                    key = normalize_phrase(json.dumps(it, ensure_ascii=False))
            else:
                key = normalize_phrase(str(it))
            if key not in seen:
                seen.add(key)
                unique.append(it)

        matched = importer.find_intent_by_display_name(intent_name, intents)
        if matched is None:
            print(f"[CREATE] {intent_name} -> {len(unique)} phrases")
            if args.dry_run:
                for sample in unique[:3]:
                    parts = build_parts_from_item(sample, importer.entity_map)
                    print("  sample parts:", [(p.text, getattr(p, "entity_type", None), getattr(p, "alias", None)) for p in parts])
                created.append((intent_name, len(unique)))
            else:
                try:
                    ci = importer.create_intent(intent_name, unique)
                    cnt = len(getattr(ci, "training_phrases", []) or [])
                    created.append((intent_name, cnt))
                    print(f"  Created {intent_name}: phrases={cnt}")
                except Exception as e:
                    print(f"  Error creating {intent_name}: {e}")
        else:
            try:
                full = importer.get_intent_full(matched.name)
            except Exception:
                full = matched
            existing_texts = set()
            if getattr(full, "training_phrases", None):
                for tp in full.training_phrases:
                    txt = "".join([part.text for part in tp.parts])
                    existing_texts.add(normalize_phrase(txt))
            to_add = []
            for it in unique:
                if isinstance(it, str):
                    key = normalize_phrase(it)
                elif isinstance(it, dict):
                    if "parts" in it and isinstance(it["parts"], list):
                        combined = "".join([p.get("text", "") for p in it["parts"] if p.get("text")])
                        key = normalize_phrase(combined)
                    elif "parts_json" in it:
                        try:
                            pl = json.loads(it["parts_json"])
                            combined = "".join([p.get("text", "") for p in pl if p.get("text")])
                            key = normalize_phrase(combined)
                        except Exception:
                            key = normalize_phrase(json.dumps(it, ensure_ascii=False))
                    elif "text" in it and isinstance(it["text"], str):
                        key = normalize_phrase(it["text"])
                    else:
                        key = normalize_phrase(json.dumps(it, ensure_ascii=False))
                else:
                    key = normalize_phrase(str(it))
                if key not in existing_texts:
                    to_add.append(it)
            if not to_add:
                skipped.append(intent_name)
                print(f"[SKIP] {intent_name}: no new phrases")
            else:
                print(f"[UPDATE] {intent_name}: adding {len(to_add)} phrases")
                if args.dry_run:
                    for sample in to_add[:3]:
                        parts = build_parts_from_item(sample, importer.entity_map)
                        print("  sample parts:", [(p.text, getattr(p, "entity_type", None), getattr(p, "alias", None)) for p in parts])
                    updated.append((intent_name, len(to_add)))
                else:
                    try:
                        added, before, after = importer.update_intent_add_phrases(matched, to_add)
                        updated.append((intent_name, len(added)))
                        print(f"  Updated {intent_name}: before={before}, after={after}, added={len(added)}")
                    except Exception as e:
                        print(f"  Error updating {intent_name}: {e}")

        time.sleep(args.batch_delay)

    print("\n=== Summary ===")
    print(f"Created: {len(created)}")
    for n, c in created:
        print(f"  - {n}: phrases={c}")
    print(f"Updated: {len(updated)}")
    for n, c in updated:
        print(f"  - {n}: added={c}")
    print(f"Skipped: {len(skipped)}")
    if args.dry_run:
        print("(DRY RUN) No changes were applied.")
    else:
        print("Changes applied.")

if __name__ == "__main__":
    main()
