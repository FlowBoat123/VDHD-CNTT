#!/usr/bin/env python3
"""
Auto-import training phrases into Dialogflow ES.

Usage:
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
  python auto_import_dialogflow_es.py \
    --project-id my-gcp-project \
    --input dialogflow_enriched_training_data.json \
    [--language vi] [--dry-run]

Input file format (JSON):
{
  "movie_recommendation_request": [
    "cho tôi vài phim hay để xem",
    "bạn giới thiệu phim nào hấp dẫn không"
  ],
  ...
}
"""
import argparse
import json
import os
import sys
import time
from typing import List, Dict, Set
import requests
from pathlib import Path

try:
    from google.cloud import dialogflow_v2 as dialogflow
    from google.api_core.exceptions import GoogleAPICallError
except Exception as e:
    print("Missing google-cloud-dialogflow dependency. Install with:")
    print("  pip install google-cloud-dialogflow")
    raise

# ----- Helpers -----
def chunked(iterable, n):
    it = iter(iterable)
    while True:
        chunk = []
        for _ in range(n):
            try:
                chunk.append(next(it))
            except StopIteration:
                break
        if not chunk:
            break
        yield chunk

def normalize_phrase(p: str) -> str:
    # canonical normalization for deduplication
    return " ".join(p.strip().split()).lower()


def build_training_phrase_parts(phrase: str, annotate_params: bool = False, entity_map: Dict[str, List[str]] = None):
    """Return a list of TrainingPhrase.Part objects for a phrase.

    If `annotate_params` is True, the function will look for parameter markers
    in the phrase using either `{param}` or `<param>` syntax and mark those
    parts with an entity_type and alias (e.g. alias 'movie_name' -> entity '@movie_name').

    This is a lightweight heuristic: it only annotates explicit markers.
    """
    parts = []
    if not annotate_params:
        # single unannotated part
        part = dialogflow.Intent.TrainingPhrase.Part(text=phrase)
        return [part]

    import re

    def _find_quoted(s: str):
        m = re.search(r'["\'«](.+?)["\'»]', s)
        return m.group(1).strip() if m else None

    def _find_pattern_after_keywords(s: str):
        # look for patterns like 'phim na ná X', 'phim giống X', 'phim như X'
        patterns = [r'phim\s+(?:na\s*ná|na-na|na|giống\s+với|giống|như)\s+(.{1,80})$',
                    r'phim\s+(.{1,80})$']
        for p in patterns:
            m = re.search(p, s, flags=re.IGNORECASE)
            if m:
                cand = m.group(1).strip()
                # strip trailing punctuation
                cand = re.sub(r'[\.,!?]$', '', cand).strip()
                return cand
        return None

    def _tmdb_search(query: str, tmdb_key: str):
        try:
            url = 'https://api.themoviedb.org/3/search/movie'
            resp = requests.get(url, params={'api_key': tmdb_key, 'query': query}, timeout=5)
            resp.raise_for_status()
            data = resp.json()
            results = data.get('results', [])
            if results:
                # return the first title
                return results[0].get('title') or results[0].get('original_title')
        except Exception:
            return None

    # try quoted first
    candidate = _find_quoted(phrase)
    if not candidate:
        candidate = _find_pattern_after_keywords(phrase)

    # If candidate found, try to refine via TMDB if API key available
    tmdb_key = os.getenv('TMDB_API_KEY')
    if not tmdb_key:
        # try backend/.env
        try:
            repo_root = Path(__file__).resolve().parents[1]
            env_path = repo_root / 'backend' / '.env'
            if env_path.exists():
                for line in env_path.read_text(encoding='utf-8').splitlines():
                    if line.strip().startswith('TMDB_API_KEY'):
                        val = line.split('=', 1)[1].strip().strip("'\"")
                        tmdb_key = val
                        break
        except Exception:
            tmdb_key = None

    tmdb_title = None
    if candidate and tmdb_key:
        tmdb_title = _tmdb_search(candidate, tmdb_key)

    match_text = tmdb_title or candidate

    if match_text:
        # locate match_text in phrase (case-insensitive)
        idx = phrase.lower().find(match_text.lower())
        if idx >= 0:
            if idx > 0:
                parts.append(dialogflow.Intent.TrainingPhrase.Part(text=phrase[:idx]))
            matched = phrase[idx:idx+len(match_text)]
            parts.append(dialogflow.Intent.TrainingPhrase.Part(text=matched, entity_type='@movie_name', alias='movie_name', user_defined=True))
            if idx+len(match_text) < len(phrase):
                parts.append(dialogflow.Intent.TrainingPhrase.Part(text=phrase[idx+len(match_text):]))
            return parts

    # If explicit heuristics didn't detect, try matching against entity_map values
    if annotate_params and entity_map:
        text_low = phrase.lower()
        # build list of (entity_display_name, synonym) sorted by synonym length desc
        matches = []
        for ent_name, synonyms in entity_map.items():
            for syn in synonyms:
                syn_low = syn.lower()
                idx = text_low.find(syn_low)
                if idx >= 0:
                    matches.append((ent_name, syn, idx, len(syn_low)))
        if matches:
            # prefer longest match and earliest position
            matches.sort(key=lambda x: (-x[3], x[2]))
            ent_name, syn, idx, _ = matches[0]
            parts = []
            if idx > 0:
                parts.append(dialogflow.Intent.TrainingPhrase.Part(text=phrase[:idx]))
            matched = phrase[idx:idx+len(syn)]
            parts.append(dialogflow.Intent.TrainingPhrase.Part(text=matched, entity_type=f'@{ent_name}', alias=ent_name, user_defined=True))
            if idx+len(syn) < len(phrase):
                parts.append(dialogflow.Intent.TrainingPhrase.Part(text=phrase[idx+len(syn):]))
            return parts

    # fallback: no detected parameter, return single part
    return [dialogflow.Intent.TrainingPhrase.Part(text=phrase)]

# ----- Dialogflow operations -----
class DialogflowESImporter:
    def __init__(self, project_id: str, language_code: str = "vi"):
        self.project_id = project_id
        self.language_code = language_code
        self.intents_client = dialogflow.IntentsClient()
        self.parent = f"projects/{project_id}/agent"
        # Entity types client and entity map (populated on demand)
        try:
            self.entity_types_client = dialogflow.EntityTypesClient()
        except Exception:
            self.entity_types_client = None
        self._entity_map = None

    def list_intents(self) -> List[dialogflow.Intent]:
        # List intents (lightweight). Use get_intent for full data when needed.
        intents = list(self.intents_client.list_intents(request={"parent": self.parent}))
        return intents

    def get_intent_full(self, intent_name: str) -> dialogflow.Intent:
        """Fetch the full intent (INTENT_VIEW_FULL) including training_phrases."""
        try:
            full = self.intents_client.get_intent(request={"name": intent_name, "intent_view": dialogflow.IntentView.INTENT_VIEW_FULL})
            return full
        except Exception:
            # propagate exception to caller
            raise

    def load_entity_map(self) -> Dict[str, List[str]]:
        """Load entity types and their synonyms/values from Dialogflow.

        Returns a mapping from entity display name (e.g. 'movie_name') to a list
        of strings (values and synonyms). The returned map is cached on the
        importer instance as `self._entity_map`.
        """
        if self._entity_map is not None:
            return self._entity_map

        if not self.entity_types_client:
            self._entity_map = {}
            return self._entity_map

        emap = {}
        try:
            for et in self.entity_types_client.list_entity_types(request={"parent": self.parent}):
                name = et.display_name
                values = []
                # et.entities contains Entity objects with 'value' and optional 'synonyms'
                for ent in getattr(et, "entities", []):
                    v = getattr(ent, "value", None)
                    if v:
                        values.append(v)
                    # synonyms may be present
                    for s in getattr(ent, "synonyms", []) or []:
                        if s and s != v:
                            values.append(s)
                # normalize and unique
                clean = []
                seen = set()
                for v in values:
                    if not isinstance(v, str):
                        continue
                    vv = v.strip()
                    if not vv:
                        continue
                    key = vv.lower()
                    if key in seen:
                        continue
                    seen.add(key)
                    clean.append(vv)
                if clean:
                    emap[name] = clean
        except Exception:
            # if entity listing fails, leave empty
            emap = {}

        self._entity_map = emap
        return emap

    def find_intent_by_display_name(self, display_name: str, intents: List[dialogflow.Intent]):
        for it in intents:
            if it.display_name == display_name:
                return it
        return None

    def create_intent(self, display_name: str, training_phrases: List[str]) -> dialogflow.Intent:
        # Build training phrases objects
        tp_objs = []
        for phrase in training_phrases:
            parts = build_training_phrase_parts(phrase, annotate_params=self._annotate_params if hasattr(self, '_annotate_params' ) else False)
            tp = dialogflow.Intent.TrainingPhrase(parts=parts)
            tp_objs.append(tp)

        intent = dialogflow.Intent(
            display_name=display_name,
            training_phrases=tp_objs,
            # set messages default so DF is happy (optional)
            messages=[dialogflow.Intent.Message(text=dialogflow.Intent.Message.Text(text=[""]))]
        )

        created_intent = self.intents_client.create_intent(
            request={"parent": self.parent, "intent": intent, "language_code": self.language_code}
        )
        return created_intent

    def update_intent_add_phrases(self, intent: dialogflow.Intent, new_phrases: List[str]):
        # Safely add training phrases onto existing intent. To avoid accidentally
        # overwriting other fields, fetch the full intent from the API, merge
        # training_phrases, and update only the `training_phrases` field via FieldMask.
        from google.protobuf import field_mask_pb2

        # Refresh the intent from the server to ensure we have the full training_phrases
        try:
            fetched = self.intents_client.get_intent(request={"name": intent.name, "intent_view": dialogflow.IntentView.INTENT_VIEW_FULL})
        except Exception as e:
            # Fall back to the passed-in intent if get_intent fails for some reason
            fetched = intent

        existing_phrases = set()
        existing_tp_objs = []
        if getattr(fetched, "training_phrases", None):
            for tp in fetched.training_phrases:
                text = "".join([part.text for part in tp.parts])
                existing_phrases.add(normalize_phrase(text))
                existing_tp_objs.append(tp)

        added = []
        for phrase in new_phrases:
            if normalize_phrase(phrase) not in existing_phrases:
                parts = build_training_phrase_parts(phrase, annotate_params=self._annotate_params if hasattr(self, '_annotate_params' ) else False)
                tp = dialogflow.Intent.TrainingPhrase(parts=parts)
                existing_tp_objs.append(tp)
                existing_phrases.add(normalize_phrase(phrase))
                added.append(phrase)

        if not added:
            return []

        # Build a minimal Intent object with the name and updated training_phrases only
        new_intent = dialogflow.Intent(name=fetched.name, training_phrases=existing_tp_objs)

        update_mask = field_mask_pb2.FieldMask(paths=["training_phrases"])
        try:
            updated = self.intents_client.update_intent(
                request={
                    "intent": new_intent,
                    "language_code": self.language_code,
                    "update_mask": update_mask,
                }
            )
        except GoogleAPICallError as e:
            raise RuntimeError(f"Failed to update intent {intent.display_name}: {e}")

        # Return list of phrases that were actually added and counts for verification
        before_count = len(fetched.training_phrases) if getattr(fetched, "training_phrases", None) else 0
        after_count = len(existing_tp_objs)
        return added, before_count, after_count

# ----- Main CLI flow -----
def main():
    parser = argparse.ArgumentParser(description="Auto import training phrases into Dialogflow ES")
    parser.add_argument("--project-id", required=True, help="GCP project id (Dialogflow project)")
    parser.add_argument("--input", required=True, help="Input JSON file mapping intent->phrases")
    parser.add_argument("--language", default="vi", help="Language code (default: vi)")
    parser.add_argument("--dry-run", action="store_true", help="Don't apply changes, only print plan")
    parser.add_argument("--batch-delay", type=float, default=0.2, help="Delay between API calls (sec)")
    parser.add_argument("--annotate-params", action="store_true", help="Treat {param} or <param> in phrases as parameters and annotate parts")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print("Input file not found:", args.input)
        sys.exit(1)

    with open(args.input, "r", encoding="utf-8") as f:
        data: Dict[str, List[str]] = json.load(f)

    # normalize phrases lists
    for k, v in data.items():
        data[k] = [p for p in v if isinstance(p, str) and p.strip()]

    importer = DialogflowESImporter(args.project_id, args.language)
    # pass annotate flag to importer so parts builder can mark parameter parts
    setattr(importer, '_annotate_params', bool(args.annotate_params))
    if args.annotate_params:
        print("Loading entity map from Dialogflow for parameter auto-detection...")
        emap = importer.load_entity_map()
        print(f"  Loaded {len(emap)} entity types for annotation.")
    else:
        emap = None

    print("Listing existing intents...")
    existing_intents = importer.list_intents()
    print(f"Found {len(existing_intents)} intents in project {args.project_id}.")

    created = []
    updated = []
    skipped = []

    for intent_name, phrases in data.items():
        # dedupe input phrases
        normalized_set: Set[str] = set()
        unique_phrases = []
        for p in phrases:
            np = normalize_phrase(p)
            if np not in normalized_set:
                normalized_set.add(np)
                unique_phrases.append(p)

        matched_intent = importer.find_intent_by_display_name(intent_name, existing_intents)

        if matched_intent is None:
            print(f"[CREATE] Intent '{intent_name}' does not exist. Will create with {len(unique_phrases)} phrases.")
            if not args.dry_run:
                try:
                    created_intent = importer.create_intent(intent_name, unique_phrases)
                    created.append((intent_name, len(unique_phrases)))
                    # report counts: before=0, after=<created count>
                    after_cnt = len(getattr(created_intent, "training_phrases", []))
                    print(f"    Created intent '{intent_name}': before=0 phrases, after={after_cnt} phrases, added={after_cnt}")
                    # small delay
                    time.sleep(args.batch_delay)
                except Exception as e:
                    print(f"Error creating intent {intent_name}: {e}")
            else:
                created.append((intent_name, len(unique_phrases)))
                print(f"    (DRY) Create intent '{intent_name}': before=0 phrases, after={len(unique_phrases)} phrases, added={len(unique_phrases)}")
        else:
            # fetch full intent to get existing training_phrases (list_intents may return lightweight intents)
            try:
                full_intent = importer.get_intent_full(matched_intent.name)
            except Exception:
                # fallback to the listed intent if fetch fails
                full_intent = matched_intent

            # compute which phrases are new vs duplicates using the full intent
            existing_texts = set()
            if getattr(full_intent, "training_phrases", None):
                for tp in full_intent.training_phrases:
                    txt = "".join([part.text for part in tp.parts])
                    existing_texts.add(normalize_phrase(txt))

            to_add = [p for p in unique_phrases if normalize_phrase(p) not in existing_texts]
            if to_add:
                before_cnt = len(existing_texts)
                print(f"[UPDATE] Intent '{intent_name}': will add {len(to_add)} new phrases.")
                if not args.dry_run:
                    try:
                        result = importer.update_intent_add_phrases(matched_intent, to_add)
                        # result is (added_list, before_count, after_count)
                        if isinstance(result, tuple):
                            added, before_cnt, after_cnt = result
                        else:
                            # backward compatibility (shouldn't happen)
                            added = result
                            before_cnt = before_cnt
                            after_cnt = before_cnt + len(added)

                        updated.append((intent_name, len(added)))
                        print(f"    Updated intent '{intent_name}': before={before_cnt} phrases, after={after_cnt} phrases, added={len(added)}")
                        time.sleep(args.batch_delay)
                    except Exception as e:
                        print(f"Error updating intent {intent_name}: {e}")
                else:
                    # dry-run: compute expected after count
                    after_cnt = before_cnt + len(to_add)
                    updated.append((intent_name, len(to_add)))
                    print(f"    (DRY) Update intent '{intent_name}': before={before_cnt} phrases, after={after_cnt} phrases, added={len(to_add)}")
            else:
                before_cnt = len(existing_texts)
                print(f"[SKIP] Intent '{intent_name}': no new phrases to add. before={before_cnt}, after={before_cnt}")
                skipped.append(intent_name)

    # Summary
    print("\n=== Summary ===")
    print(f"Intents to be created: {len(created)}")
    for name, n in created:
        print(f"  - {name}: phrases={n}")
    print(f"Intents updated: {len(updated)}")
    for name, n in updated:
        print(f"  - {name}: added_phrases={n}")
    print(f"Intents skipped (no change): {len(skipped)}")
    if args.dry_run:
        print("\n(DRY RUN) No changes were applied.")
    else:
        print("\n(Changes applied.)")

if __name__ == "__main__":
    main()
