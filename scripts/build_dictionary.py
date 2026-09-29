"""표준국어대사전 '전체 내려받기' xls 파일들로 게임용 사전(data/words.txt)을 만든다.

사용법:
    python scripts/build_dictionary.py "<xls 파일들이 있는 폴더>" [-o data/words.txt]

기준:
- 구성 단위가 '단어'인 표제어만 (구, 관용구, 속담 제외)
- 품사에 '명사'가 있는 것만 (의존 명사만 있는 것은 제외, 비속어는 아래 예외)
- 범주가 방언/북한어/옛말뿐인 표제어는 제외 (일반어 뜻이 하나라도 있으면 포함)
- 비속어("속되게 이르는 말", "욕으로 하는 말" 등)는 걸러내지 않는다.
  명사가 아니어도 감탄사/대명사/부사 등 활용하지 않는 말이면 포함한다 (제기랄, 젠장, 이놈 …).
  동사/형용사처럼 활용하는 말은 끝말잇기에 맞지 않아 제외한다.
- 표준국어대사전에 없는 말(씨발, 존나 …)은 data/extra_words.txt 로 따로 관리한다.
- 동음이의어 번호 "(02)"와 구분 기호 "-", "^"는 떼고, 두 글자 이상 순수 한글만 남긴다
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent

COL_WORD = 0
COL_UNIT = 1
COL_POS = 11
COL_DEF = 16
COL_CATEGORY = 18

EXCLUDED_CATEGORIES = {"방언", "북한어", "옛말"}

HOMONYM_NO = re.compile(r"\(\d+\)$")
SENSE_MARK = re.compile(r"「\d+」|\[[^\]]*\]")
POS_TAG = re.compile(r"「([^」]+)」")
HANGUL_WORD = re.compile(r"[가-힣]{2,}")
VULGAR = re.compile(r"속되게|비속하게|낮잡아|욕으로|욕하여|욕하는")
# "→ 네미02[Ⅰ]." 처럼 다른 표제어를 가리키기만 하는 뜻풀이
CROSS_REF = re.compile(r"^→\s*([가-힣\-\^]+)")
INFLECTED_POS = {"동사", "형용사", "보조 동사", "보조 형용사", "어미", "접사", "조사"}


def normalize(headword: str) -> str | None:
    word = HOMONYM_NO.sub("", headword.strip())
    word = word.replace("-", "").replace("^", "")
    return word if HANGUL_WORD.fullmatch(word) else None


def categories(cell: str) -> set[str]:
    return {SENSE_MARK.sub("", c).strip() for c in cell.split("\n") if c.strip()}


def process_file(
    path: Path, words: set[str], vulgar: set[str], refs: dict[str, str], stats: Counter
) -> None:
    book = xlrd.open_workbook(str(path), on_demand=True)
    sheet = book.sheet_by_index(0)
    for r in range(1, sheet.nrows):
        row = sheet.row_values(r)
        stats["rows"] += 1

        if row[COL_UNIT] != "단어":
            stats["skip_unit"] += 1
            continue
        pos = set(POS_TAG.findall(row[COL_POS]))
        is_vulgar = bool(VULGAR.search(row[COL_DEF]))
        uninflected = bool(pos) and not pos & INFLECTED_POS
        if "명사" not in pos and not (is_vulgar and uninflected):
            if uninflected and (m := CROSS_REF.match(row[COL_DEF].strip())):
                # 참조 대상이 비속어로 밝혀지면 나중에 추가한다.
                word, target = normalize(row[COL_WORD]), normalize(m.group(1))
                if word and target:
                    refs[word] = target
            stats["skip_pos"] += 1
            continue
        cats = categories(row[COL_CATEGORY])
        for c in cats:
            stats[f"category:{c}"] += 1
        if cats and cats <= EXCLUDED_CATEGORIES:
            stats["skip_category"] += 1
            continue
        word = normalize(row[COL_WORD])
        if word is None:
            stats["skip_form"] += 1
            continue

        words.add(word)
        if is_vulgar:
            vulgar.add(word)
            if "명사" not in pos:
                stats["vulgar_non_noun"] += 1
    book.release_resources()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path, help="xls 파일 또는 폴더")
    parser.add_argument("-o", "--output", type=Path, default=ROOT / "data" / "words.txt")
    args = parser.parse_args()

    files = sorted(args.source.glob("*.xls")) if args.source.is_dir() else [args.source]
    if not files:
        print(f"xls 파일이 없습니다: {args.source}", file=sys.stderr)
        return 1

    words: set[str] = set()
    vulgar: set[str] = set()
    refs: dict[str, str] = {}
    stats: Counter = Counter()
    for i, f in enumerate(files, 1):
        print(f"[{i}/{len(files)}] {f.name}", flush=True)
        process_file(f, words, vulgar, refs, stats)

    for word, target in refs.items():
        if target in vulgar and word not in words:
            words.add(word)
            vulgar.add(word)
            stats["vulgar_non_noun"] += 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")

    print(f"\n읽은 행: {stats['rows']:,}")
    print(f"제외 - 구성 단위(구/속담 등): {stats['skip_unit']:,}")
    print(f"제외 - 명사 아님: {stats['skip_pos']:,}")
    print(f"제외 - 방언/북한어/옛말: {stats['skip_category']:,}")
    print(f"제외 - 한글 외 문자/한 글자: {stats['skip_form']:,}")
    print("범주 분포(명사):", {k.split(':', 1)[1]: v for k, v in stats.most_common() if k.startswith("category:")})
    print(f"\n최종 단어 수: {len(words):,}")
    print(f"  비속어/욕 표시: {len(vulgar):,} (그중 명사 아닌 것 {stats['vulgar_non_noun']:,})")
    print(f"저장: {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
