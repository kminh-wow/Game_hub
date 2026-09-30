"""KKuTu(끄투) DB에서 끝말잇기 단어를 뽑아 data/kkutu_words.txt, data/kkutu_injeong.txt 를 만든다.

사용법:
    python wordchain/scripts/import_kkutu.py            # GitHub 에서 db.sql 을 받아서 처리
    python wordchain/scripts/import_kkutu.py db.sql     # 이미 받은 파일로 처리

기준 (끄투 기본 끝말잇기 규칙과 같게):
- kkutu_ko 표에서 품사(type)가 끄투의 KOR_GROUP 에 드는 단어만 (동사·형용사처럼 활용하는 말 제외)
- 두 글자 이상 순수 한글
- 어인정(flag & 2) 단어는 따로 kkutu_injeong.txt 로 (방 설정에서 켜고 끈다)
- 뜻풀이(mean)는 가져오지 않는다. 단어만 쓴다.

원본: https://github.com/JJoriping/KKuTu (GPL v3). 결과 파일은 git 에 넣지 않는다.
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_URL = "https://raw.githubusercontent.com/JJoriping/KKuTu/master/db.sql"

# KKuTu Server/lib/const.js 의 KOR_GROUP, KOR_FLAG
KOR_GROUP = {"0", "1", "3", "7", "8", "11", "9", "16", "15", "17", "2", "18", "20", "26", "19", "INJEONG"}
FLAG_INJEONG = 2

HANGUL_WORD = re.compile(r"[가-힣]{2,}")
NULL = "\\N"


def read_rows(path: Path):
    """PostgreSQL 덤프의 `COPY kkutu_ko (_id, type, mean, hit, flag, theme)` 블록을 읽는다."""
    with open(path, encoding="utf-8") as f:
        inside = False
        for line in f:
            if line.startswith("COPY kkutu_ko "):
                inside = True
                continue
            if not inside:
                continue
            if line.startswith("\\."):
                return
            cols = line.rstrip("\n").split("\t")
            if len(cols) >= 5:
                yield cols


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", nargs="?", type=Path, help="db.sql 경로 (없으면 GitHub 에서 받음)")
    parser.add_argument("-o", "--out-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()

    if args.source:
        db_path = args.source
    else:
        db_path = Path(tempfile.gettempdir()) / "kkutu_db.sql"
        print(f"받는 중: {DB_URL} (약 42MB)", flush=True)
        urllib.request.urlretrieve(DB_URL, db_path)

    words: set[str] = set()
    injeong: set[str] = set()
    stats: Counter = Counter()
    for word, type_, _mean, _hit, flag, *_ in read_rows(db_path):
        stats["rows"] += 1
        if not HANGUL_WORD.fullmatch(word):
            stats["skip_form"] += 1
            continue
        if not KOR_GROUP & set(type_.split(",")):
            stats["skip_type"] += 1
            continue
        flags = int(flag) if flag not in (NULL, "") else 0
        (injeong if flags & FLAG_INJEONG else words).add(word)

    if not stats["rows"]:
        print("kkutu_ko 데이터를 찾지 못했어요.", file=sys.stderr)
        return 1

    injeong -= words
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "kkutu_words.txt").write_text("\n".join(sorted(words)) + "\n", encoding="utf-8")
    (args.out_dir / "kkutu_injeong.txt").write_text("\n".join(sorted(injeong)) + "\n", encoding="utf-8")

    print(f"읽은 단어: {stats['rows']:,}")
    print(f"제외 - 한글 외 문자/한 글자: {stats['skip_form']:,}")
    print(f"제외 - 동사·형용사 등 활용하는 말: {stats['skip_type']:,}")
    print(f"일반 단어: {len(words):,} → {args.out_dir / 'kkutu_words.txt'}")
    print(f"어인정 단어: {len(injeong):,} → {args.out_dir / 'kkutu_injeong.txt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
