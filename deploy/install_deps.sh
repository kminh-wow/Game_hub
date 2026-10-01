#!/usr/bin/env bash
# 가상환경(.venv)을 파이썬 3.11 로 맞추고 requirements.txt 를 설치한다. setup.sh 와 post_update.sh 가 부른다.
#
# 왜 3.11 인가:
#   요트 다이스의 물리 계산에 쓰는 pybullet 3.2.7 은 파이썬 3.11 까지만 미리 빌드된 설치 파일(wheel)이 있다.
#   그보다 새 파이썬(예: Ubuntu 26.04 의 3.14)에서는 소스를 컴파일해야 하는데, 컴파일러(gcc)와 Python.h 가
#   필요하고 임시 공간(/tmp 는 메모리 디스크라 약 450MB)도 모자라서 "Disk quota exceeded" 로 실패한다.
#   3.11 은 uv 로 내려받는다. 시스템 파이썬은 건드리지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."

WANT=3.11
BOOT="$HOME/.cache/game-hub-uv"

# pip 가 큰 파일을 풀 때 /tmp(작은 메모리 디스크) 대신 디스크를 쓰게 한다.
export TMPDIR="$HOME/.tmp"
mkdir -p "$TMPDIR"

current() { .venv/bin/python -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo "없음"; }

install_requirements() {
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
}

if [ "$(current)" = "$WANT" ]; then
  install_requirements
  exit 0
fi

echo "==> 가상환경을 파이썬 $WANT 로 새로 만듭니다 (지금: $(current)). 1~3분 걸려요."

# uv 는 시스템 파이썬 대신 쓸 별도 환경에 설치한다.
if [ ! -x "$BOOT/bin/uv" ]; then
  python3 -m venv "$BOOT"
  "$BOOT/bin/pip" install -q uv
fi

# 새 환경이 완성될 때까지 예전 환경은 지우지 않는다. 실패하면 되돌린다.
rm -rf .venv.old
[ -d .venv ] && mv .venv .venv.old
if "$BOOT/bin/uv" venv --seed --python "$WANT" .venv && install_requirements \
   && .venv/bin/python -c "import fastapi, uvicorn, pybullet"; then
  rm -rf .venv.old
  echo "==> 가상환경 준비 완료 (파이썬 $(current))"
else
  echo "!! 새 가상환경을 만들지 못했어요. 예전 환경으로 되돌립니다." >&2
  rm -rf .venv
  [ -d .venv.old ] && mv .venv.old .venv
  exit 1
fi
