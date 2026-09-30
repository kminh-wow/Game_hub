"""FastAPI 앱: 정적 프론트엔드 서빙과 게임용 WebSocket 엔드포인트."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .dictionary import Dictionary
from .server import CLOSE_INVALID_NAME, GameServer, valid_name

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"


def resolve_words_path() -> Path:
    """WORDS_FILE 환경변수 > data/words.txt(전처리된 전체 사전) > 샘플 사전."""
    if env := os.environ.get("WORDS_FILE"):
        return Path(env)
    full = DATA_DIR / "words.txt"
    return full if full.exists() else DATA_DIR / "sample_words.txt"


def dictionary_paths() -> list[Path]:
    """메인 사전 + 끄투 일반 단어(scripts/import_kkutu.py 로 생성) + 보충 사전."""
    paths = [resolve_words_path()]
    for name in ("kkutu_words.txt", "extra_words.txt"):
        if (DATA_DIR / name).exists():
            paths.append(DATA_DIR / name)
    return paths


def injeong_paths() -> list[Path]:
    path = DATA_DIR / "kkutu_injeong.txt"
    return [path] if path.exists() else []


dictionary = Dictionary.load(*dictionary_paths(), injeong_paths=injeong_paths())
server = GameServer(dictionary)

# 게임 화면 외의 자동 문서 페이지(/docs, /redoc, /openapi.json)는 노출하지 않는다.
app = FastAPI(title="Word Chain Online", docs_url=None, redoc_url=None, openapi_url=None)
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
