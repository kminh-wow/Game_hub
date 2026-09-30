# Quoridor Online

> Game Hub의 일부입니다. 실행과 배포 방법은 [루트 README](../README.md)를 보세요.

FastAPI(WebSocket) + 순수 HTML/CSS/JS로 만든 Quoridor 웹 게임.
- **1:1 실시간 온라인 대전**: 방 코드를 만들어 친구와 공유
- **1인 플레이 (vs AI)**: 상대 로직은 Python으로 구현 (BFS 최단경로 휴리스틱 + 2-ply minimax)

## 게임 규칙 요약

- 9x9 보드, 각 플레이어 벽 10개.
- 한 턴에 말을 한 칸 이동하거나(상대 말과 인접 시 점프 가능) 벽을 하나 세운다.
- 벽은 겹치거나 서로를 완전히 가로막을 수 없다 (양쪽 다 목표행까지 경로가 항상 남아있어야 함).
- 상대편 끝 행에 먼저 도달하면 승리.

## 프로젝트 구조

```
server/
  game.py       # Quoridor 규칙 엔진 (이동/점프/벽/경로검증/승리판정)
  ai.py         # AI 상대 로직
  rooms.py      # 방(세션) 관리
  main.py       # FastAPI 앱 + WebSocket 라우팅
web/
  index.html, style.css, board.js, net.js
```
