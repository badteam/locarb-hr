#!/usr/bin/env bash
# Installs a tiny relay on the server: ZKTeco fingerprint devices talk plain HTTP to it
# on port 8081, and it forwards everything to the HR system's "adms" function over HTTPS.
# Usage (as root):  curl -sL https://raw.githubusercontent.com/badteam/locarb-hr/main/tools/adms-relay-install.sh | bash -s <RELAY_TOKEN>
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then echo "ERROR: missing token"; exit 1; fi
if [ "$(id -u)" != "0" ]; then echo "ERROR: run as root"; exit 1; fi

command -v python3 >/dev/null || { apt-get update -qq && apt-get install -y -qq python3; }

PORT=8081
if ss -ltn 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active --quiet adms-relay; then PORT=18081; fi

mkdir -p /opt/adms-relay
cat > /opt/adms-relay/relay.py <<'PY'
import os, sys, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET = "https://kuvccaqlyyskuvwoykbs.supabase.co/functions/v1/adms"
TOKEN = open("/opt/adms-relay/token").read().strip()
PORT = int(os.environ.get("PORT", "8081"))

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def relay(self):
        path, _, query = self.path.partition("?")
        if not path.lower().startswith("/iclock/"):
            return self.reply(404, b"not found")
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n > 0 else None
        req = urllib.request.Request(TARGET, data=body, method=self.command, headers={
            "x-relay-token": TOKEN, "x-orig-path": path, "x-orig-query": query,
            "x-device-ip": self.client_address[0], "Content-Type": "text/plain",
        })
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                self.reply(r.status, r.read())
        except urllib.error.HTTPError as e:
            self.reply(e.code, e.read() or b"ERROR")
        except Exception as e:
            sys.stderr.write("relay error: %s\n" % e)
            self.reply(502, b"ERROR")

    def reply(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    do_GET = relay
    do_POST = relay

    def log_message(self, fmt, *args):
        pass

ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
PY
printf '%s' "$TOKEN" > /opt/adms-relay/token
chmod 600 /opt/adms-relay/token

cat > /etc/systemd/system/adms-relay.service <<UNIT
[Unit]
Description=LoCarb fingerprint devices relay (ADMS)
After=network-online.target

[Service]
Environment=PORT=$PORT
ExecStart=/usr/bin/python3 /opt/adms-relay/relay.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now adms-relay >/dev/null 2>&1
systemctl restart adms-relay

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then ufw allow $PORT/tcp >/dev/null; fi

sleep 2
IP=$(curl -s -4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')
TEST=$(curl -s --max-time 20 "http://127.0.0.1:$PORT/iclock/cdata?SN=x" || true)
echo
echo "=================================================="
if [ "$TEST" = "OK" ]; then
  echo " RELAY READY"
else
  echo " RELAY PROBLEM: [$TEST]"
fi
echo " Server address: $IP"
echo " Port: $PORT"
echo "=================================================="
