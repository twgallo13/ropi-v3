#!/usr/bin/env bash
# emulator-start.sh — Start all Firebase emulators for local development
set -euo pipefail

echo "▶ Starting Firebase emulators (project: ropi-aoss-dev)..."
firebase use ropi-aoss-dev
firebase emulators:start --import=./emulator-data --export-on-exit=./emulator-data
