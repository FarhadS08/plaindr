"""Tests for the SSRF egress guard (plaindr.utils.url_guard)."""

import pytest

from plaindr.utils.url_guard import (
    SsrfError,
    assert_url_allowed,
    resolve_and_assert_public,
)


@pytest.mark.parametrize(
    "url",
    [
        "https://openai.com/privacy",
        "http://example.com/terms",
        "https://sub.domain.co.uk/policy",
    ],
)
def test_assert_url_allowed_accepts_public(url: str) -> None:
    assert assert_url_allowed(url) == url.strip()


@pytest.mark.parametrize(
    "url",
    [
        "ftp://openai.com",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "http://",  # no host
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "http://127.0.0.1:8000/admin",
        "http://localhost/internal",
        "http://10.0.0.5/",
        "http://192.168.1.1/",
        "http://172.16.4.2/",
        "http://[::1]/",  # IPv6 loopback
        "http://[fd00::1]/",  # IPv6 unique-local
        "http://[::ffff:169.254.169.254]/",  # IPv4-mapped metadata
    ],
)
def test_assert_url_allowed_rejects_internal(url: str) -> None:
    with pytest.raises(SsrfError):
        assert_url_allowed(url)


def test_resolve_rejects_hostname_pointing_at_private_ip() -> None:
    # Attacker-controlled domain whose A record is an internal address.
    def _evil_resolver(host: str) -> list[str]:
        return ["169.254.169.254"]

    with pytest.raises(SsrfError):
        resolve_and_assert_public(
            "https://evil.example.com/", resolver=_evil_resolver
        )


def test_resolve_accepts_hostname_pointing_at_public_ip() -> None:
    def _public_resolver(host: str) -> list[str]:
        return ["93.184.216.34"]  # a public address

    url = "https://good.example.com/privacy"
    assert resolve_and_assert_public(url, resolver=_public_resolver) == url


def test_resolve_rejects_when_any_address_is_internal() -> None:
    # Mixed answer — one public, one private. Must reject (fail closed).
    def _mixed_resolver(host: str) -> list[str]:
        return ["93.184.216.34", "10.1.2.3"]

    with pytest.raises(SsrfError):
        resolve_and_assert_public(
            "https://mixed.example.com/", resolver=_mixed_resolver
        )


def test_resolve_rejects_on_resolution_failure() -> None:
    def _failing_resolver(host: str) -> list[str]:
        raise OSError("dns down")

    with pytest.raises(SsrfError):
        resolve_and_assert_public(
            "https://nope.example.com/", resolver=_failing_resolver
        )


def test_resolve_skips_dns_for_literal_public_ip() -> None:
    # A public literal IP passes without invoking the resolver at all.
    def _boom(host: str) -> list[str]:  # pragma: no cover - must not run
        raise AssertionError("resolver should not be called for IP literals")

    assert resolve_and_assert_public("https://93.184.216.34/", resolver=_boom)
