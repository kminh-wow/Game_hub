"""팩맨: 브라우저에서만 도는 싱글 게임이라 서버는 정적 파일만 내려준다."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

WEB_DIR = Path(__file__).resolve().parent / "web"

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
