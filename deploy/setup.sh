#!/usr/bin/env bash
# 서버 최초 설치: 패키지 설치 → venv → systemd 서비스 등록 → 시작
# 사용법: bash deploy/setup.sh             (기본 8000번 포트, nginx가 80 → 8000 전달)
#         PORT=80 bash deploy/setup.sh     (nginx 없이 80번으로 바로, 밖에서 직접 받음)
#
# 게임 서버는 기본으로 서버 안(127.0.0.1)에서만 받는다. 밖에서는 nginx(80번)로만 들어온다.
# 밖에서 직접 받아야 하면(PORT=80 이거나 HOST=0.0.0.0) 전체 공개로 띄운다.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
if [ -z "${HOST:-}" ]; then
  [ "$PORT" = 80 ] && HOST=0.0.0.0 || HOST=127.0.0.1
fi
SERVICE=game-hub
RUN_USER="$(whoami)"
OLD_SERVICES=(word-chain-online quoridor)

echo "==> 설치 위치: $APP_DIR, 주소: $HOST:$PORT"

# 예전에 게임별로 따로 띄우던 서비스는 끄고 지운다 (포트 충돌 방지).
for old in "${OLD_SERVICES[@]}"; do
  if [ -f "/etc/systemd/system/$old.service" ]; then
    echo "==> 예전 서비스 정리: $old"
    sudo systemctl disable --now "$old" || true
    sudo rm -f "/etc/systemd/system/$old.service"
  fi
done
sudo systemctl daemon-reload

if command -v ss >/dev/null && ss -ltn "sport = :$PORT" | grep -q LISTEN \
   && ! systemctl is-active --quiet "$SERVICE"; then
  echo "!! $PORT 번 포트를 이미 다른 프로그램이 쓰고 있어요. PORT=... 로 다른 포트를 지정하세요." >&2
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

echo "==> 가상환경과 패키지 (파이썬 3.11, 요트 다이스의 pybullet 때문)"
cd "$APP_DIR"
bash deploy/install_deps.sh

WORDS=wordchain/data/words.txt
if [ ! -f "$WORDS" ] && [ -f "$HOME/word-chain-online/data/words.txt" ]; then
  echo "==> 예전 설치에서 끝말잇기 사전 복사"
  cp "$HOME/word-chain-online/data/words.txt" "$WORDS"
fi
if [ ! -f "$WORDS" ]; then
  echo "!! $WORDS 가 없어요. 끝말잇기가 샘플 사전(약 450단어)으로 실행됩니다."
  echo "   내 PC에서: scp -i 키 wordchain/data/words.txt $RUN_USER@<서버IP>:$APP_DIR/$WORDS"
  echo "   올린 뒤: sudo systemctl restart $SERVICE"
fi

# 끄투 단어(일반 + 어인정)는 git 에 없으므로 없으면 GitHub 에서 받아 만든다.
if [ ! -f wordchain/data/kkutu_words.txt ]; then
  echo "==> 끄투 단어 가져오는 중 (약 42MB 다운로드)"
  .venv/bin/python wordchain/scripts/import_kkutu.py || echo "!! 끄투 단어를 못 가져왔어요. 표준국어대사전만으로 실행됩니다."
fi

echo "==> systemd 서비스 등록"
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<UNIT
[Unit]
Description=Game Hub (wordchain, quoridor)
After=network.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
# 게임 상태가 메모리에 있으므로 워커는 반드시 1개
ExecStart=$APP_DIR/.venv/bin/uvicorn hub.main:app --host $HOST --port $PORT --proxy-headers
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

if curl -fsS "http://127.0.0.1:$PORT/wordchain/api/health"; then
  echo
  echo "==> 완료! http://<퍼블릭IP>/ 로 접속하세요."
  if [ "$HOST" = 127.0.0.1 ]; then
    echo "    (게임 서버는 서버 안에서만 받아요. 밖에서는 nginx 80번으로 들어와요.)"
  fi
else
  echo "!! 서버 응답이 없어요. 로그 확인: sudo journalctl -u $SERVICE -n 50" >&2
  exit 1
fi
