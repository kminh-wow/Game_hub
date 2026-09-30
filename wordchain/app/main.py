"""끝말잇기 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

import os
from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .dictionary import Dictionary
from .room import Room

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


async def submit_word(room: Room, player: Player, msg: dict) -> None:
    await room.submit(player, str(msg.get("word", "")))


server = GameServer(
    Room,
    ctx=dictionary,
    actions={"submit_word": submit_word},
    welcome_info=lambda: {"word_count": len(dictionary), "injeong_count": len(dictionary.injeong)},
)
app = create_app(server, STATIC_DIR, "Word Chain Online", health_info=lambda: {"words": len(dictionary)})
