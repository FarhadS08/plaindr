"""AI consequence analysis — uses Anthropic Claude to analyze
the business impact of policy changes."""

import json
import logging
from datetime import date

import anthropic

from plaindr.config import Settings
from plaindr.models.diff import PolicyChangeAnalysis

logger = logging.getLogger(__name__)

_MODEL = "claude-sonnet-4-20250514"
_MAX_DIFF_CHARS = 15_000

_SYSTEM_PROMPT = """\
You are a policy analyst specializing in AI company terms of service, \
privacy policies, and data handling agreements. Given a unified diff \
of a policy change, analyze its business impact.

Respond with valid JSON matching this schema exactly:
{
  "summary": "2-3 sentence overview of what changed",
  "key_changes": [
    {
      "section": "section name or heading",
      "change_type": "added | removed | modified",
      "description": "plain English description",
      "severity": "info | warning | breaking"
    }
  ],
  "consequences": "paragraph explaining business impact",
  "risk_level": "low | medium | high | critical"
}

Severity guide:
- info: clarifications, formatting, minor wording
- warning: new restrictions, expanded data usage, changed limits
- breaking: removed rights, new mandatory obligations, liability shifts

Risk level guide:
- low: cosmetic or clarification changes
- medium: notable but manageable changes
- high: significant rights/obligations changes
- critical: fundamental terms altered, immediate action needed"""


def analyze_policy_change(
    company_name: str,
    policy_type: str,
    old_effective_date: date | None,
    new_effective_date: date | None,
    diff_text: str,
    settings: Settings,
) -> PolicyChangeAnalysis:
    """Send diff to Anthropic Claude for consequence analysis."""
    prompt = _build_prompt(
        company_name,
        policy_type,
        old_effective_date,
        new_effective_date,
        diff_text,
    )
    raw_json = _call_anthropic(prompt, settings)
    return _parse_response(raw_json)


def _build_prompt(
    company_name: str,
    policy_type: str,
    old_date: date | None,
    new_date: date | None,
    diff_text: str,
) -> str:
    """Build the user prompt with diff context."""
    truncated = diff_text[:_MAX_DIFF_CHARS]
    old_str = str(old_date) if old_date else "unknown"
    new_str = str(new_date) if new_date else "unknown"

    return (
        f"Company: {company_name}\n"
        f"Policy type: {policy_type}\n"
        f"Old version date: {old_str}\n"
        f"New version date: {new_str}\n\n"
        f"Unified diff:\n```\n{truncated}\n```"
    )


def _call_anthropic(prompt: str, settings: Settings) -> str:
    """Call Anthropic Claude and return the raw response text."""
    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key.get_secret_value()
    )
    response = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def _parse_response(raw_json: str) -> PolicyChangeAnalysis:
    """Parse the JSON response into a PolicyChangeAnalysis."""
    # Strip markdown code fences if present
    cleaned = raw_json.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]

    data = json.loads(cleaned.strip())
    return PolicyChangeAnalysis.model_validate(data)
