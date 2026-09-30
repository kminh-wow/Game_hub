"""대기실 공통 동작: 참가자, 방장, 준비, 설정, 게임 시작/종료.

게임마다 BaseRoom 을 상속해서 다음만 정한다.
- settings_class: 설정 dataclass (copy() 메서드 필요)
- setting_limits: 정수 설정의 (최소, 최대)
- bool_settings: 참/거짓 설정 이름
- create_game(): 게임 객체를 만든다. 게임은 start(), remove_player(p), finish() 를 갖고,
  끝나면 room.end_game(self) 를 부른다.
- (선택) extra_state(), can_start(), min_players, max_players_limit
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Any, ClassVar

from .models import Player, broadcast


def clamp_int(value: Any, lo: int, hi: int) -> int | None:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return None


class BaseRoom:
    settings_class: ClassVar[type]
    setting_limits: ClassVar[dict[str, tuple[int, int]]] = {}
    bool_settings: ClassVar[tuple[str, ...]] = ()
    min_players: ClassVar[int] = 2
    max_players_limit: ClassVar[int] = 8
    default_max_players: ClassVar[int] = 4

    def __init__(
        self,
        room_id: str,
        title: str,
        host: Player,
        max_players: int,
        ctx: Any,
        on_lobby_change: Callable[[], Awaitable[None]],
    ):
        self.id = room_id
        self.title = title
        self.host = host
        self.max_players = max_players
        self.ctx = ctx                      # 게임이 쓰는 공유 자원 (사전 등)
        self.settings = self.settings_class()
        self.players: list[Player] = []
        self.ready: set[str] = set()
        self.game: Any = None
        self._on_lobby_change = on_lobby_change

    # ---- 게임마다 바꾸는 부분 ----

    def create_game(self) -> Any:
        raise NotImplementedError

    def extra_state(self) -> dict[str, Any]:
        """방 상태(state)에 덧붙일 게임별 정보."""
        return {}

    def can_start(self) -> str | None:
        """시작할 수 없으면 이유를 돌려준다."""
        if len(self.players) < self.min_players:
            return f"{self.min_players}명 이상 있어야 시작할 수 있어요."
        return None

    # ---- 조회 ----

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
            **self.extra_state(),
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

        for key, (lo, hi) in self.setting_limits.items():
            if key in data and (value := clamp_int(data[key], lo, hi)) is not None:
                setattr(self.settings, key, value)
        for key in self.bool_settings:
            if key in data:
                setattr(self.settings, key, bool(data[key]))
        if "max_players" in data:
            lo = max(self.min_players, len(self.players))
            value = clamp_int(data["max_players"], lo, self.max_players_limit)
            if value is not None:
                self.max_players = value
        await self.sync()
        return None

    async def start(self, player: Player) -> str | None:
        if player is not self.host:
            return "방장만 시작할 수 있어요."
        if self.playing:
            return "이미 게임 중이에요."
        if reason := self.can_start():
            return reason
        if any(p.id not in self.ready for p in self.players if p is not self.host):
            return "모두 준비해야 시작할 수 있어요."

        self.game = self.create_game()
        await self.sync()
        await self.game.start()
        return None

    async def end_game(self, game: Any) -> None:
        if self.game is not game:
            return
        self.game = None
        self.ready.clear()
        await self.sync()
