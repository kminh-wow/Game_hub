"""홀덤 방: 2~8명 토너먼트. 방 안에서 게임마다 우승 횟수를 센다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    start_chips: int = 1000   # 시작 칩
    blind_every: int = 8      # 블라인드가 오르는 판 수
    turn_time: int = 30       # 한 번 행동 제한 시간(초)

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"start_chips": (500, 10000), "blind_every": (3, 20), "turn_time": (10, 60)}
    min_players = 2
    max_players_limit = 8
    default_max_players = 6

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.wins: dict[str, int] = {}

    def create_game(self) -> Game:
        return Game(self)

    def extra_state(self) -> dict[str, Any]:
        return {"wins": self.wins}

    # 우승 기록
    def record_result(self, winner: Any) -> None:
        if winner is not None:
            self.wins[winner.id] = self.wins.get(winner.id, 0) + 1
