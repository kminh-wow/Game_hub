"""AI 대사: 게임 상황이나 플레이어 채팅에 맞춰 미리 써 둔 말을 골라 방 채팅으로 보낸다.

게임은 상황 이름(예: "hit", "win")별 대사 목록을 넘기고, 일이 생길 때 say("hit") 를 부른다.
"""
from __future__ import annotations

import asyncio
import random
import re
import string
import time
from typing import Any

from . import spicy as spicy_data

COOLDOWN = 6.0        # 일반 대사 사이 최소 간격(초)
CHAT_COOLDOWN = 2.0   # 채팅 대꾸는 이 간격만 지나면 한다
LIMIT = 30            # 한 판에 하는 말 수 제한
DELAY = (0.6, 1.6)    # 일이 생기고 말하기까지 기다리는 시간(초)
RECENT = 25           # 최근에 한 말은 이만큼 피한다
JOIN = (.35, .4)      # 앞말·뒷말을 붙이는 확률

# 플레이어 채팅 분류 (앞에서부터 먼저 맞는 것). 욕 단어는 비공개 파일(spicy.json 의 insult)에서 더한다
INSULT = r"바보|멍청|못하|허접|노답|쓰레기"
_EXTRA_INSULT = spicy_data.pattern("insult")
CHAT_KINDS = [
    ("chat_insult", INSULT + ("|" + _EXTRA_INSULT.pattern if _EXTRA_INSULT else "")),
    ("chat_laugh", r"ㅋㅋ|ㅎㅎ|lol|웃기"),
    ("chat_hello", r"안녕|ㅎㅇ|하이|hi|hello|반가"),
    ("chat_gg", r"\bgg\b|ㅈㅈ|졌|항복|잘했|굿"),
    ("chat_question", r"\?|뭐|왜|어떻게|누구"),
]


def _fields(line: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(line) if name}


# 칸 채우기 (값이 모자라거나 중괄호가 틀린 대사는 None)
def _fill(line: str, values: dict[str, Any]) -> str | None:
    try:
        return line.format(**values) if _fields(line) <= values.keys() else None
    except (ValueError, IndexError, KeyError, AttributeError):
        return None


# 대사 목록 다듬기 (글자 대사만)
def _texts(value: Any) -> list[str]:
    return [line for line in value if isinstance(line, str)] if isinstance(value, list) else []


class Banter:
    def __init__(self, room: Any, speaker: dict[str, Any], lines: dict[str, list[str]],
                 rng: random.Random | None = None, spicy: dict[str, Any] | None = None):
        self.room = room
        self.speaker = speaker              # {"id", "name"}
        self.spicy = spicy is not None      # 매운맛 (욕설 섞인 말투)
        spicy = dict(spicy or {})
        self.prefixes = _texts(spicy.pop("_prefix", []))   # 대사 앞에 붙이는 말 (매운맛)
        self.suffixes = _texts(spicy.pop("_suffix", []))   # 대사 뒤에 붙이는 말 (매운맛)
        join = spicy.pop("_join", JOIN)                     # 앞말·뒷말 붙이는 확률 (매운맛 파일에서 바꿀 수 있음)
        valid = isinstance(join, (list, tuple)) and len(join) == 2 and all(isinstance(p, (int, float)) for p in join)
        self.join = tuple(join) if valid else JOIN
        self.lines = {**lines, **{kind: _texts(value) for kind, value in spicy.items()}}
        self.rng = rng or random.Random()
        self.spoken = 0
        self._last_at = -COOLDOWN
        self._recent: list[str] = []
        self._tasks: set[asyncio.Task] = set()

    # 대사 고르기 (채울 수 있는 칸만 있는 대사 중, 최근에 한 말은 피한다)
    def pick(self, kind: str, **values: Any) -> str | None:
        pool = [(line, text) for line in self.lines.get(kind) or [] if (text := _fill(line, values)) is not None]
        if not pool:
            return None
        fresh = [pair for pair in pool if pair[0] not in self._recent] or pool
        line, text = self.rng.choice(fresh)
        self._recent = (self._recent + [line])[-RECENT:]
        return self._decorate(text, values)

    # 앞말·뒷말 붙이기 (매운맛)
    def _decorate(self, text: str, values: dict[str, Any]) -> str:
        head = [filled for p in self.prefixes if (filled := _fill(p, values)) is not None]
        tail = [filled for s in self.suffixes if (filled := _fill(s, values)) is not None]
        if head and self.rng.random() < self.join[0] and not re.match(r"[ㅋㅎ아야와어헐씨시]", text):
            text = f"{self.rng.choice(head)} {text}"
        if tail and self.rng.random() < self.join[1] and not re.search(r"[ㅋㅎ?!]$", text):
            text = f"{text} {self.rng.choice(tail)}"
        return text

    # 상황에 맞는 말 하기 (important 면 간격·확률 무시, after 초 뒤에 말함)
    def say(self, kind: str, chance: float = 1.0, important: bool = False, after: float = 0.0,
            cooldown: float | None = None, **values: Any) -> bool:
        now = time.monotonic()
        if self.spoken >= LIMIT and not important:
            return False
        gap = COOLDOWN if cooldown is None else cooldown
        if not important and (now - self._last_at < gap or self.rng.random() > chance):
            return False
        text = self.pick(kind, **values)
        if not text:
            return False
        self.spoken += 1
        self._last_at = now
        task = asyncio.create_task(self._send(text, after))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    # 플레이어 채팅에 대꾸
    def hear(self, player: Any, text: str) -> bool:
        kind = next((k for k, pattern in CHAT_KINDS if re.search(pattern, text, re.I)), "chat_other")
        chance = 0.9 if kind != "chat_other" else 0.5
        return self.say(kind, chance=chance, cooldown=CHAT_COOLDOWN, name=getattr(player, "name", ""))

    async def _send(self, text: str, after: float = 0.0) -> None:
        try:
            await asyncio.sleep(after + self.rng.uniform(*DELAY))
            await self.room.broadcast({
                "type": "chat", "scope": "room", "from": self.speaker, "text": text,
                "spectator": False, "bot": True,
            })
        except asyncio.CancelledError:
            pass

    def stop(self) -> None:
        for task in list(self._tasks):
            task.cancel()
