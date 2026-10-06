"""오목 방: 최대 2명. 혼자 시작하면 AI 와 둔다. 방 안에서 판마다 전적을 센다."""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from common.multiplayer import BaseRoom

from .ai import DEFAULT_LEVEL, LEVEL_NAMES
from .game import Game


@dataclass
class RoomSettings:
    turn_time: int = 30   # 한 수 제한 시간(초). 넘기면 패배
    ai_level: int = DEFAULT_LEVEL   # AI 난이도 (0 하 ~ 4 최상)
    ai_talk: int = 0                # AI 말투 (0 순한맛, 1 매운맛: 욕설 섞임)

    def copy(self) -> RoomSettings:
        return replace(self)


class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"turn_time": (10, 120), "ai_level": (0, len(LEVEL_NAMES) - 1), "ai_talk": (0, 1)}
    min_players = 1          # 혼자면 AI 와 대결
    max_players_limit = 2
    default_max_players = 2

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.max_players = 2
        self.wins: dict[str, int] = {}
        self.draws = 0
        self.last_loser_id: str | None = None

    def create_game(self) -> Game:
        return Game(self)

    def extra_state(self) -> dict[str, Any]:
        return {"wins": self.wins, "draws": self.draws}

    def record_result(self, winner: Any, loser: Any) -> None:
        if winner is None:
            self.draws += 1
            return
        self.wins[winner.id] = self.wins.get(winner.id, 0) + 1
        self.last_loser_id = loser.id if loser else None
