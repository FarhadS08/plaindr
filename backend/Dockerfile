# Plaindr backend — Python 3.12 + uv, deployed on Railway.
#
# We abandoned Nixpacks because its auto-generated install step
# depended on $NIXPACKS_UV_VERSION which Railway stopped providing.
# This Dockerfile is the same shape as the working Nixpacks image:
# venv at /opt/venv, activated via PATH, so every process started by
# the container finds the right python without any explicit path.

FROM python:3.12-slim

# uv ships as a single static binary — copy it in instead of
# pip-bootstrapping.
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv

# Venv lives at /opt/venv (same as the old Nixpacks layout) and is
# pre-pended to PATH so `python` resolves to the venv interpreter
# everywhere — Dockerfile CMD, Railway's dashboard start override,
# whatever. UV_PROJECT_ENVIRONMENT tells `uv sync` to put it there.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first — caches across code changes.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project

# Source + final sync so the project itself is installed into the venv.
COPY . .
RUN uv sync --no-dev --frozen

# Railway injects $PORT at runtime; fall back to 8000 locally.
EXPOSE 8000

# Shell form so ${PORT} expands from Railway's env. `python` resolves
# through PATH to /opt/venv/bin/python.
CMD ["/bin/sh", "-c", "python -m plaindr serve --host 0.0.0.0 --port ${PORT:-8000}"]
