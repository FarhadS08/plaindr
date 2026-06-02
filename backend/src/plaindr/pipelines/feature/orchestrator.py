"""Pipeline orchestrator — end-to-end execution from CSV to Supabase Storage,
with version-aware upsert, diff computation, and AI analysis.

Integrates:
- URL discovery via Firecrawl map() for completeness
- 3-tier scraping cascade with smart escalation
- PDF extraction and iframe content detection
- Content quality validation before storage
- Version-aware upsert with diff computation
- Policy files stored as .md with YAML frontmatter in Supabase Storage

Supports three scraping backends via protocol-based architecture:
- "firecrawl": Firecrawl API for all scraping (original behavior)
- "playwright": Playwright browser for scraping, Firecrawl for agent/discovery
- "hybrid" (default): Playwright first, Firecrawl fallback + agent/discovery
"""

import logging
import re
from contextlib import ExitStack
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

import yaml

from plaindr.clients.policy_store import PolicyStore
from plaindr.clients.protocol import (
    AgentProtocol,
    ScraperProtocol,
    UrlDiscoveryProtocol,
)
from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings
from plaindr.models.diff import DiffDocument
from plaindr.models.policy import PolicyDocument
from plaindr.pipelines.feature.content_validator import validate_content
from plaindr.pipelines.feature.csv_loader import ScrapingTask, load_and_explode
from plaindr.pipelines.feature.date_extractor import extract_effective_date
from plaindr.pipelines.feature.refiner import (
    build_policy_document,
    clean_markdown,
    is_duplicate,
)
from plaindr.pipelines.feature.scraper import (
    ScrapeResult,
    scrape_batch,
    scrape_task,
    scrape_task_with_escalation,
)
from plaindr.pipelines.feature.url_discovery import discover_missing_urls
from plaindr.pipelines.inference.analyzer import analyze_policy_change
from plaindr.pipelines.inference.differ import (
    compute_diff,
    diff_summary_stats,
    diff_to_unified_text,
)
from plaindr.utils.hashing import md5_hash, semantic_hash

logger = logging.getLogger(__name__)


@dataclass
class CompletenessEntry:
    """A single entry in the completeness report."""

    level: str  # FAILED, WARNING, LOW_CONFIDENCE, INFO
    url: str
    message: str
    error_type: str = ""


@dataclass
class PipelineResult:
    """Summary of a full pipeline run."""

    companies_upserted: int = 0
    tasks_total: int = 0
    tasks_from_csv: int = 0
    tasks_from_discovery: int = 0
    scrape_success: int = 0
    scrape_failed: int = 0
    content_rejected: int = 0
    smart_escalations: int = 0
    smart_escalation_recovered: int = 0
    pdfs_extracted: int = 0
    iframes_detected: int = 0
    policies_new: int = 0
    policies_changed: int = 0
    policies_unchanged: int = 0
    policies_duplicate: int = 0
    diffs_computed: int = 0
    errors: list[str] = field(default_factory=list)
    completeness_entries: list[CompletenessEntry] = field(default_factory=list)


# ── Helpers: slugs and frontmatter ──────────────────────


def _slugify(name: str) -> str:
    """Convert a name to a URL-safe slug."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _policy_filename(policy_type: str, source_url: str) -> str:
    """Generate a deterministic filename from policy type and URL path."""
    path = urlparse(str(source_url)).path.strip("/").split("/")[-1] or policy_type
    slug = _slugify(path)
    return f"{slug}.md" if slug else f"{policy_type}.md"


def _build_policy_markdown(doc: PolicyDocument, company_name: str) -> str:
    """Serialize a PolicyDocument as Markdown with YAML frontmatter."""
    frontmatter = {
        "source_url": str(doc.source_url),
        "company": company_name,
        "company_id": str(doc.author_id),
        "policy_type": doc.policy_type,
        "title": doc.title,
        "effective_date": str(doc.effective_date) if doc.effective_date else None,
        "scraped_at": doc.scraped_at.isoformat(),
        "content_hash": doc.id,
        "version": doc.version,
        "summary": doc.summary,
    }
    header = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
    return f"---\n{header}---\n\n{doc.content}"


# ── Client creation ─────────────────────────────────────


def _create_clients(
    settings: Settings,
    exit_stack: ExitStack,
) -> tuple[ScraperProtocol, AgentProtocol | None, UrlDiscoveryProtocol | None]:
    """Create scraper clients based on the configured backend.

    Returns (scraper, agent, discovery) where:
    - scraper: always available (Playwright, Firecrawl, or Hybrid)
    - agent: None if no Firecrawl API key (Tier 2 is skipped)
    - discovery: None if no Firecrawl API key (URL discovery is skipped)
    """
    from plaindr.clients.firecrawl import FirecrawlClient

    backend = settings.scraper_backend

    if backend == "firecrawl":
        fc = FirecrawlClient(settings)
        return fc, fc, fc

    # Playwright or Hybrid mode
    from plaindr.clients.playwright import PlaywrightClient

    pw = PlaywrightClient(settings)
    exit_stack.enter_context(pw)

    fc: FirecrawlClient | None = None
    if settings.firecrawl_api_key.get_secret_value():
        fc = FirecrawlClient(settings)

    if backend == "hybrid" and fc is not None:
        from plaindr.clients.protocol import HybridScraper
        scraper: ScraperProtocol = HybridScraper(primary=pw, fallback=fc)
    else:
        scraper = pw

    # Firecrawl provides agent + discovery; None if no API key
    return scraper, fc, fc


# ── Public entry points ─────────────────────────────────


def run_full_pipeline(
    csv_path: Path,
    settings: Settings,
) -> PipelineResult:
    """CSV -> discover -> scrape -> clean -> validate -> upsert to Supabase Storage.

    Full pipeline for ingesting policies from a CSV file.
    Includes pre-scrape URL discovery to catch policies missed by the CSV.
    """
    result = PipelineResult()
    storage = SupabaseStorageClient(settings)
    store = PolicyStore(storage, settings)
    store.load()

    with ExitStack() as stack:
        scraper, agent, discovery = _create_clients(settings, stack)
        logger.info(
            "Pipeline using scraper_backend=%s (agent=%s, discovery=%s)",
            settings.scraper_backend,
            "available" if agent else "unavailable",
            "available" if discovery else "unavailable",
        )

        # 1. Load CSV and explode into tasks
        companies, tasks = load_and_explode(csv_path)
        result.tasks_from_csv = len(tasks)

        # 2. Register companies in the store
        result.companies_upserted = store.upsert_companies(companies)

        # 3. Pre-scrape URL discovery (requires Firecrawl)
        if discovery is not None:
            discovered_tasks = discover_missing_urls(discovery, tasks)
            result.tasks_from_discovery = len(discovered_tasks)
            if discovered_tasks:
                logger.info(
                    "URL discovery found %d additional policy URLs",
                    len(discovered_tasks),
                )
                tasks.extend(discovered_tasks)
        else:
            logger.info(
                "URL discovery skipped (no Firecrawl API key)",
            )

        # 4. Filter out tasks already in the store (resume support)
        new_tasks = []
        skipped = 0
        for t in tasks:
            if store.get_policy_by_source_url(str(t.policy_url)):
                skipped += 1
            else:
                new_tasks.append(t)
        if skipped:
            logger.info(
                "Skipping %d URLs already in store, scraping %d new",
                skipped, len(new_tasks),
            )
        tasks = new_tasks
        result.tasks_total = len(tasks)

        # 5. Scrape all tasks (CSV + discovered)
        scrape_results = scrape_batch(scraper, tasks, agent=agent)

        # 5. Process each result with smart escalation
        existing_ids = store.get_all_content_hashes()
        for sr in scrape_results:
            _process_scrape_result(
                sr, existing_ids, settings,
                storage, store, scraper, agent, result,
            )

    # Reload the store so downstream consumers see updated data
    store.reload()
    logger.info("Pipeline complete: %s", result)
    _write_completeness_report(result, "ingest")
    return result


def run_rescrape(settings: Settings) -> PipelineResult:
    """Re-scrape all known policies from Supabase Storage.

    Uses the full 3-tier scraping cascade with smart escalation.
    Detects and processes content changes.
    """
    result = PipelineResult()
    storage = SupabaseStorageClient(settings)
    store = PolicyStore(storage, settings)
    store.load()

    with ExitStack() as stack:
        scraper, agent, _discovery = _create_clients(settings, stack)
        logger.info(
            "Rescrape using scraper_backend=%s (agent=%s)",
            settings.scraper_backend,
            "available" if agent else "unavailable",
        )

        policies = store.list_policies()
        result.tasks_total = len(policies)

        for policy in policies:
            _rescrape_policy(
                policy, scraper, agent, settings,
                storage, store, result,
            )

        # User-submitted URLs — joined after the canonical loop so any
        # regression in this newer code path can only degrade the new
        # feature, never crash the Sunday canonical cron we've relied on
        # for months. Try/except wraps the whole block for the same
        # reason.
        try:
            _rescrape_user_policies(
                settings, scraper, agent, storage, store, result,
            )
        except Exception:
            logger.exception(
                "user-policies rescrape block failed; canonical rescrape "
                "already completed, continuing",
            )

    # Reload the store so downstream consumers see updated data
    store.reload()
    logger.info("Rescrape complete: %s", result)
    _write_completeness_report(result, "rescrape")
    return result


def _rescrape_user_policies(
    settings: Settings,
    scraper: ScraperProtocol,
    agent: AgentProtocol | None,
    storage: SupabaseStorageClient,
    store: PolicyStore,
    result: PipelineResult,
) -> None:
    """Re-scrape rows in `user_policies` that are not canonical mirrors.

    Canonical-mirror rows (is_canonical_mirror=true) were already covered
    by the main loop because their URL is in companies.yaml. Everything
    else is a user-private URL we alone are responsible for tracking.
    """
    from plaindr.clients.supabase_table import SupabaseTableClient

    table = SupabaseTableClient(settings)
    rows = table.list_rescrape_candidates()
    if not rows:
        logger.info("No user-submitted policies to rescrape")
        return

    logger.info("Rescraping %d user-submitted policies", len(rows))
    ok = 0
    changed = 0
    failed = 0

    for row in rows:
        url = row.get("url")
        row_id = row.get("id")
        if not url or not row_id:
            continue

        try:
            task = ScrapingTask(
                company_id=UUID("00000000-0000-0000-0000-000000000000"),
                company_name="user-submitted",
                category="",
                policy_url=url,
                policy_type="user_submitted",
            )
            sr = scrape_task(scraper, task, agent=agent)
            if sr.error or not sr.markdown:
                table.mark_user_policy_status(row_id, "failed", error=sr.error or "no markdown")
                failed += 1
                continue

            cleaned = clean_markdown(sr.markdown)
            new_hash = md5_hash(cleaned)
            old_hash = row.get("content_hash")

            if new_hash == old_hash:
                table.mark_user_policy_status(row_id, "unchanged")
                ok += 1
                continue

            # Content changed → upload new markdown, bump hash.
            path = row.get("storage_path") or ""
            if path:
                # Keep the existing filename to preserve the URL that
                # retriever / frontend already fetch from.
                _, _, filename = path.rpartition("/")
                owner = path[: -(len(filename) + 1)] if filename else ""
                storage.upload_user_policy(owner, filename, cleaned)
                table.update_user_policy_after_scrape(
                    row_id, content_hash=new_hash, storage_path=path, status="updated",
                )
                changed += 1
            else:
                # No storage_path means this was a canonical mirror; skip,
                # since the canonical loop above already handled it.
                table.mark_user_policy_status(row_id, "unchanged")
                ok += 1
        except Exception as exc:
            logger.exception("user-policy rescrape failed for %s: %s", url, exc)
            try:
                table.mark_user_policy_status(row_id, "failed", error=str(exc)[:500])
            except Exception:
                pass
            failed += 1

    logger.info(
        "User-policies rescrape: %d ok, %d changed, %d failed",
        ok, changed, failed,
    )


# ── Private helpers ──────────────────────────────────────


def _process_scrape_result(
    sr: ScrapeResult,
    existing_ids: set[str],
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
    scraper: ScraperProtocol,
    agent: AgentProtocol | None,
    result: PipelineResult,
) -> None:
    """Process a single scrape result through the full pipeline.

    Includes smart escalation: if content validation rejects Tier 1
    output, retries with the Spark agent before giving up.
    """
    if not sr.success:
        result.scrape_failed += 1
        result.errors.append(
            f"Scrape failed [{sr.error_type.value}] {sr.task.policy_url}: "
            f"{sr.error}"
        )
        result.completeness_entries.append(CompletenessEntry(
            level="FAILED",
            url=str(sr.task.policy_url),
            message=sr.error or "Unknown error",
            error_type=sr.error_type.value,
        ))
        logger.warning(
            "Scrape failed [%s] %s: %s",
            sr.error_type.value,
            sr.task.policy_url,
            sr.error,
        )
        return
    result.scrape_success += 1

    # Track PDF and iframe extractions
    if sr.pdf_extracted:
        result.pdfs_extracted += 1
    if sr.iframe_content:
        result.iframes_detected += len(sr.iframe_content)

    effective_date = extract_effective_date(sr.raw_markdown)
    cleaned = clean_markdown(sr.raw_markdown)
    if not cleaned.strip():
        result.scrape_failed += 1
        return

    # Content quality gate — reject garbage before it reaches storage
    validation = validate_content(
        cleaned,
        source_url=str(sr.task.policy_url),
        policy_type=sr.task.policy_type,
    )

    # Smart escalation: if content was rejected and we haven't exhausted
    # all options, retry with a different tier. This handles cases where:
    # - Tier 1 returns 500+ chars of marketing text (not a policy)
    # - Tier 2 (Spark agent) returns garbage that fails validation
    if not validation.is_valid and sr.tier_used in (1, 2):
        result.smart_escalations += 1
        logger.info(
            "Content rejected from Tier %d for %s, attempting smart escalation",
            sr.tier_used,
            sr.task.policy_url,
        )
        escalation_sr = scrape_task_with_escalation(
            scraper,
            sr.task,
            validation.rejection_reason or "content validation failed",
            agent=agent,
        )
        if escalation_sr.success:
            # Re-run the pipeline on the escalated result
            effective_date = extract_effective_date(escalation_sr.raw_markdown)
            cleaned = clean_markdown(escalation_sr.raw_markdown)
            validation = validate_content(
                cleaned,
                source_url=str(sr.task.policy_url),
                policy_type=sr.task.policy_type,
            )
            if validation.is_valid:
                result.smart_escalation_recovered += 1
                logger.info(
                    "Smart escalation recovered %s (score=%.1f)",
                    sr.task.policy_url,
                    validation.score,
                )

    if not validation.is_valid:
        result.content_rejected += 1
        result.errors.append(
            f"Content rejected for {sr.task.policy_url}: "
            f"{validation.rejection_reason}"
        )
        result.completeness_entries.append(CompletenessEntry(
            level="FAILED",
            url=str(sr.task.policy_url),
            message=(
                f"Content rejected (score={validation.score:.1f}): "
                f"{validation.rejection_reason}"
            ),
            error_type="content_rejected",
        ))
        logger.warning(
            "Content rejected for %s (score=%.1f): %s",
            sr.task.policy_url,
            validation.score,
            validation.rejection_reason,
        )
        return

    if validation.warnings:
        for warning in validation.warnings:
            result.completeness_entries.append(CompletenessEntry(
                level="LOW_CONFIDENCE",
                url=str(sr.task.policy_url),
                message=f"Accepted (score={validation.score:.1f}) — {warning}",
            ))
        logger.info(
            "Content accepted for %s with warnings: %s",
            sr.task.policy_url,
            validation.warnings,
        )

    doc = build_policy_document(sr.task, cleaned, effective_date=effective_date)

    if is_duplicate(doc, existing_ids):
        result.policies_duplicate += 1
        return

    _upsert_and_sync(doc, settings, storage, store, result)


def _rescrape_policy(
    policy: PolicyDocument,
    scraper: ScraperProtocol,
    agent: AgentProtocol | None,
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
    result: PipelineResult,
) -> None:
    """Re-scrape a single policy and process changes.

    Uses the full 3-tier scraping cascade (not just basic fetch)
    because pages that previously worked with Tier 1 may now
    require JS rendering or agent navigation.
    """
    task = ScrapingTask(
        company_id=policy.author_id,
        company_name=policy.title,
        category="",
        policy_url=str(policy.source_url),
        policy_type=policy.policy_type,
    )
    sr = scrape_task(scraper, task, agent=agent)

    if not sr.success:
        result.scrape_failed += 1
        result.errors.append(f"Scrape failed {policy.source_url}: {sr.error}")
        return
    result.scrape_success += 1

    if sr.pdf_extracted:
        result.pdfs_extracted += 1
    if sr.iframe_content:
        result.iframes_detected += len(sr.iframe_content)

    effective_date = extract_effective_date(sr.raw_markdown)
    cleaned = clean_markdown(sr.raw_markdown)

    # Content quality gate for re-scrapes too
    validation = validate_content(
        cleaned,
        source_url=str(policy.source_url),
        policy_type=policy.policy_type,
    )

    # Smart escalation for re-scrapes (covers both Tier 1 and Tier 2)
    if not validation.is_valid and sr.tier_used in (1, 2):
        result.smart_escalations += 1
        escalation_sr = scrape_task_with_escalation(
            scraper,
            task,
            validation.rejection_reason or "content validation failed",
            agent=agent,
        )
        if escalation_sr.success:
            effective_date = extract_effective_date(escalation_sr.raw_markdown)
            cleaned = clean_markdown(escalation_sr.raw_markdown)
            validation = validate_content(
                cleaned,
                source_url=str(policy.source_url),
                policy_type=policy.policy_type,
            )
            if validation.is_valid:
                result.smart_escalation_recovered += 1

    if not validation.is_valid:
        result.content_rejected += 1
        result.errors.append(
            f"Re-scrape content rejected for {policy.source_url}: "
            f"{validation.rejection_reason}"
        )
        logger.warning(
            "Re-scrape content rejected for %s: %s",
            policy.source_url,
            validation.rejection_reason,
        )
        return

    from plaindr.utils.hashing import md5_hash

    new_doc = policy.model_copy(
        update={
            "id": md5_hash(cleaned),
            "content": cleaned,
            "effective_date": effective_date or policy.effective_date,
        }
    )

    _upsert_and_sync(new_doc, settings, storage, store, result)


def _upsert_and_sync(
    doc: PolicyDocument,
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
    result: PipelineResult,
) -> None:
    """Upsert policy to Supabase Storage with version tracking.

    - New policy: write .md with YAML frontmatter to policies bucket.
    - Changed policy: archive old version, compute diff, overwrite current.
    - Unchanged policy (same content_hash): skip.
    """
    existing = store.get_policy_by_source_url(str(doc.source_url))
    company_name = store.get_company_name(doc.author_id) or doc.title
    company_slug = _slugify(company_name)
    filename = _policy_filename(doc.policy_type, str(doc.source_url))

    if existing is not None:
        # Same content hash means nothing changed
        if existing.id == doc.id:
            result.policies_unchanged += 1
            return

        # Semantic-equivalence guard: even if the raw MD5 differs, the
        # content may be identical after stripping markdown syntax and
        # whitespace. This catches phantom diffs from scraper output
        # drift (trailing whitespace, link-syntax variations, widget
        # leakage) that survived clean_markdown. Treat as unchanged.
        if semantic_hash(existing.content) == semantic_hash(doc.content):
            logger.info(
                "Semantic-equivalent content for %s — skipping diff "
                "(raw hashes differ: %s vs %s)",
                doc.source_url, existing.id[:8], doc.id[:8],
            )
            result.policies_unchanged += 1
            return

        # Phantom-hunk guard: compute_diff filters whitespace-only and
        # token-permutation noise hunks; if nothing real survives, treat
        # as unchanged so we don't archive or bump the version for noise.
        hunks = compute_diff(existing.content, doc.content)
        if not hunks:
            logger.info(
                "All hunks filtered as phantom for %s — skipping diff "
                "(raw hashes differ: %s vs %s)",
                doc.source_url, existing.id[:8], doc.id[:8],
            )
            result.policies_unchanged += 1
            return

        # Content changed — archive old version, compute diff, overwrite
        result.policies_changed += 1
        doc = doc.model_copy(update={"version": existing.version + 1})

        _archive_old_version(existing, company_slug, filename, storage)
        _compute_and_store_diff(
            existing, doc, company_slug, filename, settings, storage, store,
            precomputed_hunks=hunks,
        )
        result.diffs_computed += 1
    else:
        result.policies_new += 1

    # Write current version to the policies bucket
    md_content = _build_policy_markdown(doc, company_name)
    try:
        storage.upload_policy(company_slug, filename, md_content)
        store.register_policy(doc)
    except Exception as e:
        result.errors.append(f"Storage upload failed {doc.source_url}: {e}")
        logger.exception("Storage upload failed for %s", doc.source_url)


def _archive_old_version(
    old: PolicyDocument,
    company_slug: str,
    filename: str,
    storage: SupabaseStorageClient,
) -> None:
    """Upload the old policy version to the archive bucket."""
    policy_name = filename.removesuffix(".md")
    archive_filename = f"v{old.version}.md"
    try:
        storage.upload_archive(company_slug, policy_name, archive_filename, old.content)
    except Exception as e:
        logger.exception(
            "Failed to archive v%d of %s: %s", old.version, old.source_url, e,
        )


def _compute_and_store_diff(
    old: PolicyDocument,
    new: PolicyDocument,
    company_slug: str,
    filename: str,
    settings: Settings,
    storage: SupabaseStorageClient,
    store: PolicyStore,
    precomputed_hunks: list | None = None,
) -> None:
    """Compute diff between old and new policy, run AI analysis, upload to archive.

    `precomputed_hunks` lets the caller pass in already-filtered hunks
    so we don't redo the diff work after the phantom-hunk guard.
    """
    hunks = precomputed_hunks if precomputed_hunks is not None else compute_diff(
        old.content, new.content,
    )
    diff_text = diff_to_unified_text(hunks)
    stats = diff_summary_stats(hunks)

    # Get company name for AI analysis
    company_name = store.get_company_name(old.author_id) or old.title

    # AI analysis (wrapped in try/except — always store diff)
    analysis = None
    analysis_status = "pending"
    analysis_error = None

    try:
        analysis = analyze_policy_change(
            company_name=company_name,
            policy_type=old.policy_type,
            old_effective_date=old.effective_date,
            new_effective_date=new.effective_date,
            diff_text=diff_text,
            settings=settings,
        )
        analysis_status = "completed"
    except Exception as e:
        analysis_status = "failed"
        analysis_error = str(e)
        logger.exception("AI analysis failed for %s", old.source_url)

    diff_doc = DiffDocument(
        id=f"{old.id}_{new.id}",
        source_url=old.source_url,
        author_id=old.author_id,
        old_version_id=old.id,
        new_version_id=new.id,
        old_version=old.version,
        new_version=new.version,
        old_effective_date=old.effective_date,
        new_effective_date=new.effective_date,
        diff_text=diff_text,
        stats=stats,
        analysis=analysis,
        analysis_status=analysis_status,
        analysis_error=analysis_error,
    )

    # Serialize diff to JSON and upload to archive bucket
    policy_name = filename.removesuffix(".md")
    diff_filename = f"v{old.version}-to-v{new.version}.json"
    analysis_json = diff_doc.model_dump_json(indent=2)

    try:
        storage.upload_archive(
            company_slug, policy_name, diff_filename, analysis_json,
        )
    except Exception as e:
        logger.exception(
            "Failed to upload diff analysis for %s: %s", old.source_url, e,
        )


def _write_completeness_report(
    result: PipelineResult,
    run_type: str,
) -> Path | None:
    """Write a completeness report log file after a pipeline run.

    The report lists every URL that had a problem — failures,
    content rejections, low-confidence acceptances, and warnings.
    This enables manual review of risky results before using the
    data for compliance decisions.

    Reports are written to logs/completeness/ with timestamps.
    Returns the path to the report file, or None if nothing to report.
    """
    if not result.completeness_entries and not result.errors:
        logger.info("Completeness report: no issues to report")
        return None

    log_dir = Path("logs/completeness")
    log_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    report_path = log_dir / f"{run_type}_{timestamp}.log"

    lines: list[str] = []
    lines.append(f"# Plaindr Completeness Report — {run_type}")
    lines.append(f"# Generated: {datetime.now(UTC).isoformat()}")
    lines.append("#")
    lines.append("# Summary:")
    lines.append(f"#   Tasks total:       {result.tasks_total}")
    lines.append(f"#   Scrape success:     {result.scrape_success}")
    lines.append(f"#   Scrape failed:      {result.scrape_failed}")
    lines.append(f"#   Content rejected:   {result.content_rejected}")
    lines.append(f"#   Smart escalations:  {result.smart_escalations}")
    lines.append(f"#   Escalation recovered: {result.smart_escalation_recovered}")
    lines.append(f"#   PDFs extracted:     {result.pdfs_extracted}")
    lines.append(f"#   Iframes detected:   {result.iframes_detected}")
    lines.append(f"#   Policies new:       {result.policies_new}")
    lines.append(f"#   Policies changed:   {result.policies_changed}")
    lines.append(f"#   Policies unchanged: {result.policies_unchanged}")
    lines.append("")

    # Group entries by level for readability
    for level in ("FAILED", "WARNING", "LOW_CONFIDENCE", "INFO"):
        entries = [e for e in result.completeness_entries if e.level == level]
        if not entries:
            continue
        lines.append(f"## {level} ({len(entries)} entries)")
        lines.append("")
        for entry in entries:
            error_suffix = f" [{entry.error_type}]" if entry.error_type else ""
            lines.append(f"[{entry.level}]{error_suffix} {entry.url}")
            lines.append(f"  {entry.message}")
            lines.append("")

    report_text = "\n".join(lines)
    report_path.write_text(report_text)

    logger.info(
        "Completeness report written to %s (%d entries)",
        report_path,
        len(result.completeness_entries),
    )
    return report_path
