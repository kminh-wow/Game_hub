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


# ---- 매운맛 (실제 데이터는 git 에 없는 private/spicy.json, 테스트는 가짜 단어로) ----

FAKE_SPICY = {
    "insult": "욕일|욕이",
    "hate": "혐오말",
    "lines": {"omok": {"start": ["욕일 시작"]}, "fortress": {"start": ["욕이 시작 {name}"]}},
}


@pytest.fixture
def fake_spicy(monkeypatch):
    from common.multiplayer import spicy
    monkeypatch.setattr(spicy, "data", lambda: FAKE_SPICY)
    return FAKE_SPICY


def test_spicy_lines(fake_spicy):
    from common.multiplayer import spicy
    assert spicy.available() and spicy.lines("omok") == {"start": ["욕일 시작"]}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(0), spicy={"hit": ["욕일 정확하지"]})
    assert b.spicy and b.pick("hit") == "욕일 정확하지"
    assert b.pick("chat_other") == "그렇군요."                   # 매운맛에 없는 상황은 원래 대사


def test_without_private_file_spicy_is_unavailable(monkeypatch):
    from common.multiplayer import spicy
    monkeypatch.setattr(spicy, "data", lambda: {})
    assert not spicy.available() and spicy.lines("omok") is None and spicy.pattern("insult") is None


def test_broken_regex_is_ignored(monkeypatch, caplog):
    from common.multiplayer import spicy
    monkeypatch.setattr(spicy, "data", lambda: {"insult": "(욕일", "hate": 3})
    assert spicy.pattern("insult") is None and spicy.pattern("hate") is None
    assert "정규식이 틀렸어요" in caplog.text


def test_broken_lines_are_skipped():
    spicy = {"_join": "많이", "_prefix": ["앞말 {", 7], "_suffix": ["{0}"],
             "hit": ["안녕 {}", "{name 시작", "{name!x}", "멀쩡한 대사 {name}"], "win": "대사 아님"}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(0), spicy=spicy)
    assert b.join == banter_module.JOIN and b.prefixes == ["앞말 {"]
    for _ in range(10):
        assert b.pick("hit", name="철수") == "멀쩡한 대사 철수"       # 틀린 대사·앞말·뒷말은 건너뛴다
    assert b.pick("win", name="철수") is None


def test_private_spicy_lines_have_no_hate():
    from common.multiplayer import spicy
    real = spicy.data()
    if not real:
        pytest.skip("private/spicy.json 이 없다")
    hate = spicy.pattern("hate")
    for table in real["lines"].values():
        for kind, lines in table.items():
            if kind == "_join":
                continue
            for line in lines:                               # 대사와 앞말·뒷말 모두
                assert not (hate and hate.search(line)), line


def test_lines_need_their_values_and_get_prefix_suffix(monkeypatch):
    spicy = {"_join": [1.0, 1.0], "_prefix": ["앞말"], "_suffix": ["뒷말", "파워 {power}"], "hit": ["파워 {power}로 맞혔다", "그냥 맞혔다"]}
    b = Banter(RoomStub(), {"id": "ai", "name": "AI"}, LINES, random.Random(0), spicy=spicy)
    for _ in range(10):
        text = b.pick("hit")                            # 값이 없으면 {power} 대사·뒷말은 안 고른다
        assert "{" not in text and text.startswith("앞말 그냥 맞혔다")
    texts = {b.pick("hit", power=73) for _ in range(30)}
    assert any("파워 73로 맞혔다" in t for t in texts)
    assert all(t.startswith("앞말 ") for t in texts)
    assert "_prefix" not in b.lines
