import pytest

from app.dictionary import Dictionary, apply_dueum, next_chars


@pytest.mark.parametrize(
    ("ch", "expected"),
    [
        ("력", "역"), ("리", "이"), ("례", "예"), ("류", "유"), ("량", "양"),
        ("라", "나"), ("로", "노"), ("루", "누"), ("래", "내"), ("뢰", "뇌"), ("름", "늠"),
        ("녀", "여"), ("뇨", "요"), ("뉴", "유"), ("니", "이"),
    ],
)
def test_dueum(ch, expected):
    assert apply_dueum(ch) == expected


@pytest.mark.parametrize("ch", ["가", "나", "역", "사", "a", "ㄱ"])
def test_dueum_not_applied(ch):
    assert apply_dueum(ch) is None


def test_next_chars():
    assert next_chars("노력") == ("력", "역")
    assert next_chars("사과") == ("과",)


def test_dictionary_filters_and_killer():
    d = Dictionary(["노력", "역사", "사과", "과일", "로봇", "가", "abc"])
    assert len(d) == 5
    assert "가" not in d and "abc" not in d
    assert not d.is_killer("노력")  # 역사
    assert d.is_killer("로봇")      # '봇'으로 시작하는 단어 없음
    assert d.is_killer("과일")      # '일'로 시작하는 단어 없음
    assert not d.is_killer(d.random_start_word())


def test_injeong_words_are_optional():
    d = Dictionary(["사과", "과일"], injeong=["일본", "사과"])
    assert d.injeong == {"일본"}              # 일반 단어와 겹치면 일반 단어로 본다
    assert d.allows("사과") and not d.allows("일본")
    assert d.allows("일본", injeong=True)
    assert d.is_killer("과일")                 # 어인정을 빼면 '일'로 시작하는 말이 없다
    assert not d.is_killer("과일", injeong=True)
