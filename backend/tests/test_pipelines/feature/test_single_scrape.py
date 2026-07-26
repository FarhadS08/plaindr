"""Tests for the one-shot user-submission scrape wrapper."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from plaindr.pipelines.feature.scraper import ScrapeResult
from plaindr.pipelines.feature.single_scrape import (
    SingleScrapeResult,
    scrape_single_url,
)

# The real scrape_single_url runs the SSRF guard (DNS resolution) before
# fetching. Patch it to a passthrough in the happy-path tests so they stay
# network-free; the guard itself is covered in tests/test_utils/test_url_guard
# and by test_scrape_single_url_blocks_internal below.
_NO_SSRF = patch(
    "plaindr.pipelines.feature.single_scrape.resolve_and_assert_public",
    lambda url: url,
)


def _fake_task_result(markdown: str, success: bool = True) -> ScrapeResult:
    task = MagicMock()
    task.policy_url = "https://example.com/privacy"
    return ScrapeResult(
        task=task,
        raw_markdown=markdown,
        success=success,
        error=None if success else "boom",
    )


@_NO_SSRF
@patch("plaindr.pipelines.feature.single_scrape._create_clients")
@patch("plaindr.pipelines.feature.single_scrape.scrape_task")
def test_scrape_single_url_success(
    mock_scrape: MagicMock,
    mock_create: MagicMock,
) -> None:
    mock_create.return_value = (MagicMock(), None, None)
    mock_scrape.return_value = _fake_task_result(
        "# Privacy Policy\n\n"
        "This is a reasonably long policy document we collect data about users "
        "and protect it with industry standard measures at all times."
    )
    settings = MagicMock()

    result = scrape_single_url("https://example.com/privacy", settings)

    assert isinstance(result, SingleScrapeResult)
    assert result.error is None
    assert result.markdown is not None
    assert result.content_hash is not None
    assert len(result.content_hash) == 32
    assert result.title == "Privacy Policy"


@_NO_SSRF
@patch("plaindr.pipelines.feature.single_scrape._create_clients")
@patch("plaindr.pipelines.feature.single_scrape.scrape_task")
def test_scrape_single_url_failure_captured(
    mock_scrape: MagicMock,
    mock_create: MagicMock,
) -> None:
    mock_create.return_value = (MagicMock(), None, None)
    mock_scrape.return_value = _fake_task_result("", success=False)
    settings = MagicMock()

    result = scrape_single_url("https://example.com/privacy", settings)

    assert result.markdown is None
    assert result.error is not None


@_NO_SSRF
@patch("plaindr.pipelines.feature.single_scrape._create_clients")
@patch("plaindr.pipelines.feature.single_scrape.scrape_task")
def test_scrape_single_url_exception_captured(
    mock_scrape: MagicMock,
    mock_create: MagicMock,
) -> None:
    mock_create.side_effect = RuntimeError("client setup failed")
    settings = MagicMock()

    result = scrape_single_url("https://example.com/privacy", settings)

    assert result.markdown is None
    assert result.error is not None
    assert "Scrape crashed" in result.error


def test_scrape_single_url_blocks_internal() -> None:
    # A literal internal IP is rejected before any network/client setup —
    # no patching needed (the deterministic guard does no DNS).
    result = scrape_single_url(
        "http://169.254.169.254/latest/meta-data/", MagicMock()
    )

    assert result.markdown is None
    assert result.error is not None
    assert "Blocked internal URL" in result.error
