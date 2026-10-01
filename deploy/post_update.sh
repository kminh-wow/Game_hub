#!/usr/bin/env bash
# update.sh 가 git pull 뒤에 실행한다. 직접 실행해도 된다 (pull 없이 재설치·재시작).
set -euo pipefail
cd "$(dirname "$0")/.."

bash deploy/install_deps.sh

# 끄투 단어(일반 + 어인정)는 git 에 없으므로 없으면 GitHub 에서 받아 만든다.
if [ ! -f wordchain/data/kkutu_words.txt ]; then
  echo "==> 끄투 단어 가져오는 중 (약 42MB 다운로드)"
  .venv/bin/python wordchain/scripts/import_kkutu.py || echo "!! 끄투 단어를 못 가져왔어요. 표준국어대사전만으로 실행됩니다."
fi

# 새 코드가 모든 게임을 불러오는지 재시작 전에 확인한다.
# 하나라도 못 불러오면 재시작하지 않고, 지금 돌고 있는 서버를 그대로 둔다.
echo "==> 새 코드 점검"
if ! .venv/bin/python - <<'PY'
import sys
from hub.main import FAILED_GAMES

if FAILED_GAMES:
    for name, why in FAILED_GAMES.items():
        print(f"!! 게임 '{name}' 을(를) 불러오지 못했어요: {why}", file=sys.stderr)
    sys.exit(1)
print("모든 게임을 불러왔어요.")
PY
then
  echo "!! 점검에 실패해서 재시작하지 않았어요. 서버는 예전 코드로 계속 돌고 있어요." >&2
  exit 1
fi

sudo systemctl restart game-hub
sleep 4
systemctl --no-pager status game-hub | head -3
echo "끝말잇기 사전: $(curl -fsS http://127.0.0.1:8000/wordchain/api/health 2>/dev/null || echo '응답 없음')"
