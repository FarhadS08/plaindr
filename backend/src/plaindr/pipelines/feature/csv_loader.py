"""CSV Task Explosion — reads the Tools Database CSV
and produces individual scraping tasks."""

import csv
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from plaindr.models.company import CompanyDocument


@dataclass
class ScrapingTask:
    """A single URL to scrape, linked back to its parent company."""

    company_id: UUID
    company_name: str
    category: str
    policy_url: str
    policy_type: str  # e.g. "privacy", "tos", "security"


# Maps CSV column names to policy_type values
_POLICY_COLUMNS: list[tuple[str, str]] = [
    ("Privacy", "privacy"),
    ("ToS", "tos"),
    ("Security and Complince", "security"),
    ("Additonal", "general"),
]


def _extract_urls(cell: str) -> list[str]:
    """Extract URLs from a cell that may contain newline-separated URLs."""
    urls: list[str] = []
    for line in cell.replace(";", "\n").split("\n"):
        url = line.strip()
        if url and url.startswith("http"):
            urls.append(url)
    return urls


def load_and_explode(
    csv_path: Path,
    *,
    max_tools: int = 100,
) -> tuple[
    list[CompanyDocument],
    list[ScrapingTask],
]:
    """Read the Tools Database CSV and explode rows into tasks.

    The CSV has these columns:
        - # (row number)
        - Tool Name
        - Category
        - URL (main homepage)
        - Privacy (newline-separated privacy policy URLs)
        - ToS (newline-separated terms of service URLs)
        - Security and Complince (newline-separated security URLs)
        - Additonal (newline-separated additional policy URLs)

    Args:
        csv_path: Path to the CSV file.
        max_tools: Maximum number of tools to process (default 100).

    Returns:
        A tuple of (companies, tasks). Each company appears once.
        Each URL becomes its own ScrapingTask with its policy_type.
    """
    companies: list[CompanyDocument] = []
    tasks: list[ScrapingTask] = []

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if len(companies) >= max_tools:
                break
            name = row.get("Tool Name", "").strip()
            category = row.get("Category", "").strip()
            main_url = row.get("URL", "").strip()

            # Skip rows without a name or valid URL
            if not name or not main_url or not main_url.startswith("http"):
                continue

            company = CompanyDocument(
                name=name,
                category=category,
                main_url=main_url,
            )
            companies.append(company)

            for col_name, policy_type in _POLICY_COLUMNS:
                cell = row.get(col_name, "")
                if not cell or cell.strip() in ("N/A", ""):
                    continue
                for url in _extract_urls(cell):
                    tasks.append(
                        ScrapingTask(
                            company_id=company.id,
                            company_name=company.name,
                            category=company.category,
                            policy_url=url,
                            policy_type=policy_type,
                        )
                    )

    return companies, tasks
