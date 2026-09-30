"""여러 멀티플레이 게임이 함께 쓰는 접속·로비·방 관리.

    from common.multiplayer import BaseRoom, GameServer, Player, create_app

새 게임은 BaseRoom 을 상속한 방과 게임 클래스만 만들면 된다. docs/DEVELOPMENT.md 참고.
"""
from .app import create_app
from .models import Player, broadcast
from .room import BaseRoom, clamp_int
from .server import (
    CLOSE_INVALID_NAME,
    CLOSE_NAME_TAKEN,
    CLOSE_REPLACED,
    GameServer,
    valid_name,
)

__all__ = [
    "BaseRoom",
    "CLOSE_INVALID_NAME",
    "CLOSE_NAME_TAKEN",
    "CLOSE_REPLACED",
    "GameServer",
    "Player",
    "broadcast",
    "clamp_int",
    "create_app",
    "valid_name",
]
