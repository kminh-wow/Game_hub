# 끝말잇기 온라인 (Word Chain Online)

끄투(KKuTu) 스타일의 실시간 멀티플레이 끝말잇기 게임입니다.
FastAPI와 WebSocket으로 서버를 만들었고, 프론트엔드는 순수 HTML/CSS/JS입니다.

## 실행

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

브라우저에서 http://127.0.0.1:8000 을 여세요. 창을 여러 개 띄우면 혼자서도 멀티플레이를 테스트할 수 있습니다.

테스트는 이렇게 실행합니다.

```bash
pytest
```

## 게임 규칙

- 방장이 방을 만들고, 나머지 참가자가 모두 **준비**하면 방장이 게임을 시작합니다. 2~8명이 참가할 수 있습니다.
- 라운드마다 무작위 **제시어**가 나오고, 첫 사람은 제시어의 끝 글자로 시작하는 단어를 입력합니다.
- **두음법칙**이 적용됩니다: 력→역, 라→나, 녀→여 등.
- 한 라운드 안에서 같은 단어는 다시 쓸 수 없습니다.
- 턴 제한 시간 안에 잇지 못하면 **-50점**을 받고 라운드가 끝납니다. 진 사람이 다음 라운드를 시작합니다.
- 점수는 `글자 수 × 10`에 빨리 입력할수록 붙는 보너스(최대 2배)를 더해 계산합니다.
- 라운드 시간은 모든 턴이 공유합니다. 라운드 시간이 줄어들면 턴 시간도 짧아집니다.
- 방 설정: 라운드 수, 턴 시간, 라운드 시간, 최대 인원, **한방단어 금지**.
- 내 차례에 채팅창에 입력하면 단어로 제출됩니다. 내 차례가 아닐 때 입력하면 채팅이 됩니다.

## 구조

```
app/
  main.py        FastAPI 앱, 정적 파일 서빙, /ws WebSocket 엔드포인트
  server.py      접속자·로비·방 목록 관리, 메시지 라우팅
  room.py        대기실(참가자, 준비, 설정), 게임 시작/종료
  game.py        게임 진행(라운드, 턴 타이머, 단어 판정, 점수)
  dictionary.py  사전 로딩, 두음법칙, 한방단어 판정
  models.py      Player, broadcast 헬퍼
static/          index.html, style.css, app.js
data/
  sample_words.txt  개발용 샘플 사전 (약 450단어)
  words.txt         전체 사전 (직접 생성, git에서 제외)
tests/
```

게임 상태는 모두 서버 메모리에 있습니다. 따라서 서버 프로세스는 하나로 실행해야 합니다.

## 사전

사전 파일은 아래 순서로 찾습니다.

1. `WORDS_FILE` 환경변수에 지정한 경로
2. `data/words.txt` (전체 사전)
3. `data/sample_words.txt` (샘플)

파일 형식은 한 줄에 한 단어이고, 공백으로 구분해도 됩니다. `#` 뒤는 주석입니다. 한글이 아니거나 한 글자인 단어는 불러올 때 제외됩니다.

전체 사전은 국립국어원 **표준국어대사전** 또는 **우리말샘**의 "사전 내려받기" 데이터를 전처리해서 만들 예정입니다. 사용 전에 각 사이트의 이용 조건을 확인하세요.

## WebSocket 프로토콜

접속: `ws://<host>/ws?name=<닉네임>`

모든 메시지는 JSON이고 `type` 필드를 가집니다.

| 클라이언트 → 서버 | 필드 |
|---|---|
| `chat` | `text` |
| `create_room` | `title`, `max_players` |
| `join_room` | `room_id` |
| `leave_room` | |
| `ready` | |
| `update_settings` | `settings: {rounds, turn_time, round_time, max_players, no_killer}` |
| `start` | |
| `submit_word` | `word` |

| 서버 → 클라이언트 | 설명 |
|---|---|
| `welcome` | 내 정보, 사전 단어 수 |
| `lobby` | 방 목록, 접속자 목록 (로비에 있을 때) |
| `room` | 방 전체 상태 (`room: null`이면 방에서 나감) |
| `chat` / `system` / `error` | 채팅, 시스템 메시지, 오류 |
| `game_start` / `round_start` / `turn` | 게임 진행 |
| `word_ok` / `word_fail` | 단어 판정 결과 |
| `round_end` / `game_over` | 라운드 패배자, 최종 순위 |

## 다음 할 일

- [ ] 표준국어대사전/우리말샘 전처리 스크립트 (`scripts/`)
- [ ] 재접속 처리
- [ ] 관전 모드
- [ ] 다른 게임 모드 (쿵쿵따, 앞말잇기 등)
- [ ] 효과음과 애니메이션
