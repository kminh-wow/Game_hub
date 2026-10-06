"""AI 대사: 게임 상황이나 플레이어 채팅에 맞춰 미리 써 둔 말을 골라 방 채팅으로 보낸다.

게임은 상황 이름(예: "hit", "win")별 대사 목록을 넘기고, 일이 생길 때 say("hit") 를 부른다.
나중에 로컬 LLM 등으로 대사를 만들려면 pick() 만 바꾸면 된다.
"""
from __future__ import annotations

import asyncio
import random
import re
import time
from typing import Any

COOLDOWN = 6.0        # 일반 대사 사이 최소 간격(초)
CHAT_COOLDOWN = 2.0   # 채팅 대꾸는 이 간격만 지나면 한다
LIMIT = 30            # 한 판에 하는 말 수 제한
DELAY = (0.6, 1.6)    # 일이 생기고 말하기까지 기다리는 시간(초)

# 플레이어 채팅 분류 (앞에서부터 먼저 맞는 것)
CHAT_KINDS = [
    ("chat_insult", r"바보|멍청|못하|허접|노답|쓰레기"),
    ("chat_laugh", r"ㅋㅋ|ㅎㅎ|lol|웃기"),
    ("chat_hello", r"안녕|ㅎㅇ|하이|hi|hello|반가"),
    ("chat_gg", r"\bgg\b|ㅈㅈ|졌|항복|잘했|굿"),
    ("chat_question", r"\?|뭐|왜|어떻게|누구"),
]


class Banter:
    def __init__(self, room: Any, speaker: dict[str, Any], lines: dict[str, list[str]],
                 rng: random.Random | None = None):
        self.room = room
        self.speaker = speaker              # {"id", "name"}
        self.lines = lines
        self.rng = rng or random.Random()
        self.spoken = 0
        self._last_at = -COOLDOWN
        self._recent: list[str] = []
        self._tasks: set[asyncio.Task] = set()

    # 대사 고르기 (최근에 한 말은 피한다)
    def pick(self, kind: str, **values: Any) -> str | None:
        pool = self.lines.get(kind) or []
        if not pool:
            return None
        fresh = [line for line in pool if line not in self._recent] or pool
        line = self.rng.choice(fresh)
        self._recent = (self._recent + [line])[-6:]
        try:
            return line.format(**values)
        except (KeyError, IndexError):
            return line

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
