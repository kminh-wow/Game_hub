"""포트리스 방: 1~4명. 혼자 시작하면 허수아비를 상대로 연습한다."""
from __future__ import annotations

from dataclasses import dataclass, replace

from common.multiplayer import BaseRoom

from .game import Game


@dataclass
class RoomSettings:
    turn_time: int = 30   # 한 차례 제한 시간(초). 넘기면 쏘지 못하고 넘어간다

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"turn_time": (10, 60)}
    min_players = 1
    max_players_limit = 4
    default_max_players = 4

    def create_game(self) -> Game:
        return Game(self)
