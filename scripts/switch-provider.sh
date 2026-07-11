#!/usr/bin/env bash
#
# switch-provider.sh — toggle an agent group's AI provider/model and
# restart its container(s) in one shot.
#
# Wraps two `ncl` calls:
#   ncl groups config update --id <id> --provider <provider> [--model <model>]
#   ncl groups restart       --id <id> [--rebuild] [--message <text>]
#
# Run this ON THE NANOCLAW HOST (needs data/ncl.sock + `ncl` on PATH).
# Resolves <folder> -> agent_group_id itself via `ncl groups list` — callers
# never need to look up or hardcode a group ID.
#
# Two independent model-selection paths exist in NanoClaw (see docs/ollama.md
# and container/agent-runner/src/config.ts vs providers/opencode.ts):
#   - claude / ollama: model is a container_configs DB column, read straight
#     from container.json by the agent-runner. `--model` here writes it.
#     Takes effect on container restart alone.
#   - opencode: model comes from the OPENCODE_MODEL host env var (set in
#     ~/.config/nanoclaw/secrets.env), loaded into process.env when the
#     NanoClaw *service* starts. `--model` here is stored in the DB but the
#     opencode provider ignores it. Changing the OpenRouter model requires
#     editing secrets.env AND restarting the host service — this script
#     does not do that.
#
# Usage:
#   switch-provider.sh list
#   switch-provider.sh status <folder>
#   switch-provider.sh switch <folder> <provider> [model] [--rebuild] [--message "text"]
#
# Examples:
#   switch-provider.sh list
#   switch-provider.sh status cli-with-mathipe
#   switch-provider.sh switch cli-with-mathipe ollama gpt-oss:120b-cloud
#   switch-provider.sh switch cli-with-mathipe ollama deepseek-v4-flash:cloud
#   switch-provider.sh switch cli-with-mathipe opencode
#   switch-provider.sh switch cli-with-mathipe claude claude-sonnet-4-5

set -euo pipefail

KNOWN_PROVIDERS=(claude ollama opencode)

die() {
	echo "error: $*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found on PATH"
}

need ncl
need jq

check_host() {
	if ! ncl groups list --json >/dev/null 2>&1; then
		ncl groups list >&2 || true
		die "NanoClaw host not reachable — start it and retry (see error above)."
	fi
}

# `ncl ... --json` wraps the payload as {id, ok, data}. This helper runs an
# ncl command, verifies ok == true, and prints the unwrapped .data.
ncl_json() {
	local out
	out=$(ncl "$@" --json)
	if [ "$(echo "$out" | jq -r '.ok')" != "true" ]; then
		echo "$out" >&2
		die "ncl $* failed"
	fi
	echo "$out" | jq -c '.data'
}

resolve_group_id() {
	local folder="$1"
	local matches
	matches=$(ncl_json groups list | jq -r --arg f "$folder" '.[] | select(.folder == $f) | .id')
	local count
	count=$(printf '%s\n' "$matches" | grep -c . || true)
	if [ "$count" -eq 0 ]; then
		die "no agent group with folder '$folder' — run '$0 list' to see available groups"
	fi
	if [ "$count" -gt 1 ]; then
		die "multiple agent groups matched folder '$folder' (should be unique) — investigate manually"
	fi
	echo "$matches"
}

cmd_list() {
	check_host
	echo -e "FOLDER\tID\tNAME"
	ncl_json groups list | jq -r '.[] | "\(.folder)\t\(.id)\t\(.name)"'
}

cmd_status() {
	local folder="${1:?usage: $0 status <folder>}"
	check_host
	local id
	id=$(resolve_group_id "$folder")
	echo "group:    $folder"
	echo "id:       $id"
	ncl_json groups config get --id "$id" | jq '{provider, model, effort}'
}

cmd_switch() {
	local folder="${1:?usage: $0 switch <folder> <provider> [model] [--rebuild] [--message TEXT]}"
	local provider="${2:?usage: $0 switch <folder> <provider> [model] [--rebuild] [--message TEXT]}"
	shift 2

	local model="" rebuild="" message=""
	if [ $# -gt 0 ] && [[ "$1" != --* ]]; then
		model="$1"
		shift
	fi
	while [ $# -gt 0 ]; do
		case "$1" in
		--rebuild)
			rebuild="1"
			shift
			;;
		--message)
			message="${2:?--message requires a value}"
			shift 2
			;;
		*)
			die "unknown argument: $1"
			;;
		esac
	done

	local known=0
	for p in "${KNOWN_PROVIDERS[@]}"; do
		[ "$p" = "$provider" ] && known=1
	done
	if [ "$known" -eq 0 ]; then
		echo "warning: '$provider' is not a recognized provider (${KNOWN_PROVIDERS[*]}) — proceeding anyway" >&2
	fi

	case "$provider" in
	ollama)
		[ -n "$model" ] || die "provider 'ollama' requires a model, e.g.: $0 switch $folder ollama gemma3:latest (see 'ollama list' on the host)"
		;;
	opencode)
		if [ -n "$model" ]; then
			echo "note: opencode reads its model from OPENCODE_MODEL in secrets.env, not from this flag." >&2
			echo "      '$model' will be saved in the DB but the opencode provider ignores it." >&2
		fi
		;;
	esac

	check_host
	local id
	id=$(resolve_group_id "$folder")

	local update_args=(groups config update --id "$id" --provider "$provider")
	[ -n "$model" ] && update_args+=(--model "$model")
	echo "+ ncl ${update_args[*]}"
	ncl_json "${update_args[@]}" >/dev/null

	local restart_args=(groups restart --id "$id")
	[ -n "$rebuild" ] && restart_args+=(--rebuild)
	[ -n "$message" ] && restart_args+=(--message "$message")
	echo "+ ncl ${restart_args[*]}"
	ncl_json "${restart_args[@]}" >/dev/null

	echo "switched '$folder' -> provider=$provider${model:+ model=$model}"
	case "$provider" in
	ollama)
		echo "verify: curl -s http://localhost:11434/api/ps | grep '\"name\"'   # model should show once loaded"
		echo "verify: docker exec \$(docker ps --filter name=nanoclaw-v2-$folder --format '{{.Names}}' | head -1) env | grep ANTHROPIC"
		;;
	opencode)
		echo "note: current OpenRouter model is whatever OPENCODE_MODEL is in ~/.config/nanoclaw/secrets.env"
		echo "      (that only changes on a host-service restart, not this script)."
		;;
	claude)
		echo "verify: docker exec \$(docker ps --filter name=nanoclaw-v2-$folder --format '{{.Names}}' | head -1) env | grep ANTHROPIC"
		;;
	esac
}

main() {
	local verb="${1:-}"
	shift || true
	case "$verb" in
	list) cmd_list "$@" ;;
	status) cmd_status "$@" ;;
	switch) cmd_switch "$@" ;;
	*)
		cat >&2 <<EOF
Usage:
  $0 list
  $0 status <folder>
  $0 switch <folder> <provider> [model] [--rebuild] [--message TEXT]

Providers: ${KNOWN_PROVIDERS[*]}
EOF
		exit 1
		;;
	esac
}

main "$@"
