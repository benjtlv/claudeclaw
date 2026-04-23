#!/bin/bash
# Send a Telegram message mid-task via the correct agent's bot.
# Usage: notify.sh "message text" [--agent <name>]
# No --agent flag = main bot (TELEGRAM_BOT_TOKEN).
# With --agent = fuzzy-matches agent dirs, loads its bot token from agent.yaml.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
ENV_FILE="$PROJECT_ROOT/.env"
AGENTS_DIR="$PROJECT_ROOT/agents"

if [ ! -f "$ENV_FILE" ]; then
  echo "notify.sh: .env not found at $ENV_FILE" >&2
  exit 1
fi

read_env() {
  grep -E "^$1=" "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

CHAT_ID=$(read_env ALLOWED_CHAT_ID)
if [ -z "$CHAT_ID" ]; then
  echo "notify.sh: ALLOWED_CHAT_ID not set in .env" >&2
  exit 1
fi

MESSAGE="$1"
shift

AGENT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Fall back to CLAUDECLAW_AGENT_ID env var if no --agent flag
if [ -z "$AGENT" ] && [ -n "$CLAUDECLAW_AGENT_ID" ] && [ "$CLAUDECLAW_AGENT_ID" != "main" ]; then
  AGENT="$CLAUDECLAW_AGENT_ID"
fi

AGENT_ID="main"

if [ -z "$AGENT" ]; then
  # No agent specified -- use main bot
  TOKEN=$(read_env TELEGRAM_BOT_TOKEN)
else
  # Fuzzy match: find agent dir whose name contains the input (case-insensitive)
  MATCH=""
  for dir in "$AGENTS_DIR"/*/; do
    dirname=$(basename "$dir")
    [ "$dirname" = "_template" ] && continue
    if echo "$dirname" | grep -qi "$AGENT"; then
      MATCH="$dir"
      AGENT_ID="$dirname"
      break
    fi
  done

  if [ -z "$MATCH" ]; then
    echo "notify.sh: no agent matching '$AGENT'" >&2
    exit 1
  fi

  YAML="$MATCH/agent.yaml"
  if [ ! -f "$YAML" ]; then
    echo "notify.sh: no agent.yaml in $MATCH" >&2
    exit 1
  fi

  # Read telegram_bot_token_env from agent.yaml, then resolve it from .env
  TOKEN_ENV=$(grep -E '^telegram_bot_token_env:' "$YAML" | sed 's/^telegram_bot_token_env:[[:space:]]*//')
  if [ -z "$TOKEN_ENV" ]; then
    echo "notify.sh: no telegram_bot_token_env in $YAML" >&2
    exit 1
  fi

  TOKEN=$(read_env "$TOKEN_ENV")
fi

if [ -z "$TOKEN" ]; then
  echo "notify.sh: bot token not found" >&2
  exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d text="${MESSAGE}" \
  -d parse_mode="HTML" > /dev/null

# Log to conversation memory so the memory system picks it up
DB_FILE="$PROJECT_ROOT/store/claudeclaw.db"
if [ -f "$DB_FILE" ]; then
  node -e "
    const path = require('path');
    const Database = require('better-sqlite3');
    const db = new Database(path.resolve(process.argv[1]));
    db.prepare('INSERT INTO conversation_log (chat_id, session_id, role, content, created_at, agent_id) VALUES (?, NULL, ?, ?, ?, ?)').run(
      process.argv[2], 'assistant', process.argv[3], Math.floor(Date.now() / 1000), process.argv[4]
    );
    db.close();
  " "$DB_FILE" "$CHAT_ID" "$MESSAGE" "$AGENT_ID"
fi
