#!/usr/bin/env bash
# 코드 업데이트: git pull → 의존성 설치 → 재시작
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
.venv/bin/pip install -q -r requirements.txt

# 끄투 단어(일반 + 어인정)는 git 에 없으므로 없으면 GitHub 에서 받아 만든다.
if [ ! -f wordchain/data/kkutu_words.txt ]; then
  echo "==> 끄투 단어 가져오는 중 (약 42MB 다운로드)"
  .venv/bin/python wordchain/scripts/import_kkutu.py || echo "!! 끄투 단어를 못 가져왔어요. 표준국어대사전만으로 실행됩니다."
fi
sudo systemctl restart game-hub
sleep 2
systemctl --no-pager status game-hub | head -5
