"""Restore a CRM export zip (produced by GET /api/admin/export-database) into MongoDB.

The export zip stores every database/collection as `<db_name>/<collection>.json`
(Extended JSON via bson.json_util), plus `_manifest.json` and `_indexes.json`.

Usage:
    # restore every database exactly as exported (preserves source db names):
    python restore_from_export.py --zip crm_export_xxx.zip --mongo-url "mongodb+srv://..." [--drop]

    # OR force EVERYTHING into a single target database (consolidate):
    python restore_from_export.py --zip crm_export_xxx.zip --mongo-url "..." --db mycrm [--drop]

The Mongo URL and DB name come from CLI args or the MONGO_URL / DB_NAME env vars only.
Nothing is ever hardcoded.
"""
import argparse
import os
import zipfile
from collections import defaultdict

from bson import json_util
from pymongo import MongoClient

BATCH_SIZE = 1000


def _index_options(spec: dict) -> dict:
    allowed = ("unique", "sparse", "expireAfterSeconds", "partialFilterExpression", "collation")
    return {key: value for key, value in spec.items() if key in allowed}


def _split_entry(path: str):
    """`<db>/<collection>.json` -> (db, collection); `<collection>.json` -> (None, collection)."""
    stem = path[:-len(".json")]
    parts = stem.split("/", 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, parts[0]


def _recreate_indexes(collection, index_info: dict):
    for index_name, spec in (index_info or {}).items():
        if index_name == "_id_" or not isinstance(spec, dict) or "key" not in spec:
            continue
        keys = [(field, direction) for field, direction in spec["key"]]
        try:
            collection.create_index(keys, name=index_name, **_index_options(spec))
        except Exception as exc:  # noqa: BLE001
            print(f"  ! could not recreate index {index_name} on {collection.name}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore a CRM export zip into MongoDB.")
    parser.add_argument("--zip", required=True, help="Path to crm_export_*.zip")
    parser.add_argument("--mongo-url", default=os.environ.get("MONGO_URL"))
    parser.add_argument("--db", default=os.environ.get("DB_NAME"),
                        help="Force ALL collections into this single database. "
                             "If omitted, each collection is restored into its original database name.")
    parser.add_argument("--drop", action="store_true",
                        help="Drop each target collection before inserting")
    args = parser.parse_args()

    if not args.mongo_url:
        parser.error("Mongo URL is required (pass --mongo-url or set MONGO_URL)")

    client = MongoClient(args.mongo_url)

    with zipfile.ZipFile(args.zip) as archive:
        names = archive.namelist()
        manifest = json_util.loads(archive.read("_manifest.json")) if "_manifest.json" in names else {}
        indexes = json_util.loads(archive.read("_indexes.json")) if "_indexes.json" in names else {}
        entries = sorted(
            name for name in names
            if name.endswith(".json") and not name.split("/")[-1].startswith("_")
        )
        if not entries:
            parser.error("No <collection>.json files found in the zip")

        # restored[target_db][collection] = inserted count
        restored = defaultdict(dict)
        # map target_db/collection back to its source db for manifest comparison
        source_of = {}

        for entry in entries:
            source_db, collection_name = _split_entry(entry)
            target_db_name = args.db or source_db
            if not target_db_name:
                parser.error("Export has no database folders; pass --db to choose a target database")
            target = client[target_db_name][collection_name]
            source_of[(target_db_name, collection_name)] = source_db

            docs = json_util.loads(archive.read(entry)) or []
            if args.drop:
                target.drop()

            inserted = 0
            batch = []
            for doc in docs:
                batch.append(doc)
                if len(batch) >= BATCH_SIZE:
                    target.insert_many(batch, ordered=False)
                    inserted += len(batch)
                    batch = []
            if batch:
                target.insert_many(batch, ordered=False)
                inserted += len(batch)
            restored[target_db_name][collection_name] = inserted

            # index info is keyed by source db -> collection (new format) or collection (old format)
            if source_db and isinstance(indexes.get(source_db), dict):
                _recreate_indexes(target, (indexes.get(source_db) or {}).get(collection_name))
            else:
                _recreate_indexes(target, indexes.get(collection_name))
            print(f"{target_db_name}/{collection_name}: inserted {inserted}")

        print("\n=== verification (actual vs manifest) ===")
        manifest_dbs = manifest.get("databases") or {}
        manifest_flat = manifest.get("collections") or {}  # old single-db format
        mismatches = 0
        for target_db_name in sorted(restored):
            for collection_name in sorted(restored[target_db_name]):
                actual = client[target_db_name][collection_name].count_documents({})
                source_db = source_of[(target_db_name, collection_name)]
                if source_db and source_db in manifest_dbs:
                    expected = manifest_dbs[source_db].get(collection_name)
                else:
                    expected = manifest_flat.get(collection_name)
                if expected is not None and actual != expected:
                    mismatches += 1
                    print(f"{target_db_name}/{collection_name}: {actual}  <-- MISMATCH (manifest={expected})")
                else:
                    print(f"{target_db_name}/{collection_name}: {actual}  OK")
        print(f"\nDone. {sum(len(v) for v in restored.values())} collection(s) restored, "
              f"{mismatches} mismatch(es).")


if __name__ == "__main__":
    main()
