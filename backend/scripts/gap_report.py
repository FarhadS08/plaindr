"""Per-company coverage gap report.

For each company in Tools.csv, shows which policy types are covered
and which are missing (with the specific URL that failed).

Usage:
    cd backend && uv run python scripts/gap_report.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings


def _classify_url(url: str, column: str) -> str:
    """Infer policy type. CSV column is the authoritative signal."""
    col = column.lower()
    # CSV column wins — it's how the user categorized the URL
    if col == "privacy":
        return "privacy"
    if col == "tos":
        return "tos"
    if "security" in col:
        return "security"
    # Additonal column — fall back to URL heuristics
    u = url.lower()
    if "privacy" in u:
        return "privacy"
    if "terms" in u or "/tos" in u or "/legal" in u:
        return "tos"
    if "security" in u or "trust" in u:
        return "security"
    return "other"


def main() -> None:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)
    csv_path = Path(__file__).resolve().parents[2] / "Tools.csv"

    # Load all uploaded policies with their source URLs
    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    uploaded_urls: set[str] = set()
    for path in md_files:
        try:
            content = storage.download_text(
                settings.policies_bucket, path
            )
            for line in content.split("\n"):
                if line.startswith("source_url:"):
                    uploaded_urls.add(
                        line.replace("source_url:", "").strip()
                    )
                    break
        except Exception:
            pass

    # Parse CSV and classify URLs per company
    company_coverage: dict[str, dict] = {}

    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = row.get("Tool Name", "").strip()
            if not company:
                continue

            cov = company_coverage.setdefault(
                company,
                {
                    "privacy": {"matched": [], "missing": []},
                    "tos": {"matched": [], "missing": []},
                    "security": {"matched": [], "missing": []},
                    "other": {"matched": [], "missing": []},
                },
            )

            for col in ["Privacy", "ToS", "Security and Complince", "Additonal"]:
                val = row.get(col, "") or ""
                for url in val.strip().split("\n"):
                    url = url.strip()
                    if url and url.startswith("http"):
                        ptype = _classify_url(url, col)
                        bucket = (
                            "matched" if url in uploaded_urls else "missing"
                        )
                        cov[ptype][bucket].append(url)

    # Build report
    print("=" * 80)
    print("PLAINDR PER-COMPANY COVERAGE GAP REPORT")
    print("=" * 80)
    print()

    full_coverage = []
    partial_coverage = []
    zero_coverage = []

    for company in sorted(company_coverage.keys()):
        cov = company_coverage[company]
        total = sum(
            len(cov[t]["matched"]) + len(cov[t]["missing"])
            for t in ["privacy", "tos", "security", "other"]
        )
        matched_total = sum(
            len(cov[t]["matched"])
            for t in ["privacy", "tos", "security", "other"]
        )

        if total == 0:
            continue

        has_privacy = bool(cov["privacy"]["matched"])
        has_tos = bool(cov["tos"]["matched"])
        has_security = bool(cov["security"]["matched"])

        if matched_total == 0:
            zero_coverage.append(company)
        elif matched_total == total:
            full_coverage.append(company)
        else:
            partial_coverage.append(company)

        # Print company section
        status_icon = (
            "FULL" if matched_total == total
            else "NONE" if matched_total == 0
            else "PART"
        )
        print(
            f"[{status_icon}] {company} "
            f"({matched_total}/{total} URLs)"
        )
        print(
            f"  privacy:  {'YES' if has_privacy else 'NO '}  "
            f"tos: {'YES' if has_tos else 'NO '}  "
            f"security: {'YES' if has_security else 'NO '}"
        )

        for ptype in ["privacy", "tos", "security", "other"]:
            missing = cov[ptype]["missing"]
            if missing:
                print(f"  missing {ptype}:")
                for url in missing:
                    print(f"    - {url}")
        print()

    # Summary
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    total_companies = len(company_coverage)
    print(f"Total companies: {total_companies}")
    print(
        f"  Full coverage:    {len(full_coverage)} "
        f"({len(full_coverage)/total_companies*100:.0f}%)"
    )
    print(
        f"  Partial coverage: {len(partial_coverage)} "
        f"({len(partial_coverage)/total_companies*100:.0f}%)"
    )
    print(
        f"  Zero coverage:    {len(zero_coverage)} "
        f"({len(zero_coverage)/total_companies*100:.0f}%)"
    )

    print("\nZERO COVERAGE COMPANIES (cannot be queried at all):")
    for c in zero_coverage:
        print(f"  - {c}")

    print("\nCOMPANIES MISSING PRIVACY POLICY:")
    for company in sorted(company_coverage.keys()):
        cov = company_coverage[company]
        has_privacy_urls = bool(
            cov["privacy"]["matched"] or cov["privacy"]["missing"]
        )
        if has_privacy_urls and not cov["privacy"]["matched"]:
            print(f"  - {company}")

    print("\nCOMPANIES MISSING TERMS OF SERVICE:")
    for company in sorted(company_coverage.keys()):
        cov = company_coverage[company]
        has_tos_urls = bool(
            cov["tos"]["matched"] or cov["tos"]["missing"]
        )
        if has_tos_urls and not cov["tos"]["matched"]:
            print(f"  - {company}")


if __name__ == "__main__":
    main()
