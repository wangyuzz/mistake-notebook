#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077

if [ -e .env ]; then
  echo 'Found .env; keeping existing configuration. Do not regenerate deployment secrets.' >&2
  exit 1
fi

random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}
database_password=$(random_hex)
setup_token=$(random_hex)
settings_key=$(random_hex)
if [ "${#database_password}" -ne 64 ] || [ "${#setup_token}" -ne 64 ] || [ "${#settings_key}" -ne 64 ]; then
  echo 'Failed to generate secrets.' >&2
  exit 1
fi

(
  set -C
  cat > .env <<EOF
# Generated once for this deployment. Keep this file private and backed up.
POSTGRES_PASSWORD=$database_password
APP_BIND_IP=0.0.0.0
APP_PORT=3001
HOST=0.0.0.0
PORT=3001
DATABASE_URL=
DATABASE_SSL=false
# Set true only after HTTPS is working.
COOKIE_SECURE=false
SETUP_TOKEN=$setup_token
SETTINGS_ENCRYPTION_KEY=$settings_key
AI_API_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
AI_MODEL=
AI_RECOGNITION_MODEL=
AI_TIMEOUT_MS=90000
EOF
)
echo 'Created private .env with random deployment secrets.'
echo 'Start: docker compose up -d --build'
echo 'Read SETUP_TOKEN locally from .env when creating the first administrator.'
echo 'Keep .env when updating. Back up .env and the database together.'
