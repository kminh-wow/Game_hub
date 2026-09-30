"""대기실 상태(참가자, 준비, 설정)와 게임 시작/종료."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, replace
from typing import Any

from .dictionary import Dictionary
from .game import Game
from .models import Player, broadcast

MIN_PLAYERS = 2
MAX_PLAYERS = 8

# 설정 이름: (최소, 최대)
SETTING_LIMITS = {
    "rounds": (1, 10),
    "turn_time": (5, 30),
    "round_time": (30, 300),
}


@dataclass
class RoomSettings:
    rounds: int = 5
    turn_time: int = 15    # 한 턴 제한 시간(초)
    round_time: int = 90   # 라운드 전체 시간(초)
    no_killer: bool = False
    injeong: bool = True   # 어인정 단어(끄투 사용자 등록 단어) 허용

    def copy(self) -> RoomSettings:
        return replace(self)


def _clamp_int(value: Any, lo: int, hi: int) -> int | None:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return None


class Room:
    def __init__(
        self,
        room_id: str,
        title: str,
        host: Player,
        max_players: int,
        dictionary: Dictionary,
        on_lobby_change: Callable[[], Awaitable[None]],
    ):
        self.id = room_id
        self.title = title
        self.host = host
        self.max_players = max_players
        self.dictionary = dictionary
        self.settings = RoomSettings()
        self.players: list[Player] = []
        self.ready: set[str] = set()
        self.game: Game | None = None
        self._on_lobby_change = on_lobby_change

    @property
    def playing(self) -> bool:
        return self.game is not None

    @property
    def full(self) -> bool:
        return len(self.players) >= self.max_players

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "host": self.host.name,
            "players": len(self.players),
            "max_players": self.max_players,
            "playing": self.playing,
        }

    def state(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "host_id": self.host.id,
            "max_players": self.max_players,
            "settings": asdict(self.settings),
            "players": [{**p.public(), "ready": p.id in self.ready} for p in self.players],
            "playing": self.playing,
            "game": self.game.snapshot() if self.game else None,
        }

    async def broadcast(self, msg: dict[str, Any]) -> None:
        await broadcast(self.players, msg)

    async def system(self, text: str) -> None:
        await self.broadcast({"type": "system", "text": text})

    async def sync(self) -> None:
        await self.broadcast({"type": "room", "room": self.state()})
        await self._on_lobby_change()

    # ---- 입장/퇴장 ----

    async def add(self, player: Player) -> None:
        self.players.append(player)
        player.room = self
        await self.system(f"{player.name}님이 들어왔어요.")
        await self.sync()

    async def remove(self, player: Player) -> None:
        if player not in self.players:
            return
        self.players.remove(player)
        self.ready.discard(player.id)
        player.room = None
        if self.game:
            await self.game.remove_player(player)
        if self.players and self.host is player:
            self.host = self.players[0]
            self.ready.discard(self.host.id)
            await self.system(f"{self.host.name}님이 방장이 되었어요.")
        await self.system(f"{player.name}님이 나갔어요.")
        await self.sync()

    # ---- 대기실 ----

    async def toggle_ready(self, player: Player) -> str | None:
        if self.playing:
            return "게임 중에는 바꿀 수 없어요."
        if player is self.host:
            return None
        if player.id in self.ready:
            self.ready.remove(player.id)
        else:
            self.ready.add(player.id)
        await self.sync()
        return None

    async def update_settings(self, player: Player, data: dict[str, Any]) -> str | None:
        if player is not self.host:
            return "방장만 설정을 바꿀 수 있어요."
        if self.playing:
            return "게임 중에는 바꿀 수 없어요."

        for key, (lo, hi) in SETTING_LIMITS.items():
            if key in data and (value := _clamp_int(data[key], lo, hi)) is not None:
                setattr(self.settings, key, value)
        for key in ("no_killer", "injeong"):
            if key in data:
                setattr(self.settings, key, bool(data[key]))
        if "max_players" in data:
            value = _clamp_int(data["max_players"], max(MIN_PLAYERS, len(self.players)), MAX_PLAYERS)
            if value is not None:
                self.max_players = value
        await self.sync()
        return None

    async def start(self, player: Player) -> str | None:
        if player is not self.host:
            return "방장만 시작할 수 있어요."
        if self.playing:
            return "이미 게임 중이에요."
        if len(self.players) < MIN_PLAYERS:
            return f"{MIN_PLAYERS}명 이상 있어야 시작할 수 있어요."
        if any(p.id not in self.ready for p in self.players if p is not self.host):
            return "모두 준비해야 시작할 수 있어요."

        self.game = Game(self)
        await self.sync()
        await self.game.start()
        return None

    async def submit(self, player: Player, word: str) -> None:
        if self.game:
            await self.game.submit(player, word)

    async def end_game(self, game: Game) -> None:
        if self.game is not game:
            return
        self.game = None
        self.ready.clear()
        await self.sync()
