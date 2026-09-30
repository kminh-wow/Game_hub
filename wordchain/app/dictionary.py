"""단어 사전 로딩과 끝말잇기 규칙(두음법칙, 한방단어) 판정."""
from __future__ import annotations

import random
import re
from collections import defaultdict
from collections.abc import Iterable
from pathlib import Path

HANGUL_WORD = re.compile(r"[가-힣]+")

_HANGUL_BASE = 0xAC00
_HANGUL_COUNT = 11172

# 초성 인덱스
_CHO_N = 2   # ㄴ
_CHO_R = 5   # ㄹ
_CHO_O = 11  # ㅇ

# 중성 인덱스 기준 두음법칙 적용 대상
_R_TO_O = {2, 6, 7, 12, 17, 20}  # ㄹ + ㅑㅕㅖㅛㅠㅣ → ㅇ (력→역, 리→이)
_R_TO_N = {0, 1, 8, 11, 13, 18}  # ㄹ + ㅏㅐㅗㅚㅜㅡ → ㄴ (라→나, 로→노)
_N_TO_O = {6, 12, 17, 20}        # ㄴ + ㅕㅛㅠㅣ → ㅇ (녀→여, 니→이)


def apply_dueum(ch: str) -> str | None:
    """두음법칙을 적용한 글자를 돌려준다. 적용 대상이 아니면 None."""
    code = ord(ch) - _HANGUL_BASE
    if not 0 <= code < _HANGUL_COUNT:
        return None
    cho, rest = divmod(code, 588)
    jung, jong = divmod(rest, 28)
    if cho == _CHO_R and jung in _R_TO_O:
        new_cho = _CHO_O
    elif cho == _CHO_R and jung in _R_TO_N:
        new_cho = _CHO_N
    elif cho == _CHO_N and jung in _N_TO_O:
        new_cho = _CHO_O
    else:
        return None
    return chr(_HANGUL_BASE + new_cho * 588 + jung * 28 + jong)


def next_chars(word: str) -> tuple[str, ...]:
    """word 다음에 올 단어가 시작할 수 있는 글자들."""
    last = word[-1]
    alt = apply_dueum(last)
    return (last, alt) if alt else (last,)


def _valid(words: Iterable[str]) -> set[str]:
    return {w for w in words if len(w) >= 2 and HANGUL_WORD.fullmatch(w)}


def _read(paths: Iterable[Path]) -> list[str]:
    """한 줄에 한 단어(공백 구분도 허용). '#' 뒤는 주석. 여러 파일은 합친다."""
    words: list[str] = []
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                words.extend(line.split("#", 1)[0].split())
    return words


class Dictionary:
    """일반 단어와 어인정 단어(끄투 사용자 등록 단어, 방 설정으로 허용 여부를 정함)."""

    def __init__(self, words: Iterable[str], injeong: Iterable[str] = ()):
        self.words = _valid(words)
        if not self.words:
            raise ValueError("사전에 사용할 수 있는 단어가 없습니다.")
        self.injeong = _valid(injeong) - self.words

        self._by_first: dict[str, set[str]] = defaultdict(set)
        for w in self.words:
            self._by_first[w[0]].add(w)
        self._injeong_by_first: dict[str, set[str]] = defaultdict(set)
        for w in self.injeong:
            self._injeong_by_first[w[0]].add(w)

        # 제시어는 이어갈 수 있는 짧은 단어 위주로 고른다.
        playable = [w for w in self.words if not self.is_killer(w)]
        short = [w for w in playable if len(w) <= 3]
        self._start_words = sorted(short or playable or self.words)

    @classmethod
    def load(cls, *paths: Path, injeong_paths: Iterable[Path] = ()) -> Dictionary:
        return cls(_read(paths), _read(injeong_paths))

    def __len__(self) -> int:
        return len(self.words)

    def __contains__(self, word: str) -> bool:
        return word in self.words

    def allows(self, word: str, injeong: bool = False) -> bool:
        return word in self.words or (injeong and word in self.injeong)

    def is_killer(self, word: str, injeong: bool = False) -> bool:
        """한방단어: 뒤에 이을 수 있는 단어가 사전에 하나도 없는 단어."""
        return not any(
            self._by_first.get(c) or (injeong and self._injeong_by_first.get(c))
            for c in next_chars(word)
        )

    def random_start_word(self) -> str:
        return random.choice(self._start_words)
