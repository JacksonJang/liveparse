#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-liveparse.com}"
APP_URL="${APP_URL:-http://localhost:4173}"
TUNNEL_NAME="${TUNNEL_NAME:-liveparse}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$PROJECT_DIR/cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed. Install it first: brew install cloudflared" >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"

if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "Cloudflare login is required. A browser window will open."
  cloudflared tunnel login
fi

TUNNEL_ID="$(cloudflared tunnel list --output json 2>/dev/null | python3 -c 'import json,sys; name=sys.argv[1]; data=json.load(sys.stdin); print(next((t.get("id","") for t in data if t.get("name")==name), ""))' "$TUNNEL_NAME")"

if [ -z "$TUNNEL_ID" ]; then
  echo "Creating Cloudflare Tunnel: $TUNNEL_NAME"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(cloudflared tunnel list --output json | python3 -c 'import json,sys; name=sys.argv[1]; data=json.load(sys.stdin); print(next((t.get("id","") for t in data if t.get("name")==name), ""))' "$TUNNEL_NAME")"
fi

if [ -z "$TUNNEL_ID" ]; then
  echo "Could not resolve tunnel id for $TUNNEL_NAME" >&2
  exit 1
fi

CREDENTIALS_FILE="$HOME/.cloudflared/$TUNNEL_ID.json"
if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "Missing credentials file: $CREDENTIALS_FILE" >&2
  exit 1
fi

cat > "$CONFIG_FILE" <<YAML
tunnel: $TUNNEL_ID
credentials-file: $CREDENTIALS_FILE

ingress:
  - hostname: $DOMAIN
    service: $APP_URL
  - hostname: www.$DOMAIN
    service: $APP_URL
  - service: http_status:404
YAML

echo "Routing DNS: $DOMAIN -> $TUNNEL_NAME"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$DOMAIN"
echo "Routing DNS: www.$DOMAIN -> $TUNNEL_NAME"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "www.$DOMAIN" || true

echo "Wrote $CONFIG_FILE"
echo "Run the app and tunnel with:"
echo "  npm run build && npm run preview"
echo "  cloudflared tunnel --config ./cloudflared/config.yml run $TUNNEL_NAME"
