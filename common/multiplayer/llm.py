"""로컬 LLM(llama.cpp 서버 등, OpenAI 호환 /v1/chat/completions)으로 AI 대사 만들기.

기본 주소는 서버 자신의 127.0.0.1:18080 이다. 내 PC에서 tools/ai-chat.bat 을 켜면
SSH 터널로 PC의 llama-server 가 이 주소에 연결된다. 다른 주소는 환경변수 BANTER_LLM_URL, 끄려면 "off".
연결이 없거나, 응답이 늦거나, 이상한 말을 하면 None 을 돌려주고 미리 써 둔 대사를 쓴다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import urllib.request

from . import spicy

log = logging.getLogger("game")

TIMEOUT = 4.0          # 이 안에 답이 없으면 미리 써 둔 대사
MAX_CHARS = 60         # 이보다 길면 버린다
RETRY_AFTER = 20.0     # 실패하면 이 시간 동안은 부르지 않는다
DEFAULT_URL = "http://127.0.0.1:18080"

# 나오면 버리는 말 (비공개 파일 spicy.json): hate 는 언제나, profanity 는 순한맛일 때. 파일이 없으면 거르지 않는다
HATE = spicy.pattern("hate")
PROFANITY = spicy.pattern("profanity")
EMOJI = re.compile("[%s-%s%s-%s%s]" % (chr(0x1F000), chr(0x1FAFF), chr(0x2600), chr(0x27BF), chr(0xFE0F)))   # 이모지
ODD = re.compile("[^ -~%s-%s%s-%s…·]" % (chr(0xAC00), chr(0xD7A3), chr(0x3131), chr(0x318E)))   # 한글·영문·기본 기호 밖의 글자

_down_until = 0.0
_connected: bool | None = None   # 마지막으로 확인한 연결 상태 (바뀔 때만 로그)


def url() -> str:
    value = os.environ.get("BANTER_LLM_URL", "").strip() or DEFAULT_URL
    return "" if value.lower() in ("off", "0", "none") else value.rstrip("/")


def enabled() -> bool:
    return bool(url()) and time.monotonic() >= _down_until


def _mark(ok: bool) -> None:
    global _connected
    if ok != _connected:
        log.info("[LLM] %s", "연결됨 — AI 대사를 새로 만듭니다" if ok else "연결 안 됨 — 미리 써 둔 대사를 씁니다")
    _connected = ok


def _post(prompt_system: str, prompt_user: str) -> str:
    body = {
        "messages": [
            {"role": "system", "content": prompt_system},
            {"role": "user", "content": prompt_user + " /no_think"},
        ],
        "max_tokens": 80,
        "temperature": 0.9,
        "chat_template_kwargs": {"enable_thinking": False},   # Qwen3 생각 모드 끄기
    }
    req = urllib.request.Request(
        url() + "/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.load(resp)
    return data["choices"][0]["message"]["content"] or ""


# 답 다듬기 (생각 부분·따옴표 제거, 한 줄만)
def clean(text: str, allow_profanity: bool = False) -> str | None:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = text.strip().splitlines()[0].strip() if text.strip() else ""
    text = re.sub(r"^[^:：\"']{1,12}[:：]\s*", "", text)     # "AI: ..." 같은 이름표
    text = re.sub(r"\s{2,}", " ", EMOJI.sub("", text))
    text = text.strip("\"'“”‘’ ")
    if not text or len(text) > MAX_CHARS or ODD.search(text) or (HATE and HATE.search(text)):
        return None
    if not allow_profanity and PROFANITY and PROFANITY.search(text):
        return None
    return text


# 대사 만들기 (실패하면 None)
async def generate(prompt_system: str, prompt_user: str, allow_profanity: bool = False) -> str | None:
    global _down_until
    if not enabled():
        return None
    try:
        raw = await asyncio.wait_for(asyncio.to_thread(_post, prompt_system, prompt_user), TIMEOUT + 0.5)
    except Exception:
        _down_until = time.monotonic() + RETRY_AFTER
        _mark(False)
        return None
    _mark(True)
    return clean(raw, allow_profanity)
