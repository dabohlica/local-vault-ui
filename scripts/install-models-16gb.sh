#!/usr/bin/env bash
# Model setup for a 16 GB Apple-Silicon Mac (e.g. MacBook Air M-series).
#
#   Embeddings  → qwen3-embedding:0.6b via Ollama          (~0.6 GB)
#   Prose/vision → GLM-4.6V-Flash 4-bit via MLX (mlx-vlm)  (~7 GB, reads images)
#
# Why two runtimes: Ollama's MLX engine needs >32 GB unified memory and has no GLM
# vision build, so the GLM model runs on Apple's MLX directly (mlx_vlm.server, an
# OpenAI-compatible server bound to 127.0.0.1). vault-ui routes any model named
# "mlx:<repo>" to it; everything stays on this machine.
#
# Memory budget (approx.): GLM 4-bit ~7 GB + KV cache ~0.7 GB + embedder ~0.7 GB
# ≈ 8.5 GB — inside macOS's default GPU limit (~10.7 GB on 16 GB). Don't keep a
# second large Ollama model (e.g. gemma4) loaded at the same time.
#
# Usage:
#   scripts/install-models-16gb.sh              # install + download models
#   scripts/install-models-16gb.sh --autostart  # also start the MLX server at login (launchd)
#   scripts/install-models-16gb.sh --configure  # also point a running vault-ui at these models
set -euo pipefail

EMBED_MODEL="qwen3-embedding:0.6b"
GLM_REPO="mlx-community/GLM-4.6V-Flash-4bit"
MLX_PORT="${MLX_PORT:-8080}"
VENV="${VAULT_MLX_VENV:-$HOME/.local/share/vault-ui/mlx-venv}"
APP_URL="${VAULT_UI_URL:-http://127.0.0.1:3000}"
PLIST="$HOME/Library/LaunchAgents/com.vault-ui.mlx-server.plist"

AUTOSTART=0; CONFIGURE=0
for arg in "$@"; do
  case "$arg" in
    --autostart) AUTOSTART=1 ;;
    --configure) CONFIGURE=1 ;;
    -h|--help) sed -n 2,21p "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# --- Preflight ---------------------------------------------------------------
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || die "MLX needs an Apple-Silicon Mac."
mem_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
(( mem_gb >= 16 )) || die "Found ${mem_gb} GB RAM; this setup needs 16 GB."
free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
(( free_gb >= 12 )) || die "Only ${free_gb} GB free disk; need ~12 GB (models + Python env)."
command -v ollama >/dev/null || die "Ollama not found — install it from https://ollama.com first."

# --- 1. Embedding model (Ollama) ---------------------------------------------
say "Pulling embedding model $EMBED_MODEL"
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama isn't running — starting it in the background."
  (ollama serve >/dev/null 2>&1 &)
  for _ in {1..20}; do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
fi
ollama pull "$EMBED_MODEL"

# --- 2. MLX runtime (isolated Python venv) -----------------------------------
say "Setting up the MLX Python environment in $VENV"
mkdir -p "$(dirname "$VENV")"
if command -v uv >/dev/null; then
  [[ -x "$VENV/bin/python" ]] || uv venv --python 3.12 "$VENV"
  uv pip install --python "$VENV/bin/python" -U mlx-vlm
else
  PY=$(command -v python3.12 || command -v python3.11 || true)
  [[ -n "$PY" ]] || die "Need Python ≥3.11 (brew install python@3.12) or uv (brew install uv)."
  [[ -x "$VENV/bin/python" ]] || "$PY" -m venv "$VENV"
  "$VENV/bin/pip" install -U pip mlx-vlm
fi

# --- 3. GLM-4.6V-Flash weights -----------------------------------------------
say "Downloading $GLM_REPO (~7 GB, resumable)"
"$VENV/bin/python" - "$GLM_REPO" <<'PY'
import sys
from huggingface_hub import snapshot_download
print(snapshot_download(sys.argv[1]))
PY

# --- 4. Smoke test -----------------------------------------------------------
say "Smoke-testing GLM on MLX (loads the model once, ~30 s)"
"$VENV/bin/python" -m mlx_vlm.generate --model "$GLM_REPO" --max-tokens 40 --temperature 0 \
  --prompt "In one sentence: what is a personal knowledge vault?" | tail -n 5

# --- 5. Optional: start the server at login ----------------------------------
SERVER_CMD=("$VENV/bin/python" -m mlx_vlm.server --host 127.0.0.1 --port "$MLX_PORT")
if (( AUTOSTART )); then
  say "Installing launchd agent ($PLIST)"
  mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.vault-ui.mlx-server</string>
  <key>ProgramArguments</key><array>
    <string>${SERVER_CMD[0]}</string><string>-m</string><string>mlx_vlm.server</string>
    <string>--host</string><string>127.0.0.1</string><string>--port</string><string>${MLX_PORT}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/vault-ui-mlx.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/vault-ui-mlx.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/com.vault-ui.mlx-server" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "MLX server will run at login on 127.0.0.1:$MLX_PORT (logs: ~/Library/Logs/vault-ui-mlx.log)."
fi

# --- 6. Optional: point vault-ui at the new models ---------------------------
if (( CONFIGURE )); then
  say "Configuring vault-ui at $APP_URL"
  curl -fsS -X POST "$APP_URL/api/setup" -H 'Content-Type: application/json' -d "{
    \"chatModel\": \"mlx:$GLM_REPO\",
    \"writerModel\": \"mlx:$GLM_REPO\",
    \"librarianModel\": \"mlx:$GLM_REPO\",
    \"visionModel\": \"mlx:$GLM_REPO\",
    \"embedModel\": \"$EMBED_MODEL\"
  }" >/dev/null && echo "Saved. The index re-embeds with $EMBED_MODEL automatically on its next sync." \
    || echo "vault-ui isn't reachable at $APP_URL — set the models in Settings instead (see below)."
fi

cat <<EOF

Done.

  Start the MLX server (unless you used --autostart):
    ${SERVER_CMD[*]}

  vault-ui → Settings → models (or run this script with --configure):
    Chat / Writer / Librarian / Vision:  mlx:$GLM_REPO
    Embedding:                           $EMBED_MODEL

  Changing the embedding model triggers a one-time full re-index.
  Optional, frees ~10 GB of disk if you no longer use it:  ollama rm gemma4
EOF
