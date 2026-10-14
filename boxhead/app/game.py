"""박스헤드 같이 하기: 방장의 브라우저가 게임을 계산하고, 서버는 입력과 화면 값을 전달만 한다.

흐름: 시작하면 서버가 방장·참가자·난수 시드를 알려 주고 → 방장 브라우저가 계산을 시작해 20번/초 화면 값(snap)을 보내면
서버가 나머지 참가자·관전자에게 전달 → 다른 참가자는 입력(input)을 보내고 서버가 방장에게 전달 → 방장이 끝났다고(over) 하면 결과를 알린다.
방장이 나가면 그 판은 끝난다.
"""
from __future__ import annotations

import secrets
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

MAX_SNAP_BYTES = 120_000      # 화면 값 한 번의 크기 제한
MAX_INPUT_KEYS = 8


class Game:
    def __init__(self, room: Room):
        self.room = room
        self.settings = room.settings.copy()
        self.host: Player = room.host
        self.players = list(room.players)
        self.seed = secrets.randbits(32)
        self.finished = False
        self.last_snap: dict[str, Any] | None = None

    # 시작할 때 모두에게 알리는 값
    def meta(self) -> dict[str, Any]:
        return {
            "host_id": self.host.id,
            "players": [p.public() for p in self.players],
            "seed": self.seed,
            "difficulty": self.settings.difficulty,
        }

    async def start(self) -> None:
        await self.room.system(f"박스헤드 시작! 방장({self.host.name}) 화면에서 계산해요. 난이도 {['하', '중', '상'][self.settings.difficulty]}")
        await self.room.broadcast({"type": "game", "game": self.meta()})

    # 관전자·늦게 들어온 사람에게 지금 상태
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        msgs: list[dict[str, Any]] = [{"type": "game", "game": self.meta()}]
        if self.last_snap is not None:
            msgs.append({"type": "snap", "snap": self.last_snap})
        return msgs

    # 참가자의 입력 → 방장
    async def relay_input(self, player: Player, msg: dict) -> str | None:
        if self.finished or player is self.host or player not in self.players:
            return None
        data = msg.get("input")
        if not isinstance(data, dict) or len(data) > MAX_INPUT_KEYS:
            return None
        await self.host.send({"type": "input", "id": player.id, "input": data})
        return None

    # 방장의 화면 값 → 나머지 모두
    async def relay_snap(self, player: Player, msg: dict) -> str | None:
        if self.finished or player is not self.host:
            return None
        snap = msg.get("snap")
        if not isinstance(snap, dict) or len(str(snap)) > MAX_SNAP_BYTES:
            return None
        self.last_snap = snap
        out = {"type": "snap", "snap": snap}
        for p in self.room.audience:
            if p is not self.host:
                await p.send(out)
        return None

    # 방장이 끝났다고 알림
    async def over(self, player: Player, msg: dict) -> str | None:
        if self.finished or player is not self.host:
            return None
        info = msg.get("result") if isinstance(msg.get("result"), dict) else {}
        await self.finish(
            score=_num(info.get("score")), level=_num(info.get("level")), kills=_num(info.get("kills")), time=_num(info.get("time")),
        )
        return None

    async def remove_player(self, player: Player) -> None:
        if self.finished:
            return
        if player is self.host:
            await self.finish(reason="host_left")

    async def finish(self, score: int = 0, level: int = 0, kills: int = 0, time: int = 0, reason: str | None = None) -> None:
        if self.finished:
            return
        self.finished = True
        self.room.record_result(score)
        await self.room.broadcast({
            "type": "game_over", "winner": None, "reason": reason,
            "score": score, "level": level, "kills": kills, "time": time,
            "players": [p.public() for p in self.players],
        })
        await self.room.end_game(self)


def _num(value: Any) -> int:
    try:
        return max(0, min(10**9, int(value)))
    except (TypeError, ValueError):
        return 0
