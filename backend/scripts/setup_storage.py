"""One-time setup: create Supabase Storage buckets for the policy system."""

from __future__ import annotations

import sys
from pathlib import Path

# Add backend src to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from supabase import create_client

from plaindr.config import Settings


def create_buckets(settings: Settings) -> None:
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    storage = client.storage

    for bucket_name, public in [
        (settings.policies_bucket, True),
        (settings.archive_bucket, False),
    ]:
        try:
            storage.get_bucket(bucket_name)
            print(f"  Bucket '{bucket_name}' already exists — skipping.")
        except Exception:
            storage.create_bucket(
                bucket_name,
                options={"public": public, "file_size_limit": 10_485_760},
            )
            print(f"  Created bucket '{bucket_name}' (public={public}).")


def main() -> None:
    print("Setting up Supabase Storage buckets...")
    settings = Settings()
    create_buckets(settings)
    print("Done.")


if __name__ == "__main__":
    main()
