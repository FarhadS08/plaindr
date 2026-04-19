"""Generate a complete inventory of every policy in Supabase as CSV.

Opens in Excel/Numbers/Sheets for manual verification.
One row per file with company, type, source URL, word count, upload date.

Usage:
    cd backend && uv run python scripts/inventory.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings


def main() -> None:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    public_base = (
        f"{settings.supabase_url}/storage/v1/object/public/"
        f"{settings.policies_bucket}"
    )

    files = storage.list_files(settings.policies_bucket)
    md_files = sorted(
        [f for f in files if f["name"].endswith(".md")],
        key=lambda f: f["name"],
    )

    output_path = Path("/tmp/plaindr-overnight/inventory.csv")

    rows = []
    for f in md_files:
        path = f["name"]
        try:
            content = storage.download_text(
                settings.policies_bucket, path
            )
        except Exception:
            rows.append({
                "path": path, "company": "", "policy_type": "",
                "source_url": "", "title": "", "word_count": 0,
                "size_bytes": f.get("metadata", {}).get("size", 0),
                "uploaded_at": f.get("updated_at", ""),
                "content_hash": "", "effective_date": "",
                "status": "DOWNLOAD_FAILED",
            })
            continue

        meta: dict = {}
        body = ""
        if content.startswith("---"):
            end = content.find("---", 4)
            if end > 0:
                try:
                    meta = yaml.safe_load(content[4:end]) or {}
                except yaml.YAMLError:
                    meta = {}
                body = content[end + 3:].strip()
            else:
                body = content
        else:
            body = content

        word_count = len(body.split())

        # Status heuristics
        status = "OK"
        if word_count < 100:
            status = "SHORT"
        elif word_count < 300:
            status = "SHORT_FAQ"
        if not meta.get("source_url"):
            status = "NO_SOURCE_URL"
        if not meta.get("company_id"):
            status = "NO_COMPANY_ID"

        rows.append({
            "company": meta.get("company", ""),
            "policy_type": meta.get("policy_type", ""),
            "word_count": word_count,
            "status": status,
            "supabase_url": f"{public_base}/{path}",
            "source_url": meta.get("source_url", ""),
            "path": path,
            "title": meta.get("title", ""),
            "size_bytes": f.get("metadata", {}).get("size", 0),
            "uploaded_at": f.get("updated_at", ""),
            "content_hash": meta.get("content_hash", ""),
            "effective_date": meta.get("effective_date", ""),
        })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")
    print()
    print("Status breakdown:")
    statuses: dict[str, int] = {}
    for r in rows:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    for s, c in sorted(statuses.items(), key=lambda x: -x[1]):
        print(f"  {s}: {c}")

    print()
    print("Companies (with policy count):")
    company_counts: dict[str, int] = {}
    for r in rows:
        c = r["company"] or r["path"].split("/")[0]
        company_counts[c] = company_counts.get(c, 0) + 1
    for c in sorted(company_counts.keys()):
        print(f"  {c}: {company_counts[c]}")


if __name__ == "__main__":
    main()
