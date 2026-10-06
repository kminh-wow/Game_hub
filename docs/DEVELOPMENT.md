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

- **요트 다이스는 `pybullet`(물리 엔진)이 필요해요.** PyPI에는 Linux용 파이썬 3.11 이하 설치 파일만 있어서, 그 밖의 환경(Windows, macOS, 더 새로운 파이썬)에서는 직접 컴파일해야 해요(Windows는 Visual C++ 빌드 도구). 설치하지 못해도 **요트 다이스만 빠지고 나머지 게임은 정상으로 떠요.** 서버 로그에 `게임 'yacht'을(를) 불러오지 못했어요`가 남고, `pytest tests`의 `test_all_games_loaded`가 이유를 알려줘요.
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
common/
  multiplayer/   멀티 게임 공통 서버: 접속·닉네임·로비·방·채팅·WebSocket (끝말잇기, 행맨, 오목, 요트 다이스)
  web/lobby.js   멀티 게임 공통 화면: 로그인·로비·대기실·채팅·결과 창 (/common/lobby.js, 오목·요트 다이스가 사용)
wordchain/       끝말잇기 (FastAPI 앱: wordchain/app/main.py)
quoridor/        쿼리도   (FastAPI 앱: quoridor/server/main.py)
pacman/          팩맨     (FastAPI 앱: pacman/app.py, 정적 파일만 제공)
hangman/         행맨     (FastAPI 앱: hangman/app/main.py)
omok/            오목     (FastAPI 앱: omok/app/main.py)
yacht/           요트 다이스 (FastAPI 앱: yacht/app/main.py)
fortress/        포트리스 (FastAPI 앱: fortress/app/main.py)
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
| `/omok/` | 오목 |
| `/yacht/` | 요트 다이스 |
| `/fortress/` | 포트리스 |
| `/common/` | 공통 프론트엔드 파일 (`lobby.js`) |

- 각 게임은 독립된 FastAPI 앱이고, 자원과 WebSocket을 **페이지 기준 상대 경로**로 불러옵니다. 그래서 어느 경로에 붙여도 동작합니다.
- 게임 상태는 각 앱의 **메모리**에 있습니다. uvicorn 워커는 반드시 1개로 실행합니다.
- 허브는 모든 HTTP 응답에 `Cache-Control: no-cache`를 붙입니다. 배포 직후 브라우저가 예전 JS를 쓰는 일을 막기 위해서입니다. 바뀌지 않은 파일은 ETag로 304만 받습니다.

### 새 게임 추가하기

1. `<게임이름>/` 폴더에 FastAPI 앱을 만듭니다. 프론트엔드에서는 `/ws` 대신 `new URL("ws", location.href)`처럼 상대 경로를 씁니다.
2. `hub/main.py`의 `GAMES`에 등록합니다.
3. `hub/static/index.html`에 카드를 추가합니다.
4. `tests/test_hub.py`에 페이지와 WebSocket 테스트를 추가합니다.

멀티 게임이라면 아래 공통 모듈을 쓰세요. 오목(`omok/`)이 가장 짧은 예시입니다.

## 공통 멀티플레이 모듈

### 서버: `common/multiplayer`

접속(닉네임 중복 거부, 같은 브라우저 이어받기), 로비, 방(방장, 준비, 설정, 시작, 퇴장), 채팅, WebSocket 엔드포인트를 모두 처리합니다. 게임은 **방 설정, 게임 클래스, 게임 전용 메시지**만 만들면 됩니다.

```python
# <게임>/app/room.py
from dataclasses import dataclass, replace
from common.multiplayer import BaseRoom

@dataclass
class RoomSettings:
    turn_time: int = 30
    def copy(self): return replace(self)

class Room(BaseRoom):
    settings_class = RoomSettings
    setting_limits = {"turn_time": (10, 120)}   # 정수 설정 (최소, 최대)
    bool_settings = ()                          # 참/거짓 설정 이름
    min_players, max_players_limit, default_max_players = 2, 8, 4

    def create_game(self):
        return Game(self)       # start(), remove_player(p), finish() 를 갖고, 끝나면 room.end_game(self)

# <게임>/app/main.py
from common.multiplayer import GameServer, create_app

async def place(room, player, msg):             # 게임 중일 때만 불림. 오류면 안내 문구(str)를 돌려줌
    return await room.game.place(player, msg.get("x"), msg.get("y"))

server = GameServer(Room, ctx=None, actions={"place": place}, welcome_info=dict)
app = create_app(server, STATIC_DIR, "My Game")
```

- `ctx`는 방마다 공유할 자원입니다 (끝말잇기는 사전, 행맨은 영어 단어 목록). 방에서는 `self.ctx`로 씁니다.
- `extra_state()`를 덮어쓰면 방 상태(`room` 메시지)에 게임별 정보를 붙일 수 있습니다 (오목의 방 전적 등).
- `can_start()`를 덮어쓰면 시작 조건을 바꿀 수 있습니다.
- 게임 폴더 안에서 `pytest`를 돌리려면 `conftest.py`로 저장소 루트를 경로에 추가합니다 (`omok/conftest.py` 참고).
- 테스트에서 여러 WebSocket을 열 때는 `with TestClient(app) as client:`로 열어야 모든 연결이 이벤트 루프 하나를 공유합니다.

#### 관전

`BaseRoom`이 관전자를 처리하므로 **게임은 따로 할 일이 거의 없습니다.**

- 클라이언트가 `spectate_room {room_id}`를 보내면 `room.spectators`에 들어갑니다. 관전자는 `max_players`에 들어가지 않고, 방마다 `MAX_SPECTATORS`(20)명까지입니다.
- `room.broadcast()`는 참가자와 관전자 모두(`room.audience`)에게 보냅니다. 게임이 참가자에게 직접 보내는 곳이 있으면 `room.players` 대신 `room.audience`를 쓰세요(행맨의 `broadcast_state` 참고).
- 방 상태(`room` 메시지)에 `spectators` 목록이 들어가고, 로비의 방 카드(`rooms[].spectators`)와 접속자(`users[].spectating`)에도 표시됩니다.
- 관전 중인 사람(`player.spectating`)은 `chat`, `leave_room`, `ping`, `client_error`만 보낼 수 있습니다. 게임 조작·준비·시작·설정은 `관전 중에는 할 수 없어요.` 오류로 막힙니다. 채팅에는 `spectator: true`가 붙습니다.
- **늦게 들어온 관전자에게 지금 상태를 보내려면** 게임에 `watch_messages(player) -> list[dict]`를 만듭니다. 입장 직후 이 메시지들을 관전자에게만 보냅니다. 숨겨야 할 정보(행맨의 정답 등)는 여기서 가립니다.
- 참가자가 모두 나가면 방이 닫히고, 관전자는 `room: null`과 안내 오류를 받고 로비로 돌아갑니다.

- AI 대사: `common/multiplayer/banter.py`의 `Banter`가 상황 이름별 대사 목록(`omok/app/banter.py`, `fortress/app/banter.py`)에서 골라 `bot: true` 채팅으로 보냅니다. 일반 대사는 6초 간격·확률·한 판 30마디 제한, 시작·승패는 항상 말합니다. 플레이어 채팅은 게임의 `hear_chat(player, text)`로 넘어오고, 욕·웃음·인사·GG·질문을 골라 2초 간격으로 대꾸합니다. 나중에 로컬 LLM 등으로 바꾸려면 `Banter.pick()`만 바꾸면 됩니다.
- 기록: `common/multiplayer/log.py`의 `room_event(room, "글")`로 게임 안의 일을 로그에 남깁니다(포트리스 발사, 요트 점수 기록 참고). 화면은 25초마다 `ping`을 보내 연결을 유지하고, 오류가 나면 `client_error {message, stack, ua}`를 보냅니다(`lobby.reportError(err, "어디서")`로 직접 보낼 수도 있습니다).

### 화면: `common/web/lobby.js`

로그인 → 로비 → 대기실 → 게임 화면 전환, 방 목록, 참가자 목록, 설정 폼, 채팅, 결과 창을 처리합니다. 게임의 `app.js`는 게임 화면만 그립니다.

관전을 위해 HTML에 `#spectator-box`(`#spectator-count`, `#spectator-list`)가 있어야 합니다(`omok/static/index.html` 참고). 게임 중이거나 꽉 찬 방 카드를 누르면 관전하고, 관전자의 대기실에는 준비·시작 버튼 대신 안내 문구가 나옵니다. 끝말잇기와 행맨은 같은 코드를 자기 `app.js`에 갖고 있습니다.

```html
<script src="../common/lobby.js"></script>
<script src="static/app.js"></script>
```

```js
const lobby = GameLobby.init({
  storageKey: "omok",                              // 닉네임·브라우저 식별값 저장 키
  renderGame(game, room) { /* #game-view 안을 그림 */ },
  handlers: { game(msg) { lobby.setGame(msg.game); } },
  playerRight: (p, room) => `${room.wins[p.id] || 0}승`,
  showLastGame: true,                              // 끝난 뒤에도 대기실 아래에 마지막 판 표시
});
lobby.send("place", { x, y });
```

필요한 HTML id(`screen-login`, `room-list`, `settings-form`, `game-view` …)는 `omok/static/index.html`을 참고하세요. 설정 폼의 입력은 `name`이 서버 설정 이름과 같아야 하고, 바뀌면 자동으로 서버에 보냅니다. 끝말잇기와 행맨은 아직 각자 `app.js`에 같은 코드를 갖고 있고, 디자인 작업이 끝나면 `lobby.js`로 옮길 예정입니다.

## 서버 배포 (EC2 등 Linux)

Amazon Linux와 Ubuntu에서 동작합니다. systemd 서비스(`game-hub`)로 등록되므로 SSH를 끊어도 계속 돌고, 재부팅하면 자동으로 다시 시작합니다.

```bash
git clone https://github.com/kminh-wow/Game_hub.git
cd Game_hub
bash deploy/setup.sh              # 게임 서버는 127.0.0.1:8000, nginx가 80 → 8000 전달
```

- 게임 서버는 기본으로 **서버 안(127.0.0.1)에서만** 받습니다. 밖에서는 nginx(80번)로만 들어오므로 보안 그룹에서 8000번을 열 필요가 없습니다.
- nginx 없이 80번으로 바로 띄우려면: `PORT=80 bash deploy/setup.sh` (이때는 밖에서 직접 받도록 `0.0.0.0`으로 띄웁니다. `HOST=`로 직접 지정할 수도 있습니다)
- 서버 설정(`/etc/systemd/system/game-hub.service`)은 `setup.sh`가 만듭니다. `update.sh`는 코드만 갱신하므로, 포트나 주소를 바꿀 때는 `setup.sh`를 다시 실행하세요 (여러 번 실행해도 안전합니다).
- 코드 업데이트: `bash deploy/update.sh` (git pull 후 `deploy/post_update.sh`가 아래를 차례로 합니다)
  1. `deploy/install_deps.sh`: 가상환경을 **파이썬 3.11**로 맞추고 `requirements.txt`를 설치합니다.
  2. 끄투 단어 파일이 없으면 생성합니다.
  3. **재시작 전에 새 코드가 모든 게임을 불러오는지 점검**합니다. 하나라도 실패하면 재시작하지 않고, 돌고 있는 서버를 그대로 둡니다.
  4. 서비스를 재시작합니다.
- **왜 파이썬 3.11인가**: pybullet 3.2.7은 3.11까지만 미리 빌드된 설치 파일이 있습니다. 더 새로운 파이썬(Ubuntu 26.04의 3.14 등)에서는 소스를 컴파일해야 하는데, 서버에 컴파일러가 없고 `/tmp`가 작은 메모리 디스크(약 450MB)라서 `Disk quota exceeded`로 실패합니다. 3.11은 [uv](https://docs.astral.sh/uv/)로 내려받으며 시스템 파이썬은 건드리지 않습니다. 새 가상환경이 완성되기 전에는 예전 것을 지우지 않고, 실패하면 되돌립니다.
- **배포가 `Disk quota exceeded`로 실패하면**: `df -h /`로 디스크를, `findmnt /tmp`로 임시 공간을 확인하세요. 스크립트는 `TMPDIR`을 `~/.tmp`(디스크)로 돌려 두었습니다.
- 로그 보기: `sudo journalctl -u game-hub -f`
- **게임 기록만 실시간으로 보기**: `sudo journalctl -u game-hub -f | grep 게임` (지난 기록은 `--since "1 hour ago"`처럼 시간을 붙여서)
  - 멀티 게임(끝말잇기·행맨·오목·요트·포트리스)은 `게임 [포트리스 #3] ...` 형식으로 한 줄씩 남깁니다: 접속·접속 끊김, 방 만듦·입장·나감·관전·방 닫힘, 게임 시작(참가자·설정), 게임 끝(승자·순위). 요트는 점수 기록, 포트리스는 발사(각도·파워·바람·피해·탈락)와 시간 초과도 남깁니다.
  - **브라우저 오류**: 화면에서 오류가 나면 브라우저가 서버로 보내서 `브라우저 오류 닉네임 (크롬 141): 문구 | 스택` 으로 남습니다(접속 하나당 20개까지). 오류만 보려면 `| grep "브라우저 오류"`.
  - 게임 메시지를 처리하다 서버에서 오류가 나면 `서버 오류 닉네임 메시지 종류`와 함께 전체 스택을 남기고, 연결은 끊지 않습니다(그 사람에게는 "서버에서 오류가 났어요"가 갑니다).
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
    main.py        사전 로딩, GameServer·앱 생성 (게임 메시지: submit_word)
    room.py        방 설정(라운드, 턴 시간, 한방단어 금지, 어인정)과 게임 연결
    game.py        게임 진행(라운드, 턴 타이머, 단어 판정, 점수)
    dictionary.py  사전 로딩, 두음법칙, 한방단어 판정
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

서버는 메인 사전, 끄투 단어, 보충 사전을 합쳐서 불러오고, 어인정 단어는 따로 불러옵니다(방 설정 `injeong`으로 허용 여부를 정함).

- **메인 사전**은 다음 순서로 찾습니다.
  1. `WORDS_FILE` 환경변수에 지정한 경로
  2. `wordchain/data/words.txt`
  3. `wordchain/data/sample_words.txt`
- **끄투 일반 단어**: `wordchain/data/kkutu_words.txt` (git에서 제외, 아래 스크립트로 생성)
- **끄투 어인정 단어**: `wordchain/data/kkutu_injeong.txt` (git에서 제외)
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

### 끄투 단어 가져오기

```bash
python wordchain/scripts/import_kkutu.py            # GitHub 에서 db.sql(약 42MB)을 받아서 처리
python wordchain/scripts/import_kkutu.py db.sql     # 이미 받은 파일로 처리
```

- [KKuTu](https://github.com/JJoriping/KKuTu)의 `db.sql`에서 `kkutu_ko` 표를 읽습니다.
- 끄투 기본 끝말잇기 규칙과 같게, 품사(`type`)가 끄투의 `KOR_GROUP`에 드는 단어만 씁니다. 동사·형용사처럼 활용하는 말은 뺍니다.
- `flag & 2`(어인정)인 단어는 `kkutu_injeong.txt`로 따로 저장합니다.
- 뜻풀이(`mean`)는 가져오지 않습니다. KKuTu 레포가 GPL v3이므로 결과 파일은 git에 넣지 않습니다.
- `deploy/setup.sh`와 `deploy/post_update.sh`(`update.sh`가 호출)는 `kkutu_words.txt`가 없으면 이 스크립트를 자동으로 실행합니다.

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

### 관전 프로토콜

쿼리도는 공개 로비 없이 **방 코드**로 들어가므로, 관전도 코드로 합니다.

| 클라이언트 → 서버 | 설명 |
|---|---|
| `watch_room` `{code}` | 관전 시작. 없는 방이거나 관전석(20명)이 가득 차면 `error` |
| `leave_watch` | 관전을 끝낸다 (연결은 그대로) |

서버는 `watching {code, mode}` 다음에 지금 `state`를 보내고, 이후 `state`를 계속 보냅니다. 참가자가 나가면 `opponent_left`, 모두 나가서 방이 닫히면 `room_closed`를 받습니다. 관전자의 `move`·`place_wall`·`chat`은 `게임에 참가하지 않았습니다.`로 거절됩니다. 화면은 관전 중이면 시점을 1P로 고정하고 조작·채팅·학습 패널을 숨깁니다.

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

접속·로비·방 관리는 공통 모듈(`common/multiplayer`)을 씁니다. 게임 규칙은 `game.py`에 있습니다.

```
hangman/
  app/
    main.py      단어 목록 로딩, GameServer·앱 생성 (게임 메시지: set_word, guess)
    room.py      방 설정(출제 바퀴 수, 목숨, 턴 시간, 힌트 공개)과 게임 연결
    game.py      라운드 진행(출제 → 추측 → 정답 공개), 차례, 점수, 힌트, 퇴장 처리
    words.py     영어 단어 목록 로딩과 검사
  static/        index.html, style.css, app.js
  data/
    enable1.txt       ENABLE 단어 목록 (퍼블릭 도메인, 약 17만 단어)
    common_words.txt  출제 시간 초과 때 자동으로 낼 쉬운 단어
  tests/
```

- 라운드 단계: `setting`(출제) → `guessing`(추측) → `break`(정답 공개) → 다음 라운드
- 출제 순서와 추측 순서는 모두 **방에 들어온 순서**입니다. 추측 순서는 출제자 다음 사람부터 시작하고, 출제자와 탈락자는 건너뜁니다.
- 교수대는 추측자마다 따로 있습니다(`strikes: {player_id: n}`). 목숨만큼 틀리면 `hanged`에 들어가 그 라운드에서 탈락하고, 추측자가 모두 탈락하면 라운드가 끝납니다.
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
| `game` | `game`: 내 시점의 게임 상태, `events`: 방금 일어난 일 목록 (`letter_ok`, `letter_fail`, `word_ok`, `hanged`, `hint` …) |
| `game_over` | 최종 순위 |

---

## 오목

공통 모듈 위에 만든 가장 작은 멀티 게임입니다. 새 멀티 게임을 만들 때 참고하세요.

```
omok/
  app/
    main.py     GameServer·앱 생성 (게임 메시지: place, resign)
    room.py     방 설정(한 수 제한 시간), 최대 2명, 방 전적(wins)과 다음 판 흑 결정
    game.py     한 판 진행: 착수, 턴 타이머(초과 시 패배), 기권, 퇴장, AI 차례
    rules.py    판, 5목 판정(자유룰, 장목 인정), AI
  static/       index.html, style.css, app.js (lobby.js 사용)
  tests/
```

- 혼자 시작하면 `AIPlayer`가 상대가 됩니다. AI는 빈 칸마다 공격 점수(내 돌이 이어지는 정도) × 1.1 + 수비 점수(상대 돌이 이어지는 정도)를 계산해 가장 높은 곳에 둡니다. 띈 모양(예: ●●_●●)은 보지 않는 단순한 방식입니다.
- 첫 판은 흑백을 무작위로 정하고, 다음 판부터는 직전 판에서 진 사람이 흑입니다.
- 게임 메시지: `place {x, y}`, `resign` → 서버는 `game`(판 상태), `game_over`(승자, 이유: five·timeout·resign·leave·draw)를 보냅니다.

---

## 요트 다이스

```
yacht/
  app/
    main.py     GameServer·앱 생성 (게임 메시지: roll, hold, write)
    room.py     방 설정(한 차례 제한 시간), 1~5명
    game.py     차례 진행: 굴리기(최대 3번), 고정, 점수 기록, 시간 초과 자동 기록, 퇴장
    rules.py    족보 점수 계산, 보너스, 자동 기록 칸 고르기
  static/       index.html, style.css, app.js (lobby.js 사용)
  tests/
```

- 주사위 값은 서버가 정합니다. `game` 메시지의 `events`에 `roll` 이벤트(`dice`, 이번에 굴러간 주사위 `rolled`)가 오면, 화면은 굴러간 주사위만 0.7초 동안 무작위 눈을 보여 주다가 실제 값에 멈춥니다.
- `preview`는 지금 주사위로 각 칸에 적을 수 있는 점수입니다. 차례인 사람은 버튼으로, 다른 사람은 회색 글자로 봅니다.
- 점수가 어떻게 계산됐는지는 서버가 만들어 보냅니다(`rules.explain`). `preview_notes`는 지금 주사위의 칸별 설명이고, `notes[플레이어][칸]`은 적을 때 저장한 설명입니다. 화면은 점수 바로 옆에 괄호로 보여 줍니다(고를 수 있는 칸은 버튼 안에 함께 넣고, 칸이 좁으면 점수 아래로 내려갑니다). 설명이 점수와 어긋나지 않는지는 무작위 주사위 5000판으로 검사합니다(`yacht/tests/test_rules_explain.py`, pybullet 없이 돌아갑니다).

### 요트 주사위 물리 판정

`yacht/app/physics.py`는 PyBullet DIRECT 월드에서 240Hz로 낙하·충돌을 계산하고, 30Hz 위치/쿼터니언 궤적을 전달합니다. 초기 자세·속도만 무작위이며, 최종 면의 월드 Y축 법선으로 눈을 판정합니다. 클라이언트가 눈을 제출하지 않습니다. `tray3d.js`는 같은 궤적을 보간하고, WebGL 미지원 시에도 서버 결과를 사용합니다. 재생 중 서버에서 고정·굴리기·기록을 거부하며, 제한 시간이 끝나면 정지 후 기록합니다. 물리 계산은 작업 스레드에서 수행하고 퇴장·차례 변경 시 오래된 결과를 폐기합니다.

`pip install -r requirements.txt`로 PyBullet도 설치해야 합니다. 플랫폼에 맞는 wheel이 없으면 C++ 빌드 도구가 필요합니다. 검증: `cd yacht && python -m pytest tests`.

---

## 포트리스

```
fortress/
  app/
    main.py     GameServer·앱 생성 (게임 메시지: aim, move, fire)
    room.py     방 설정(한 차례 제한 시간, 혼자일 때 상대), 1~4명
    game.py     차례 진행: 바람·연료, 조준, 이동, 발사, 포탄 재생 대기, AI 차례, 퇴장, 순위
    world.py    산 지형(높이맵) 생성, 포탄 궤적, 폭발(지형 파괴·흙 무너짐·피해·떨어짐), 탱크 이동
    ai.py       AI 조준: 각도·파워를 격자로 시험해 상대에 가장 가까운 궤적을 고르고 난이도만큼 오차를 섞음
  static/       index.html, style.css, app.js (lobby.js 사용, 캔버스 2D)
  tests/
```

- 좌표는 왼쪽 아래가 (0, 0), 전장은 1200×700입니다. 지형은 열마다 흙이 있는 구간 목록(`[[아래, 위], ...]`)이라 처마와 동굴을 표현할 수 있고, 폭발하면 원 안의 흙만 지웁니다(`carve`). 화면으로는 구간이 하나뿐인 열을 높이 숫자 하나로 줄여 보냅니다(`pack`). 처음 지형은 높이맵으로 만들고 옆 칸과 높이 차가 3을 넘으면 흘려 보내(`slide`) 어디든 오를 수 있게 한 뒤 구간 목록으로 바꿉니다.
- 탱크는 발밑의 가장 가까운 땅(`support`)에 섭니다. 한 걸음(3)에 20까지 오를 수 있고 오른 높이만큼 연료를 더 쓰며, 처마가 낮아(16 미만) 몸이 안 들어가면 막힙니다.
- 혼자 시작하면 설정 `solo_opponent`에 따라 허수아비(0, 차례 없음)나 AI(1~3, 하·중·상)가 붙습니다. AI 탱크 id는 `ai`이고, 차례가 오면 작업 스레드에서 조준을 계산한 뒤 `aim`을 보내고 쏩니다.
- 포탄은 서버가 1/120초 단위로 계산하고(중력 + 바람), 30Hz 궤적(`frames`)을 `shot` 이벤트로 보냅니다. 화면은 궤적을 재생하는 동안 터지기 전 지형을 보여 주고, 터지는 순간 새 지형과 체력으로 바꿉니다. 서버는 재생 시간(`duration_ms`)이 지난 뒤 다음 차례로 넘깁니다.
- 파워는 화면의 게이지에서 정해 `fire {power, weapon}`으로 보냅니다(0~100 중 어떤 값이든 정당한 선택이라 서버는 범위만 확인합니다). 각도·방향은 `aim {angle, facing}`, 이동은 `move {dir}` 한 번에 3씩이며 연료를 씁니다. 서버는 다른 사람에게 `aim`·`tank` 메시지로 바로 알려 줍니다.
- 메시지: `game`(상태 + `events`: turn, shot, timeout, left), `aim`, `tank`, `game_over`(`ranking`, `winner`).
- 검증: `cd fortress && python -m pytest tests` (물리 엔진이 필요 없습니다).

