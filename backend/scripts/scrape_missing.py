"""Targeted re-scrape for missing and bad policy URLs.

Uses Firecrawl's direct scrape endpoint (better anti-bot bypass)
instead of Playwright for sites behind Cloudflare.

Usage:
    cd backend && PYTHONUNBUFFERED=1 uv run python scripts/scrape_missing.py
"""

from __future__ import annotations

import csv
import logging
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings
from plaindr.pipelines.feature.content_validator import validate_content
from plaindr.pipelines.feature.date_extractor import extract_effective_date
from plaindr.pipelines.feature.refiner import clean_markdown
from plaindr.utils.hashing import md5_hash

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _policy_filename(source_url: str, policy_type: str) -> str:
    from urllib.parse import urlparse

    path = urlparse(source_url).path.strip("/").split("/")[-1] or policy_type
    slug = _slugify(path)
    return f"{slug}.md" if slug else f"{policy_type}.md"


def _infer_policy_type(url: str, csv_column: str) -> str:
    """Infer policy type from CSV column and URL."""
    col_lower = csv_column.lower()
    if "privacy" in col_lower:
        return "privacy"
    if "tos" in col_lower:
        return "tos"
    if "security" in col_lower:
        return "security"

    url_lower = url.lower()
    if "privacy" in url_lower:
        return "privacy"
    if "terms" in url_lower or "tos" in url_lower:
        return "tos"
    if "security" in url_lower:
        return "security"
    return "general"


def get_missing_urls(
    csv_path: Path,
    storage: SupabaseStorageClient,
    settings: Settings,
) -> list[dict]:
    """Find URLs from CSV that aren't in Supabase yet."""
    # Get uploaded source URLs
    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    uploaded_urls = set()
    for path in md_files:
        try:
            content = storage.download_text(settings.policies_bucket, path)
            for line in content.split("\n"):
                if line.startswith("source_url:"):
                    uploaded_urls.add(
                        line.replace("source_url:", "").strip()
                    )
                    break
        except Exception:
            pass

    # Parse CSV
    missing = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = row.get("Tool Name", "").strip()
            row.get("#", "").strip()
            category = row.get("Category", "").strip()
            main_url = row.get("URL", "").strip()

            for col in [
                "Privacy", "ToS", "Security and Complince", "Additonal"
            ]:
                val = row.get(col, "") or ""
                for url in val.strip().split("\n"):
                    url = url.strip()
                    if url and url.startswith("http") and url not in uploaded_urls:
                        missing.append({
                            "url": url,
                            "company": company,
                            "category": category,
                            "main_url": main_url,
                            "column": col,
                            "policy_type": _infer_policy_type(url, col),
                        })

    return missing


def scrape_with_firecrawl_direct(url: str, api_key: str) -> str:
    """Scrape a URL using Firecrawl's direct endpoint.

    This has better anti-bot bypass than Playwright.
    """
    from firecrawl import FirecrawlApp

    app = FirecrawlApp(api_key=api_key)
    try:
        result = app.scrape(
            url,
            formats=["markdown"],
            only_main_content=True,
        )
        markdown = result.markdown or ""
        if markdown:
            return markdown
    except Exception as e:
        logger.warning("Firecrawl scrape failed for %s: %s", url, e)
    return ""


def build_and_upload(
    url: str,
    content: str,
    company: str,
    policy_type: str,
    storage: SupabaseStorageClient,
    settings: Settings,
) -> bool:
    """Build markdown file and upload to Supabase."""
    content_hash = md5_hash(content)
    company_slug = _slugify(company)
    filename = _policy_filename(url, policy_type)

    effective_date = extract_effective_date(content)

    frontmatter = {
        "source_url": url,
        "company": company,
        "company_id": "",
        "policy_type": policy_type,
        "title": f"{company} {policy_type.replace('_', ' ').title()} Policy",
        "effective_date": (
            str(effective_date) if effective_date else None
        ),
        "scraped_at": datetime.now(UTC).isoformat(),
        "content_hash": content_hash,
        "version": 1,
        "summary": None,
    }

    header = yaml.dump(
        frontmatter, default_flow_style=False, allow_unicode=True
    )
    md_content = f"---\n{header}---\n\n{content}"

    try:
        storage.upload_policy(company_slug, filename, md_content)
        logger.info("Uploaded %s/%s", company_slug, filename)
        return True
    except Exception as e:
        logger.warning("Failed to upload %s/%s: %s", company_slug, filename, e)
        return False


def main() -> None:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    csv_path = Path(__file__).resolve().parents[2] / "Tools.csv"

    # Also re-scrape these 3 bad files
    bad_urls = [
        {"url": "https://n8n.io/privacy", "company": "n8n",
         "policy_type": "privacy", "column": "Privacy",
         "category": "", "main_url": ""},
        {"url": "https://www.resemble.ai/privacy", "company": "Resemble",
         "policy_type": "privacy", "column": "Privacy",
         "category": "", "main_url": ""},
        {"url": "https://www.jasper.ai/legal/privacy", "company": "Jasper",
         "policy_type": "privacy", "column": "Privacy",
         "category": "", "main_url": ""},
    ]

    # Delete the 3 bad files first
    bad_paths = ["n8n/privacy.md", "resemble/privacy.md", "jasper/privacy.md"]
    try:
        storage.delete(settings.policies_bucket, bad_paths)
        logger.info("Deleted 3 bad privacy files")
    except Exception:
        pass

    # Get missing URLs from CSV
    missing = get_missing_urls(csv_path, storage, settings)
    logger.info("Found %d missing URLs from CSV", len(missing))

    # Combine bad + missing (dedup)
    all_urls = {u["url"]: u for u in bad_urls}
    for m in missing:
        if m["url"] not in all_urls:
            all_urls[m["url"]] = m

    targets = list(all_urls.values())
    logger.info("Total targets to scrape: %d", len(targets))

    # Scrape using Firecrawl direct (better anti-bot)
    api_key = settings.firecrawl_api_key
    if not api_key:
        logger.error("FIRECRAWL_API_KEY not set")
        sys.exit(1)

    uploaded = 0
    failed = 0
    rejected = 0

    for i, target in enumerate(targets, 1):
        url = target["url"]
        company = target["company"]
        policy_type = target.get("policy_type", "general")

        logger.info("[%d/%d] Scraping %s", i, len(targets), url)

        raw = scrape_with_firecrawl_direct(url, api_key)
        if not raw:
            logger.warning("Empty content for %s", url)
            failed += 1
            continue

        # Clean and validate
        cleaned = clean_markdown(raw)
        result = validate_content(cleaned, url, policy_type)

        if not result.is_valid:
            logger.warning(
                "Content rejected for %s: %s", url, result.rejection_reason
            )
            rejected += 1
            continue

        # Upload
        if build_and_upload(
            url, cleaned, company, policy_type, storage, settings
        ):
            uploaded += 1
        else:
            failed += 1

    logger.info(
        "Done. Uploaded: %d, Rejected: %d, Failed: %d (out of %d)",
        uploaded, rejected, failed, len(targets),
    )


if __name__ == "__main__":
    main()
