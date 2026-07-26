"""Regression tests for PostgREST filter-injection hardening.

`_fetch_user_policies_for_scope` interpolates scope ids into PostgREST's
`or=` grammar. `_safe_scope_id` must drop anything that could break out of
a single filter clause (commas, dots/operators, wildcards, whitespace).
"""

import pytest

from plaindr.pipelines.inference.retriever import _safe_scope_id


@pytest.mark.parametrize(
    "value",
    [
        "d3b07384-d9a0-4f1e-8b2a-1c2d3e4f5a6b",  # supabase UUID
        "user_2abcDEF123",  # clerk-style id
        "org-1",
        "ABC_def-123",
    ],
)
def test_accepts_plain_ids(value: str) -> None:
    assert _safe_scope_id(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "x,storage_path.like.*",  # the injection payload from the audit
        "user_id.eq.1",
        "a.b",  # dot enables PostgREST operators
        "a,b",  # comma adds a clause
        "a b",  # whitespace
        "*",  # wildcard
        "1;drop",
        "a)or(1",
        "",  # empty
    ],
)
def test_drops_injection_payloads(value: str) -> None:
    assert _safe_scope_id(value) is None


def test_none_passthrough() -> None:
    assert _safe_scope_id(None) is None
