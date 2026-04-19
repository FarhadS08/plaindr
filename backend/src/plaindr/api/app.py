"""FastAPI application factory — CORS, lifespan, router mounting."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.api.routers import companies, diffs, policies, query, store_admin, voice

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize clients on startup, close on shutdown.

    PolicyStore loads ~500 files from Supabase; warming it eagerly
    would block /health for 30-60s on cold start. Kick it off in a
    background task so the server is reachable immediately, then the
    first real query blocks briefly until load completes.
    """
    get_settings()

    def _warm_store() -> None:
        try:
            get_policy_store()
        except Exception:
            logger.exception("Background PolicyStore warm-up failed")

    asyncio.get_event_loop().run_in_executor(None, _warm_store)
    yield


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    settings = get_settings()
    app = FastAPI(
        title="Plaindr API",
        description="AI Policy Manager — RAG-powered policy intelligence",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(policies.router, prefix="/api")
    app.include_router(diffs.router, prefix="/api")
    app.include_router(companies.router, prefix="/api")
    app.include_router(query.router, prefix="/api")
    app.include_router(voice.router, prefix="/api")
    app.include_router(store_admin.router, prefix="/api")

    @app.get("/health")
    def _health() -> dict:
        """Railway health check — lightweight readiness signal."""
        return {"status": "ok"}

    return app
