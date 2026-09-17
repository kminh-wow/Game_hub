# Quoridor Online

FastAPI(WebSocket) + 순수 HTML/CSS/JS로 만든 Quoridor 웹 게임.
- **1:1 실시간 온라인 대전**: 방 코드를 만들어 친구와 공유
- **1인 플레이 (vs AI)**: 상대 로직은 Python으로 구현 (BFS 최단경로 휴리스틱 + 2-ply minimax)

## 로컬 실행

```bash
cd game-project
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r server/requirements.txt
uvicorn server.main:app --reload
```

브라우저에서 `http://127.0.0.1:8000` 접속. 온라인 대전을 테스트하려면 브라우저 탭 두 개를 열어 한쪽은 "새 게임 만들기", 다른 쪽은 발급된 코드로 "코드로 참가"를 누르면 된다.

## 게임 규칙 요약

- 9x9 보드, 각 플레이어 벽 10개.
- 한 턴에 말을 한 칸 이동하거나(상대 말과 인접 시 점프 가능) 벽을 하나 세운다.
- 벽은 겹치거나 서로를 완전히 가로막을 수 없다 (양쪽 다 목표행까지 경로가 항상 남아있어야 함).
- 상대편 끝 행에 먼저 도달하면 승리.

## EC2 배포 (프리티어)

1. EC2 인스턴스에 Python 3.11+ 설치 후 이 저장소를 클론.
2. 가상환경 생성 및 `pip install -r server/requirements.txt`.
3. `deploy/quoridor.service`를 참고해 `/etc/systemd/system/quoridor.service`로 등록:
   ```bash
   sudo cp deploy/quoridor.service /etc/systemd/system/quoridor.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now quoridor
   ```
   (파일 안의 `User`/`WorkingDirectory`/venv 경로를 실제 배포 경로에 맞게 수정)
4. 보안 그룹에서 8000번 포트(또는 nginx를 쓸 경우 80)를 열어준다.
5. 포트 번호 없이 IP만으로 접속되게 하려면 `deploy/nginx.conf.example`을 `/etc/nginx/sites-available/default`에 적용해 80번 포트를 8000번으로 리버스 프록시한다. 도메인/HTTPS(wss)가 필요해지면 그 파일 하단 주석의 certbot 절차를 따른다.

## 프로젝트 구조

```
server/
  game.py       # Quoridor 규칙 엔진 (이동/점프/벽/경로검증/승리판정)
  ai.py         # AI 상대 로직
  rooms.py      # 방(세션) 관리
  main.py       # FastAPI 앱 + WebSocket 라우팅
web/
  index.html, style.css, board.js, net.js
deploy/
  quoridor.service, nginx.conf.example
```
