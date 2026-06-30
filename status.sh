#!/usr/bin/env bash
# status.sh — shows live status of background pandoc conversion jobs

SPINNER='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
TICK=0
INTERVAL=3

clear

while true; do
  # Collect all pandoc processes
  mapfile -t PROCS < <(ps aux | awk '/pandoc/ && !/grep/ && !/status\.sh/ {print $2, $3, $8, $0}')

  RUNNING=()
  for entry in "${PROCS[@]}"; do
    pid=$(echo "$entry" | awk '{print $1}')
    cpu=$(echo "$entry" | awk '{print $2}')
    state=$(echo "$entry" | awk '{print $3}')
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || echo "")

    [ -z "$cmd" ] && continue

    # Classify
    if echo "$cmd" | grep -q '\-\-to pdf'; then
      type="PDF"
    elif echo "$cmd" | grep -q '\-\-to epub'; then
      type="EPUB"
    elif echo "$cmd" | grep -q '\-f html \-t markdown'; then
      type="MD"
    else
      type="pandoc"
    fi

    # Output file
    out=$(echo "$cmd" | grep -oP '(?<=-o )\S+' || echo "?")

    RUNNING+=("$pid|$type|$cpu|$state|$out")
  done

  SP="${SPINNER:$(( TICK % ${#SPINNER} )):1}"
  NOW=$(date '+%H:%M:%S')

  # Render
  tput cup 0 0
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Pandoc background jobs — ${NOW}  (refresh every ${INTERVAL}s)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ ${#RUNNING[@]} -eq 0 ]; then
    echo "  No pandoc processes running.                          "
  else
    printf "  %-6s  %-5s  %-6s  %-5s  %s\n" "PID" "TYPE" "CPU%" "STATE" "OUTPUT"
    echo "  ──────────────────────────────────────────────────────"
    for entry in "${RUNNING[@]}"; do
      IFS='|' read -r pid type cpu state out <<< "$entry"
      case "$state" in
        R*) icon="▶" ;;
        T*) icon="⏸" ;;
        Z*) icon="💀" ;;
        *)  icon="${SP}" ;;
      esac
      printf "  %s %-6s  %-5s  %-6s  %-5s  %s\n" \
        "$icon" "$pid" "$type" "$cpu" "$state" "$out"
    done
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Press Ctrl+C to exit                                  "

  # Clear any leftover lines below
  tput ed 2>/dev/null || true

  sleep "$INTERVAL"
  TICK=$(( TICK + 1 ))
done
