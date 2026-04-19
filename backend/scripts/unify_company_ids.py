"""Force all policy files to use the canonical company_id from companies.yaml.

Some files from different ingest runs have different UUIDs for the same
company. This script rewrites them all to match companies.yaml.
"""

from __future__ import annotations

import logging
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


def main() -> None:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    # Load canonical companies.yaml
    yaml_content = storage.download_text(
        settings.policies_bucket, "companies.yaml"
    )
    companies_list = yaml.safe_load(yaml_content) or []
    name_to_id = {
        c["name"].lower(): c["id"]
        for c in companies_list if c.get("name")
    }
    logger.info("Loaded %d canonical companies", len(name_to_id))

    files = storage.list_files(settings.policies_bucket)
    md_files = [f["name"] for f in files if f["name"].endswith(".md")]

    fixed = 0
    skipped = 0
    unknown = 0

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
        cur_id = (meta.get("company_id") or "").strip()

        if not name:
            unknown += 1
            continue

        canonical_id = name_to_id.get(name.lower())
        if not canonical_id:
            unknown += 1
            continue

        if cur_id == canonical_id:
            skipped += 1
            continue

        # Rewrite with canonical ID
        meta["company_id"] = canonical_id
        body = content[end + 3:]
        new_fm = yaml.dump(
            meta, default_flow_style=False, allow_unicode=True
        )
        new_content = f"---\n{new_fm}---{body}"

        slug = path.split("/")[0]
        filename = path.split("/", 1)[1] if "/" in path else path
        try:
            storage.upload_policy(slug, filename, new_content)
            fixed += 1
            if fixed % 20 == 0:
                logger.info("Fixed %d files so far...", fixed)
        except Exception as e:
            logger.warning("Upload failed for %s: %s", path, e)

    logger.info(
        "Done. Fixed %d, already-correct %d, unknown %d",
        fixed, skipped, unknown,
    )


if __name__ == "__main__":
    main()
