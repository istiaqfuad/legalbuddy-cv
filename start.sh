#!/bin/sh
# Heroku single-dyno start: FastAPI on loopback (internal only, reached
# by the Next.js routes via API_INTERNAL_URL) and the Next.js
# standalone server on $PORT (the public entrypoint).
set -e

API_PORT="${API_INTERNAL_PORT:-8000}"
export HOSTNAME="0.0.0.0"
export PORT="${PORT:-3000}"

uv run uvicorn legalbuddy.api:app --host 127.0.0.1 --port "$API_PORT" &

exec node /app/web/server.js
