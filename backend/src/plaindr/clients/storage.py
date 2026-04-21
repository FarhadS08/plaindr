"""Supabase Storage client — thin wrapper for policy file operations.

Handles upload, download, listing, and deletion of policy Markdown files
across the policies and policies-archive buckets.
"""

import logging

from supabase import create_client

from plaindr.config import Settings

logger = logging.getLogger(__name__)


class SupabaseStorageClient:
    """Wrapper around the Supabase Python client for Storage operations."""

    def __init__(self, settings: Settings) -> None:
        self._client = create_client(
            settings.supabase_url,
            settings.supabase_service_key.get_secret_value(),
        )
        self._policies_bucket = settings.policies_bucket
        self._archive_bucket = settings.archive_bucket
        self._user_policies_bucket = settings.user_policies_bucket

    # ── Upload / Download ────────────────────────────────

    def upload(
        self,
        bucket: str,
        path: str,
        content: bytes,
        content_type: str = "text/markdown",
    ) -> None:
        """Upload a file to the specified bucket and path."""
        self._client.storage.from_(bucket).upload(
            path,
            content,
            file_options={"content-type": content_type, "upsert": "true"},
        )

    def download(self, bucket: str, path: str) -> bytes:
        """Download a file as raw bytes."""
        return self._client.storage.from_(bucket).download(path)

    def download_text(self, bucket: str, path: str) -> str:
        """Download a file and decode as UTF-8 text."""
        return self.download(bucket, path).decode("utf-8")

    # ── List ─────────────────────────────────────────────

    def list_files(self, bucket: str, prefix: str = "") -> list[dict]:
        """List files in a bucket under the given prefix, recursively.

        Returns a flat list of file objects (dicts with a 'name' key).
        Directories are traversed automatically.
        """
        result: list[dict] = []
        self._list_recursive(bucket, prefix, result)
        return result

    def _list_recursive(
        self,
        bucket: str,
        prefix: str,
        accumulator: list[dict],
    ) -> None:
        """Walk the storage tree depth-first, collecting file entries.

        Paginates through results since Supabase defaults to 100 per page.
        """
        page_size = 1000
        offset = 0
        while True:
            try:
                entries = self._client.storage.from_(bucket).list(
                    prefix,
                    {"limit": page_size, "offset": offset},
                )
            except Exception:
                logger.warning(
                    "Failed to list bucket=%s prefix=%s offset=%d",
                    bucket, prefix, offset,
                )
                return

            if not entries:
                break

            for entry in entries:
                name = entry.get("name", "")
                # Supabase marks directories with id=None and no metadata
                is_dir = entry.get("id") is None
                child_path = f"{prefix}/{name}" if prefix else name

                if is_dir:
                    self._list_recursive(bucket, child_path, accumulator)
                else:
                    accumulator.append({**entry, "name": child_path})

            if len(entries) < page_size:
                break
            offset += page_size

    # ── Delete ───────────────────────────────────────────

    def delete(self, bucket: str, paths: list[str]) -> None:
        """Delete one or more files from a bucket."""
        if not paths:
            return
        self._client.storage.from_(bucket).remove(paths)

    # ── Convenience: policies bucket ─────────────────────

    def upload_policy(
        self,
        company_slug: str,
        filename: str,
        content: str,
    ) -> None:
        """Upload a policy file to ``policies/{company_slug}/{filename}``."""
        path = f"{company_slug}/{filename}"
        self.upload(
            self._policies_bucket,
            path,
            content.encode("utf-8"),
        )

    def upload_archive(
        self,
        company_slug: str,
        policy_name: str,
        filename: str,
        content: str,
    ) -> None:
        """Upload an archived policy version.

        Path: ``policies-archive/{company_slug}/{policy_name}/{filename}``
        """
        path = f"{company_slug}/{policy_name}/{filename}"
        self.upload(
            self._archive_bucket,
            path,
            content.encode("utf-8"),
        )

    # NOTE: ``list_all_policies`` and ``download_all_policies`` below
    # deliberately only touch the canonical ``policies_bucket``. Do NOT
    # extend them to sweep the user-policies bucket — user-submitted
    # content is per-owner and must never land in the global PolicyStore
    # cache (which is what the retriever and tRPC policy list read from).
    def list_all_policies(self) -> list[str]:
        """List all ``.md`` files in the policies bucket recursively.

        Returns full paths like ``"openai/privacy-policy.md"``.
        """
        all_files = self.list_files(self._policies_bucket)
        return [
            f["name"]
            for f in all_files
            if f["name"].endswith(".md")
        ]

    def download_all_policies(self) -> dict[str, str]:
        """Download every ``.md`` policy file from the policies bucket.

        Uses a thread pool for I/O-bound parallelism, with one retry
        pass on failed downloads to tolerate transient SSL errors from
        Supabase under high concurrency.

        Returns a ``{path: content}`` dict. Skips ``companies.yaml``.
        """
        import time
        from concurrent.futures import ThreadPoolExecutor, as_completed

        paths = [
            p for p in self.list_all_policies()
            if "companies.yaml" not in p
        ]
        result: dict[str, str] = {}

        def _fetch(p: str) -> tuple[str, str | None]:
            try:
                return p, self.download_text(self._policies_bucket, p)
            except Exception as exc:
                logger.debug("Download failed for %s: %s", p, exc)
                return p, None

        # Pass 1: 16 workers (high throughput, occasional SSL EOFs)
        with ThreadPoolExecutor(max_workers=16) as pool:
            futures = [pool.submit(_fetch, p) for p in paths]
            for fut in as_completed(futures):
                path, content = fut.result()
                if content is not None:
                    result[path] = content

        # Pass 2: sequential retry on misses — transient SSL errors
        # under high concurrency are usually resolved by retrying later.
        missed = [p for p in paths if p not in result]
        if missed:
            logger.info(
                "Retrying %d transient download failures sequentially",
                len(missed),
            )
            time.sleep(0.5)
            for p in missed:
                _, content = _fetch(p)
                if content is not None:
                    result[p] = content
                else:
                    logger.warning(
                        "Failed to download %s after retry — skipping", p
                    )

        logger.info(
            "Downloaded %d/%d policy files from '%s'",
            len(result),
            len(paths),
            self._policies_bucket,
        )
        return result

    # ── Convenience: user-policies bucket ────────────────

    def upload_user_policy(
        self,
        owner_id: str,
        filename: str,
        content: str,
    ) -> None:
        """Upload a user-submitted policy to ``user-policies/{owner_id}/{filename}``.

        ``owner_id`` is either a user id or an organization id, depending
        on the submission scope — the caller picks which one.
        """
        path = f"{owner_id}/{filename}"
        self.upload(
            self._user_policies_bucket,
            path,
            content.encode("utf-8"),
        )

    def download_user_policy(self, storage_path: str) -> str:
        """Download a user-submitted policy by its stored path.

        ``storage_path`` is the exact value from the ``user_policies.storage_path``
        column (``{owner_id}/{filename}``). We don't re-derive the path
        so that moves and renames remain safe — the DB is the source of truth.
        """
        return self.download_text(self._user_policies_bucket, storage_path)

    def delete_user_policy(self, storage_path: str) -> None:
        """Delete a single user-submitted policy file."""
        self.delete(self._user_policies_bucket, [storage_path])
