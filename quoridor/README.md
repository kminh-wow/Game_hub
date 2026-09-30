# Quoridor Online

FastAPI(WebSocket) + 순수 HTML/CSS/JS로 만든 Quoridor 웹 게임.
- **1:1 실시간 온라인 대전**: 방 코드를 만들어 친구와 공유
- **1인 플레이 (vs AI)**: 상대 로직은 Python으로 구현 (BFS 최단경로 휴리스틱 + 2-ply minimax)

## 로컬 실행

3D 화면은 `web/assets/models/`의 Blender GLB와 `web/vendor/three/`의 Three.js 0.180.0을 사용한다. 런타임 CDN 연결은 필요 없다. 말 이동 모드에서 초록 칸을 클릭하고, 벽 설치 모드에서 위치를 클릭한다. `R` 또는 방향 버튼으로 벽을 회전한다. 서버가 승인한 행동에 걷기·점프·벽 설치·승패 애니메이션이 연결되어 있다.

Three.js 파일을 다시 준비할 때만 `npm ci`와 `npm run vendor`를 실행한다. 배포할 때 `web/vendor/`와 `web/assets/`도 포함한다.

```bash
cd quo
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r server/requirements.txt
uvicorn server.main:app --reload
```

브라우저에서 `http://127.0.0.1:8000` 접속. 온라인 대전을 테스트하려면 브라우저 탭 두 개를 열어 한쪽은 "새 게임 만들기", 다른 쪽은 발급된 코드로 "코드로 참가"를 누르면 된다.

### 3D 연결 검증 (2026-09-26)

브라우저에서 GLB 로딩, 이동 클릭, 중복 입력 차단, 걷기·점프 상태 큐, 벽 설치 성공/거절, 학습 표시, 모바일 레이아웃, 승리 동작과 결과 창을 모의 서버 메시지로 검증했다. 실제 FastAPI 서버의 AI·온라인 대전 통합 테스트는 서버 의존성 설치가 승인되지 않아 미실행이다.

화면 테스트는 `node tools/preview.mjs`로 정적 서버를 띄우고 Playwright가 설치된 환경에서 `node tools/test-3d.cjs`로 실행한다. 필요하면 `PLAYWRIGHT_MODULE` 환경 변수에 Playwright 패키지 경로를 지정한다. 정적 미리보기 서버에는 게임 서버가 없으므로 실제 플레이는 위 Uvicorn 명령으로 실행해야 한다.

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
