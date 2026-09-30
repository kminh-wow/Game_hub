"""출제 가능한 영어 단어 목록 (ENABLE 단어 목록, 퍼블릭 도메인)."""
from __future__ import annotations

import random
import re
from collections.abc import Iterable
from pathlib import Path

MIN_LEN = 3
MAX_LEN = 15
WORD_RE = re.compile(r"[A-Z]+")


def normalize(text: str) -> str:
    return text.strip().upper()


def _read_words(path: Path) -> list[str]:
    words: list[str] = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            words.extend(line.split("#", 1)[0].split())
    return words


class WordList:
    def __init__(self, words: Iterable[str], common: Iterable[str] = ()):
        self.words = {
            w.upper() for w in words
            if MIN_LEN <= len(w) <= MAX_LEN and WORD_RE.fullmatch(w.upper())
        }
        if not self.words:
            raise ValueError("단어 목록이 비어 있습니다.")
        self.common = sorted({w.upper() for w in common if w.upper() in self.words})

    @classmethod
    def load(cls, words_path: Path, common_path: Path | None = None) -> WordList:
        common = _read_words(common_path) if common_path and common_path.exists() else []
        return cls(_read_words(words_path), common)

    def __len__(self) -> int:
        return len(self.words)

    def __contains__(self, word: str) -> bool:
        return word.upper() in self.words

    def random_common(self) -> str:
        return random.choice(self.common or sorted(self.words))
