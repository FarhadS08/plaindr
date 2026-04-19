"""Backfill missing company_id in policy files.

The scrape_missing.py script uploaded files with empty company_id.
This script reads companies.yaml, matches by slug, and rewrites
the frontmatter with the correct UUID.

Usage:
    cd backend && uv run python scripts/backfill_company_ids.py
"""

from __future__ import annotations

import logging
import sys
import uuid
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)


def _deterministic_uuid(name: str) -> str:
    """Generate a stable UUID from a company name."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"plaindr.{name.lower()}"))


def main() -> None:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    # Load companies.yaml
    try:
        companies_yaml = storage.download_text(
            settings.policies_bucket, "companies.yaml"
        )
        companies_list = yaml.safe_load(companies_yaml) or []
    except Exception:
        companies_list = []

    # Build slug → id map
    slug_to_id = {c["slug"]: c["id"] for c in companies_list if c.get("slug")}
    name_to_id = {c["name"].lower(): c["id"] for c in companies_list if c.get("name")}

    # List all policy files
    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    fixed = 0
    skipped = 0
    companies_added = 0

    for path in md_files:
        try:
            content = storage.download_text(settings.policies_bucket, path)
        except Exception:
            continue

        if not content.startswith("---"):
            continue

        end = content.find("---", 4)
        if end == -1:
            continue

        try:
            meta = yaml.safe_load(content[4:end]) or {}
        except yaml.YAMLError:
            continue

        # Check if company_id is missing or empty
        if meta.get("company_id"):
            skipped += 1
            continue

        # Infer slug from path (e.g., "vercel/terms.md" → "vercel")
        slug = path.split("/")[0]
        company_name = meta.get("company", "").strip()

        # Try slug match first, then name match
        company_id = slug_to_id.get(slug) or name_to_id.get(
            company_name.lower()
        )

        if not company_id:
            # Create deterministic UUID and add to companies list
            company_id = _deterministic_uuid(company_name or slug)
            companies_list.append({
                "id": company_id,
                "name": company_name or slug,
                "slug": slug,
                "category": "unknown",
                "main_url": "",
                "aliases": [],
            })
            slug_to_id[slug] = company_id
            name_to_id[(company_name or slug).lower()] = company_id
            companies_added += 1

        # Rewrite frontmatter with company_id
        meta["company_id"] = company_id
        body = content[end + 3:]
        new_frontmatter = yaml.dump(
            meta, default_flow_style=False, allow_unicode=True
        )
        new_content = f"---\n{new_frontmatter}---{body}"

        # Upload back
        try:
            storage.upload_policy(
                slug,
                path.split("/", 1)[1],
                new_content,
            )
            fixed += 1
            if fixed % 20 == 0:
                logger.info("Fixed %d files so far...", fixed)
        except Exception as e:
            logger.warning("Failed to upload %s: %s", path, e)

    # Re-upload companies.yaml if we added any
    if companies_added:
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
            "Added %d new companies to companies.yaml", companies_added
        )

    logger.info(
        "Done. Fixed %d files, skipped %d (already had company_id)",
        fixed, skipped,
    )


if __name__ == "__main__":
    main()
