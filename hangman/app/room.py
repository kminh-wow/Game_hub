"""행맨 방: 공통 대기실(BaseRoom)에 행맨 설정과 게임을 붙인다."""
from __future__ import annotations

from dataclasses import dataclass, replace

from common.multiplayer import BaseRoom

from .game import Game
from .words import WordList


@dataclass
class RoomSettings:
    cycles: int = 1       # 모두가 몇 번씩 출제할지
    lives: int = 6        # 각자 교수대 완성까지 틀릴 수 있는 횟수
    turn_time: int = 20   # 한 턴 제한 시간(초)
    hint_turn: int = 4    # 틀린 추측이 몇 번이면 힌트를 공개할지

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {
        "cycles": (1, 3),
        "lives": (4, 10),
        "turn_time": (10, 60),
        "hint_turn": (1, 15),
    }
    default_max_players = 6

    @property
    def words(self) -> WordList:
        return self.ctx

    def create_game(self) -> Game:
        return Game(self)
