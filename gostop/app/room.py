"""고스톱 방: 사람 1~3명, 모자란 자리는 AI. 방 안에서 게임마다 1등 횟수를 센다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    size: int = 3             # 2 맞고(7점) / 3 고스톱(3점). 사람이 모자라면 AI
    start_chips: int = 10000  # 시작 칩
    point_value: int = 100    # 점당 칩
    max_rounds: int = 10      # 판 수 (0이면 누가 칩이 떨어질 때까지)
    turn_time: int = 25       # 한 번 내는 제한 시간(초)

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"size": (2, 3), "start_chips": (1000, 100000), "point_value": (10, 1000), "max_rounds": (0, 50), "turn_time": (10, 60)}
    min_players = 1           # 혼자면 AI 와
    max_players_limit = 3
    default_max_players = 3

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.wins: dict[str, int] = {}

    def create_game(self) -> Game:
        return Game(self)

    def extra_state(self) -> dict[str, Any]:
        return {"wins": self.wins}

    # 1등 기록 (AI 가 1등이면 세지 않음)
    def record_result(self, winner: Any) -> None:
        if winner is not None:
            self.wins[winner.id] = self.wins.get(winner.id, 0) + 1
