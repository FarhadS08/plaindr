"""FastAPI application factory — CORS, lifespan, router mounting."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from plaindr.api.dependencies import get_policy_store, get_settings
from plaindr.api.routers import companies, diffs, policies, query, store_admin, voice


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize clients on startup, close on shutdown."""
    # Warm up singletons
    get_settings()
    get_policy_store()
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
