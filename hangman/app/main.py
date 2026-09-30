"""행맨 FastAPI 앱. 접속·로비·방 관리는 common.multiplayer 를 쓴다."""
from __future__ import annotations

from pathlib import Path

from common.multiplayer import GameServer, Player, create_app

from .room import Room
from .words import WordList

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
MAX_GUESS = 20

words = WordList.load(DATA_DIR / "enable1.txt", DATA_DIR / "common_words.txt")


async def set_word(room: Room, player: Player, msg: dict) -> str | None:
    word = str(msg.get("word", ""))[:MAX_GUESS]
    return await room.game.set_word(player, word, str(msg.get("hint", "")))


async def guess(room: Room, player: Player, msg: dict) -> str | None:
    return await room.game.guess(player, str(msg.get("text", ""))[:MAX_GUESS])


server = GameServer(
    Room,
    ctx=words,
    actions={"set_word": set_word, "guess": guess},
    welcome_info=lambda: {"word_count": len(words)},
)
app = create_app(server, STATIC_DIR, "Hangman", health_info=lambda: {"words": len(words)})
