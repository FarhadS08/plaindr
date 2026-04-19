"""Rebuild companies.yaml from policy file frontmatter.

Fixes the UUID drift problem: each policy file has a company_id in its
frontmatter, but companies.yaml might have a different UUID for the
same company. This script uses the policy files as the source of truth
and rebuilds companies.yaml to match.
"""

from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main() -> None:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    # Load existing companies.yaml for category/main_url data
    existing_meta: dict[str, dict] = {}
    try:
        yaml_content = storage.download_text(
            settings.policies_bucket, "companies.yaml"
        )
        existing = yaml.safe_load(yaml_content) or []
        for c in existing:
            if c.get("name"):
                existing_meta[c["name"].lower()] = c
    except Exception:
        pass

    # Scan all policy files for (company_name, company_id) pairs
    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    canonical: dict[str, dict] = {}  # name_lower -> {name, id, slug, ...}
    collisions: list[tuple[str, str, str]] = []

    for path in md_files:
        try:
            content = storage.download_text(
                settings.policies_bucket, path
            )
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

        name = (meta.get("company") or "").strip()
        cid = (meta.get("company_id") or "").strip()
        if not name or not cid:
            continue

        key = name.lower()
        if key in canonical:
            if canonical[key]["id"] != cid:
                collisions.append((name, canonical[key]["id"], cid))
            continue

        # Pull category and main_url from existing meta if we have it
        extra = existing_meta.get(key, {})
        canonical[key] = {
            "id": cid,
            "name": name,
            "slug": _slugify(name),
            "category": extra.get("category", "unknown"),
            "main_url": extra.get("main_url", ""),
            "aliases": extra.get("aliases", []),
        }

    logger.info("Found %d unique companies in policy files", len(canonical))
    if collisions:
        logger.warning(
            "Found %d companies with multiple UUIDs in files:", len(collisions)
        )
        for name, id1, id2 in collisions[:10]:
            logger.warning("  %s: %s vs %s (keeping first)", name, id1, id2)

    # Write rebuilt companies.yaml
    companies_list = sorted(canonical.values(), key=lambda c: c["name"])
    yaml_out = yaml.dump(
        companies_list, default_flow_style=False, allow_unicode=True
    )
    storage.upload(
        settings.policies_bucket,
        "companies.yaml",
        yaml_out.encode("utf-8"),
        content_type="text/yaml",
    )
    logger.info(
        "Wrote %d companies to companies.yaml", len(companies_list)
    )


if __name__ == "__main__":
    main()
