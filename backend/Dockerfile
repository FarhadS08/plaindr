# Plaindr backend — Python 3.12 + uv, deployed on Railway.
#
# We abandoned Nixpacks here because its auto-generated install step
# was:
#   pip install uv==$NIXPACKS_UV_VERSION
# and Railway's build env stopped setting that default, producing
# "uv==" and a pip "Invalid requirement" crash. A Dockerfile is
# explicit, reproducible, and takes 15 lines.

FROM python:3.12-slim

# uv ships as a single static binary; copy it out of Astral's image
# instead of pip-installing it, which is faster and avoids the env
# var dance that broke Nixpacks in the first place.
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copy lockfiles first so dependency install caches across code
# changes. Only busts when pyproject.toml or uv.lock actually moves.
COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --frozen --no-install-project

# Now the source, then re-sync to install the project itself.
COPY . .
RUN uv sync --no-dev --frozen

# Railway injects $PORT at runtime; default for local docker runs.
ENV PORT=8000
EXPOSE 8000

# Call the venv Python directly — avoids any uv lockfile freshness
# check at container start, which was eating ~2 minutes and blowing
# past Railway's 5-minute healthcheck window.
CMD ["/bin/sh", "-c", "/app/.venv/bin/python -m plaindr serve --host 0.0.0.0 --port ${PORT}"]
