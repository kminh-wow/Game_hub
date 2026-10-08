"""게임 허브: 메인 화면(게임 선택)과 각 게임 앱을 경로별로 묶는다.

    /            메인 화면
    /wordchain/  끝말잇기
    /quoridor/   쿼리도
    /pacman/     팩맨
    /hangman/    행맨
    /omok/       오목
    /yacht/      요트 다이스
    /fortress/   포트리스
    /shooter/    턴제 FPS
    /common/     게임들이 함께 쓰는 프론트엔드 파일 (lobby.js 등)

게임 상태가 각 앱의 메모리에 있으므로 uvicorn 워커는 반드시 1개로 실행한다.
"""
from __future__ import annotations

import importlib
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders

log = logging.getLogger("hub")

STATIC_DIR = Path(__file__).resolve().parent / "static"
COMMON_WEB_DIR = Path(__file__).resolve().parent.parent / "common" / "web"

# 경로 이름 -> 그 게임의 FastAPI 앱이 있는 모듈
GAME_MODULES = {
    "wordchain": "wordchain.app.main",
    "quoridor": "quoridor.server.main",
    "pacman": "pacman.app",
    "hangman": "hangman.app.main",
    "omok": "omok.app.main",
    "yacht": "yacht.app.main",
    "fortress": "fortress.app.main",
    "shooter": "shooter.app.main",
}


def load_games(modules: dict[str, str]) -> tuple[dict[str, FastAPI], dict[str, str]]:
    """게임 앱들을 불러온다. 한 게임이 실패해도(예: 필요한 패키지가 없음) 나머지는 계속 뜬다.

    돌려주는 값: (불러온 앱들, 실패한 게임 -> 오류 설명). 실패는 로그에도 남긴다.
    배포 스크립트(deploy/post_update.sh)는 실패한 게임이 있으면 재시작하지 않는다.
    """
    games: dict[str, FastAPI] = {}
    failed: dict[str, str] = {}
    for name, module in modules.items():
        try:
            games[name] = importlib.import_module(module).app
        except Exception as exc:
            failed[name] = f"{type(exc).__name__}: {exc}"
            log.error("게임 '%s'을(를) 불러오지 못했어요 — 이 게임만 빼고 계속합니다.", name, exc_info=True)
    return games, failed


GAMES, FAILED_GAMES = load_games(GAME_MODULES)

app = FastAPI(title="Game Hub", docs_url=None, redoc_url=None, openapi_url=None)


class RevalidateMiddleware:
    """모든 HTTP 응답에 Cache-Control: no-cache 를 붙인다.

    브라우저가 예전 JS/HTML 을 캐시해 두고 새 버전을 안 쓰는 일을 막는다.
    바뀌지 않은 파일은 ETag 로 304 만 받으므로 다시 내려받지는 않는다.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-cache"
            await send(message)

        await self.app(scope, receive, send_with_header)


app.add_middleware(RevalidateMiddleware)


def _redirect_to(path: str):
    async def redirect() -> RedirectResponse:
        return RedirectResponse(path)
    return redirect


for name, game_app in GAMES.items():
    # 각 게임은 상대 경로로 자원을 불러오므로 끝에 '/'가 붙은 주소로 보낸다.
    app.add_api_route(f"/{name}", _redirect_to(f"/{name}/"), include_in_schema=False)
    app.mount(f"/{name}", game_app)

app.mount("/common", StaticFiles(directory=COMMON_WEB_DIR), name="common")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="hub")
