"""매운맛(욕설) 말투 데이터: git 에 올리지 않는 private/spicy.json 에서 읽는다.

파일이 없으면 매운맛을 쓸 수 없고(방 설정에서도 숨김), 욕설 걸러내기도 하지 않는다.
파일 형식:
    {
      "system": "LLM 에게 줄 매운맛 지시문 ({game}, {name} 자리 표시)",
      "insult": "플레이어 욕 알아보기 정규식 (단어|단어)",
      "hate": "언제나 버릴 말 정규식",
      "profanity": "순한맛일 때 버릴 욕 정규식",
      "lines": {"omok": {"상황": ["대사", ...]}, "fortress": {...}}
    }
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


@lru_cache(maxsize=1)
def data() -> dict[str, Any]:
    try:
        return json.loads(PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        logging.getLogger("game").warning("[매운맛] %s 를 읽지 못했어요", PATH)
        return {}


def available() -> bool:
    return bool(data().get("lines"))


def lines(game: str) -> dict[str, list[str]] | None:
    return data().get("lines", {}).get(game) or None


def system() -> str | None:
    return data().get("system") or None


def pattern(key: str) -> re.Pattern[str] | None:
    value = data().get(key)
    return re.compile(value) if value else None
