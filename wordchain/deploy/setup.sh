#!/usr/bin/env bash
# 서버 최초 설치: 패키지 설치 → venv → systemd 서비스 등록 → 시작
# 사용법: bash deploy/setup.sh            (기본 80번 포트)
#         PORT=8000 bash deploy/setup.sh  (다른 포트)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-80}"
SERVICE=word-chain-online
RUN_USER="$(whoami)"

echo "==> 설치 위치: $APP_DIR, 포트: $PORT"

if command -v ss >/dev/null && ss -ltn "sport = :$PORT" | grep -q LISTEN \
   && ! systemctl is-active --quiet "$SERVICE"; then
  echo "!! $PORT 번 포트를 이미 다른 프로그램이 쓰고 있어요. PORT=8000 처럼 다른 포트를 지정하세요." >&2
  exit 1
fi

echo "==> 패키지 설치"
if command -v apt-get >/dev/null; then
  sudo apt-get update -y
  sudo apt-get install -y python3 python3-venv python3-pip git
  PY=python3
elif command -v dnf >/dev/null; then
  sudo dnf install -y python3.11 python3.11-pip git || sudo dnf install -y python3 python3-pip git
  PY=$(command -v python3.11 || command -v python3)
else
  echo "!! apt-get/dnf 를 찾을 수 없어요." >&2
  exit 1
fi

echo "==> 가상환경"
cd "$APP_DIR"
[ -d .venv ] || "$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

if [ ! -f data/words.txt ]; then
  echo "!! data/words.txt 가 없어요. 샘플 사전(약 450단어)으로 실행됩니다."
  echo "   내 PC에서: scp -i 키.pem data/words.txt $RUN_USER@<서버IP>:$APP_DIR/data/"
  echo "   올린 뒤: sudo systemctl restart $SERVICE"
fi

echo "==> systemd 서비스 등록"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=Word Chain Online
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
# 게임 상태가 메모리에 있으므로 워커는 반드시 1개
ExecStart=$APP_DIR/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sudo systemctl restart $SERVICE
sleep 2

if curl -fsS "http://127.0.0.1:$PORT/api/health"; then
  echo
  echo "==> 완료! http://<퍼블릭IP>$([ "$PORT" = 80 ] || echo ":$PORT") 로 접속하세요."
else
  echo "!! 서버 응답이 없어요. 로그 확인: sudo journalctl -u $SERVICE -n 50" >&2
  exit 1
fi
