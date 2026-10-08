"""게임 기록: 접속·방·게임 진행과 브라우저 오류를 서버 로그에 한 줄씩 남긴다.

서버에서 실시간으로 보기:  sudo journalctl -u game-hub -f | grep 게임
"""
from __future__ import annotations

import logging
import re
import sys
from typing import Any

log = logging.getLogger("game")
if not log.handlers:
    _handler = logging.StreamHandler(sys.stderr)
    _handler.setFormatter(logging.Formatter("게임 %(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False

# 앱 제목 -> 로그에 쓰는 게임 이름
LABELS = {
    "Word Chain Online": "끝말잇기",
    "Hangman": "행맨",
    "Omok": "오목",
    "Yacht Dice": "요트",
    "Fortress": "포트리스",
    "Turn FPS": "턴제 FPS",
}


def tag(label: str, room: Any = None) -> str:
    return f"[{label} #{getattr(room, 'id', '?')}]" if room is not None else f"[{label}]"


# 방 기록
def room_event(room: Any, text: str) -> None:
    log.info("%s %s", tag(getattr(room, "log_label", "?"), room), text)


# 게임 결과 요약 (game_over 메시지에서)
def result_text(msg: dict[str, Any]) -> str:
    parts = []
    winner = msg.get("winner")
    if isinstance(winner, dict) and winner.get("name"):
        parts.append(f"승자 {winner['name']}")
    ranking = msg.get("ranking")
    if isinstance(ranking, list) and ranking:
        cells = []
        for r in ranking[:8]:
            if not isinstance(r, dict):
                continue
            extra = next((f" {r[k]}" for k in ("score", "hp") if k in r), "")
            cells.append(f"{r.get('name', '?')}{extra}")
        parts.append("순위 " + ", ".join(cells))
    if msg.get("reason"):
        parts.append(f"이유 {msg['reason']}")
    return " · ".join(parts) or "끝"


# 브라우저 종류 요약
def browser(ua: str) -> str:
    ua = ua or ""
    mobile = "모바일 " if re.search(r"Mobile|Android|iPhone|iPad", ua) else ""
    for name, pattern in (("삼성 인터넷", r"SamsungBrowser/(\d+)"), ("엣지", r"Edg/(\d+)"), ("웨일", r"Whale/(\d+)"),
                          ("파이어폭스", r"Firefox/(\d+)"), ("크롬", r"Chrome/(\d+)"), ("사파리", r"Version/(\d+).*Safari")):
        if m := re.search(pattern, ua):
            return f"{mobile}{name} {m.group(1)}"
    return f"{mobile}알 수 없는 브라우저"
