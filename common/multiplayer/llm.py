"""로컬 LLM(llama.cpp 서버 등, OpenAI 호환 /v1/chat/completions)으로 AI 대사 만들기.

서버 환경변수 BANTER_LLM_URL 에 주소를 넣으면 켜진다 (예: http://100.64.0.2:8080).
안 넣었거나, 응답이 늦거나, 이상한 말을 하면 None 을 돌려주고 미리 써 둔 대사를 쓴다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import urllib.request

log = logging.getLogger("game")

TIMEOUT = 4.0          # 이 안에 답이 없으면 미리 써 둔 대사
MAX_CHARS = 60         # 이보다 길면 버린다
RETRY_AFTER = 60.0     # 실패하면 이 시간 동안은 부르지 않는다

# 나오면 버리는 말 (욕설·비하)
BLOCKED = re.compile(r"(?!)")

_down_until = 0.0


def url() -> str:
    return os.environ.get("BANTER_LLM_URL", "").rstrip("/")


def enabled() -> bool:
    return bool(url()) and time.monotonic() >= _down_until


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
def clean(text: str) -> str | None:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = text.strip().splitlines()[0].strip() if text.strip() else ""
    text = re.sub(r"^[^:：\"']{1,12}[:：]\s*", "", text)     # "AI: ..." 같은 이름표
    text = text.strip("\"'“”‘’ ")
    if not text or len(text) > MAX_CHARS or BLOCKED.search(text):
        return None
    return text


# 대사 만들기 (실패하면 None)
async def generate(prompt_system: str, prompt_user: str) -> str | None:
    global _down_until
    if not enabled():
        return None
    try:
        raw = await asyncio.wait_for(asyncio.to_thread(_post, prompt_system, prompt_user), TIMEOUT + 0.5)
    except Exception as exc:
        _down_until = time.monotonic() + RETRY_AFTER
        log.warning("[LLM] 대사 생성 실패 (%s) — %d초 동안 미리 써 둔 대사를 씁니다", type(exc).__name__, RETRY_AFTER)
        return None
    return clean(raw)
