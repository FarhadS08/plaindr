"""Recovery pass for zero/partial coverage — use Firecrawl with JS wait.

Many sites (Notion, Phind, Bambu Lab, TurboScribe, etc.) are JS-only SPAs.
Firecrawl's default scrape returns too-short content because JS hasn't
rendered yet. This script uses waitFor to let JS execute.

Usage:
    cd backend && uv run python scripts/recover_gaps.py
"""

from __future__ import annotations

import csv
import logging
import re
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings
from plaindr.pipelines.feature.content_validator import validate_content
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
    """Build a filename including policy_type to avoid collisions."""
    from urllib.parse import urlparse
    path = urlparse(source_url).path.strip("/").split("/")[-1] or policy_type
    slug = _slugify(path)
    if not slug:
        return f"{policy_type}.md"
    # Prefix with policy_type if the slug doesn't already identify it
    # (prevents different URL paths collapsing to the same filename)
    if policy_type in slug:
        return f"{slug}.md"
    return f"{policy_type}-{slug}.md"


def _infer_policy_type(url: str, column: str) -> str:
    col = column.lower()
    if col == "privacy":
        return "privacy"
    if col == "tos":
        return "tos"
    if "security" in col:
        return "security"
    u = url.lower()
    if "privacy" in u:
        return "privacy"
    if "terms" in u or "/tos" in u:
        return "tos"
    if "security" in u or "trust" in u:
        return "security"
    return "general"


def _deterministic_uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"plaindr.{name.lower()}"))


def scrape_with_js_wait(url: str, api_key: str) -> str:
    """Scrape with JS wait + cookie dismissal actions."""
    from firecrawl import FirecrawlApp
    app = FirecrawlApp(api_key=api_key)
    try:
        result = app.scrape(
            url,
            formats=["markdown"],
            only_main_content=True,
            wait_for=5000,
            timeout=60000,
        )
        markdown = result.markdown or ""
        return markdown
    except Exception as e:
        logger.warning("JS-wait scrape failed for %s: %s", url, e)
        return ""


def get_missing_urls(
    csv_path: Path,
    storage: SupabaseStorageClient,
    settings: Settings,
) -> list[dict]:
    """Find all CSV URLs NOT yet in Supabase."""
    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    uploaded: set[str] = set()
    for path in md_files:
        try:
            content = storage.download_text(
                settings.policies_bucket, path
            )
            for line in content.split("\n"):
                if line.startswith("source_url:"):
                    uploaded.add(
                        line.replace("source_url:", "").strip()
                    )
                    break
        except Exception:
            pass

    missing = []
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = row.get("Tool Name", "").strip()
            if not company:
                continue
            for col in [
                "Privacy", "ToS", "Security and Complince", "Additonal"
            ]:
                val = row.get(col, "") or ""
                for url in val.strip().split("\n"):
                    url = url.strip()
                    if url and url.startswith("http") and url not in uploaded:
                        missing.append({
                            "url": url,
                            "company": company,
                            "column": col,
                            "policy_type": _infer_policy_type(url, col),
                        })
    return missing


def main() -> None:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)
    csv_path = Path(__file__).resolve().parents[2] / "Tools.csv"

    missing = get_missing_urls(csv_path, storage, settings)
    logger.info("Found %d missing URLs", len(missing))

    # Load companies.yaml to look up company_id
    try:
        companies_yaml = storage.download_text(
            settings.policies_bucket, "companies.yaml"
        )
        companies_list = yaml.safe_load(companies_yaml) or []
    except Exception:
        companies_list = []

    name_to_id = {
        c["name"].lower(): c["id"]
        for c in companies_list if c.get("name")
    }

    api_key = settings.firecrawl_api_key
    if not api_key:
        logger.error("FIRECRAWL_API_KEY missing")
        sys.exit(1)

    uploaded = 0
    rejected = 0
    failed = 0
    new_companies = []

    for i, m in enumerate(missing, 1):
        url = m["url"]
        company = m["company"]
        policy_type = m["policy_type"]

        logger.info("[%d/%d] %s — %s", i, len(missing), company, url)

        raw = scrape_with_js_wait(url, api_key)
        if not raw:
            failed += 1
            continue

        cleaned = clean_markdown(raw)
        result = validate_content(cleaned, url, policy_type)

        if not result.is_valid:
            logger.info(
                "  rejected: %s", result.rejection_reason
            )
            rejected += 1
            continue

        # Get company_id
        company_id = name_to_id.get(company.lower())
        if not company_id:
            company_id = _deterministic_uuid(company)
            name_to_id[company.lower()] = company_id
            new_companies.append({
                "id": company_id,
                "name": company,
                "slug": _slugify(company),
                "category": "unknown",
                "main_url": "",
                "aliases": [],
            })

        content_hash = md5_hash(cleaned)
        frontmatter = {
            "source_url": url,
            "company": company,
            "company_id": company_id,
            "policy_type": policy_type,
            "title": f"{company} {policy_type.title()} Policy",
            "effective_date": None,
            "scraped_at": datetime.now(UTC).isoformat(),
            "content_hash": content_hash,
            "version": 1,
            "summary": None,
        }
        header = yaml.dump(
            frontmatter, default_flow_style=False, allow_unicode=True
        )
        md_content = f"---\n{header}---\n\n{cleaned}"

        slug = _slugify(company)
        filename = _policy_filename(url, policy_type)
        try:
            storage.upload_policy(slug, filename, md_content)
            logger.info("  UPLOADED %s/%s (%d words)",
                        slug, filename, len(cleaned.split()))
            uploaded += 1
        except Exception as e:
            logger.warning("  upload failed: %s", e)
            failed += 1

    # Update companies.yaml if new companies added
    if new_companies:
        companies_list.extend(new_companies)
        yaml_content = yaml.dump(
            companies_list, default_flow_style=False, allow_unicode=True
        )
        storage.upload(
            settings.policies_bucket,
            "companies.yaml",
            yaml_content.encode("utf-8"),
            content_type="text/yaml",
        )
        logger.info(
            "Added %d new companies to registry", len(new_companies)
        )

    logger.info(
        "Done. Uploaded %d, rejected %d, failed %d (out of %d)",
        uploaded, rejected, failed, len(missing),
    )


if __name__ == "__main__":
    main()
