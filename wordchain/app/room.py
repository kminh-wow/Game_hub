"""끝말잇기 방: 공통 대기실(BaseRoom)에 끝말잇기 설정과 게임을 붙인다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom, Player

from .dictionary import Dictionary
from .game import Game


@dataclass
class RoomSettings:
    rounds: int = 5
    turn_time: int = 15    # 한 턴 제한 시간(초)
    round_time: int = 90   # 라운드 전체 시간(초)
    no_killer: bool = False
    injeong: bool = True   # 어인정 단어(끄투 사용자 등록 단어) 허용

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {
        "rounds": (1, 10),
        "turn_time": (5, 30),
        "round_time": (30, 300),
    }
    bool_settings = ("no_killer", "injeong")

    @property
    def dictionary(self) -> Dictionary:
        return self.ctx

    def create_game(self) -> Game:
        return Game(self)

    def extra_state(self) -> dict[str, Any]:
        return {"game": self.game.snapshot() if self.game else None}

    async def submit(self, player: Player, word: str) -> None:
        if self.game:
            await self.game.submit(player, word)
