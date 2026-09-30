# 개발 문서

Game Hub를 직접 실행하거나 개발에 참여하려는 분을 위한 문서입니다. 게임 소개는 [README](../README.md)를 보세요.

## 로컬 실행

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn hub.main:app --reload
```

http://127.0.0.1:8000 을 여세요.

- 끝말잇기 전체 사전(`wordchain/data/words.txt`)은 git에 없어요. 없으면 샘플 사전(약 450단어)으로 실행됩니다. 만드는 방법은 [끝말잇기 사전 만들기](#끝말잇기-사전-만들기)에 있어요.
- 테스트
  - 허브 통합 테스트: `pytest tests`
  - 끝말잇기 규칙·접속 관리: `cd wordchain && pytest`
  - 팩맨 규칙: `node --test pacman/tests/logic.test.mjs` (Node 18 이상)
  - 행맨 게임 흐름: `cd hangman && pytest`

## 구조

```
hub/
  main.py        메인 앱: 게임 앱들을 경로별로 붙인다 (mount), 캐시 헤더
  static/        메인 화면
wordchain/       끝말잇기 (FastAPI 앱: wordchain/app/main.py)
quoridor/        쿼리도   (FastAPI 앱: quoridor/server/main.py)
pacman/          팩맨     (FastAPI 앱: pacman/app.py, 정적 파일만 제공)
hangman/         행맨     (FastAPI 앱: hangman/app/main.py)
deploy/          서버 설치, 업데이트 스크립트
docs/            이 문서, README용 스크린샷
tests/           허브 통합 테스트
```

| 경로 | 앱 |
|---|---|
| `/` | 메인 화면 (`hub/static`) |
| `/wordchain/` | 끝말잇기 |
| `/quoridor/` | 쿼리도 |
| `/pacman/` | 팩맨 |
| `/hangman/` | 행맨 |

- 각 게임은 독립된 FastAPI 앱이고, 자원과 WebSocket을 **페이지 기준 상대 경로**로 불러옵니다. 그래서 어느 경로에 붙여도 동작합니다.
- 게임 상태는 각 앱의 **메모리**에 있습니다. uvicorn 워커는 반드시 1개로 실행합니다.
- 허브는 모든 HTTP 응답에 `Cache-Control: no-cache`를 붙입니다. 배포 직후 브라우저가 예전 JS를 쓰는 일을 막기 위해서입니다. 바뀌지 않은 파일은 ETag로 304만 받습니다.

### 새 게임 추가하기

1. `<게임이름>/` 폴더에 FastAPI 앱을 만듭니다. 프론트엔드에서는 `/ws` 대신 `new URL("ws", location.href)`처럼 상대 경로를 씁니다.
2. `hub/main.py`의 `GAMES`에 등록합니다.
3. `hub/static/index.html`에 카드를 추가합니다.
4. `tests/test_hub.py`에 페이지와 WebSocket 테스트를 추가합니다.

## 서버 배포 (EC2 등 Linux)

Amazon Linux와 Ubuntu에서 동작합니다. systemd 서비스(`game-hub`)로 등록되므로 SSH를 끊어도 계속 돌고, 재부팅하면 자동으로 다시 시작합니다.

```bash
git clone https://github.com/kminh-wow/Game_hub.git
cd Game_hub
bash deploy/setup.sh              # 기본 8000번 포트 (nginx가 80 → 8000 전달)
```

- nginx 없이 80번으로 바로 띄우려면: `PORT=80 bash deploy/setup.sh`
- 코드 업데이트: `bash deploy/update.sh`
- 로그 보기: `sudo journalctl -u game-hub -f`
- 끝말잇기 전체 사전은 git에 없으므로 서버에 따로 올립니다.
  - `scp -i <키> wordchain/data/words.txt <user>@<서버IP>:~/Game_hub/wordchain/data/`
  - 올린 뒤 `sudo systemctl restart game-hub`
- 예전에 게임별로 따로 설치한 `word-chain-online`, `quoridor` 서비스는 setup이 자동으로 끄고 지웁니다. `~/word-chain-online`에 사전이 있으면 복사해 옵니다.

nginx를 쓴다면 WebSocket을 넘겨주도록 설정해야 합니다.

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

---

## 끝말잇기

### 코드 구조

```
wordchain/
  app/
    main.py        FastAPI 앱, 정적 파일, /ws 엔드포인트
    server.py      접속자·로비·방 목록 관리, 닉네임 중복 처리, 메시지 라우팅
    room.py        대기실(참가자, 준비, 설정), 게임 시작/종료
    game.py        게임 진행(라운드, 턴 타이머, 단어 판정, 점수)
    dictionary.py  사전 로딩, 두음법칙, 한방단어 판정
    models.py      Player, broadcast 헬퍼
  static/          index.html, style.css, app.js
  data/
    sample_words.txt  개발용 샘플 사전 (약 450단어)
    extra_words.txt   보충 사전 (사전에 없는 비속어 등, git에 포함)
    words.txt         전체 사전 (스크립트로 생성, git에서 제외)
  scripts/
    build_dictionary.py  표준국어대사전 xls → data/words.txt
  tests/
```

### 사전 불러오기

서버는 메인 사전과 보충 사전을 합쳐서 불러옵니다.

- **메인 사전**은 다음 순서로 찾습니다.
  1. `WORDS_FILE` 환경변수에 지정한 경로
  2. `wordchain/data/words.txt`
  3. `wordchain/data/sample_words.txt`
- **보충 사전**은 `wordchain/data/extra_words.txt`입니다.

파일 형식은 한 줄에 한 단어이고, 공백으로 구분해도 됩니다. `#` 뒤는 주석입니다. 한글이 아니거나 한 글자인 단어는 불러올 때 제외됩니다.

### 끝말잇기 사전 만들기

1. [표준국어대사전](https://stdict.korean.go.kr)에 로그인한 뒤 "사전 내려받기"에서 전체 파일(xls)을 받습니다.
2. 저장소 루트에서 스크립트를 실행합니다. 15초 정도 걸리고, 결과는 `wordchain/data/words.txt`에 저장됩니다.

```bash
python wordchain/scripts/build_dictionary.py "C:\경로\전체 내려받기_표준국어대사전_xls_..."
```

스크립트의 선별 기준은 다음과 같습니다.

- 구성 단위가 '단어'인 표제어만 넣습니다. 구, 관용구, 속담은 뺍니다.
- 품사에 명사가 있는 단어만 넣습니다.
- **비속어는 반드시 포함**합니다. 뜻풀이에 "속되게", "비속하게", "낮잡아", "욕으로" 같은 표시가 있으면 명사가 아니어도 넣습니다(예: 제기랄, 젠장, 이놈). 단, 동사·형용사처럼 활용하는 말은 뺍니다. "→ 네미"처럼 비속어를 가리키는 참조 표제어도 넣습니다.
- 방언, 북한어, 옛말뿐인 표제어는 뺍니다.
- 동음이의어 번호 `(02)`와 구분 기호 `-`, `^`를 떼고, 두 글자 이상 순수 한글만 남깁니다.

사전 데이터는 국립국어원의 이용 조건을 따릅니다.

### WebSocket 프로토콜

접속: `ws://<host>/wordchain/ws?name=<닉네임>&token=<브라우저 식별값>`

- `token`은 브라우저가 localStorage에 저장해 두는 임의 값입니다. 같은 닉네임과 같은 token으로 다시 접속하면 예전 연결을 끊고 이어받습니다.
- 종료 코드

| 코드 | 의미 |
|---|---|
| 4000 | 닉네임이 비었거나 12자를 넘음 |
| 4001 | 같은 닉네임이 이미 접속 중 (대소문자 무시) |
| 4002 | 같은 브라우저의 새 연결이 이어받아서 끊김 |

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
| `kicked` | 같은 브라우저의 새 연결이 이어받음 (곧 4002로 종료) |
| `game_start` / `round_start` / `turn` | 게임 진행 |
| `word_ok` / `word_fail` | 단어 판정 결과 |
| `round_end` / `game_over` | 라운드 패배자, 최종 순위 |

---

## 쿼리도

### 코드 구조

```
quoridor/
  server/
    game.py       규칙 엔진 (이동, 점프, 벽, 경로 검증, 승리 판정)
    ai.py         AI (BFS 최단경로 휴리스틱 + 얕은 minimax, 난이도 프리셋)
    analysis.py   학습 모드용 수 평가 (라벨, 이유, 계산 과정)
    rooms.py      방(세션) 관리, 6자리 방 코드
    main.py       FastAPI 앱 + WebSocket 라우팅
  web/
    index.html, style.css, net.js, board.js, board3d.js
    vendor/three/    three.js (npm run vendor 로 갱신)
    assets/models/   GLB 모델 (보드, 칸, 벽, 말)
  assets-source/     Blender 원본과 에셋 문서
  tools/             에셋 미리보기, 3D 테스트, three.js 복사 스크립트
  3D_ASSET_PLAN.md   3D 모델·애니메이션 제작 계획
```

- 좌표는 `(row, col)`이고 0~8입니다. 1P는 0행에서 출발해 8행이 목표, 2P는 반대입니다.
- 벽은 8×8 교차점 위에 놓입니다. `H`는 가로, `V`는 세로입니다.
- 3D 에셋 제작 기록은 [assets-source/README.md](../quoridor/assets-source/README.md)에 있습니다.

---

## 팩맨

브라우저에서만 도는 싱글 게임입니다. 서버(`pacman/app.py`)는 정적 파일만 내려줍니다.

```
pacman/
  app.py             정적 파일 서빙
  web/
    index.html, style.css   화면 (임시 스타일)
    logic.js         규칙: 미로, 타일 이동, 유령 목표·방향 선택, 모드 일정 (DOM 없음)
    game.js          게임 진행(상태, 점수, 목숨, 레벨), 입력, 캔버스 그리기
  tests/
    logic.test.mjs   logic.js 테스트 (node --test)
```

- 미로는 `logic.js`의 `MAZE` 문자열입니다. `#` 벽, `-` 유령 집 문, `.` 점, `o` 파워 점입니다.
- 엔티티는 타일 좌표 `(x, y)`, 다음 타일까지의 진행도 `p`(0~1), 방향 `dir`로 움직입니다. 타일 중앙에 닿을 때마다 다음 방향을 고릅니다.
- 유령 상태: `house`(집 안) → `leaving` → `normal` → (먹히면) `eaten` → `entering` → `leaving` …
- 디버그: 브라우저 콘솔에서 `__pacman.game`, `__pacman.pac`, `__pacman.ghosts`로 상태를 볼 수 있습니다.
- 그리기는 `game.js`의 `draw*` 함수에 모여 있습니다. 디자인을 바꿀 때는 이 부분과 `style.css`만 고치면 됩니다.

---

## 행맨

접속·로비·방 관리(`server.py`, `room.py`, `models.py`)는 끝말잇기와 같은 구조입니다. 게임 규칙은 `game.py`에 있습니다.

```
hangman/
  app/
    main.py      FastAPI 앱, /ws 엔드포인트
    server.py    접속자·로비·방 목록, 닉네임 중복 처리, 메시지 라우팅
    room.py      대기실(참가자, 준비, 설정), 게임 시작/종료
    game.py      라운드 진행(출제 → 추측 → 정답 공개), 차례, 점수, 힌트, 퇴장 처리
    words.py     영어 단어 목록 로딩과 검사
  static/        index.html, style.css, app.js
  data/
    enable1.txt       ENABLE 단어 목록 (퍼블릭 도메인, 약 17만 단어)
    common_words.txt  출제 시간 초과 때 자동으로 낼 쉬운 단어
  tests/
```

- 라운드 단계: `setting`(출제) → `guessing`(추측) → `break`(정답 공개) → 다음 라운드
- 출제 순서와 추측 순서는 모두 **방에 들어온 순서**입니다. 추측 순서는 출제자 다음 사람부터 시작하고 출제자는 건너뜁니다.
- 게임 상태는 플레이어마다 따로 보냅니다(`type: "game"`). **정답(`word`)은 출제자와 정답 공개 때만** 들어갑니다.
- 테스트에서 여러 WebSocket을 열 때는 `with TestClient(app) as client:`처럼 열어야 모든 연결이 이벤트 루프 하나를 공유합니다.

### WebSocket 메시지

접속, 로비, 방, 채팅 메시지와 종료 코드는 끝말잇기와 같습니다. 게임 메시지만 다릅니다.

| 클라이언트 → 서버 | 필드 |
|---|---|
| `set_word` | `word`, `hint` (출제자만) |
| `guess` | `text` (알파벳 1글자 또는 단어 전체, 내 차례만) |
| `update_settings` | `settings: {cycles, lives, turn_time, hint_turn, max_players}` |

| 서버 → 클라이언트 | 설명 |
|---|---|
| `game` | `game`: 내 시점의 게임 상태, `events`: 방금 일어난 일 목록 (`letter_ok`, `letter_fail`, `word_ok`, `hint` …) |
| `game_over` | 최종 순위 |
