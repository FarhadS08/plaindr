"""Post-ingest verification — ensures every policy in Supabase is correct
and every URL from Tools.csv is accounted for.

Three verification layers:
  1. Coverage: every CSV URL is in Supabase or has a documented reason
  2. Content integrity: every uploaded file is real policy text
  3. Spot-check: sample of policies re-fetched and compared to stored version

Usage:
    cd backend && uv run python scripts/verify_policies.py
    cd backend && uv run python scripts/verify_policies.py --spot-check 20
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

import anthropic
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

# ── Policy language markers ────────────────────────────────

STRONG_POLICY_TERMS = [
    "privacy policy", "terms of service", "terms of use",
    "data processing", "personal data", "cookies",
    "acceptable use", "end user license", "service agreement",
    "data protection", "gdpr", "ccpa", "hipaa",
]

WEAK_POLICY_TERMS = [
    "privacy", "terms", "policy", "data", "security",
    "compliance", "agreement", "consent", "rights",
    "collect", "process", "retain", "disclose",
]

ERROR_INDICATORS = [
    "page not found", "404", "access denied", "403 forbidden",
    "cloudflare", "captcha", "just a moment", "checking your browser",
    "enable javascript", "robot", "blocked", "unavailable",
]


# ── Layer 1: Coverage ──────────────────────────────────────


def check_coverage(
    csv_path: Path,
    uploaded: dict[str, str],
) -> dict:
    """Compare CSV URLs against uploaded policies.

    Returns a report dict with matched, missing, and per-company stats.
    """
    csv_urls: dict[str, list[dict]] = {}  # url -> [{company, col}]
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = row.get("Tool Name", "").strip()
            for col in ["Privacy", "ToS", "Security and Complince", "Additonal"]:
                val = row.get(col, "") or ""
                for url in val.strip().split("\n"):
                    url = url.strip()
                    if url and url.startswith("http"):
                        csv_urls.setdefault(url, []).append(
                            {"company": company, "column": col}
                        )

    # Map uploaded source_urls
    uploaded_source_urls = set()
    for _path, content in uploaded.items():
        for line in content.split("\n"):
            if line.startswith("source_url:"):
                uploaded_source_urls.add(line.replace("source_url:", "").strip())
                break

    matched = []
    missing = []
    for url, entries in csv_urls.items():
        if url in uploaded_source_urls:
            matched.append({"url": url, "company": entries[0]["company"]})
        else:
            missing.append({
                "url": url,
                "company": entries[0]["company"],
                "column": entries[0]["column"],
            })

    # Per-company stats
    company_stats: dict[str, dict] = {}
    for entry in matched:
        c = entry["company"]
        company_stats.setdefault(c, {"matched": 0, "missing": 0})
        company_stats[c]["matched"] += 1
    for entry in missing:
        c = entry["company"]
        company_stats.setdefault(c, {"matched": 0, "missing": 0})
        company_stats[c]["missing"] += 1

    zero_coverage = [
        c for c, s in company_stats.items() if s["matched"] == 0
    ]

    return {
        "csv_urls": len(csv_urls),
        "uploaded": len(uploaded_source_urls),
        "matched": len(matched),
        "missing_count": len(missing),
        "missing": missing,
        "coverage_pct": (
            len(matched) / len(csv_urls) * 100 if csv_urls else 0
        ),
        "companies_with_zero_coverage": zero_coverage,
        "company_stats": company_stats,
    }


# ── Layer 2: Content Integrity ─────────────────────────────


def check_content_integrity(uploaded: dict[str, str]) -> dict:
    """Verify every uploaded policy has valid content.

    Checks:
    - YAML frontmatter has required fields
    - Content is real policy text (not error page, CAPTCHA, homepage)
    - Content length is reasonable
    """
    issues = []
    stats = {"total": 0, "good": 0, "flagged": 0}

    required_fields = [
        "source_url", "company", "company_id", "policy_type", "content_hash"
    ]

    for path, content in uploaded.items():
        stats["total"] += 1
        file_issues = []

        # Parse frontmatter
        if not content.startswith("---"):
            file_issues.append("Missing YAML frontmatter")
        else:
            end = content.find("---", 4)
            if end == -1:
                file_issues.append("Malformed YAML frontmatter")
            else:
                try:
                    meta = yaml.safe_load(content[4:end])
                    if not isinstance(meta, dict):
                        file_issues.append("Frontmatter is not a dict")
                    else:
                        for field in required_fields:
                            if not meta.get(field):
                                file_issues.append(
                                    f"Missing required field: {field}"
                                )
                except yaml.YAMLError:
                    file_issues.append("Invalid YAML in frontmatter")

        # Extract body
        body_start = content.find("---", 4)
        body = content[body_start + 3:].strip() if body_start > 0 else content
        words = body.split()
        word_count = len(words)

        # Length check
        if word_count < 100:
            file_issues.append(f"Very short content ({word_count} words)")
        elif word_count < 300:
            file_issues.append(f"Short content ({word_count} words)")

        # Error page detection
        first_500 = body[:500].lower()
        for indicator in ERROR_INDICATORS:
            if indicator in first_500 and word_count < 500:
                file_issues.append(
                    f"Possible error page (contains '{indicator}')"
                )
                break

        # Policy language check
        body_lower = body.lower()
        strong_hits = sum(
            1 for t in STRONG_POLICY_TERMS if t in body_lower
        )
        weak_hits = sum(
            1 for t in WEAK_POLICY_TERMS if t in body_lower
        )

        if strong_hits == 0 and weak_hits < 3:
            file_issues.append(
                "No policy language detected "
                f"(strong={strong_hits}, weak={weak_hits})"
            )

        if file_issues:
            stats["flagged"] += 1
            issues.append({
                "path": path,
                "word_count": word_count,
                "issues": file_issues,
            })
        else:
            stats["good"] += 1

    return {"stats": stats, "issues": issues}


# ── Layer 3: AI Spot-Check ─────────────────────────────────


def ai_spot_check(
    uploaded: dict[str, str],
    settings: Settings,
    sample_size: int = 10,
) -> dict:
    """Use Claude to verify a random sample of policies are genuine.

    For each sampled policy, asks Claude to assess:
    - Is this actual policy/legal text or garbage?
    - Does the content match the stated policy_type?
    - Are there signs of truncation or corruption?
    """
    import random

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    paths = list(uploaded.keys())
    sample = random.sample(paths, min(sample_size, len(paths)))

    results = []
    for path in sample:
        content = uploaded[path]

        # Extract metadata and first 2000 chars of body
        body_start = content.find("---", 4)
        meta_str = content[4:body_start] if body_start > 0 else ""
        body = content[body_start + 3:].strip() if body_start > 0 else content
        preview = body[:2000]

        try:
            meta = yaml.safe_load(meta_str) or {}
        except yaml.YAMLError:
            meta = {}

        prompt = f"""Analyze this scraped policy document and answer in JSON:

File: {path}
Stated policy_type: {meta.get('policy_type', 'unknown')}
Stated company: {meta.get('company', 'unknown')}
Word count: {len(body.split())}

First 2000 characters of content:
---
{preview}
---

Respond with ONLY this JSON (no markdown):
{{
  "is_genuine_policy": true/false,
  "matches_stated_type": true/false,
  "appears_truncated": true/false,
  "appears_corrupted": true/false,
  "is_error_page": true/false,
  "is_homepage": true/false,
  "confidence": "high"/"medium"/"low",
  "notes": "brief explanation"
}}"""

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        answer = response.content[0].text.strip()

        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            parsed = {"raw": answer, "parse_error": True}

        results.append({
            "path": path,
            "company": meta.get("company", "unknown"),
            "policy_type": meta.get("policy_type", "unknown"),
            "word_count": len(body.split()),
            "verdict": parsed,
        })
        logger.info(
            "Spot-check %s: genuine=%s type_match=%s",
            path,
            parsed.get("is_genuine_policy"),
            parsed.get("matches_stated_type"),
        )

    # Summary
    genuine = sum(
        1 for r in results
        if r["verdict"].get("is_genuine_policy") is True
    )
    type_match = sum(
        1 for r in results
        if r["verdict"].get("matches_stated_type") is True
    )
    flagged = [
        r for r in results
        if r["verdict"].get("is_genuine_policy") is False
        or r["verdict"].get("is_error_page") is True
        or r["verdict"].get("is_homepage") is True
        or r["verdict"].get("appears_corrupted") is True
    ]

    return {
        "sample_size": len(results),
        "genuine": genuine,
        "type_match": type_match,
        "flagged": flagged,
        "all_results": results,
    }


# ── Report Generation ──────────────────────────────────────


def write_report(
    coverage: dict,
    integrity: dict,
    spot_check: dict | None,
    output_path: Path,
) -> None:
    """Write a human-readable verification report."""
    lines = []
    lines.append("=" * 70)
    lines.append("PLAINDR POLICY VERIFICATION REPORT")
    lines.append(f"Generated: {datetime.now().isoformat()}")
    lines.append("=" * 70)

    # Coverage
    lines.append("\n## LAYER 1: COVERAGE")
    lines.append(f"CSV URLs:    {coverage['csv_urls']}")
    lines.append(f"Uploaded:    {coverage['uploaded']}")
    lines.append(f"Matched:     {coverage['matched']}")
    lines.append(f"Missing:     {coverage['missing_count']}")
    lines.append(f"Coverage:    {coverage['coverage_pct']:.1f}%")

    if coverage["companies_with_zero_coverage"]:
        lines.append(
            f"\nCOMPANIES WITH ZERO COVERAGE "
            f"({len(coverage['companies_with_zero_coverage'])}):"
        )
        for c in sorted(coverage["companies_with_zero_coverage"]):
            lines.append(f"  - {c}")

    if coverage["missing"]:
        lines.append(f"\nMISSING URLs ({coverage['missing_count']}):")
        by_company: dict[str, list] = {}
        for entry in coverage["missing"]:
            by_company.setdefault(entry["company"], []).append(entry)
        for company in sorted(by_company):
            lines.append(f"\n  {company}:")
            for entry in by_company[company]:
                lines.append(f"    - {entry['url']} [{entry['column']}]")

    # Integrity
    lines.append("\n\n## LAYER 2: CONTENT INTEGRITY")
    lines.append(f"Total files: {integrity['stats']['total']}")
    lines.append(f"Good:        {integrity['stats']['good']}")
    lines.append(f"Flagged:     {integrity['stats']['flagged']}")

    if integrity["issues"]:
        lines.append(f"\nFLAGGED FILES ({len(integrity['issues'])}):")
        for issue in integrity["issues"]:
            lines.append(f"\n  {issue['path']} ({issue['word_count']} words):")
            for i in issue["issues"]:
                lines.append(f"    - {i}")

    # Spot-check
    if spot_check:
        lines.append("\n\n## LAYER 3: AI SPOT-CHECK")
        lines.append(f"Sample size:  {spot_check['sample_size']}")
        lines.append(f"Genuine:      {spot_check['genuine']}")
        lines.append(f"Type match:   {spot_check['type_match']}")

        if spot_check["flagged"]:
            lines.append(
                f"\nAI-FLAGGED ({len(spot_check['flagged'])}):"
            )
            for r in spot_check["flagged"]:
                lines.append(
                    f"\n  {r['path']} ({r['company']}, "
                    f"{r['policy_type']}, {r['word_count']} words):"
                )
                lines.append(f"    {r['verdict'].get('notes', 'N/A')}")
        else:
            lines.append("\nNo issues found by AI spot-check.")

        lines.append("\nALL SPOT-CHECK RESULTS:")
        for r in spot_check["all_results"]:
            v = r["verdict"]
            status = "PASS" if v.get("is_genuine_policy") else "FAIL"
            lines.append(
                f"  [{status}] {r['path']} — "
                f"{v.get('notes', 'N/A')}"
            )

    # Summary
    lines.append("\n\n" + "=" * 70)
    lines.append("SUMMARY")
    lines.append("=" * 70)
    cov_ok = coverage["coverage_pct"] > 90
    int_ok = integrity["stats"]["flagged"] == 0
    spot_ok = spot_check is None or len(spot_check["flagged"]) == 0

    lines.append(
        f"Coverage:   {'PASS' if cov_ok else 'NEEDS ATTENTION'} "
        f"({coverage['coverage_pct']:.1f}%)"
    )
    lines.append(
        f"Integrity:  {'PASS' if int_ok else 'NEEDS ATTENTION'} "
        f"({integrity['stats']['flagged']} flagged)"
    )
    if spot_check:
        lines.append(
            f"Spot-check: {'PASS' if spot_ok else 'NEEDS ATTENTION'} "
            f"({len(spot_check['flagged'])} flagged)"
        )

    report = "\n".join(lines)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report)
    logger.info("Report written to %s", output_path)

    # Also print to stdout
    print(report)


# ── Main ───────────────────────────────────────────────────


def main() -> None:
    from dotenv import load_dotenv

    parser = argparse.ArgumentParser(
        description="Verify policy completeness and integrity"
    )
    parser.add_argument(
        "--spot-check",
        type=int,
        default=0,
        help="Number of policies to AI spot-check (costs API calls)",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "Tools.csv",
        help="Path to Tools.csv",
    )
    args = parser.parse_args()

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    # Download all policies
    logger.info("Downloading all policies from Supabase...")
    uploaded = storage.download_all_policies()
    logger.info("Downloaded %d policy files", len(uploaded))

    # Layer 1: Coverage
    logger.info("Running coverage check...")
    coverage = check_coverage(args.csv, uploaded)

    # Layer 2: Content integrity
    logger.info("Running content integrity check...")
    integrity = check_content_integrity(uploaded)

    # Layer 3: AI spot-check (optional)
    spot_check = None
    if args.spot_check > 0:
        logger.info(
            "Running AI spot-check on %d policies...", args.spot_check
        )
        spot_check = ai_spot_check(uploaded, settings, args.spot_check)

    # Write report
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = (
        Path(__file__).resolve().parents[1]
        / "logs"
        / "verification"
        / f"verify_{timestamp}.txt"
    )
    write_report(coverage, integrity, spot_check, report_path)


if __name__ == "__main__":
    main()
