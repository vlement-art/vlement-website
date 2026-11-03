#!/usr/bin/env python3
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path


def d1_table_row_counts(sql_file: Path) -> dict[str, int]:
    sql = sql_file.read_text(encoding="utf-8")
    if not re.search(r"\bCREATE\s+TABLE\b", sql, re.IGNORECASE):
        raise ValueError("D1 export has no CREATE TABLE statements.")

    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql)
        names = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        if not names:
            raise ValueError("D1 export did not create any user tables.")
        counts = {}
        for (name,) in names:
            quoted_name = '"' + name.replace('"', '""') + '"'
            counts[name] = connection.execute(
                f"SELECT COUNT(*) FROM {quoted_name}"
            ).fetchone()[0]
        return counts
    finally:
        connection.close()


def verify_manifest(backup_dir: Path) -> None:
    manifest_path = backup_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_files = manifest.get("files")
    if not isinstance(expected_files, list):
        raise ValueError("Manifest files list is missing or invalid.")

    actual_paths = {
        path.relative_to(backup_dir).as_posix()
        for path in backup_dir.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    }
    expected_paths = {item["path"] for item in expected_files}
    if actual_paths != expected_paths:
        raise ValueError("Manifest file list does not match the extracted backup.")

    total_size = 0
    for item in expected_files:
        path = backup_dir / item["path"]
        contents = path.read_bytes()
        if len(contents) != item["size_bytes"]:
            raise ValueError(f"File size mismatch for {item['path']}.")
        if hashlib.sha256(contents).hexdigest() != item["sha256"]:
            raise ValueError(f"SHA-256 mismatch for {item['path']}.")
        total_size += len(contents)

    if manifest.get("file_count") != len(expected_files):
        raise ValueError("Manifest file count does not match the extracted backup.")
    if manifest.get("total_size_bytes") != total_size:
        raise ValueError("Manifest total size does not match the extracted backup.")
    if not (backup_dir / "repo.bundle").is_file():
        raise ValueError("The repository bundle is missing.")

    d1_file = backup_dir / "d1.sql"
    row_counts = d1_table_row_counts(d1_file) if d1_file.is_file() else {}
    if manifest.get("d1_table_row_counts", {}) != row_counts:
        raise ValueError("D1 restore-test row counts do not match the manifest.")
    r2_dir = backup_dir / "r2-files"
    r2_file_count = sum(path.is_file() for path in r2_dir.rglob("*")) if r2_dir.exists() else 0
    if manifest.get("r2_file_count") != r2_file_count:
        raise ValueError("R2 file count does not match the manifest.")
    print(f"Manifest verified: {len(expected_files)} payload files, {r2_file_count} R2 files.")


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--verify":
        verify_manifest(Path(sys.argv[2]).resolve())
        return
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: create-backup-manifest.py BACKUP_DIR UTC_DATE GIT_COMMIT "
            "or create-backup-manifest.py --verify BACKUP_DIR"
        )

    backup_dir = Path(sys.argv[1]).resolve()
    backup_date, git_commit = sys.argv[2:]
    if not (backup_dir / "repo.bundle").is_file():
        raise ValueError("The repository bundle is missing.")

    d1_file = backup_dir / "d1.sql"
    row_counts = d1_table_row_counts(d1_file) if d1_file.is_file() else {}
    r2_dir = backup_dir / "r2-files"
    r2_file_count = sum(path.is_file() for path in r2_dir.rglob("*")) if r2_dir.exists() else 0
    payload_files = sorted(
        path for path in backup_dir.rglob("*")
        if path.is_file() and path.name != "manifest.json"
    )
    files = []
    for path in payload_files:
        contents = path.read_bytes()
        files.append({
            "path": path.relative_to(backup_dir).as_posix(),
            "size_bytes": len(contents),
            "sha256": hashlib.sha256(contents).hexdigest(),
        })

    manifest = {
        "backup_date_utc": backup_date,
        "git_commit": git_commit,
        "file_count": len(files),
        "total_size_bytes": sum(item["size_bytes"] for item in files),
        "r2_file_count": r2_file_count,
        "d1_table_row_counts": row_counts,
        "files": files,
        "manifest_note": "Hashes cover every payload file except this manifest, which cannot contain its own hash.",
    }
    manifest_path = backup_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if d1_file.is_file():
        restored_counts = d1_table_row_counts(d1_file)
        if restored_counts != manifest["d1_table_row_counts"]:
            raise ValueError("D1 restore-test row counts do not match the manifest.")
        print(f"Local in-memory D1 restore test passed for {len(restored_counts)} tables.")
    verify_manifest(backup_dir)


if __name__ == "__main__":
    main()
