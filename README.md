# Game Hub

친구들과 브라우저에서 바로 즐기는 게임 모음입니다. FastAPI 서버 하나가 메인 화면과 모든 게임을 제공합니다.

| 경로 | 게임 | 설명 |
|---|---|---|
| `/` | 메인 화면 | 게임 선택 |
| `/wordchain/` | [끝말잇기](wordchain/README.md) | 실시간 멀티플레이 끝말잇기 (2~8명) |
| `/quoridor/` | [쿼리도](quoridor/README.md) | 3D 보드 전략 게임 (2명, AI 대전) |

## 로컬 실행

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn hub.main:app --reload
```

http://127.0.0.1:8000 을 여세요.

- 끝말잇기 전체 사전(`wordchain/data/words.txt`)은 git에 없습니다. 없으면 샘플 사전(약 450단어)으로 실행됩니다. 만드는 방법은 [끝말잇기 README](wordchain/README.md#사전)에 있습니다.
- 테스트: `pytest tests` (허브), `cd wordchain && pytest` (끝말잇기 규칙)

## 구조

```
hub/
  main.py        메인 앱: 게임 앱들을 경로별로 붙인다 (mount)
  static/        메인 화면
wordchain/       끝말잇기 (FastAPI 앱: wordchain/app/main.py)
quoridor/        쿼리도 (FastAPI 앱: quoridor/server/main.py)
deploy/          서버 설치, 업데이트 스크립트
tests/           허브 통합 테스트
```

각 게임은 독립된 FastAPI 앱이고, 자원과 WebSocket을 **페이지 기준 상대 경로**로 불러옵니다. 그래서 어느 경로에 붙여도 동작합니다.

### 새 게임 추가하기

1. `<게임이름>/` 폴더에 FastAPI 앱을 만듭니다. 프론트엔드에서는 `/ws` 대신 `new URL("ws", location.href)`처럼 상대 경로를 씁니다.
2. `hub/main.py`의 `GAMES`에 등록합니다.
3. `hub/static/index.html`에 카드를 추가합니다.

## 서버 배포 (EC2 등 Linux)

게임 상태가 서버 메모리에 있으므로 **워커는 1개로만** 실행합니다. 재시작하면 진행 중인 방은 모두 사라집니다.

```bash
git clone https://github.com/kminh-wow/Game_hub.git
cd Game_hub
bash deploy/setup.sh              # 기본 8000번 포트 (nginx가 80 → 8000 전달)
```

- 예전에 따로 설치한 `word-chain-online`, `quoridor` 서비스는 자동으로 끄고 지웁니다. 서버의 `~/word-chain-online`에 끝말잇기 사전이 있으면 그것도 복사해 옵니다.
- nginx 없이 80번으로 바로 띄우려면: `PORT=80 bash deploy/setup.sh`
- 코드 업데이트: `bash deploy/update.sh`
- 로그 보기: `sudo journalctl -u game-hub -f`
