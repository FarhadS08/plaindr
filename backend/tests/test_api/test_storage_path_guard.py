"""Regression tests for the user-policy storage-path ownership guard.

`_assert_owned_storage_path` is defense-in-depth: even if a row's
storage_path were tampered with, a read/delete must not reach an object
outside the row owner's `<owner_id>/` namespace.
"""

import pytest
from fastapi import HTTPException

from plaindr.api.routers.user_policies import _assert_owned_storage_path


def test_personal_owner_path_ok() -> None:
    row = {"user_id": "user-1", "organization_id": None}
    # Should not raise.
    _assert_owned_storage_path(row, "user-1/openai-privacy-abcd1234.md")


def test_org_owner_path_ok() -> None:
    row = {"user_id": None, "organization_id": "org-9"}
    _assert_owned_storage_path(row, "org-9/openai-terms-abcd1234.md")


@pytest.mark.parametrize(
    "storage_path",
    [
        "victim-org/secret.md",  # different owner prefix
        "user-2/secret.md",  # another user's object
        "user-1/../victim/secret.md",  # traversal out of the namespace
        "/etc/passwd",  # absolute path, wrong prefix
        "user-11/secret.md",  # prefix-lookalike (owner is "user-1")
    ],
)
def test_foreign_or_traversal_paths_rejected(storage_path: str) -> None:
    row = {"user_id": "user-1", "organization_id": None}
    with pytest.raises(HTTPException) as exc:
        _assert_owned_storage_path(row, storage_path)
    assert exc.value.status_code == 404


def test_missing_owner_rejected() -> None:
    row = {"user_id": None, "organization_id": None}
    with pytest.raises(HTTPException) as exc:
        _assert_owned_storage_path(row, "anything/x.md")
    assert exc.value.status_code == 404
