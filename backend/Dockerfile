# PaperAid Pro API — production image for Cloud Run.
# Stage 1 installs the pinned citeproc-js engine; stage 2 is the Python runtime (non-root).

FROM node:22-bookworm-slim AS citeproc
WORKDIR /engine
COPY app/services/citations/engine/package.json app/services/citations/engine/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

# Node.js runtime for the citation engine; DejaVu fonts for Unicode PDF export.
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs fonts-dejavu-core fonts-dejavu-extra \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY scripts ./scripts
COPY --from=citeproc /engine/node_modules ./app/services/citations/engine/node_modules

RUN useradd --system --uid 10001 --home /srv appuser && chown -R appuser /srv
USER appuser

EXPOSE 8080
# Cloud Run sends SIGTERM on scale-down; uvicorn shuts down gracefully.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 20"]
