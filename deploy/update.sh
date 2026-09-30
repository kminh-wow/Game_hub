#!/usr/bin/env bash
# 코드 업데이트: git pull 후, 받은 최신 post_update.sh 로 나머지(의존성·데이터·재시작)를 진행한다.
# (git pull 이 이 파일 자체를 바꿔도 실행이 꼬이지 않도록 나머지 단계는 별도 파일에 둔다)
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
exec bash deploy/post_update.sh
