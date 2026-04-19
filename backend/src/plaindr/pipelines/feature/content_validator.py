"""Content quality gate — validates that scraped content is actually
a policy document before it reaches MongoDB.

This module sits between cleaning (refiner.py) and storage
(orchestrator.py → MongoDB). It catches garbage that passes the
empty-string check: error pages, login forms, navigation fragments,
marketing copy, and other non-policy content.

The validator uses a layered approach — each check is independent
and contributes to a composite quality score. Content must pass
ALL hard gates and meet a minimum quality score to proceed.
"""

import logging
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ── Hard Gates ────────────────────────────────────────────
# These are binary pass/fail checks. Failing ANY hard gate
# immediately rejects the content.

_MIN_CONTENT_LENGTH = 500  # chars — real policies are always longer

# Error page / access-denied indicators (case-insensitive).
# If ANY of these appear as a primary heading or dominant text,
# the page is likely not a policy.
_ERROR_PAGE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"^#\s*(?:404|403|401|429|500|502|503|error|page not found|"
        r"not found|access denied|forbidden|unauthorized|"
        r"too many requests|service unavailable|bad gateway)",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(
        r"(?:the page you (?:requested|were looking for)|"
        r"this page (?:doesn't|does not) exist|"
        r"you don't have (?:permission|access)|"
        r"please check the url|"
        r"page (?:has been|was) (?:removed|moved|deleted)|"
        r"rate limit (?:exceeded|reached)|"
        r"too many requests|"
        r"service (?:temporarily |is )?unavailable|"
        r"try again later|"
        r"under maintenance)",
        re.IGNORECASE,
    ),
]

# Login / authentication form indicators.
_LOGIN_FORM_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:sign\s*in|log\s*in|create\s*(?:an?\s*)?account|"
        r"forgot\s*(?:your\s*)?password|reset\s*password|"
        r"enter\s*your\s*(?:email|username|credentials))",
        re.IGNORECASE,
    ),
]
# Login forms are short; a real policy that mentions "sign in"
# will be long enough to pass the length + keyword checks.
_LOGIN_FORM_MAX_LENGTH = 1500

# CAPTCHA / bot-check indicators.
_CAPTCHA_PATTERNS: list[re.Pattern[str]] = [
    re.compile(
        r"(?:verify you(?:'re| are) (?:a )?human|"
        r"complete the (?:captcha|security check)|"
        r"checking (?:your|if the site) (?:browser|connection)|"
        r"please enable (?:javascript|cookies)|"
        r"ray id|cloudflare|just a moment)",
        re.IGNORECASE,
    ),
]


# ── Soft Signals (Policy Terminology) ────────────────────
# These contribute to a quality score. Real policies contain
# clusters of these terms; garbage content typically has few.

# Tier 1: Strong policy indicators (weighted 3x)
# Expanded to cover plain-language variants, regional regulations,
# and synonyms that appear in real-world policies.
_STRONG_POLICY_TERMS = {
    # Standard policy document names
    "privacy policy", "terms of service", "terms of use",
    "terms and conditions", "service agreement", "cookie policy",
    "acceptable use", "end user license", "license agreement",
    # Data handling terminology
    "data processing", "data protection", "data retention",
    "personal data", "personal information", "user data",
    "data controller", "data processor", "data subject",
    "data collection", "data sharing", "data transfer",
    "data breach", "data security", "data deletion",
    # Plain-language equivalents
    "collect information", "collect your information",
    "share your information", "share information",
    "information we collect", "information you provide",
    "how we use", "how we collect", "how we share",
    "your information", "your data", "your privacy",
    "we collect", "we use", "we share", "we store",
    "we may collect", "we may use", "we may share",
    "information about you", "protect your",
    # Legal clauses
    "third party", "third parties", "third-party",
    "intellectual property", "confidentiality",
    "indemnification", "limitation of liability",
    "governing law", "dispute resolution", "arbitration",
    # Compliance frameworks — global
    "gdpr", "ccpa", "cpra", "coppa", "hipaa", "ferpa",
    "pipeda", "pdpa", "lgpd", "privacy act", "popia",
    "dpa", "data processing agreement",
    # Consent and rights
    "opt-out", "opt out", "opt-in", "opt in",
    "consent", "lawful basis", "legitimate interest",
    "right to access", "right to delete", "right to erasure",
    "right to rectification", "right to portability",
    "do not sell", "do not share",
    # Security and compliance
    "security measures", "encryption", "access controls",
    "biometric", "accessibility", "sla",
    "service level agreement",
}

# Tier 2: Common policy language (weighted 1x)
_COMMON_POLICY_TERMS = {
    "policy", "privacy", "security", "compliance",
    "rights", "obligations", "restrictions", "prohibited",
    "permitted", "authorized", "unauthorized",
    "collect", "process", "store", "retain", "delete",
    "disclose", "share", "transfer", "access",
    "breach", "notify", "notification", "amendment",
    "termination", "suspension", "effective date",
    "applicable law", "jurisdiction", "warranty",
    "disclaimer", "liability", "damages",
    "user", "subscriber", "customer", "account",
    "content", "services", "platform", "software",
    "information", "data", "encryption",
}

# Minimum score to pass (out of possible max ~100+).
# Calibrated so that a real policy easily scores 15+
# while garbage (404 pages, marketing) scores < 5.
_MIN_QUALITY_SCORE = 8


# ── Structural Signals ───────────────────────────────────
# Real policies have structure: headings, numbered sections,
# paragraph breaks. Pure garbage tends to be flat.

_HEADING_PATTERN = re.compile(r"^#{1,4}\s+.+$", re.MULTILINE)
_NUMBERED_SECTION = re.compile(r"^\d+[\.\)]\s+", re.MULTILINE)
_BULLET_LIST = re.compile(r"^[\-\*]\s+", re.MULTILINE)


@dataclass
class ValidationResult:
    """Outcome of content quality validation."""

    is_valid: bool
    score: float
    rejection_reason: str | None = None
    warnings: list[str] = field(default_factory=list)


def validate_content(
    cleaned_content: str,
    source_url: str,
    policy_type: str = "",
) -> ValidationResult:
    """Validate that cleaned content is a genuine policy document.

    Applies hard gates first (binary reject), then computes a
    composite quality score from terminology and structure signals.

    Args:
        cleaned_content: Content after refiner.clean_markdown().
        source_url: For logging context.
        policy_type: Expected policy type (for targeted checks).

    Returns:
        ValidationResult with pass/fail, score, and diagnostics.
    """
    warnings: list[str] = []

    # ── Hard Gate 1: Minimum length ──────────────────
    if len(cleaned_content.strip()) < _MIN_CONTENT_LENGTH:
        return ValidationResult(
            is_valid=False,
            score=0,
            rejection_reason=(
                f"Content too short ({len(cleaned_content.strip())} chars, "
                f"minimum {_MIN_CONTENT_LENGTH})"
            ),
        )

    # ── Hard Gate 2: Error page detection ────────────
    for pattern in _ERROR_PAGE_PATTERNS:
        match = pattern.search(cleaned_content)
        if match:
            return ValidationResult(
                is_valid=False,
                score=0,
                rejection_reason=(
                    f"Detected error page indicator: '{match.group()[:80]}'"
                ),
            )

    # ── Hard Gate 3: CAPTCHA / bot-check ─────────────
    for pattern in _CAPTCHA_PATTERNS:
        match = pattern.search(cleaned_content)
        if match:
            return ValidationResult(
                is_valid=False,
                score=0,
                rejection_reason=(
                    f"Detected CAPTCHA/bot-check: '{match.group()[:80]}'"
                ),
            )

    # ── Hard Gate 4: Login form (only for short content) ──
    if len(cleaned_content.strip()) < _LOGIN_FORM_MAX_LENGTH:
        for pattern in _LOGIN_FORM_PATTERNS:
            match = pattern.search(cleaned_content)
            if match:
                return ValidationResult(
                    is_valid=False,
                    score=0,
                    rejection_reason=(
                        f"Detected login form in short content: "
                        f"'{match.group()[:80]}'"
                    ),
                )

    # ── Soft Scoring: Terminology ────────────────────
    content_lower = cleaned_content.lower()
    score = 0.0

    strong_matches = []
    for term in _STRONG_POLICY_TERMS:
        if term in content_lower:
            score += 3
            strong_matches.append(term)

    common_matches = []
    for term in _COMMON_POLICY_TERMS:
        if term in content_lower:
            score += 1
            common_matches.append(term)

    # ── Soft Scoring: Structure ──────────────────────
    heading_count = len(_HEADING_PATTERN.findall(cleaned_content))
    numbered_count = len(_NUMBERED_SECTION.findall(cleaned_content))
    bullet_count = len(_BULLET_LIST.findall(cleaned_content))

    # Headings are a strong signal — real policies have sections
    score += min(heading_count * 2, 10)  # Cap at 10 points

    # Numbered sections and bullets indicate structured legal text
    score += min((numbered_count + bullet_count) * 0.5, 5)  # Cap at 5

    # ── Length bonus (longer content is more likely real) ──
    if len(cleaned_content) > 5000:
        score += 3
    elif len(cleaned_content) > 2000:
        score += 1

    # ── Strong term signal ─────────────────────────────
    # Content with zero strong policy terms gets a score penalty
    # but is NOT hard-capped. Some policies use plain language,
    # non-English terminology, or company-specific phrasing that
    # won't match our term list. The expanded term list (70+ terms)
    # makes zero-match genuinely rare for real policies, but we
    # still allow structure + common terms to carry the score.
    if not strong_matches:
        # Scale penalty by how few common terms were found.
        # Zero strong + few common = almost certainly not a policy.
        # Zero strong + many common = possibly plain-language policy.
        common_count = len(common_matches)
        if common_count < 5:
            score -= 6  # Heavy penalty — very unlikely to be a policy
        else:
            score -= 3  # Lighter penalty — may be plain-language policy
        warnings.append(
            "No strong policy terms found — content may use "
            "non-standard or non-English terminology"
        )

    if heading_count == 0:
        warnings.append("No Markdown headings found — content may lack structure")

    if len(cleaned_content) < 1000:
        warnings.append(
            f"Content is relatively short ({len(cleaned_content)} chars)"
        )

    # ── Final Decision ───────────────────────────────
    if score < _MIN_QUALITY_SCORE:
        logger.warning(
            "Content rejected for %s — quality score %.1f < %d. "
            "Strong terms: %s. Common terms: %s. "
            "Headings: %d, Numbered: %d, Bullets: %d",
            source_url,
            score,
            _MIN_QUALITY_SCORE,
            strong_matches[:5],
            common_matches[:5],
            heading_count,
            numbered_count,
            bullet_count,
        )
        return ValidationResult(
            is_valid=False,
            score=score,
            rejection_reason=(
                f"Quality score too low ({score:.1f}/{_MIN_QUALITY_SCORE}). "
                f"Content does not appear to be a policy document."
            ),
            warnings=warnings,
        )

    if warnings:
        logger.info(
            "Content accepted for %s (score=%.1f) with warnings: %s",
            source_url,
            score,
            warnings,
        )

    return ValidationResult(
        is_valid=True,
        score=score,
        warnings=warnings,
    )
