"""Tests for the one-shot user-submission scrape wrapper."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from plaindr.pipelines.feature.scraper import ScrapeResult
from plaindr.pipelines.feature.single_scrape import (
    SingleScrapeResult,
    scrape_single_url,
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
