"""멀티플레이 게임용 FastAPI 앱 틀: 정적 프론트엔드(/, /static)와 게임 WebSocket(/ws)."""
from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .log import LABELS, log, tag
from .server import CLOSE_INVALID_NAME, GameServer, valid_name

# 연결이 끊겼다는 예외. 새 Starlette(1.x)는 이미 끊긴 연결에서 다시 받으려 하면
# WebSocketDisconnect 와는 다른 WebSocketDisconnected 를 던지므로 둘 다 잡는다.
try:
    from starlette.websockets import WebSocketDisconnected
except ImportError:  # 예전 Starlette
    WebSocketDisconnected = WebSocketDisconnect
DISCONNECTED = (WebSocketDisconnect, WebSocketDisconnected)


def create_app(
    server: GameServer,
    static_dir: Path,
    title: str,
    health_info: Callable[[], dict[str, Any]] = dict,
) -> FastAPI:
    # 게임 화면 외의 자동 문서 페이지(/docs, /redoc, /openapi.json)는 노출하지 않는다.
    app = FastAPI(title=title, docs_url=None, redoc_url=None, openapi_url=None)
    server.label = LABELS.get(title, title)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    @app.get("/api/health")
    async def health() -> dict:
        return {"status": "ok", **health_info(), "players": len(server.players), "rooms": len(server.rooms)}

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket) -> None:
        await ws.accept()
        name = ws.query_params.get("name", "").strip()
        if not valid_name(name):
            await ws.close(code=CLOSE_INVALID_NAME, reason="invalid name")
            return

        player = await server.connect(ws, name, ws.query_params.get("token", ""))
        if player is None:
            return
        try:
            while True:
                raw = await ws.receive_text()
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                # 처리 중 오류가 나도 연결은 유지
                try:
                    await server.handle(player, msg)
                except Exception:
                    kind = msg.get("type") if isinstance(msg, dict) else None
                    where = tag(server.label, player.room) if player.room else tag(server.label)
                    log.exception("%s 서버 오류 %s 메시지 %s", where, player.name, kind)
                    await player.send({"type": "error", "message": "서버에서 오류가 났어요. 다시 해 주세요."})
        except DISCONNECTED:
            pass
        finally:
            # 연결 작업이 취소되더라도(서버 종료 등) 퇴장 정리는 끝까지 한다.
            await asyncio.shield(server.disconnect(player))

    return app
