"""Tests for the /api/user-policies/discover endpoint."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from plaindr.api.app import create_app
from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.api.routers import user_policies as up
from plaindr.models.company import CompanyDocument


class _FakeFirecrawl:
    def map_policy_urls(self, domain_url: str) -> list[str]:
        return [
            "https://openai.com/policies/privacy-policy",
            "https://openai.com/policies/terms-of-use",
        ]


class _FakeStore:
    def __init__(self, companies: list[CompanyDocument]) -> None:
        self._companies = companies

    def list_companies(self) -> list[CompanyDocument]:
        return self._companies


class _FakeSettings:
    user_policies_enabled = True


class _FakeTable:
    def is_org_member(self, user_id: str, org_id: str) -> bool:
        return True


@pytest.fixture
def discover_client() -> Generator[TestClient, None, None]:
    # Build the app and override deps WITHOUT entering the lifespan
    # context (no `with`), so the PolicyStore warm-up never runs.
    app = create_app()
    # Seed a company on openai.com so resolve_company takes the MATCHED
    # path and never calls the LLM — keeps the test network-free.
    matched = CompanyDocument(
        name="OpenAI", category="AI Chat", main_url="https://openai.com"
    )
    app.dependency_overrides[up._require_feature_enabled] = lambda: None
    app.dependency_overrides[up._require_user] = lambda: "user-1"
    app.dependency_overrides[up._get_firecrawl] = lambda: _FakeFirecrawl()
    app.dependency_overrides[up._get_table_client] = lambda: _FakeTable()
    app.dependency_overrides[get_policy_store] = lambda: _FakeStore([matched])
    app.dependency_overrides[get_settings] = lambda: _FakeSettings()
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_discover_returns_company_and_policies(
    discover_client: TestClient,
) -> None:
    resp = discover_client.post(
        "/api/user-policies/discover",
        json={"url": "https://openai.com", "organization_id": None},
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["company"]["name"] == "OpenAI"
    assert body["company"]["matched"] is True
    assert len(body["policies"]) == 2
    assert all(
        p["url"].startswith("https://openai.com") for p in body["policies"]
    )


def test_discover_rejects_non_http(discover_client: TestClient) -> None:
    resp = discover_client.post(
        "/api/user-policies/discover",
        json={"url": "ftp://openai.com", "organization_id": None},
        headers={"Authorization": "Bearer test"},
    )
    assert resp.status_code == 400
