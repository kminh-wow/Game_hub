"""AI 대사: 고르기, 간격·횟수 제한, 채팅 분류."""
import asyncio
import random

import pytest

import common.multiplayer.banter as banter_module
from common.multiplayer.banter import Banter


class RoomStub:
    def __init__(self):
        self.sent = []

    async def broadcast(self, msg):
        self.sent.append(msg)


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    monkeypatch.setattr(banter_module, "DELAY", (0, 0))
    monkeypatch.setenv("BANTER_LLM_URL", "off")       # LLM 테스트만 따로 켠다


def run(coro):
    return asyncio.run(coro)


LINES = {"hit": ["맞았다!", "명중!", "아프죠?"], "win": ["이겼다, {name}님!"], "chat_insult": ["진정하세요."],
         "chat_other": ["그렇군요."], "chat_hello": ["안녕, {name}님!"]}


def test_lines_are_sent_as_bot_chat_with_names():
    async def scenario():
        room = RoomStub()
        b = Banter(room, {"id": "ai", "name": "AI"}, LINES, random.Random(0))
        assert b.say("win", important=True, name="철수")
        await asyncio.sleep(0.01)
        msg = room.sent[0]
        assert msg["type"] == "chat" and msg["bot"] and msg["from"]["name"] == "AI"
        assert msg["text"] == "이겼다, 철수님!"
        assert not b.say("없는상황", important=True)
    run(scenario())


def test_cooldown_and_limit(monkeypatch):
    async def scenario():
        room = RoomStub()
        b = Banter(room, {"id": "ai", "name": "AI"}, LINES, random.Random(0))
        assert b.say("hit")
        assert not b.say("hit")                         # 간격 안에는 말하지 않는다
        assert b.say("win", important=True)             # 중요한 말은 바로
        monkeypatch.setattr(banter_module, "COOLDOWN", 0)
        b.spoken = banter_module.LIMIT
        assert not b.say("hit")                         # 한 판 제한
        assert b.say("win", important=True)
        await asyncio.sleep(0.01)
        assert len(room.sent) == 3
    run(scenario())


def test_avoids_repeating_recent_lines(monkeypatch):
    monkeypatch.setattr(banter_module, "COOLDOWN", 0)
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(1))
    picks = [b.pick("hit") for _ in range(3)]
    assert sorted(picks) == sorted(LINES["hit"])


@pytest.mark.parametrize("text,kind", [("이 ***아", "chat_insult"), ("ㅎㅇ", "chat_hello"), ("오늘 날씨", "chat_other")])
def test_chat_is_classified(monkeypatch, text, kind):
    async def scenario():
        room = RoomStub()
        b = Banter(room, {"id": "ai", "name": "AI"}, LINES, random.Random(0))
        b.rng.random = lambda: 0.0                      # 확률 통과
        player = type("P", (), {"name": "영희"})()
        assert b.hear(player, text)
        await asyncio.sleep(0.01)
        assert room.sent[0]["text"] in [line.format(name="영희") for line in LINES[kind]]
    run(scenario())


# ---- 로컬 LLM ----

@pytest.fixture
def fake_llm(monkeypatch):
    """OpenAI 호환 /v1/chat/completions 를 흉내 내는 작은 서버."""
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    import common.multiplayer.llm as llm

    state = {"reply": "오늘 바람은 제 편이네요!", "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append(body)
            out = json.dumps({"choices": [{"message": {"content": state["reply"]}}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("BANTER_LLM_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setattr(llm, "_down_until", 0.0)
    yield state
    server.shutdown()


def _one_line(state, kind="hit", **kw):
    async def scenario():
        room = RoomStub()
        b = Banter(room, {"id": "ai", "name": "AI · 상"}, LINES, random.Random(0), game="포트리스",
                   situations={"hit": "네 포탄이 맞았다"})
        assert b.say(kind, important=True, **kw)
        for _ in range(80):                             # LLM 이 늦거나 실패해도 결국 한 마디는 한다
            if room.sent:
                break
            await asyncio.sleep(0.1)
        return room.sent[0]["text"]
    return asyncio.run(scenario())


def test_llm_line_is_used_when_available(fake_llm):
    assert _one_line(fake_llm) == "오늘 바람은 제 편이네요!"
    req = fake_llm["requests"][0]
    assert req["chat_template_kwargs"] == {"enable_thinking": False}
    assert "포트리스" in req["messages"][0]["content"] and "AI · 상" in req["messages"][0]["content"]
    assert "네 포탄이 맞았다" in req["messages"][1]["content"]


@pytest.mark.parametrize("reply", ["<think>음</think>야 이 ***아", "", "아" * 100])
def test_bad_llm_lines_fall_back_to_written_lines(fake_llm, reply):
    fake_llm["reply"] = reply
    assert _one_line(fake_llm) in LINES["hit"]


def test_llm_output_is_cleaned(fake_llm):
    fake_llm["reply"] = "<think>\n</think>\n\nAI: \"명중이죠, 계산대로!\"\n(설명)"
    assert _one_line(fake_llm) == "명중이죠, 계산대로!"


def test_unreachable_llm_falls_back_and_backs_off(monkeypatch):
    import common.multiplayer.llm as llm
    monkeypatch.setenv("BANTER_LLM_URL", "http://127.0.0.1:9")      # 아무도 안 받는 포트
    monkeypatch.setattr(llm, "_down_until", 0.0)
    assert _one_line(None) in LINES["hit"]
    assert not llm.enabled()                                          # 한동안 부르지 않는다


def test_default_address_and_off(monkeypatch):
    import common.multiplayer.llm as llm
    monkeypatch.delenv("BANTER_LLM_URL", raising=False)
    assert llm.url() == "http://127.0.0.1:18080"                      # PC 터널이 붙는 곳
    monkeypatch.setenv("BANTER_LLM_URL", "off")
    assert llm.url() == "" and not llm.enabled()


# ---- 매운맛 ----

def test_spicy_lines_replace_mild_ones():
    spicy = {"hit": ["*** 정확하지 ***"]}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(0), spicy=spicy)
    assert b.spicy and b.pick("hit") == "*** 정확하지 ***"
    assert b.pick("chat_other") == "그렇군요."                   # 매운맛에 없는 상황은 원래 대사
    system, _ = b._prompt("hit", "예시", "", {})
    assert "욕을 자연스럽게" in system and "패드립" in system


def test_profanity_allowed_only_when_spicy_but_hate_always_blocked():
    from common.multiplayer.llm import clean
    assert clean("*** 못 쏘네 ***") is None
    assert clean("*** 못 쏘네 ***", allow_profanity=True) == "*** 못 쏘네 ***"
    for hateful in ("이 장애인아", "***마 ㅋㅋ", "죽여버린다 ***"):
        assert clean(hateful, allow_profanity=True) is None
    assert clean("거기에 두냐 *** ㅋㅋ") is None                     # 순한맛에서는 욕
    assert clean("거기에 두냐 *** ㅋㅋ", allow_profanity=True) == "거기에 두냐 *** ㅋㅋ"


def test_spicy_written_lines_have_no_hate():
    from common.multiplayer.llm import HATE
    from fortress.app.banter import SPICY as fortress_spicy
    from omok.app.banter import SPICY as omok_spicy
    for table in (fortress_spicy, omok_spicy):
        for lines in table.values():
            for line in lines:
                assert not HATE.search(line), line


def test_odd_scripts_are_dropped():
    from common.multiplayer.llm import clean
    assert clean("아니" + chr(0x0E48) + ", 내가 몇살이지?") is None       # 섞여 나온 태국 글자
    assert clean("你好 반가워요") is None
    assert clean("와... 졌다 · 인정~ GG!") == "와... 졌다 · 인정~ GG!"
