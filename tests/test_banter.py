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
        assert b.say("win", important=True, name="철수")  # 중요한 말은 바로
        monkeypatch.setattr(banter_module, "COOLDOWN", 0)
        b.spoken = banter_module.LIMIT
        assert not b.say("hit")                         # 한 판 제한
        assert b.say("win", important=True, name="철수")
        await asyncio.sleep(0.01)
        assert len(room.sent) == 3
    run(scenario())


def test_avoids_repeating_recent_lines(monkeypatch):
    monkeypatch.setattr(banter_module, "COOLDOWN", 0)
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(1))
    picks = [b.pick("hit") for _ in range(3)]
    assert sorted(picks) == sorted(LINES["hit"])


@pytest.mark.parametrize("text,kind", [("넌 바보야", "chat_insult"), ("ㅎㅇ", "chat_hello"), ("오늘 날씨", "chat_other")])
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


# ---- 대사 다듬기 ----

def test_broken_lines_are_skipped():
    lines = {**LINES, "hit": ["안녕 {}", "{name 시작", "{name!x}", "멀쩡한 대사 {name}"]}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, lines, random.Random(0))
    for _ in range(10):
        assert b.pick("hit", name="철수") == "멀쩡한 대사 철수"       # 중괄호가 틀린 대사는 건너뛴다


def test_lines_need_their_values():
    lines = {**LINES, "hit": ["파워 {power}로 맞혔다", "그냥 맞혔다"]}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, lines, random.Random(0))
    for _ in range(10):
        assert b.pick("hit") == "그냥 맞혔다"                      # 값이 없으면 {power} 대사는 안 고른다
    assert any(b.pick("hit", power=73) == "파워 73로 맞혔다" for _ in range(30))
