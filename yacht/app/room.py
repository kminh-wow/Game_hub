"""요트 다이스 방: 1~5명. 혼자 시작하면 연습 모드."""
from __future__ import annotations

from dataclasses import dataclass, replace

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    turn_time: int = 60   # 한 차례 제한 시간(초). 넘기면 가장 높은 칸에 자동 기록

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"turn_time": (20, 180)}
    min_players = 1
    max_players_limit = 5
    default_max_players = 5

    def create_game(self) -> Game:
        return Game(self)
