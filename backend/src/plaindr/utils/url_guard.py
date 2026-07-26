"""SSRF egress guard.

User-submitted URLs are fetched by our own process (Playwright / httpx),
so an attacker who can make us scrape ``http://169.254.169.254/...`` or
``http://localhost:PORT/...`` can read cloud-metadata credentials or reach
internal-only services, and the fetched body is returned to the caller.
These helpers reject such destinations.

Two layers, deliberately separated so request handlers and unit tests can
stay network-free:

* :func:`assert_url_allowed` — cheap, deterministic, **no DNS**. Enforces
  the http/https scheme and rejects hosts that are *literally* private IPs
  or well-known internal names. Safe to call anywhere.
* :func:`resolve_and_assert_public` — everything above **plus** DNS
  resolution, rejecting when any resolved address is non-public. Defeats a
  public-looking hostname whose A/AAAA record points at an internal IP.
  Call it at the actual fetch boundary. The resolver is injectable so tests
  never touch the network.

Note: this resolves once and checks; the subsequent fetch re-resolves, so a
determined DNS-rebinding attacker retains a narrow window. It fully blocks
the practical cases (literal internal IPs and hostnames with static private
A records), which are the concrete exploits.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from collections.abc import Callable
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str], list[str]]

_ALLOWED_SCHEMES = frozenset({"http", "https"})

# Hostnames that never point anywhere public. Matched case-insensitively
# against the exact host. Private *IP literals* are handled separately.
_BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "ip6-localhost",
        "ip6-loopback",
        "metadata",
        "metadata.google.internal",
    }
)


class SsrfError(ValueError):
    """Raised when a URL points at a disallowed (internal) destination."""


def _ip_is_public(addr: IPAddress) -> bool:
    """True only for globally-routable, non-internal addresses."""
    # Unwrap IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) so the v4 rules
    # apply — the v6 wrapper's is_private/is_link_local don't catch these.
    mapped = getattr(addr, "ipv4_mapped", None)
    if mapped is not None:
        addr = mapped
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _host_ip_or_none(host: str) -> IPAddress | None:
    """Parse ``host`` as an IP literal, or return None if it's a name."""
    try:
        return ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return None


def assert_url_allowed(url: str) -> str:
    """Deterministic (no-DNS) SSRF pre-check.

    Returns the trimmed URL on success; raises :class:`SsrfError` for a
    non-http(s) scheme, a missing host, an internal hostname, or a private
    IP literal.
    """
    trimmed = url.strip()
    parsed = urlparse(trimmed)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise SsrfError("URL must use http or https")
    host = parsed.hostname
    if not host:
        raise SsrfError("URL must include a host")
    host_l = host.lower()
    if host_l in _BLOCKED_HOSTNAMES:
        raise SsrfError(f"Refusing to fetch internal host: {host}")
    ip = _host_ip_or_none(host_l)
    if ip is not None and not _ip_is_public(ip):
        raise SsrfError(f"Refusing to fetch internal address: {host}")
    return trimmed


def _default_resolver(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    return [info[4][0] for info in infos]


def resolve_and_assert_public(
    url: str, *, resolver: Resolver | None = None
) -> str:
    """No-DNS checks + DNS resolution; reject if any address is non-public."""
    trimmed = assert_url_allowed(url)
    host = (urlparse(trimmed).hostname or "").lower()
    # A literal IP already passed the public check in assert_url_allowed.
    if _host_ip_or_none(host) is not None:
        return trimmed
    resolve = resolver or _default_resolver
    try:
        addresses = resolve(host)
    except Exception as exc:  # noqa: BLE001 — any resolver failure → reject
        raise SsrfError(f"Could not resolve host: {host}") from exc
    if not addresses:
        raise SsrfError(f"Could not resolve host: {host}")
    for raw in addresses:
        ip = _host_ip_or_none(raw)
        if ip is None or not _ip_is_public(ip):
            raise SsrfError(
                f"Host {host} resolves to internal address {raw}"
            )
    return trimmed
