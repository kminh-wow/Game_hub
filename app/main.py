"""FastAPI 앱: 정적 프론트엔드 서빙과 게임용 WebSocket 엔드포인트."""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .dictionary import Dictionary
from .server import GameServer, valid_name

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"


def resolve_words_path() -> Path:
    """WORDS_FILE 환경변수 > data/words.txt(전처리된 전체 사전) > 샘플 사전."""
    if env := os.environ.get("WORDS_FILE"):
        return Path(env)
    full = DATA_DIR / "words.txt"
    return full if full.exists() else DATA_DIR / "sample_words.txt"


dictionary = Dictionary.load(resolve_words_path())
server = GameServer(dictionary)

app = FastAPI(title="Word Chain Online")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "words": len(dictionary),
        "players": len(server.players),
        "rooms": len(server.rooms),
    }


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    name = ws.query_params.get("name", "").strip()
    if not valid_name(name):
        await ws.close(code=4000, reason="invalid name")
        return

    player = await server.connect(ws, name)
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
        await server.disconnect(player)
