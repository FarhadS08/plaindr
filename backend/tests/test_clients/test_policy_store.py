"""Tests for the in-memory PolicyStore backed by Supabase Storage."""

from datetime import UTC, date, datetime
from unittest.mock import MagicMock
from uuid import UUID

import pytest
import yaml

from plaindr.clients.policy_store import PolicyStore
from plaindr.models.company import CompanyDocument
from plaindr.utils.hashing import md5_hash

# ── Test data ───────────────────────────────────────────

COMPANY_A_ID = UUID("aaaaaaaa-0000-0000-0000-000000000001")
COMPANY_B_ID = UUID("bbbbbbbb-0000-0000-0000-000000000002")

_CONTENT_A = (
    "# Privacy Policy\n\n"
    "Acme Corp respects your privacy. We collect minimal data and never "
    "share your information with third parties without your explicit consent."
)
_CONTENT_B = (
    "# Terms of Service\n\n"
    "By using Globex services you agree to the following terms and conditions. "
    "Your use of the service constitutes acceptance of these terms."
)

COMPANIES_YAML = yaml.dump(
    [
        {
            "id": str(COMPANY_A_ID),
            "name": "Acme Corp",
            "slug": "acme-corp",
            "category": "coding",
            "main_url": "https://acme.example.com",
            "aliases": ["acme"],
        },
        {
            "id": str(COMPANY_B_ID),
            "name": "Globex",
            "slug": "globex",
            "category": "analytics",
            "main_url": "https://globex.example.com",
            "aliases": ["globex corporation"],
        },
    ],
    default_flow_style=False,
)


def _build_policy_md(
    source_url: str,
    company: str,
    company_id: UUID,
    policy_type: str,
    content: str,
    title: str = "Policy",
    version: int = 1,
) -> str:
    content_hash = md5_hash(content)
    fm = yaml.dump(
        {
            "source_url": source_url,
            "company": company,
            "company_id": str(company_id),
            "policy_type": policy_type,
            "title": title,
            "effective_date": "2025-01-15",
            "scraped_at": "2025-01-15T12:00:00",
            "content_hash": content_hash,
            "version": version,
            "summary": f"Summary of {title}",
        },
        default_flow_style=False,
    )
    return f"---\n{fm}---\n\n{content}"


POLICY_A_MD = _build_policy_md(
    source_url="https://acme.example.com/privacy",
    company="Acme Corp",
    company_id=COMPANY_A_ID,
    policy_type="privacy",
    content=_CONTENT_A,
    title="Acme Privacy Policy",
)

POLICY_B_MD = _build_policy_md(
    source_url="https://globex.example.com/terms",
    company="Globex",
    company_id=COMPANY_B_ID,
    policy_type="tos",
    content=_CONTENT_B,
    title="Globex Terms of Service",
)


# ── Fixtures ────────────────────────────────────────────


@pytest.fixture
def mock_storage() -> MagicMock:
    """Mock SupabaseStorageClient that returns test data."""
    storage = MagicMock()

    # download_text returns companies.yaml or policy .md
    def _download_text(bucket: str, path: str) -> str:
        if path == "companies.yaml":
            return COMPANIES_YAML
        raise FileNotFoundError(path)

    storage.download_text.side_effect = _download_text

    # download_all_policies returns the .md files
    storage.download_all_policies.return_value = {
        "acme-corp/privacy-policy.md": POLICY_A_MD,
        "globex/terms-of-service.md": POLICY_B_MD,
    }

    # list_files returns empty for diffs
    storage.list_files.return_value = []

    return storage


@pytest.fixture
def mock_settings() -> MagicMock:
    settings = MagicMock()
    settings.policies_bucket = "policies"
    settings.archive_bucket = "policies-archive"
    return settings


@pytest.fixture
def store(mock_storage: MagicMock, mock_settings: MagicMock) -> PolicyStore:
    s = PolicyStore(mock_storage, mock_settings)
    s.load()
    return s


# ── Company tests ───────────────────────────────────────


class TestCompanyLoading:
    def test_loads_all_companies(self, store: PolicyStore) -> None:
        assert store.count_companies() == 2

    def test_get_company_by_id(self, store: PolicyStore) -> None:
        c = store.get_company(COMPANY_A_ID)
        assert c is not None
        assert c.name == "Acme Corp"

    def test_get_company_by_name_exact(self, store: PolicyStore) -> None:
        c = store.get_company_by_name("Acme Corp")
        assert c is not None
        assert c.id == COMPANY_A_ID

    def test_get_company_by_name_case_insensitive(
        self, store: PolicyStore
    ) -> None:
        c = store.get_company_by_name("acme corp")
        assert c is not None
        assert c.id == COMPANY_A_ID

    def test_get_company_by_alias(self, store: PolicyStore) -> None:
        c = store.get_company_by_name("acme")
        assert c is not None
        assert c.id == COMPANY_A_ID

    def test_get_company_not_found(self, store: PolicyStore) -> None:
        assert store.get_company_by_name("nonexistent") is None

    def test_get_company_empty_string(self, store: PolicyStore) -> None:
        assert store.get_company_by_name("") is None


# ── Policy tests ────────────────────────────────────────


class TestPolicyLoading:
    def test_loads_all_policies(self, store: PolicyStore) -> None:
        assert store.count_policies() == 2

    def test_get_policy_by_source_url(self, store: PolicyStore) -> None:
        p = store.get_policy_by_source_url(
            "https://acme.example.com/privacy"
        )
        assert p is not None
        assert p.policy_type == "privacy"
        assert "Acme Corp" in p.content

    def test_get_policy_by_md5id(self, store: PolicyStore) -> None:
        expected_id = md5_hash(_CONTENT_A)
        p = store.get_policy(expected_id)
        assert p is not None
        assert str(p.source_url) == "https://acme.example.com/privacy"

    def test_get_policies_by_company(self, store: PolicyStore) -> None:
        policies = store.get_policies_by_company(COMPANY_A_ID)
        assert len(policies) == 1
        assert policies[0].policy_type == "privacy"

    def test_list_policies_with_content(self, store: PolicyStore) -> None:
        policies = store.list_policies(exclude_content=False)
        assert len(policies) == 2
        assert all(len(p.content) > 50 for p in policies)

    def test_list_policies_without_content(self, store: PolicyStore) -> None:
        policies = store.list_policies(exclude_content=True)
        assert len(policies) == 2
        assert all("[content excluded" in p.content for p in policies)


# ── Query Selection tests ───────────────────────────────


class TestSelectPolicies:
    def test_company_filter(self, store: PolicyStore) -> None:
        results = store.select_policies(
            "privacy policy", company_filter="Acme Corp"
        )
        assert len(results) == 1
        assert results[0].policy_type == "privacy"

    def test_company_detected_in_question(
        self, store: PolicyStore
    ) -> None:
        results = store.select_policies(
            "What does Acme Corp's privacy policy say about data?"
        )
        assert len(results) >= 1
        assert all(
            p.author_id == COMPANY_A_ID for p in results
        )

    def test_comparison_query_multiple_companies(
        self, store: PolicyStore
    ) -> None:
        results = store.select_policies(
            "Compare Acme Corp and Globex policies"
        )
        company_ids = {p.author_id for p in results}
        assert COMPANY_A_ID in company_ids
        assert COMPANY_B_ID in company_ids

    def test_policy_type_filter_without_company_is_empty(
        self, store: PolicyStore
    ) -> None:
        """Type filter alone no longer triggers deterministic selection —
        the LLM planner owns that path to avoid random grab-bag results.
        """
        results = store.select_policies(
            "terms of service", policy_type_filter="tos"
        )
        assert results == []

    def test_company_plus_type_filters_to_type(
        self, store: PolicyStore
    ) -> None:
        results = store.select_policies(
            "Acme Corp terms", policy_type_filter="tos"
        )
        # Acme has a privacy policy but no tos in the fixture — falls
        # back to the company's other policies rather than returning []
        assert all(p.author_id == COMPANY_A_ID for p in results)

    def test_general_query_without_company_is_empty(
        self, store: PolicyStore
    ) -> None:
        """Open-ended questions with no company mention return [] so
        the retriever knows to invoke the LLM planner."""
        assert store.select_policies("policy summary") == []
        assert store.select_policies("data privacy practices") == []

    def test_multi_company_results_interleave(
        self, store: PolicyStore
    ) -> None:
        """Regression: when both companies are detected, the first few
        entries must span both — not fill up one bucket before the
        other. This caused the Claude/ChatGPT comparison to return
        only ChatGPT sources and miss Anthropic entirely.
        """
        from plaindr.models.policy import PolicyDocument

        def _mk(company_id: UUID, idx: int, ptype: str) -> PolicyDocument:
            content = ("x" * 200) + f" policy {idx}"
            return PolicyDocument(
                id=md5_hash(f"{company_id}-{idx}"),
                author_id=company_id,
                title=f"Doc {idx}",
                policy_type=ptype,
                source_url=f"https://example.com/{company_id}/{idx}",
                content=content,
                summary="Summary line",
            )

        for i in range(5):
            store.register_policy(_mk(COMPANY_A_ID, i, "privacy"))
            store.register_policy(_mk(COMPANY_B_ID, i, "privacy"))

        results = store.select_policies(
            "Compare Acme Corp and Globex privacy policies"
        )
        # First 4 must include both companies — not one bucket in a row.
        first_four = {p.author_id for p in results[:4]}
        assert COMPANY_A_ID in first_four
        assert COMPANY_B_ID in first_four


# ── Frontmatter parsing tests ──────────────────────────


class TestFrontmatterParsing:
    def test_parses_effective_date(self, store: PolicyStore) -> None:
        p = store.get_policy_by_source_url(
            "https://acme.example.com/privacy"
        )
        assert p is not None
        assert p.effective_date == date(2025, 1, 15)

    def test_parses_scraped_at(self, store: PolicyStore) -> None:
        p = store.get_policy_by_source_url(
            "https://acme.example.com/privacy"
        )
        assert p is not None
        assert isinstance(p.scraped_at, datetime)

    def test_parses_version(self, store: PolicyStore) -> None:
        p = store.get_policy_by_source_url(
            "https://acme.example.com/privacy"
        )
        assert p is not None
        assert p.version == 1

    def test_skips_file_with_missing_frontmatter(
        self, mock_storage: MagicMock, mock_settings: MagicMock
    ) -> None:
        mock_storage.download_all_policies.return_value = {
            "bad/policy.md": "No frontmatter here, just content " * 5,
        }
        s = PolicyStore(mock_storage, mock_settings)
        s.load()
        assert s.count_policies() == 0

    def test_skips_file_with_short_content(
        self, mock_storage: MagicMock, mock_settings: MagicMock
    ) -> None:
        short_md = _build_policy_md(
            source_url="https://example.com/short",
            company="Test",
            company_id=COMPANY_A_ID,
            policy_type="general",
            content="Too short",
            title="Short",
        )
        mock_storage.download_all_policies.return_value = {
            "test/short.md": short_md,
        }
        s = PolicyStore(mock_storage, mock_settings)
        s.load()
        assert s.count_policies() == 0


# ── Reload tests ────────────────────────────────────────


class TestReload:
    def test_reload_refreshes_cache(
        self, store: PolicyStore, mock_storage: MagicMock
    ) -> None:
        assert store.count_policies() == 2

        # Change what storage returns
        mock_storage.download_all_policies.return_value = {
            "acme-corp/privacy-policy.md": POLICY_A_MD,
        }
        store.reload()
        assert store.count_policies() == 1


# ── find_canonical_by_url tests ─────────────────────────


class TestFindCanonicalByUrl:
    def test_exact_match(self, store: PolicyStore) -> None:
        p = store.find_canonical_by_url("https://acme.example.com/privacy")
        assert p is not None
        assert p.policy_type == "privacy"

    def test_case_insensitive_host(self, store: PolicyStore) -> None:
        p = store.find_canonical_by_url("https://ACME.example.com/privacy")
        assert p is not None

    def test_trailing_slash_stripped(self, store: PolicyStore) -> None:
        p = store.find_canonical_by_url("https://acme.example.com/privacy/")
        assert p is not None

    def test_www_prefix_ignored(self, store: PolicyStore) -> None:
        p = store.find_canonical_by_url("https://www.acme.example.com/privacy")
        assert p is not None

    def test_no_match_returns_none(self, store: PolicyStore) -> None:
        p = store.find_canonical_by_url("https://unknown.example.com/privacy")
        assert p is None

    def test_different_path_does_not_match(self, store: PolicyStore) -> None:
        # Path case/content should still discriminate.
        p = store.find_canonical_by_url("https://acme.example.com/other")
        assert p is None
