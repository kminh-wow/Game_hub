"""섯다 방: 2~6명. 방 안에서 게임마다 우승 횟수를 센다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    start_chips: int = 1000   # 시작 칩
    ante_every: int = 8       # 판돈이 오르는 판 수
    turn_time: int = 20       # 한 번 행동 제한 시간(초)
    max_hands: int = 0        # 정한 판 수가 끝나면 칩 순위 (0이면 마지막 1명이 남을 때까지)

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"start_chips": (500, 10000), "ante_every": (3, 20), "turn_time": (10, 60), "max_hands": (0, 100)}
    min_players = 2
    max_players_limit = 6
    default_max_players = 5

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
