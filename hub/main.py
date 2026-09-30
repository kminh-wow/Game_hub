"""게임 허브: 메인 화면(게임 선택)과 각 게임 앱을 경로별로 묶는다.

    /            메인 화면
    /wordchain/  끝말잇기
    /quoridor/   쿼리도
    /pacman/     팩맨
    /hangman/    행맨

게임 상태가 각 앱의 메모리에 있으므로 uvicorn 워커는 반드시 1개로 실행한다.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders

from hangman.app.main import app as hangman_app
from pacman.app import app as pacman_app
from quoridor.server.main import app as quoridor_app
from wordchain.app.main import app as wordchain_app

STATIC_DIR = Path(__file__).resolve().parent / "static"

GAMES = {
    "wordchain": wordchain_app,
    "quoridor": quoridor_app,
    "pacman": pacman_app,
    "hangman": hangman_app,
}

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

app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="hub")
