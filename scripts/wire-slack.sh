#!/usr/bin/env bash
# wire-slack.sh — Wire the first Slack messaging group to the Personal Assistant.
#
# Usage:
#   1. DM the bot in Slack (this creates a messaging_groups row automatically)
#   2. Run:  ./scripts/wire-slack.sh
#
# You can also pass a specific engage_mode:
#   ./scripts/wire-slack.sh mention-sticky   (default: respond after first @mention in a thread)
#   ./scripts/wire-slack.sh pattern          (respond to ALL messages)

set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

DB="data/v2.db"
AGENT_GROUP_ID="ag-1781098614662-lx2src" # Personal Assistant
ENGAGE_MODE="${1:-mention-sticky}"

echo "Looking for Slack messaging groups in DB..."

MG_ID=$(sqlite3 "$DB" "SELECT id FROM messaging_groups WHERE channel_type='slack' LIMIT 1" 2>/dev/null)

if [ -z "$MG_ID" ]; then
	echo ""
	echo "No Slack messaging group found yet."
	echo "Please send a DM (or @mention) to the bot in Slack first, then re-run this script."
	exit 1
fi

echo "Found Slack messaging group: $MG_ID"

# Check if it's already wired
EXISTING=$(sqlite3 "$DB" "SELECT id FROM messaging_group_agents WHERE messaging_group_id='$MG_ID' AND agent_group_id='$AGENT_GROUP_ID'" 2>/dev/null)
if [ -n "$EXISTING" ]; then
	echo "Already wired (wiring id: $EXISTING) — nothing to do."
	exit 0
fi

echo "Creating wiring: $MG_ID → Personal Assistant (mode: $ENGAGE_MODE)..."
./bin/ncl wirings create \
	--messaging_group_id "$MG_ID" \
	--agent_group_id "$AGENT_GROUP_ID" \
	--engage_mode "$ENGAGE_MODE" \
	--sender_scope all \
	--ignored_message_policy drop

echo ""
echo "Done! Now resend your message in Slack — the bot should respond."
