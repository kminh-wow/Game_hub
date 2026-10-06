"""AI 대사: 게임 상황이나 플레이어 채팅에 맞춰 미리 써 둔 말을 골라 방 채팅으로 보낸다.

게임은 상황 이름(예: "hit", "win")별 대사 목록을 넘기고, 일이 생길 때 say("hit") 를 부른다.
서버에 BANTER_LLM_URL 이 있으면 로컬 LLM 이 대사를 새로 만들고, 실패하면 미리 써 둔 대사를 쓴다 (llm.py).
"""
from __future__ import annotations

import asyncio
import random
import re
import time
from typing import Any

from . import llm

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


SYSTEM = (
    "너는 온라인 {game} 게임에서 사람과 대결하는 AI 상대 '{name}'야. "
    "방금 일어난 상황에 맞춰 상대를 장난스럽게 도발하거나 리액션하는 채팅을 한국어 한 문장(40자 이내)으로 써. "
    "친근한 존댓말을 쓰고, 욕설·비하·혐오 표현은 절대 쓰지 마. 이모지, 따옴표, 설명 없이 대사만 써."
)


class Banter:
    def __init__(self, room: Any, speaker: dict[str, Any], lines: dict[str, list[str]],
                 rng: random.Random | None = None, game: str = "", situations: dict[str, str] | None = None):
        self.room = room
        self.speaker = speaker              # {"id", "name"}
        self.lines = lines
        self.game = game
        self.situations = situations or {}  # 상황 이름 -> LLM 에게 줄 설명
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
            cooldown: float | None = None, chat: str = "", **values: Any) -> bool:
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
        task = asyncio.create_task(self._send(text, after, self._prompt(kind, text, chat, values)))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    # 플레이어 채팅에 대꾸
    def hear(self, player: Any, text: str) -> bool:
        kind = next((k for k, pattern in CHAT_KINDS if re.search(pattern, text, re.I)), "chat_other")
        chance = 0.9 if kind != "chat_other" else 0.5
        return self.say(kind, chance=chance, cooldown=CHAT_COOLDOWN, chat=text, name=getattr(player, "name", ""))

    # LLM 에게 줄 글 (시스템, 사용자)
    def _prompt(self, kind: str, example: str, chat: str, values: dict[str, Any]) -> tuple[str, str]:
        system = SYSTEM.format(game=self.game or "보드", name=self.speaker.get("name", "AI"))
        user = f"상황: {self.situations.get(kind, kind)}."
        if chat:
            who = values.get("name") or "상대"
            user += f' {who}의 채팅: "{chat[:100]}"'
        user += f" 참고 대사: {example}"
        return system, user

    async def _send(self, text: str, after: float = 0.0, prompt: tuple[str, str] | None = None) -> None:
        try:
            made = asyncio.create_task(llm.generate(*prompt)) if prompt and llm.enabled() else None
            await asyncio.sleep(after + self.rng.uniform(*DELAY))
            if made is not None:
                text = await made or text
            await self.room.broadcast({
                "type": "chat", "scope": "room", "from": self.speaker, "text": text,
                "spectator": False, "bot": True,
            })
        except asyncio.CancelledError:
            pass

    def stop(self) -> None:
        for task in list(self._tasks):
            task.cancel()
