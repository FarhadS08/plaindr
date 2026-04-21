"""In-memory policy store backed by Supabase Storage.

Replaces MongoDB and Pinecone with a single cache that loads all policy
Markdown files from Supabase Storage on startup, parses YAML frontmatter,
and exposes query methods for the API layer and retriever.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from datetime import UTC, date, datetime
from urllib.parse import urlparse
from uuid import UUID

import frontmatter
import yaml
from rapidfuzz import fuzz, process

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings
from plaindr.models.company import CompanyDocument
from plaindr.models.diff import DiffDocument
from plaindr.models.policy import PolicyDocument
from plaindr.pipelines.feature.refiner import clean_markdown

logger = logging.getLogger(__name__)

# Maps policy_type values to keywords found in user questions.
POLICY_TYPE_KEYWORDS: dict[str, list[str]] = {
    "privacy": ["privacy", "data", "gdpr", "ccpa", "personal", "data protection"],
    "tos": ["terms", "tos", "service", "agreement", "conditions"],
    "security": ["security", "vulnerability", "breach", "encryption"],
    "acceptable_use": ["acceptable", "use policy", "prohibited", "restrictions"],
}

_FUZZY_SCORE_CUTOFF = 80

# Canonical types come first when ordering a company's bucket — these
# are the documents users actually compare. Anything else sorts after.
_TYPE_PRIORITY: dict[str, int] = {
    "privacy": 0,
    "tos": 1,
    "security": 2,
    "acceptable_use": 3,
}


def _normalize_for_match(url: str) -> str:
    """Lowercase scheme+host, drop ``www.``, strip trailing path slash.

    Intentionally light — preserves path case and query string so we
    don't accidentally collapse two different canonical policies that
    share a host.
    """
    if not url:
        return ""
    try:
        parsed = urlparse(url)
    except Exception:
        return url.strip().lower()
    scheme = (parsed.scheme or "").lower()
    host = (parsed.netloc or "").lower().removeprefix("www.")
    path = parsed.path or ""
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    # Reassemble manually so we don't double-encode the query.
    base = f"{scheme}://{host}{path}" if scheme and host else url.strip().lower()
    if parsed.query:
        base = f"{base}?{parsed.query}"
    return base


def _policy_sort_key(p: PolicyDocument) -> tuple[int, int, str]:
    """Sort key: canonical type first, newest version next, stable URL."""
    return (
        _TYPE_PRIORITY.get(p.policy_type, 99),
        -p.version,
        str(p.source_url),
    )


def _round_robin(buckets: list[list[PolicyDocument]]) -> list[PolicyDocument]:
    """Interleave N buckets so a downstream slice always spans all of them."""
    if not buckets:
        return []
    out: list[PolicyDocument] = []
    depth = max(len(b) for b in buckets)
    for i in range(depth):
        for b in buckets:
            if i < len(b):
                out.append(b[i])
    return out

# Words that should not trigger fuzzy company matching on their own.
_STOP_WORDS: frozenset[str] = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been",
    "what", "how", "why", "when", "who", "does", "do", "did",
    "can", "could", "should", "would", "will", "has", "have", "had",
    "about", "for", "of", "in", "on", "with", "to", "from", "by",
    "my", "me", "i", "we", "you", "they", "it", "this", "that",
    "and", "or", "but", "not", "no",
    "policy", "policies", "privacy", "terms", "service", "security",
    "data", "user", "users", "company", "companies", "tool", "tools",
    "change", "changed", "changes", "update", "updated", "updates",
    "say", "says", "mention", "mentions", "tell", "tells", "know",
    "month", "year", "week", "today", "recently",
})


class PolicyStore:
    """In-memory cache of all policies and companies from Supabase Storage.

    Call :meth:`load` once at startup. After a scrape cycle finishes,
    call :meth:`reload` to refresh the cache.
    """

    def __init__(self, storage: SupabaseStorageClient, settings: Settings) -> None:
        self._storage = storage
        self._settings = settings

        self._companies: list[CompanyDocument] = []
        self._company_aliases: dict[str, UUID] = {}  # lowered alias -> company_id
        self._companies_by_id: dict[UUID, CompanyDocument] = {}

        self._policies: dict[str, PolicyDocument] = {}  # source_url -> PolicyDocument
        self._policies_by_id: dict[str, PolicyDocument] = {}  # md5 id -> PolicyDocument
        self._policies_by_company: dict[UUID, list[PolicyDocument]] = defaultdict(list)

        self._diffs: list[DiffDocument] = []
        self._diffs_by_id: dict[str, DiffDocument] = {}

        self._loaded = False

    # ── Lifecycle ────────────────────────────────────────────

    def load(self) -> None:
        """Download all policies, companies, and diffs from storage."""
        self._load_companies()
        self._load_policies()
        self._load_diffs()
        self._loaded = True
        logger.info(
            "PolicyStore loaded: %d companies, %d policies, %d diffs",
            len(self._companies),
            len(self._policies),
            len(self._diffs),
        )

    def reload(self) -> None:
        """Clear caches and re-load from storage."""
        self._companies.clear()
        self._company_aliases.clear()
        self._companies_by_id.clear()
        self._policies.clear()
        self._policies_by_id.clear()
        self._policies_by_company.clear()
        self._diffs.clear()
        self._diffs_by_id.clear()
        self._loaded = False
        self.load()

    # ── Companies ────────────────────────────────────────────

    def list_companies(self) -> list[CompanyDocument]:
        return list(self._companies)

    def get_company(self, company_id: UUID) -> CompanyDocument | None:
        return self._companies_by_id.get(company_id)

    def get_company_by_name(self, name: str) -> CompanyDocument | None:
        """Resolve a company name with exact, alias, then fuzzy matching."""
        lower = name.lower().strip()
        if not lower:
            return None

        # Exact match on canonical name
        for c in self._companies:
            if c.name.lower() == lower:
                return c

        # Alias match
        if lower in self._company_aliases:
            cid = self._company_aliases[lower]
            return self._companies_by_id.get(cid)

        # Fuzzy match
        names = [c.name for c in self._companies]
        if not names:
            return None
        match = process.extractOne(
            name,
            names,
            scorer=fuzz.WRatio,
            score_cutoff=_FUZZY_SCORE_CUTOFF,
        )
        if match:
            return next((c for c in self._companies if c.name == match[0]), None)

        return None

    def count_companies(self) -> int:
        return len(self._companies)

    def get_company_name(self, company_id: UUID) -> str | None:
        """Return a company's name by ID, or None."""
        c = self._companies_by_id.get(company_id)
        return c.name if c else None

    def upsert_companies(
        self, companies: list[CompanyDocument]
    ) -> int:
        """Register companies in memory and upload companies.yaml.

        Returns the number of companies upserted.
        """
        for c in companies:
            if c.id not in self._companies_by_id:
                self._companies.append(c)
                self._companies_by_id[c.id] = c
            else:
                # Update existing entry in-place
                self._companies_by_id[c.id] = c
            self._company_aliases[c.name.lower()] = c.id

        # Persist to storage as companies.yaml
        entries = []
        for c in self._companies:
            slug = re.sub(r"[^a-z0-9]+", "-", c.name.lower()).strip("-")
            entries.append({
                "id": str(c.id),
                "name": c.name,
                "slug": slug,
                "category": c.category,
                "main_url": str(c.main_url) if c.main_url else "",
                "aliases": [],
            })

        yaml_content = yaml.dump(
            entries, default_flow_style=False, allow_unicode=True
        )
        self._storage.upload(
            self._settings.policies_bucket,
            "companies.yaml",
            yaml_content.encode(),
            content_type="text/yaml",
        )
        return len(companies)

    # ── Policies ─────────────────────────────────────────────

    def list_policies(self, exclude_content: bool = False) -> list[PolicyDocument]:
        """Return all policies. Optionally strip content for listing."""
        if not exclude_content:
            return list(self._policies.values())
        # Use a placeholder that satisfies the min-length validator (50 chars)
        placeholder = "[content excluded from listing response]         "
        return [
            p.model_copy(update={"content": placeholder})
            for p in self._policies.values()
        ]

    def get_policy(self, md5id: str) -> PolicyDocument | None:
        return self._policies_by_id.get(md5id)

    def get_policy_by_source_url(self, source_url: str) -> PolicyDocument | None:
        return self._policies.get(source_url)

    def find_canonical_by_url(self, url: str) -> PolicyDocument | None:
        """Return the canonical policy whose source_url matches ``url``.

        Lightly normalizes scheme + host (lowercased, ``www.`` stripped,
        trailing slash stripped from the path) before comparing — the
        canonical entry was registered by the crawler and the user may
        type the same URL with slightly different casing or an extra
        slash. We keep query strings and path casing intact because
        many policy URLs have case-sensitive path segments (e.g.
        ``/legal/PrivacyPolicy``) and query-scoped variants.
        """
        target = _normalize_for_match(url)
        if not target:
            return None
        for source_key, policy in self._policies.items():
            if _normalize_for_match(source_key) == target:
                return policy
        return None

    def get_policies_by_company(self, company_id: UUID) -> list[PolicyDocument]:
        return list(self._policies_by_company.get(company_id, []))

    def count_policies(self) -> int:
        return len(self._policies)

    def get_all_content_hashes(self) -> set[str]:
        """Return all known policy content hashes (MD5 IDs)."""
        return set(self._policies_by_id.keys())

    def register_policy(self, doc: PolicyDocument) -> None:
        """Add or update a policy in the in-memory cache (no upload)."""
        source_key = str(doc.source_url)
        self._policies[source_key] = doc
        self._policies_by_id[doc.id] = doc
        self._policies_by_company[doc.author_id].append(doc)

    # ── Query Selection ──────────────────────────────────────

    def select_policies(
        self,
        question: str,
        company_filter: str | None = None,
        policy_type_filter: str | None = None,
    ) -> list[PolicyDocument]:
        """Deterministic policy selection for company-scoped queries.

        Returns policies only when the question (or ``company_filter``)
        resolves to one or more known companies. All other cases
        return ``[]`` — the retriever is expected to call the LLM
        planner for open-ended questions.

        For multi-company queries ("compare X and Y") the result is
        round-robin interleaved so that the retriever's ``[:N]`` cap
        always spans every detected company. Before the interleave,
        each company's bucket is sorted with canonical policy types
        (privacy, tos, security, acceptable_use) first so the most
        comparison-worthy documents land in the top slots.
        """
        companies = self._resolve_companies(question, company_filter)
        if not companies:
            return []

        detected_type = (
            policy_type_filter or self._detect_policy_type(question)
        )
        buckets: list[list[PolicyDocument]] = []
        for company in companies:
            owned = self.get_policies_by_company(company.id)
            if detected_type:
                typed = [p for p in owned if p.policy_type == detected_type]
                # Fall back to the company's full bucket rather than drop
                # them entirely — a type-less entry is better than a
                # missing side in a comparison.
                owned = typed or owned
            buckets.append(sorted(owned, key=_policy_sort_key))

        return _round_robin(buckets)

    # ── Diffs ────────────────────────────────────────────────

    def get_recent_diffs(self, limit: int = 20) -> list[DiffDocument]:
        """Return the most recent diffs from the in-memory cache."""
        return self._diffs[:limit]

    def get_diffs_by_source_url(self, source_url: str) -> list[DiffDocument]:
        """Return all cached diffs for a specific policy source URL."""
        return [
            d for d in self._diffs if str(d.source_url) == source_url
        ]

    def get_diff(self, diff_id: str) -> DiffDocument | None:
        """Look up a single diff by its ID from cache."""
        return self._diffs_by_id.get(diff_id)

    # ── Private: Loading ─────────────────────────────────────

    def _load_companies(self) -> None:
        """Download and parse companies.yaml from the policies bucket."""
        try:
            raw = self._storage.download_text(
                self._settings.policies_bucket, "companies.yaml"
            )
        except Exception:
            logger.warning(
                "Could not download companies.yaml"
                " — starting with empty registry"
            )
            return

        try:
            entries = yaml.safe_load(raw)
        except yaml.YAMLError:
            logger.warning("Failed to parse companies.yaml — invalid YAML")
            return

        if not isinstance(entries, list):
            logger.warning("companies.yaml root is not a list — skipping")
            return

        for entry in entries:
            try:
                company = CompanyDocument.model_validate(entry)
                self._companies.append(company)
                self._companies_by_id[company.id] = company

                # Index aliases (including the canonical name)
                self._company_aliases[company.name.lower()] = company.id
                for alias in entry.get("aliases", []):
                    self._company_aliases[alias.lower()] = company.id
                # Index slug if present
                slug = entry.get("slug", "")
                if slug:
                    self._company_aliases[slug.lower()] = company.id
            except Exception:
                logger.warning("Skipping invalid company entry: %s", entry)

        logger.info("Loaded %d companies from companies.yaml", len(self._companies))

    def _load_policies(self) -> None:
        """Download all .md policy files and parse frontmatter into models."""
        raw_files = self._storage.download_all_policies()

        for path, text in raw_files.items():
            try:
                policy = self._parse_policy_file(path, text)
                if policy is None:
                    continue
                source_key = str(policy.source_url)
                self._policies[source_key] = policy
                self._policies_by_id[policy.id] = policy
                self._policies_by_company[policy.author_id].append(policy)
            except Exception as exc:
                logger.warning("Failed to parse policy file %s: %s", path, exc)

        logger.info("Loaded %d policies from storage", len(self._policies))

    def _parse_policy_file(self, path: str, text: str) -> PolicyDocument | None:
        """Parse a single policy Markdown file with YAML frontmatter."""
        try:
            post = frontmatter.loads(text)
        except Exception:
            logger.warning("Failed to parse frontmatter in %s", path)
            return None

        meta = post.metadata
        # Re-run the refiner on load so updated noise patterns (language
        # pickers, nav-link strips, image-in-link headers) retroactively
        # clean up the 465 existing policies without requiring a re-scrape.
        # Idempotent on already-clean content — next scrape will rewrite
        # the file with the same result.
        content = clean_markdown(post.content)

        # Required frontmatter fields
        source_url = meta.get("source_url")
        company_id = meta.get("company_id")
        content_hash = meta.get("content_hash")
        title = meta.get("title", "")

        if not source_url or not company_id or not content_hash:
            logger.warning(
                "Policy file %s missing required frontmatter fields "
                "(source_url, company_id, content_hash)",
                path,
            )
            return None

        if not content or len(content.strip()) < 50:
            logger.warning("Policy file %s has insufficient content — skipping", path)
            return None

        # Parse dates carefully
        effective_date = self._parse_date(meta.get("effective_date"))
        scraped_at = self._parse_datetime(meta.get("scraped_at"))

        return PolicyDocument(
            id=content_hash,
            author_id=UUID(str(company_id)),
            title=title,
            policy_type=meta.get("policy_type", "general"),
            source_url=source_url,
            content=content,
            version=meta.get("version", 1),
            effective_date=effective_date,
            scraped_at=scraped_at or datetime.now(UTC),
            previous_version_id=meta.get("previous_version_id"),
            summary=meta.get("summary"),
        )

    def _load_diffs(self) -> None:
        """Download and cache all diff JSON files from the archive bucket.

        Parallelized with a thread pool — sequential downloads of N diffs
        scale linearly with RTT; 16-way parallelism cuts cold-start time.
        """
        from concurrent.futures import ThreadPoolExecutor

        files = self._storage.list_files(
            self._settings.archive_bucket, ""
        )
        json_files = [
            f["name"] for f in files if f["name"].endswith(".json")
        ]

        if not json_files:
            logger.info("No diffs in archive bucket")
            return

        with ThreadPoolExecutor(max_workers=16) as pool:
            diffs = list(pool.map(self._parse_diff_file, json_files))

        for diff in diffs:
            if diff:
                self._diffs.append(diff)
                self._diffs_by_id[diff.id] = diff

        # Sort by computed_at descending (newest first)
        self._diffs.sort(key=lambda d: d.computed_at, reverse=True)
        logger.info("Loaded %d diffs from archive bucket", len(self._diffs))

    def _parse_diff_file(self, path: str) -> DiffDocument | None:
        """Download and parse a single diff JSON file."""
        try:
            raw = self._storage.download_text(
                self._settings.archive_bucket, path
            )
        except Exception:
            logger.warning("Failed to download diff file %s", path)
            return None

        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            logger.warning("Failed to parse diff JSON: %s", path)
            return None

        if not isinstance(data, dict):
            return None

        try:
            return DiffDocument.model_validate(data)
        except Exception as exc:
            logger.warning("Invalid diff data in %s: %s", path, exc)
            return None

    # ── Private: Query Helpers ───────────────────────────────

    def _resolve_companies(
        self,
        question: str,
        explicit_filter: str | None,
    ) -> list[CompanyDocument]:
        """Identify one or more companies from filter or question text.

        Supports comparison queries like "Compare Zoom and Teams privacy".
        """
        if explicit_filter:
            company = self.get_company_by_name(explicit_filter)
            return [company] if company else []

        q_lower = question.lower()
        found: dict[UUID, CompanyDocument] = {}

        # Layer 1: exact word-boundary match on canonical name or alias
        for alias, cid in self._company_aliases.items():
            if cid in found:
                continue
            if self._word_boundary_match(q_lower, alias):
                company = self._companies_by_id.get(cid)
                if company:
                    found[cid] = company

        # Layer 2: domain match from main_url
        # e.g. question mentions "openai.com" or "openai" anywhere →
        # find company whose main_url host contains it.
        for company in self._companies:
            if company.id in found:
                continue
            main_url = str(company.main_url or "").lower()
            if not main_url:
                continue
            # Extract domain core (e.g., "openai" from "https://openai.com/")
            try:
                host = urlparse(main_url).netloc or main_url
                host = host.removeprefix("www.").split(".")[0]
            except Exception:
                continue
            if host and len(host) >= 3 and self._word_boundary_match(
                q_lower, host
            ):
                found[company.id] = company

        if found:
            return list(found.values())

        # Layer 3: fuzzy match — user may have typed a misspelled or
        # partial company name. Extract 2-3 word windows and match.
        fuzzy = self._fuzzy_company_match(question)
        if fuzzy:
            return [fuzzy]

        return []

    @staticmethod
    def _word_boundary_match(haystack_lower: str, needle: str) -> bool:
        """True if needle appears in haystack on word boundaries."""
        if not needle or len(needle) < 2:
            return False
        idx = haystack_lower.find(needle)
        if idx == -1:
            return False
        before_ok = idx == 0 or not haystack_lower[idx - 1].isalnum()
        after_idx = idx + len(needle)
        after_ok = (
            after_idx >= len(haystack_lower)
            or not haystack_lower[after_idx].isalnum()
        )
        return before_ok and after_ok

    def _fuzzy_company_match(
        self, question: str
    ) -> CompanyDocument | None:
        """Try to extract a company name with fuzzy matching.

        Scans all 2-3 word windows of the question against all known
        company names + aliases and returns the highest-scoring match
        above a confidence threshold.
        """
        candidates: list[tuple[str, CompanyDocument]] = [
            (c.name, c) for c in self._companies
        ]
        for alias, cid in self._company_aliases.items():
            company = self._companies_by_id.get(cid)
            if company:
                candidates.append((alias, company))
        if not candidates:
            return None

        # Hoist the name list so rapidfuzz isn't rebuilding it per window.
        names = [name for name, _ in candidates]
        words = question.split()
        best_score = 0.0
        best: CompanyDocument | None = None
        for size in (1, 2, 3):
            for i in range(len(words) - size + 1):
                window = " ".join(words[i : i + size]).strip()
                if len(window) < 3 or window.lower() in _STOP_WORDS:
                    continue
                match = process.extractOne(
                    window,
                    names,
                    scorer=fuzz.WRatio,
                    score_cutoff=85,
                )
                if match and match[1] > best_score:
                    best_score = match[1]
                    best = candidates[match[2]][1]
        return best

    def _detect_policy_type(self, question: str) -> str | None:
        """Detect a policy type from keywords in the question."""
        q_lower = question.lower()
        for ptype, keywords in POLICY_TYPE_KEYWORDS.items():
            for kw in keywords:
                if kw in q_lower:
                    return ptype
        return None

    # ── Private: Date Parsing ────────────────────────────────

    @staticmethod
    def _parse_date(value: str | date | None) -> date | None:
        """Safely parse a date from frontmatter (may be str or date)."""
        if value is None:
            return None
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return date.fromisoformat(str(value))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_datetime(value: str | datetime | None) -> datetime | None:
        """Safely parse a datetime from frontmatter."""
        if value is None:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value))
        except (ValueError, TypeError):
            return None
