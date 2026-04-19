"""Tests for CSV task explosion."""

import csv
from pathlib import Path

from plaindr.pipelines.feature.csv_loader import load_and_explode

# Matches actual Tools Database CSV columns
_FIELDNAMES = [
    "#",
    "Tool Name",
    "Category",
    "URL",
    "Privacy",
    "ToS",
    "Security and Complince",
    "Additonal",
]


def _write_csv(rows: list[dict], path: Path) -> None:
    """Write a list of dicts to CSV at the given path."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


class TestLoadAndExplode:
    def test_single_row_single_url(self, tmp_path):
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "OpenAI",
                    "Category": "coding",
                    "URL": "https://openai.com",
                    "Privacy": "https://openai.com/privacy",
                    "ToS": "",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        assert len(companies) == 1
        assert companies[0].name == "OpenAI"
        assert companies[0].category == "coding"

        assert len(tasks) == 1
        assert tasks[0].policy_url == "https://openai.com/privacy"
        assert tasks[0].policy_type == "privacy"
        assert tasks[0].company_id == companies[0].id

    def test_multi_url_explosion(self, tmp_path):
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "Acme",
                    "Category": "health",
                    "URL": "https://acme.com",
                    "Privacy": "https://acme.com/priv\nhttps://acme.com/priv2",
                    "ToS": "https://acme.com/terms",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        assert len(companies) == 1
        assert len(tasks) == 3
        assert tasks[0].policy_type == "privacy"
        assert tasks[1].policy_type == "privacy"
        assert tasks[2].policy_type == "tos"

    def test_all_policy_columns(self, tmp_path):
        """Each policy column maps to its own policy_type."""
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "Full",
                    "Category": "ai",
                    "URL": "https://full.com",
                    "Privacy": "https://full.com/privacy",
                    "ToS": "https://full.com/tos",
                    "Security and Complince": "https://full.com/security",
                    "Additonal": "https://full.com/other",
                },
            ],
            csv_path,
        )
        _, tasks = load_and_explode(csv_path)

        assert len(tasks) == 4
        types = [t.policy_type for t in tasks]
        assert types == ["privacy", "tos", "security", "general"]

    def test_data_lineage_preservation(self, tmp_path):
        """Each task retains parent company metadata."""
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "Corp",
                    "Category": "finance",
                    "URL": "https://corp.io",
                    "Privacy": "https://corp.io/priv",
                    "ToS": "https://corp.io/tos",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        for task in tasks:
            assert task.company_id == companies[0].id
            assert task.company_name == "Corp"
            assert task.category == "finance"

    def test_multiple_rows(self, tmp_path):
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "A",
                    "Category": "a",
                    "URL": "https://a.com",
                    "Privacy": "https://a.com/p",
                    "ToS": "",
                    "Security and Complince": "",
                    "Additonal": "",
                },
                {
                    "#": "2",
                    "Tool Name": "B",
                    "Category": "b",
                    "URL": "https://b.com",
                    "Privacy": "https://b.com/p1",
                    "ToS": "https://b.com/tos",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        assert len(companies) == 2
        assert len(tasks) == 3

    def test_whitespace_trimming(self, tmp_path):
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "  Spaced  ",
                    "Category": "  cat  ",
                    "URL": "https://spaced.com",
                    "Privacy": "  https://spaced.com/p  ",
                    "ToS": "",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        assert companies[0].name == "Spaced"
        assert companies[0].category == "cat"
        assert tasks[0].policy_url == "https://spaced.com/p"
        assert tasks[0].policy_type == "privacy"

    def test_empty_csv(self, tmp_path):
        csv_path = tmp_path / "tools.csv"
        _write_csv([], csv_path)
        companies, tasks = load_and_explode(csv_path)

        assert companies == []
        assert tasks == []

    def test_na_values_skipped(self, tmp_path):
        """Cells with N/A should not produce tasks."""
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "NoPolicy",
                    "Category": "misc",
                    "URL": "https://nopol.com",
                    "Privacy": "N/A",
                    "ToS": "N/A",
                    "Security and Complince": "N/A",
                    "Additonal": "N/A",
                },
            ],
            csv_path,
        )
        companies, tasks = load_and_explode(csv_path)

        assert len(companies) == 1
        assert len(tasks) == 0

    def test_max_tools_limit(self, tmp_path):
        """Only the first max_tools companies are processed."""
        csv_path = tmp_path / "tools.csv"
        rows = [
            {
                "#": str(i),
                "Tool Name": f"Tool{i}",
                "Category": "ai",
                "URL": f"https://tool{i}.com",
                "Privacy": f"https://tool{i}.com/privacy",
                "ToS": "",
                "Security and Complince": "",
                "Additonal": "",
            }
            for i in range(1, 11)
        ]
        _write_csv(rows, csv_path)
        companies, tasks = load_and_explode(csv_path, max_tools=3)

        assert len(companies) == 3
        assert len(tasks) == 3

    def test_semicolon_separated_urls(self, tmp_path):
        """URLs separated by semicolons should be split correctly."""
        csv_path = tmp_path / "tools.csv"
        _write_csv(
            [
                {
                    "#": "1",
                    "Tool Name": "Multi",
                    "Category": "ai",
                    "URL": "https://multi.com",
                    "Privacy": "https://multi.com/p1;https://multi.com/p2",
                    "ToS": "",
                    "Security and Complince": "",
                    "Additonal": "",
                },
            ],
            csv_path,
        )
        _, tasks = load_and_explode(csv_path)

        assert len(tasks) == 2
        assert tasks[0].policy_url == "https://multi.com/p1"
        assert tasks[1].policy_url == "https://multi.com/p2"
