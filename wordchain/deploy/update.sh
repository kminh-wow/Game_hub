#!/usr/bin/env bash
# 코드 업데이트: git pull → 의존성 설치 → 재시작
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
.venv/bin/pip install -q -r requirements.txt
sudo systemctl restart word-chain-online
sleep 2
systemctl --no-pager status word-chain-online | head -5
