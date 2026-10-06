"""포트리스 방: 1~4명. 혼자 시작하면 허수아비(연습)나 AI 를 상대한다."""
from __future__ import annotations

from dataclasses import dataclass, replace

from common.multiplayer import BaseRoom, spicy

from .game import Game


@dataclass
class RoomSettings:
    turn_time: int = 30   # 한 차례 제한 시간(초). 넘기면 쏘지 못하고 넘어간다
    solo_opponent: int = 0   # 혼자일 때 상대 (0 허수아비, 1~3 AI 하·중·상)
    ai_talk: int = 0         # AI 말투 (0 순한맛, 1 매운맛: 욕설 섞임)

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"turn_time": (10, 60), "solo_opponent": (0, 3), "ai_talk": (0, 1)}
    min_players = 1
    max_players_limit = 4
    default_max_players = 4

    # 방 상태 덧붙임 (매운맛을 쓸 수 있는지)
    def extra_state(self) -> dict:
        return {"spicy": spicy.available()}

    def create_game(self) -> Game:
        return Game(self)
