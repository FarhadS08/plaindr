"""CLI entry point — run pipelines and start the API server.

Usage:
    python -m plaindr ingest --csv path/to/tools.csv
    python -m plaindr rescrape
    python -m plaindr serve
    python -m plaindr setup-storage
"""

import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="plaindr",
        description="Plaindr AI Policy Manager CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ingest
    ingest_p = sub.add_parser("ingest", help="Full CSV → storage pipeline")
    ingest_p.add_argument("--csv", required=True, type=Path)

    # rescrape
    sub.add_parser("rescrape", help="Re-scrape all known URLs")

    # serve
    serve_p = sub.add_parser("serve", help="Start FastAPI server")
    serve_p.add_argument("--host", default=None)
    serve_p.add_argument("--port", type=int, default=None)

    # setup-storage
    sub.add_parser("setup-storage", help="Create Supabase Storage buckets")

    # verify
    verify_p = sub.add_parser(
        "verify", help="Verify policy completeness and integrity"
    )
    verify_p.add_argument(
        "--spot-check",
        type=int,
        default=0,
        help="Number of policies to AI spot-check",
    )
    verify_p.add_argument("--csv", type=Path, default=None)

    args = parser.parse_args()

    if args.command == "ingest":
        _cmd_ingest(args.csv)
    elif args.command == "rescrape":
        _cmd_rescrape()
    elif args.command == "serve":
        _cmd_serve(args.host, args.port)
    elif args.command == "setup-storage":
        _cmd_setup_storage()
    elif args.command == "verify":
        _cmd_verify(args.csv, args.spot_check)


def _cmd_ingest(csv_path: Path) -> None:
    from plaindr.config import Settings
    from plaindr.pipelines.feature.orchestrator import run_full_pipeline

    if not csv_path.exists():
        logger.error("CSV file not found: %s", csv_path)
        sys.exit(1)

    settings = Settings()
    result = run_full_pipeline(csv_path, settings)
    logger.info("Ingest result: %s", result)


def _cmd_rescrape() -> None:
    from plaindr.config import Settings
    from plaindr.pipelines.feature.orchestrator import run_rescrape

    settings = Settings()
    result = run_rescrape(settings)
    logger.info("Rescrape result: %s", result)


def _cmd_serve(host: str | None, port: int | None) -> None:
    import logging as stdlog
    import os

    # Force INFO-level logging to stdout before anything else so that
    # config errors below are visible in Railway's deploy log. Without
    # this, pydantic validation failures in Settings() exit with a
    # traceback that can get lost in the default logging config.
    stdlog.basicConfig(
        level=stdlog.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )

    # Presence-only env snapshot — never log values. If the deploy
    # fails, this is the first place to look.
    required = ["PORT", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ANTHROPIC_API_KEY"]
    optional = ["CORS_ORIGINS", "ELEVENLABS_API_KEY", "ELEVENLABS_WEBHOOK_SECRET"]
    for key in required:
        logger.info("env.required %s present=%s", key, bool(os.environ.get(key)))
    for key in optional:
        logger.info("env.optional %s present=%s", key, bool(os.environ.get(key)))

    try:
        from plaindr.config import Settings

        settings = Settings()
    except Exception:
        logger.exception(
            "Settings() failed — check the env snapshot above. The most "
            "common culprit is SUPABASE_URL / SUPABASE_SERVICE_KEY missing, "
            "or a comma-separated CORS_ORIGINS that pydantic rejects (use "
            "JSON: CORS_ORIGINS='[\"https://a.com\",\"https://b.com\"]')."
        )
        raise

    try:
        import uvicorn

        from plaindr.api.app import create_app

        app = create_app()
    except Exception:
        logger.exception("create_app() failed during import or instantiation")
        raise

    bind_host = host or settings.api_host
    bind_port = port or settings.api_port
    logger.info(
        "plaindr.serve starting host=%s port=%s debug=%s",
        bind_host,
        bind_port,
        settings.debug,
    )
    uvicorn.run(app, host=bind_host, port=bind_port)


def _cmd_setup_storage() -> None:
    from scripts.setup_storage import main as setup_main

    setup_main()


def _cmd_verify(csv_path: Path | None, spot_check: int) -> None:
    from scripts.verify_policies import main as verify_main

    sys.argv = ["verify"]
    if csv_path:
        sys.argv.extend(["--csv", str(csv_path)])
    if spot_check > 0:
        sys.argv.extend(["--spot-check", str(spot_check)])
    verify_main()


if __name__ == "__main__":
    main()
