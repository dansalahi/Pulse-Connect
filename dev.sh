#!/bin/bash
set -e

# Parse args
INSTANCES=1
DEBUG_MODE="none"   # "none" | "first" | "all"

for arg in "$@"; do
  if [[ "$arg" =~ ^--([0-9]+)$ ]]; then
    INSTANCES="${BASH_REMATCH[1]}"
  elif [[ "$arg" == "--debug:all" ]]; then
    DEBUG_MODE="all"
  elif [[ "$arg" == "--debug" ]]; then
    DEBUG_MODE="first"
  fi
done

cleanup() {
  echo ""
  echo "Stopping all processes..."
  docker stop livekit-dev 2>/dev/null || true
  pkill -f "mock-backend/index.js" 2>/dev/null || true
  pkill -f "tauri dev" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

echo "═══════════════════════════════════════════"
echo "  Pulse Connect Dev Environment"
echo "═══════════════════════════════════════════"
echo "  Instances: $INSTANCES"
echo "  Debug:     $DEBUG_MODE"
echo "═══════════════════════════════════════════"
echo ""

# 1. LiveKit
echo "→ Starting LiveKit (Docker)..."
docker stop livekit-dev 2>/dev/null || true
docker run -d --rm --name livekit-dev \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  -e LIVEKIT_KEYS="devkey: secret" \
  livekit/livekit-server:latest --dev > /dev/null
sleep 2

# 2. Mock backend
echo "→ Starting mock backend (http://localhost:3000, ws://localhost:3001)..."
(cd mock-backend && node index.js) &
sleep 2

# 3. Pulse Connect instances
echo "→ Starting $INSTANCES Pulse Connect instance(s)..."
for i in $(seq 1 $INSTANCES); do
  PORT=$((1420 + i - 1))
  USE_DEBUG=false

  if [[ "$DEBUG_MODE" == "all" ]]; then
    USE_DEBUG=true
  elif [[ "$DEBUG_MODE" == "first" && $i -eq 1 ]]; then
    USE_DEBUG=true
  fi

  if [[ "$USE_DEBUG" == "true" ]]; then
    echo "  → Instance $i on port $PORT (with --debug)"
    VITE_PORT=$PORT pnpm tauri dev -- -- --debug &
  else
    echo "  → Instance $i on port $PORT"
    VITE_PORT=$PORT pnpm tauri dev &
  fi
  sleep 3
done

echo ""
echo "═══════════════════════════════════════════"
echo "  All services started"
echo "  Press Ctrl+C to stop everything"
echo "═══════════════════════════════════════════"
wait
