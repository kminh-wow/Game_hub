from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from . import ai, game
from .rooms import RoomManager

app = FastAPI()
manager = RoomManager()

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def state_message(room, msg_type: str = "state") -> dict:
    payload = room.state.to_dict()
    payload["type"] = msg_type
    payload["mode"] = room.mode
    if room.state.winner is None:
        payload["legalMoves"] = [list(m) for m in game.legal_pawn_moves(room.state, room.state.turn)]
    else:
        payload["legalMoves"] = []
    return payload


async def maybe_run_ai(room):
    """If it's the AI's turn in an AI room, compute and apply its move."""
    while room.mode == "ai" and room.state.winner is None and room.state.turn == 2:
        action = ai.choose_move(room.state, 2)
        if action is None:
            break
        kind, payload = action
        if kind == "move":
            game.apply_move(room.state, 2, payload)
        else:
            r, c, orientation = payload
            game.apply_wall(room.state, 2, r, c, orientation)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "create_room":
                room = manager.create_room(ws)
                await ws.send_json({"type": "room_created", "code": room.code, "player": 1})

            elif msg_type == "join_room":
                code = str(data.get("code", "")).upper()
                room = manager.join_room(code, ws)
                if room is None:
                    await ws.send_json({"type": "error", "message": "방을 찾을 수 없거나 이미 가득 찼습니다."})
                    continue
                await ws.send_json({"type": "joined", "code": room.code, "player": 2})
                await room.broadcast(state_message(room))

            elif msg_type == "start_ai_game":
                room = manager.create_ai_room(ws)
                await ws.send_json({"type": "room_created", "code": room.code, "player": 1, "mode": "ai"})
                await ws.send_json(state_message(room))

            elif msg_type in ("move", "place_wall"):
                entry = manager.lookup(ws)
                if entry is None:
                    await ws.send_json({"type": "error", "message": "게임에 참가하지 않았습니다."})
                    continue
                room, player = entry

                if msg_type == "move":
                    to = tuple(data.get("to", []))
                    ok, err = game.apply_move(room.state, player, to)
                else:
                    ok, err = game.apply_wall(
                        room.state, player, data.get("r"), data.get("c"), data.get("orientation")
                    )

                if not ok:
                    await ws.send_json({"type": "error", "message": err})
                    continue

                await maybe_run_ai(room)
                await room.broadcast(state_message(room))

            else:
                await ws.send_json({"type": "error", "message": f"알 수 없는 메시지 타입: {msg_type}"})

    except WebSocketDisconnect:
        entry = manager.lookup(ws)
        manager.disconnect(ws)
        if entry is not None:
            room, player = entry
            await room.broadcast({"type": "opponent_left"})


app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
