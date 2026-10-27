"""
Seed / restore a MongoDB database from a CRM JSON export.

Supported export layouts (auto-detected):

  NEW (mongodump-style)            OLD (flat)
  crm_export/                      export_folder/
    _manifest.json                   _manifest.json
    _indexes.json                    _indexes.json
    team-pipeline-5-test_database/   users.json
      users.json                     leads.json
      leads.json                     ...
      ...

You can point --path at: the export root (crm_export), the database folder
inside it, a parent of the export root, or a .zip of any of those.
Keeps ObjectIds, dates and all other BSON types (Extended JSON via bson.json_util).

Usage (run from the backend folder):

    python seed_from_export.py --path ../crm_export --db crm_onestock --drop

    # MONGO_URL / DB_NAME are read from backend/.env unless passed explicitly
    python seed_from_export.py --path export.zip --mongo-url 'mongodb+srv://...' --db crm_onestock --drop

Options:
    --path        Export folder or .zip file (required)
    --source-db   Which database folder to import, if the export has several
    --mongo-url   Target Mongo URI (default: MONGO_URL from env / backend/.env)
    --db          Target database name (default: DB_NAME from env / backend/.env)
    --drop        Drop each collection before inserting (recommended for a clean copy)
    --skip        Collections to skip, comma separated (e.g. sessions,login_attempts)
    --yes         Do not ask for confirmation
"""
import argparse
import json
import os
import sys
import zipfile
from pathlib import Path

from bson import json_util
from pymongo import MongoClient
from pymongo.errors import BulkWriteError

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

BATCH = 1000
META_FILES = {"_manifest.json", "_indexes.json"}
INDEX_OPTS = (
    "unique", "sparse", "expireAfterSeconds", "partialFilterExpression",
    "collation", "default_language", "language_override",
)


# --------------------------------------------------------------------------
# Reading the export
# --------------------------------------------------------------------------
def collect_json(path: Path):
    """Return a list of (parts_tuple, text) for every .json under path/zip.
    parts always starts with the root name, so every file has a parent dir."""
    items = []
    if path.is_file() and path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if name.endswith("/") or name.startswith("__MACOSX") or not name.lower().endswith(".json"):
                    continue
                parts = (path.stem,) + tuple(p for p in name.split("/") if p)
                items.append((parts, zf.read(name).decode("utf-8-sig")))
    elif path.is_dir():
        root = path.resolve()
        for f in sorted(root.rglob("*.json")):
            parts = (root.name,) + f.relative_to(root).parts
            items.append((parts, f.read_text(encoding="utf-8-sig")))
    else:
        sys.exit(f"ERROR: path not found or unsupported: {path}")
    if not items:
        sys.exit("ERROR: no .json files found in the export.")
    return items


def split_export(items):
    """Split into meta files and per-database collection files.

    Returns (meta, dbs):
      meta: {(dir_parts, filename): text}
      dbs : {dir_parts: {collection_name: text}}
    """
    meta, dbs = {}, {}
    for parts, text in items:
        dir_parts, fname = parts[:-1], parts[-1]
        if fname in META_FILES:
            meta[(dir_parts, fname)] = text
        else:
            dbs.setdefault(dir_parts, {})[fname[:-5]] = text
    return meta, dbs


def find_meta(meta, dir_parts, fname):
    """Look for fname in the db folder, then each parent folder, then anywhere
    (only if unambiguous)."""
    d = dir_parts
    while d:
        if (d, fname) in meta:
            return meta[(d, fname)]
        d = d[:-1]
    matches = [t for (_, n), t in meta.items() if n == fname]
    return matches[0] if len(matches) == 1 else None


def choose_db(dbs, wanted):
    if wanted:
        for dir_parts in dbs:
            if dir_parts[-1] == wanted:
                return dir_parts
        sys.exit(f"ERROR: source db '{wanted}' not found. Available: "
                 f"{', '.join(d[-1] for d in dbs)}")
    if len(dbs) == 1:
        return next(iter(dbs))
    sys.exit("ERROR: export contains several database folders, pick one with --source-db:\n  "
             + "\n  ".join(d[-1] for d in dbs))


# --------------------------------------------------------------------------
# Parsing helpers
# --------------------------------------------------------------------------
def parse_docs(text):
    """Extended JSON array (or JSON-lines) -> list of docs, or None if invalid."""
    text = text.strip()
    if not text:
        return []
    try:
        data = json_util.loads(text)
    except json.JSONDecodeError:
        try:
            data = [json_util.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError:
            return None
    if isinstance(data, dict):
        for k in ("documents", "docs", "data"):
            if isinstance(data.get(k), list):
                return data[k]
        return None
    return data if isinstance(data, list) else None


def load_json(text):
    if not text:
        return {}
    try:
        return json_util.loads(text)
    except json.JSONDecodeError:
        print("  ! could not parse a meta file, ignoring it")
        return {}


def expected_counts(manifest, source_db):
    """Return {collection: expected_count}, tolerant of several manifest shapes."""
    m = manifest if isinstance(manifest, dict) else {}
    dbs = m.get("databases")
    if isinstance(dbs, dict) and isinstance(dbs.get(source_db), dict):
        m = dbs[source_db]
    cols = m.get("collections", {})
    out = {}
    if isinstance(cols, dict):
        for name, v in cols.items():
            if isinstance(v, dict):
                v = v.get("count", v.get("documents"))
            if isinstance(v, int):
                out[name] = v
    elif isinstance(cols, list):
        for c in cols:
            if isinstance(c, dict) and "name" in c and isinstance(c.get("count"), int):
                out[c["name"]] = c["count"]
    return out


def index_list(raw, source_db, coll):
    """Normalise _indexes.json entry for a collection into a list of index dicts.
    Handles {coll: {name: info}}, {coll: [info,...]} and {db: {coll: ...}}."""
    if not isinstance(raw, dict):
        return []
    if source_db in raw and isinstance(raw[source_db], dict) and coll not in raw:
        raw = raw[source_db]
    info = raw.get(coll)
    if isinstance(info, dict):
        if "key" in info:
            info = [info]
        else:
            info = [{**v, "name": v.get("name", k)} for k, v in info.items() if isinstance(v, dict)]
    return [i for i in (info or []) if isinstance(i, dict) and i.get("key") is not None]


def index_keys(info):
    key = info["key"]
    pairs = list(key.items()) if isinstance(key, dict) else [tuple(k) for k in key]
    if any(k == "_fts" for k, _ in pairs):  # text index -> rebuild from weights
        pairs = [(f, "text") for f in info.get("weights", {})]
    return [(k, int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v)
            for k, v in pairs]


def recreate_indexes(col, infos):
    created, failed = 0, 0
    for info in infos:
        name = info.get("name")
        if name == "_id_":
            continue
        try:
            keys = index_keys(info)
            opts = {o: info[o] for o in INDEX_OPTS if o in info}
            if any(v == "text" for _, v in keys) and "weights" in info:
                opts["weights"] = info["weights"]
            if name:
                opts["name"] = name
            col.create_index(keys, **opts)
            created += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"    ! index {name} failed: {str(exc)[:120]}")
    return created, failed


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Seed MongoDB from a CRM JSON export")
    ap.add_argument("--path", required=True)
    ap.add_argument("--source-db", default=None)
    ap.add_argument("--mongo-url", default=os.environ.get("MONGO_URL"))
    ap.add_argument("--db", default=os.environ.get("DB_NAME"))
    ap.add_argument("--drop", action="store_true")
    ap.add_argument("--skip", default="")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    if not args.mongo_url or not args.db:
        sys.exit("ERROR: need --mongo-url and --db (or MONGO_URL / DB_NAME in backend/.env).")

    if "customer-apps" in args.mongo_url:
        sys.exit("REFUSING: this looks like the Emergent shared cluster. Use your OWN database.")

    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    items = collect_json(Path(args.path))
    meta, dbs = split_export(items)
    src_dir = choose_db(dbs, args.source_db)
    source_db = src_dir[-1]
    files = dbs[src_dir]

    manifest = load_json(find_meta(meta, src_dir, "_manifest.json"))
    indexes = load_json(find_meta(meta, src_dir, "_indexes.json"))
    expected = expected_counts(manifest, source_db)
    collections = sorted(files)

    print("=" * 60)
    print(f"Source folder        : {'/'.join(src_dir)}")
    print(f"Source DB            : {manifest.get('db_name', source_db) if isinstance(manifest, dict) else source_db}")
    print(f"Exported at          : {manifest.get('exported_at', '?') if isinstance(manifest, dict) else '?'}")
    print(f"Target DB            : {args.db}")
    print(f"Drop first           : {args.drop}")
    print(f"Collections ({len(collections)})   : {', '.join(collections)}")
    if skip:
        print(f"Skipping             : {', '.join(sorted(skip))}")
    print("=" * 60)

    if not args.yes:
        if input("Continue? type 'yes': ").strip().lower() != "yes":
            sys.exit("Cancelled.")

    client = MongoClient(args.mongo_url, serverSelectionTimeoutMS=15000)
    client.admin.command("ping")
    db = client[args.db]
    print("Connected to MongoDB.\n")

    results = []
    for name in collections:
        if name in skip:
            print(f"- {name}: skipped")
            continue
        docs = parse_docs(files[name])
        if docs is None:
            print(f"- {name}: ERROR, not a valid JSON array, skipped")
            results.append((name, 0, 0, "INVALID FILE"))
            continue

        col = db[name]
        if args.drop:
            col.drop()

        inserted, dupes = 0, 0
        for i in range(0, len(docs), BATCH):
            chunk = docs[i : i + BATCH]
            try:
                res = col.insert_many(chunk, ordered=False)
                inserted += len(res.inserted_ids)
            except BulkWriteError as bwe:
                inserted += bwe.details.get("nInserted", 0)
                dupes += len(bwe.details.get("writeErrors", []))

        idx_ok, idx_fail = recreate_indexes(col, index_list(indexes, source_db, name))
        final = col.count_documents({})
        exp = expected.get(name)
        status = "OK" if exp is None or exp == final else f"MISMATCH (expected {exp})"
        print(f"- {name}: file={len(docs)} inserted={inserted} dup_skipped={dupes} "
              f"db_count={final} indexes={idx_ok}/{idx_ok + idx_fail}  [{status}]")
        results.append((name, len(docs), final, status))

    bad = [r for r in results if r[3] != "OK"]
    print("\n" + "=" * 60)
    if bad:
        print("FINISHED WITH MISMATCHES:")
        for n, f, c, s in bad:
            print(f"  {n}: file={f} db={c} -> {s}")
        print("Tip: use --drop for a clean restore, then run again.")
    else:
        print("DONE. All collection counts match the export.")
    print("Next: set MONGO_URL and DB_NAME in backend/.env, restart the backend, log in.")


if __name__ == "__main__":
    main()