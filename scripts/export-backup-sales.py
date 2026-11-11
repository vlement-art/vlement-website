#!/usr/bin/env python3
import csv
import sqlite3
import sys
from pathlib import Path


def export_sales(sql_path: Path, csv_path: Path) -> None:
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(sql_path.read_text(encoding="utf-8"))
        columns = [row[1] for row in connection.execute("PRAGMA table_info(sales)")]
        if not columns:
            raise ValueError("The D1 backup does not contain a sales table.")
        selected = [
            "sale_number", "sale_date", "artwork_slug", "item_type", "edition_number",
            "open_edition_number", "buyer_name", "buyer_email", "price", "currency",
            "status", "notes", "receipt_printed_at", "receipt_emailed_at",
        ]
        missing = set(selected) - set(columns) - {"receipt_printed_at", "receipt_emailed_at"}
        if missing:
            raise ValueError(f"The D1 sales table is missing columns: {', '.join(sorted(missing))}")
        expressions = [f'"{name}"' if name in columns else f'NULL AS "{name}"' for name in selected]
        rows = connection.execute(
            f'SELECT {", ".join(expressions)} FROM sales ORDER BY created_at, id'
        )
        with csv_path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(selected)
            for row in rows:
                writer.writerow([
                    "'" + value if isinstance(value, str) and (
                        value.startswith(("\t", "\r", "\n"))
                        or value.lstrip().startswith(("=", "+", "-", "@"))
                    )
                    else value
                    for value in row
                ])
    finally:
        connection.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: export-backup-sales.py D1_SQL OUTPUT_CSV")
    export_sales(Path(sys.argv[1]), Path(sys.argv[2]))
