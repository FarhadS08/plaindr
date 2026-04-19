"""One-time migration: export MongoDB data to Supabase Storage as Markdown files.

Usage:
    cd backend && uv run python scripts/migrate_to_storage.py

Requires both MONGODB_URI and SUPABASE_URL/SUPABASE_SERVICE_KEY in .env.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from pymongo import MongoClient

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _policy_filename(source_url: str, policy_type: str) -> str:
    from urllib.parse import urlparse

    path = urlparse(source_url).path.strip("/").split("/")[-1] or policy_type
    slug = _slugify(path)
    return f"{slug}.md" if slug else f"{policy_type}.md"


def migrate(mongo_uri: str, mongo_db: str, settings: Settings) -> None:
    """Export MongoDB data to Supabase Storage."""
    client = MongoClient(mongo_uri)
    db = client[mongo_db]
    storage = SupabaseStorageClient(settings)

    # 1. Export companies
    companies_raw = list(db.companies.find({}, {"_id": 0}))
    logger.info("Found %d companies in MongoDB", len(companies_raw))

    company_map: dict[str, dict] = {}
    companies_yaml = []
    for c in companies_raw:
        cid = str(c.get("id", ""))
        name = c.get("name", "Unknown")
        slug = _slugify(name)
        company_map[cid] = {"name": name, "slug": slug}
        companies_yaml.append({
            "id": cid,
            "name": name,
            "slug": slug,
            "category": c.get("category", ""),
            "main_url": str(c.get("main_url", "")),
            "aliases": [],
        })

    yaml_content = yaml.dump(
        companies_yaml, default_flow_style=False, allow_unicode=True
    )
    storage.upload(
        settings.policies_bucket,
        "companies.yaml",
        yaml_content.encode(),
        content_type="text/yaml",
    )
    logger.info("Uploaded companies.yaml (%d companies)", len(companies_yaml))

    # 2. Export policies as .md files
    policies_raw = list(db.policies.find({}, {"_id": 0}))
    logger.info("Found %d policies in MongoDB", len(policies_raw))

    uploaded = 0
    for p in policies_raw:
        author_id = str(p.get("author_id", ""))
        company_info = company_map.get(
            author_id, {"name": "unknown", "slug": "unknown"}
        )
        company_slug = company_info["slug"]
        company_name = company_info["name"]

        source_url = str(p.get("source_url", ""))
        policy_type = p.get("policy_type", "general")
        filename = _policy_filename(source_url, policy_type)

        frontmatter = {
            "source_url": source_url,
            "company": company_name,
            "company_id": author_id,
            "policy_type": policy_type,
            "title": p.get("title", ""),
            "effective_date": (
                str(p["effective_date"]) if p.get("effective_date") else None
            ),
            "scraped_at": (
                p["scraped_at"].isoformat()
                if p.get("scraped_at")
                else None
            ),
            "content_hash": p.get("id", ""),
            "version": p.get("version", 1),
            "summary": p.get("summary"),
        }

        header = yaml.dump(
            frontmatter, default_flow_style=False, allow_unicode=True
        )
        md_content = f"---\n{header}---\n\n{p.get('content', '')}"

        try:
            storage.upload_policy(company_slug, filename, md_content)
            uploaded += 1
        except Exception as e:
            logger.warning("Failed to upload %s/%s: %s", company_slug, filename, e)

    logger.info("Uploaded %d/%d policies", uploaded, len(policies_raw))

    # 3. Export diffs as sidecar JSON
    diffs_raw = list(db.policy_diffs.find({}, {"_id": 0}))
    logger.info("Found %d diffs in MongoDB", len(diffs_raw))

    diff_uploaded = 0
    for d in diffs_raw:
        author_id = str(d.get("author_id", ""))
        company_info = company_map.get(
            author_id, {"name": "unknown", "slug": "unknown"}
        )
        company_slug = company_info["slug"]
        source_url = str(d.get("source_url", ""))
        policy_name = _slugify(
            source_url.split("/")[-1] or "policy"
        )
        old_v = d.get("old_version", 0)
        new_v = d.get("new_version", 0)
        filename = f"v{old_v}-to-v{new_v}.json"

        # Serialize analysis if present
        diff_data = {
            "id": d.get("id", ""),
            "source_url": source_url,
            "author_id": author_id,
            "old_version_id": d.get("old_version_id", ""),
            "new_version_id": d.get("new_version_id", ""),
            "old_version": old_v,
            "new_version": new_v,
            "diff_text": d.get("diff_text", ""),
            "stats": d.get("stats", {}),
            "analysis": d.get("analysis"),
            "analysis_status": d.get("analysis_status", "pending"),
            "computed_at": (
                d["computed_at"].isoformat()
                if d.get("computed_at")
                else None
            ),
        }

        try:
            storage.upload_archive(
                company_slug,
                policy_name,
                filename,
                json.dumps(diff_data, indent=2, default=str),
            )
            diff_uploaded += 1
        except Exception as e:
            logger.warning("Failed to upload diff %s: %s", filename, e)

    logger.info("Uploaded %d/%d diffs", diff_uploaded, len(diffs_raw))

    client.close()
    logger.info("Migration complete!")


def main() -> None:
    import os

    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    mongo_uri = os.getenv("MONGODB_URI", "")
    if not mongo_uri:
        logger.error("MONGODB_URI not set in .env — cannot migrate")
        sys.exit(1)

    mongo_db = os.getenv("MONGODB_DB_NAME", "plaindr")
    settings = Settings()

    migrate(mongo_uri, mongo_db, settings)


if __name__ == "__main__":
    main()
