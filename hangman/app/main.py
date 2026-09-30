"""행맨 FastAPI 앱: 정적 프론트엔드와 게임용 WebSocket."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .server import CLOSE_INVALID_NAME, GameServer, valid_name
from .words import WordList

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"

words = WordList.load(DATA_DIR / "enable1.txt", DATA_DIR / "common_words.txt")
server = GameServer(words)

app = FastAPI(title="Hangman", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "words": len(words), "players": len(server.players), "rooms": len(server.rooms)}


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
            await server.handle(player, msg)
    except WebSocketDisconnect:
        pass
    finally:
        # 연결 작업이 취소되더라도(서버 종료 등) 퇴장 정리는 끝까지 한다.
        await asyncio.shield(server.disconnect(player))
