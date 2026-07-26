"""Security tests for the query router's scope resolution.

Covers the fix that stopped `/api/query` from trusting body-supplied
identity: user_id now comes only from a verified token, and any
organization_id is honored only after a membership check.
"""

import pytest
from fastapi import HTTPException

from plaindr.api.routers import query as q


class _FakeTable:
    def __init__(self, *, member: bool = False, jwt_user: str | None = None):
        self._member = member
        self._jwt_user = jwt_user

    def is_org_member(self, user_id: str, org_id: str) -> bool:
        return self._member

    def verify_jwt(self, token: str) -> str | None:
        return self._jwt_user


def _patch_table(monkeypatch: pytest.MonkeyPatch, table: _FakeTable) -> None:
    monkeypatch.setattr(q, "SupabaseTableClient", lambda settings: table)


def test_no_org_passes_user_through(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_table(monkeypatch, _FakeTable())
    req = q.QueryRequest(question="hi")
    assert q._resolve_scope(req, "user-1", settings=None) == ("user-1", None)


def test_anonymous_no_org_is_canonical_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_table(monkeypatch, _FakeTable())
    req = q.QueryRequest(question="hi")
    assert q._resolve_scope(req, None, settings=None) == (None, None)


def test_org_scope_requires_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_table(monkeypatch, _FakeTable(member=True))
    req = q.QueryRequest(question="hi", organization_id="org-1")
    with pytest.raises(HTTPException) as exc:
        q._resolve_scope(req, None, settings=None)
    assert exc.value.status_code == 401


def test_org_scope_rejects_non_member(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_table(monkeypatch, _FakeTable(member=False))
    req = q.QueryRequest(question="hi", organization_id="victim-org")
    with pytest.raises(HTTPException) as exc:
        q._resolve_scope(req, "attacker", settings=None)
    assert exc.value.status_code == 403


def test_org_scope_allows_member(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_table(monkeypatch, _FakeTable(member=True))
    req = q.QueryRequest(question="hi", organization_id="org-1")
    assert q._resolve_scope(req, "user-1", settings=None) == ("user-1", "org-1")


def test_query_request_has_no_user_id_field() -> None:
    # Identity must never be caller-supplied — the field is gone.
    assert "user_id" not in q.QueryRequest.model_fields


def test_optional_user_none_without_bearer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_table(monkeypatch, _FakeTable(jwt_user="should-not-be-used"))
    assert q._optional_user(authorization=None, settings=None) is None
    assert q._optional_user(authorization="Basic xyz", settings=None) is None
    assert q._optional_user(authorization="Bearer   ", settings=None) is None


def test_optional_user_resolves_valid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_table(monkeypatch, _FakeTable(jwt_user="user-42"))
    assert q._optional_user(authorization="Bearer good", settings=None) == "user-42"
