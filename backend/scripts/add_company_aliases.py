"""Backfill common name aliases to companies.yaml.

Users ask about "OpenAI" but our data is under "ChatGPT".
This script adds known aliases so the RAG retrieval finds the right
policies regardless of how the user names the company.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

# Canonical name (as it appears in Tools.csv / companies.yaml) → aliases
ALIASES: dict[str, list[str]] = {
    "ChatGPT": ["OpenAI", "GPT", "GPT-4", "GPT-5", "ChatGPT Plus", "Sora"],
    "Claude": ["Anthropic", "Claude AI"],
    "Google Gemini": ["Google", "Gemini", "Bard", "Google AI"],
    "Microsoft Copilot": ["Microsoft", "Copilot", "Bing Chat", "MS Copilot"],
    "Google Workspace AI": ["Google Workspace", "Workspace AI"],
    "Google AI Studio": ["AI Studio"],
    "GitHub Copilot": ["GitHub"],
    "Mistral AI": ["Mistral", "Le Chat"],
    "Perplexity AI": ["Perplexity"],
    "Imagine by Meta": ["Meta", "Meta AI", "Facebook AI"],
    "DreamUp (DeviantArt)": ["DreamUp", "DeviantArt"],
    "PersonaMagic (Typeform)": ["PersonaMagic", "Typeform"],
    "Vicuna (LMSYS)": ["Vicuna", "LMSYS"],
    "LINER (GetLiner)": ["Liner", "GetLiner"],
    "NVIDIA AI": ["NVIDIA", "Nvidia"],
    "Luma AI": ["Luma", "Luma Labs", "Dream Machine"],
    "Stability AI": ["Stability", "Stable Diffusion"],
    "Inflection AI": ["Inflection", "Pi"],
    "AI21 Labs": ["AI21", "Jurassic"],
    "Together AI": ["Together"],
    "Hugging Face": ["HuggingFace"],
    "Runway": ["Runway ML", "RunwayML"],
    "Midjourney": ["MJ"],
    "Leonardo.ai": ["Leonardo", "Leonardo AI"],
    "ElevenLabs": ["Eleven Labs", "11Labs"],
    "Character.AI": ["Character AI", "c.ai"],
    "Replit": ["Replit Agent"],
    "Cursor": ["Cursor AI"],
    "Windsurf": ["Codeium Windsurf"],
    "Bolt.new": ["Bolt", "StackBlitz Bolt"],
    "Lovable": ["Lovable.dev", "GPT Engineer"],
    "n8n": ["N8N"],
    "DeepSeek": ["Deepseek"],
    "Kling": ["Kling AI", "KlingAI"],
    "HeyGen": ["Heygen"],
    "Synthesia": ["Synthesia AI"],
    "Notion": ["Notion AI"],
    "Vercel": ["v0", "v0.dev"],
    "Supabase": ["Supabase AI"],
    "HubSpot": ["Hubspot"],
}


def main() -> None:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(env_path)

    settings = Settings()
    storage = SupabaseStorageClient(settings)

    # Load current companies.yaml
    yaml_content = storage.download_text(
        settings.policies_bucket, "companies.yaml"
    )
    companies = yaml.safe_load(yaml_content) or []

    matched = 0
    missed: list[str] = []
    for canonical, aliases in ALIASES.items():
        entry = next(
            (c for c in companies if c.get("name") == canonical), None
        )
        if entry is None:
            missed.append(canonical)
            continue
        existing = set(entry.get("aliases", []) or [])
        existing.update(aliases)
        entry["aliases"] = sorted(existing)
        matched += 1

    if missed:
        logger.warning(
            "Canonical names not in registry (skipped): %s", missed
        )

    # Re-sort and write back
    companies.sort(key=lambda c: c.get("name", ""))
    out = yaml.dump(companies, default_flow_style=False, allow_unicode=True)
    storage.upload(
        settings.policies_bucket,
        "companies.yaml",
        out.encode("utf-8"),
        content_type="text/yaml",
    )
    logger.info("Updated aliases for %d companies", matched)


if __name__ == "__main__":
    main()
