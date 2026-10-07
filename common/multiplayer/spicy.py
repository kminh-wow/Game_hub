"""매운맛(욕설) 말투 데이터: git 에 올리지 않는 private/spicy.json 에서 읽는다.

파일이 없으면 매운맛을 쓸 수 없다(방 설정에서도 숨김).
파일 형식:
    {
      "insult": "플레이어 욕 알아보기 정규식 (단어|단어)",
      "hate": "대사에 들어가면 안 되는 말 정규식 (테스트가 대사를 점검)",
      "lines": {"omok": {"상황": ["대사", ...]}, "fortress": {...}}
    }
정규식이나 대사에 오타가 있으면 경고만 남기고 그 부분은 없는 셈 친다.
서버에는 scp 로 올린다:  scp -i <키> private/spicy.json <user>@<서버>:~/Game_hub/private/
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).resolve().parents[2] / "private" / "spicy.json"

log = logging.getLogger("game")


@lru_cache(maxsize=1)
def data() -> dict[str, Any]:
    try:
        value = json.loads(PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        log.warning("[매운맛] %s 를 읽지 못했어요", PATH)
        return {}
    return value if isinstance(value, dict) else {}


def available() -> bool:
    return bool(data().get("lines"))


def lines(game: str) -> dict[str, Any] | None:
    table = (data().get("lines") or {}).get(game)
    return table if isinstance(table, dict) and table else None


# 정규식 읽기 (틀리면 경고 후 없는 셈)
def pattern(key: str) -> re.Pattern[str] | None:
    value = data().get(key)
    if not value:
        return None
    try:
        return re.compile(value)
    except (re.error, TypeError) as e:
        log.warning("[매운맛] %s 의 %s 정규식이 틀렸어요: %s", PATH, key, e)
        return None
