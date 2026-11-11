import csv
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("backup_sales", "scripts/export-backup-sales.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupSalesTest(unittest.TestCase):
    def test_exports_snapshot_and_neutralizes_formulas(self):
        connection = sqlite3.connect(":memory:")
        connection.executescript("""
            CREATE TABLE sales (
              id TEXT, created_at TEXT, sale_number TEXT, sale_date TEXT, artwork_slug TEXT,
              item_type TEXT, edition_number INTEGER, open_edition_number INTEGER,
              buyer_name TEXT, buyer_email TEXT, price REAL, currency TEXT, status TEXT, notes TEXT
            );
            INSERT INTO sales VALUES (
              'id', '2026-01-01', 'S-1', '2026-01-01', 'art', 'original', NULL, NULL,
              '=danger', NULL, 12.5, 'GBP', 'active', ' @danger'
            );
        """)
        with tempfile.TemporaryDirectory() as directory:
            sql = Path(directory) / "d1.sql"
            output = Path(directory) / "sales.csv"
            sql.write_text("\n".join(connection.iterdump()), encoding="utf-8")
            module.export_sales(sql, output)
            with output.open(encoding="utf-8", newline="") as file:
                row = next(csv.DictReader(file))
            self.assertEqual(row["buyer_name"], "'=danger")
            self.assertEqual(row["notes"], "' @danger")
            self.assertEqual(row["price"], "12.5")
            self.assertEqual(row["receipt_printed_at"], "")
        connection.close()


if __name__ == "__main__":
    unittest.main()
