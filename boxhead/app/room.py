"""박스헤드 방: 2~4명 협동. 방 안에서 최고 점수를 기억한다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    difficulty: int = 1       # 0 하, 1 중, 2 상

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"difficulty": (0, 2)}
    min_players = 2
    max_players_limit = 4
    default_max_players = 4

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.best = 0

    def create_game(self) -> Game:
        return Game(self)

    def extra_state(self) -> dict[str, Any]:
        return {"best": self.best}

    # 방 최고 점수
    def record_result(self, score: int) -> None:
        self.best = max(self.best, score)
