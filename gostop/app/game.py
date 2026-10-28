"""고스톱 한 게임: 정한 판 수만큼(또는 누가 칩이 떨어질 때까지) 판을 이어 가고 칩으로 순위를 매긴다.

한 판: 나눠 주기(맞고 10장·바닥 8장 / 3인 7장·바닥 6장) → 차례대로 손패 1장 내고 더미 1장 뒤집어 같은 월을 먹음
  쪽·뻑·따닥·쓸·뻑 먹기는 피 1장씩 뺏기, 폭탄(같은 월 3장 + 바닥 1장)은 4장 먹고 2번은 뒤집기만, 흔들기는 2배
→ 점수가 기준(맞고 7점 / 3인 3점) 이상이면 고·스톱 → 스톱하면 정산(고·흔들기·폭탄·나가리 배수, 피박·광박·멍박, 고박)
→ 아무도 못 나면 나가리(다음 판 2배). 처음 손패에 같은 월 4장이면 총통(바로 10점).
사람이 모자라면 AI가 자리를 채운다. 패는 본인에게만 보낸다.
"""
from __future__ import annotations

import asyncio
import random
import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from . import ai
from .rules import NAMES, best_of, go_points, kind, loser_bak, month, new_deck, score, steal_pick

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

AI_DELAY = 1.0            # AI 가 내기 전 기다리는 시간(초)
SKIP_DELAY = 0.8          # 폭탄 뒤 뒤집기만 하는 차례
RESULT_PAUSE = 9.0        # 판 결과 보여 주는 시간
CHONGTONG_POINTS = 10
AI_NAMES = ["AI 순이", "AI 돌이", "AI 꽃님"]


class Bot:
    """AI 자리 (Player 처럼 생겼지만 메시지는 받지 않음)."""
    is_bot = True

    def __init__(self, n: int, name: str | None = None):
        self.id = f"ai-{n}"
        self.name = name or AI_NAMES[n % len(AI_NAMES)]

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}

    async def send(self, msg: dict[str, Any]) -> None:
        pass


@dataclass(eq=False)
class Seat:
    player: Any
    chips: int
    hand: list[str] = field(default_factory=list)
    captured: list[str] = field(default_factory=list)
    gos: int = 0
    go_score: int = 0          # 마지막으로 고 했을 때 점수 (이보다 올라야 다시 고·스톱)
    shakes: int = 0
    bombs: int = 0
    skip: int = 0              # 폭탄 뒤 뒤집기만 하는 차례 수
    ppeok: int = 0
    away: bool = False

    @property
    def id(self) -> str:
        return self.player.id

    @property
    def is_bot(self) -> bool:
        return getattr(self.player, "is_bot", False)


class Game:
    def __init__(self, room: Room, rng: random.Random | None = None):
        self.room = room
        self.settings = room.settings.copy()
        self.rng = rng or secrets.SystemRandom()
        humans = list(room.players)
        self.rng.shuffle(humans)
        size = max(self.settings.size, len(humans))
        players: list[Any] = humans + [Bot(i) for i in range(size - len(humans))]
        self.seats = [Seat(p, self.settings.start_chips) for p in players]
        self.threshold = 7 if size == 2 else 3
        self.round_no = 0
        self.leader = self.rng.randrange(size)
        self.nagari = 1                    # 나가리가 이어지면 배수
        self.floor: list[str] = []
        self.pile: list[str] = []
        self.turn: int | None = None
        self.phase = "deal"                # play → gostop → result
        self.deadline = 0.0
        self.last: dict[str, Any] = {}     # 방금 차례에 일어난 일 (화면 연출용)
        self.seq = 0
        self.result: dict[str, Any] | None = None
        self.finished = False
        self.winner: Any = None
        self._task: asyncio.Task | None = None

    # ---- 조회 ----

    def seat_of(self, player: Any) -> Seat | None:
        return next((s for s in self.seats if s.player is player), None)

    def _turn_seconds(self) -> int:
        seat = self.seats[self.turn] if self.turn is not None else None
        return 4 if seat and seat.away else self.settings.turn_time

    # 내 차례에 낼 수 있는 카드와 방법
    def options(self, seat: Seat) -> dict[str, Any] | None:
        if self.finished or self.turn is None or self.seats[self.turn] is not seat:
            return None
        if self.phase == "gostop":
            return {"gostop": {"score": score(seat.captured)["total"], "gos": seat.gos}}
        if self.phase != "play" or seat.skip > 0:
            return None
        cards = {}
        for c in seat.hand:
            m = month(c)
            same = [h for h in seat.hand if month(h) == m]
            matches = [f for f in self.floor if month(f) == m]
            cards[c] = {
                "matches": matches,
                "choose": len(matches) == 2 and kind(matches[0]) != kind(matches[1]),
                "bomb": len(same) == 3 and len(matches) == 1,
                "shake": len(same) == 3 and not matches,
            }
        return {"cards": cards}

    def state(self, viewer: Any = None) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        players = []
        for s in self.seats:
            sc = score(s.captured)
            players.append({
                "id": s.id, "name": s.player.name, "bot": s.is_bot, "chips": s.chips,
                "hand": s.hand if viewer is not None and s.player is viewer else None,
                "hand_count": len(s.hand), "captured": s.captured, "score": sc["total"], "parts": sc["parts"],
                "pi": sc["pi"], "gos": s.gos, "shakes": s.shakes, "bombs": s.bombs, "ppeok": s.ppeok, "away": s.away,
            })
        me = self.seat_of(viewer) if viewer is not None else None
        return {
            "players": players,
            "floor": self.floor,
            "pile": len(self.pile),
            "turn_id": self.seats[self.turn].id if self.turn is not None and not self.finished else None,
            "phase": self.phase,
            "round_no": self.round_no,
            "max_rounds": self.settings.max_rounds,
            "threshold": self.threshold,
            "point_value": self.settings.point_value,
            "nagari": self.nagari,
            "time_left_ms": max(int((self.deadline - loop.time()) * 1000), 0) if self.turn is not None and not self.seats[self.turn].is_bot else 0,
            "time_total_ms": self._turn_seconds() * 1000 if self.turn is not None else 0,
            "last": self.last,
            "seq": self.seq,
            "result": self.result,
            "options": self.options(me) if me else None,
            "finished": self.finished,
            "winner_id": self.winner.id if self.winner else None,
        }

    async def broadcast_state(self) -> None:
        await asyncio.gather(*(p.send({"type": "game", "game": self.state(p)}) for p in self.room.audience))

    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(player)}]

    # ---- 진행 ----

    async def start(self) -> None:
        mode = "맞고(2명)" if len(self.seats) == 2 else "고스톱(3명)"
        bots = [s.player.name for s in self.seats if s.is_bot]
        limit = f"{self.settings.max_rounds}판" if self.settings.max_rounds else "누가 칩이 떨어질 때까지"
        await self.room.system(f"{mode} 시작! {self.threshold}점부터 고·스톱 · 점당 {self.settings.point_value:,}칩 · {limit}"
                               + (f" · AI: {', '.join(bots)}" if bots else ""))
        await self._start_round()

    def _run(self, coro) -> None:
        self._cancel()
        self._task = asyncio.create_task(coro)

    def _cancel(self) -> None:
        if self._task and self._task is not asyncio.current_task():
            self._task.cancel()
        self._task = None

    # 새 판: 섞고 나눠 주기 (바닥에 같은 월 4장이면 다시), 총통 확인
    async def _start_round(self) -> None:
        if (self.settings.max_rounds and self.round_no >= self.settings.max_rounds) or any(s.chips <= 0 for s in self.seats):
            await self.finish()
            return
        self.round_no += 1
        n = len(self.seats)
        hand_n, floor_n = (10, 8) if n == 2 else (7, 6)
        while True:
            deck = new_deck()
            self.rng.shuffle(deck)
            for s in self.seats:
                s.hand = sorted((deck.pop() for _ in range(hand_n)), key=lambda c: (month(c), c))
            self.floor = [deck.pop() for _ in range(floor_n)]
            if all(sum(1 for f in self.floor if month(f) == m) < 4 for m in range(1, 13)):
                break
        self.pile = deck
        for s in self.seats:
            s.captured, s.gos, s.go_score, s.shakes, s.bombs, s.skip, s.ppeok = [], 0, 0, 0, 0, 0, 0
        self.result = None
        self.last = {}
        self.seq += 1
        for i, s in enumerate(self.seats):
            for m in range(1, 13):
                if sum(1 for c in s.hand if month(c) == m) == 4:
                    await self.room.system(f"[{self.round_no}번째 판] {s.player.name}님 총통! ({m}월 네 장)")
                    await self._settle(i, chongtong=m)
                    return
        await self._begin_turn(self.leader)

    async def _begin_turn(self, i: int) -> None:
        self.turn = i
        self.phase = "play"
        seat = self.seats[i]
        self.deadline = asyncio.get_running_loop().time() + self._turn_seconds()
        if seat.skip > 0:
            self._run(self._auto(i, SKIP_DELAY))
        elif seat.is_bot:
            self._run(self._auto(i, AI_DELAY))
        else:
            self._run(self._timer(i))
        await self.broadcast_state()

    # AI 차례·폭탄 뒤 뒤집기·시간 초과: 자동으로 진행
    async def _auto(self, i: int, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            return
        if self.turn != i:
            return
        self._task = None
        seat = self.seats[i]
        if self.phase == "gostop":
            await self._decide(seat, self._bot_go(seat))
        elif seat.skip > 0:
            await self._do_turn(seat, None)
        else:
            pick = ai.choose_play(seat.hand, self.floor, self.rng)
            await self._do_turn(seat, pick["card"], pick["target"], pick["shake"], pick["bomb"])

    async def _timer(self, i: int) -> None:
        try:
            await asyncio.sleep(self._turn_seconds())
        except asyncio.CancelledError:
            return
        if self.turn != i:
            return
        seat = self.seats[i]
        if not seat.away:
            seat.away = True
            await self.room.system(f"{seat.player.name}님 시간 초과 · 자동으로 둬요 (아무 카드나 내면 돌아와요)")
        self._task = None
        if self.phase == "gostop":
            await self._decide(seat, False)
        else:
            pick = ai.choose_play(seat.hand, self.floor, self.rng)
            await self._do_turn(seat, pick["card"], pick["target"], pick["shake"], pick["bomb"])

    def _bot_go(self, seat: Seat) -> bool:
        others = max(score(s.captured)["total"] for s in self.seats if s is not seat)
        return ai.choose_go(score(seat.captured)["total"], seat.gos, len(seat.hand), self.threshold, others)

    # 사람이 카드 냄
    async def play(self, player: Player, card: Any, target: Any = None, shake: Any = False, bomb: Any = False) -> str | None:
        seat = self.seat_of(player)
        if self.finished or seat is None or self.turn is None or self.seats[self.turn] is not seat or self.phase != "play":
            return "지금은 내 차례가 아니에요."
        if seat.skip > 0:
            return "폭탄 뒤에는 뒤집기만 해요."
        if card not in seat.hand:
            return "그 카드는 손에 없어요."
        opts = self.options(seat)["cards"][card]
        bomb = bool(bomb) and opts["bomb"]
        shake = bool(shake) and opts["shake"]
        if target is not None and target not in opts["matches"]:
            target = None
        seat.away = False
        self._cancel()
        await self._do_turn(seat, card, target, shake, bomb)
        return None

    # 다른 사람들에게서 피 한 장씩
    def _steal(self, seat: Seat, why: str, events: list[str]) -> None:
        got = []
        for other in self.seats:
            if other is seat:
                continue
            c = steal_pick(other.captured)
            if c:
                other.captured.remove(c)
                seat.captured.append(c)
                got.append(c)
        events.append(why)
        self.last.setdefault("stolen", []).extend(got)

    def _take(self, seat: Seat, cards: list[str]) -> None:
        for c in cards:
            if c in self.floor:
                self.floor.remove(c)
        seat.captured.extend(cards)
        self.last.setdefault("taken", []).extend(cards)

    # 한 차례: 손패 1장(또는 폭탄 3장) 내고, 더미 1장 뒤집기
    async def _do_turn(self, seat: Seat, card: str | None, target: str | None = None, shake: bool = False, bomb: bool = False) -> None:
        events: list[str] = []
        self.last = {"id": seat.id, "name": seat.player.name, "played": [], "flipped": None, "taken": [], "events": events}
        self.seq += 1
        m = month(card) if card else None
        placed = None
        pending: list[str] | None = None
        floor_m: list[str] = []
        if card is None:
            seat.skip -= 1                                         # 폭탄 뒤: 뒤집기만
        elif bomb:
            same = [c for c in seat.hand if month(c) == m]
            floor_m = [f for f in self.floor if month(f) == m]
            for c in same:
                seat.hand.remove(c)
            self.last["played"] = same
            self._take(seat, same + floor_m)
            seat.bombs += 1
            seat.skip += 2
            self._steal(seat, "폭탄", events)
            floor_m = []
            m = None
        else:
            seat.hand.remove(card)
            self.last["played"] = [card]
            if shake:
                seat.shakes += 1
                events.append("흔들기")
            floor_m = [f for f in self.floor if month(f) == m]
            if not floor_m:
                self.floor.append(card)
                placed = card
            elif len(floor_m) == 1:
                pending = [card, floor_m[0]]
            elif len(floor_m) == 2:
                pick = target if target in floor_m else best_of(floor_m)
                pending = [card, pick]
            else:
                pending = [card] + floor_m                         # 바닥에 쌓인 3장을 마저 먹음
        # 더미 뒤집기
        flipped = self.pile.pop() if self.pile else None
        self.last["flipped"] = flipped
        fm = month(flipped) if flipped else None
        if flipped and m is not None and fm == m and pending and len(pending) == 2 and len(floor_m) == 1:
            self.floor += [card, flipped]                          # 뻑: 세 장이 바닥에 남음
            seat.ppeok += 1
            events.append("뻑")
        elif flipped and m is not None and fm == m and pending and len(pending) == 2 and len(floor_m) == 2:
            self._take(seat, pending + [c for c in floor_m if c not in pending] + [flipped])
            self._steal(seat, "따닥", events)
        elif flipped and placed and fm == m:
            self._take(seat, [placed, flipped])
            self._steal(seat, "쪽", events)
        else:
            if pending:
                self._take(seat, pending)
                if len(pending) == 4:
                    self._steal(seat, "뻑 먹기", events)
            if flipped:
                fl = [f for f in self.floor if month(f) == fm]
                if not fl:
                    self.floor.append(flipped)
                elif len(fl) == 3:
                    self._take(seat, [flipped] + fl)
                    self._steal(seat, "뻑 먹기", events)
                else:
                    self._take(seat, [flipped, best_of(fl)])
        if not self.floor and self.pile:
            self._steal(seat, "쓸", events)
        if events:
            await self.room.system(f"{seat.player.name}: {' · '.join(events)}!")
        await self._after_turn(seat)

    # 차례 끝: 났으면 고·스톱, 아니면 다음 사람 (모두 손패가 없으면 나가리)
    async def _after_turn(self, seat: Seat) -> None:
        total = score(seat.captured)["total"]
        no_more = all(not s.hand and s.skip == 0 for s in self.seats)
        if total >= self.threshold and total > seat.go_score:
            if no_more or (not seat.hand and seat.skip == 0):
                await self._decide(seat, False)                    # 마지막 차례면 바로 스톱
                return
            self.phase = "gostop"
            self.deadline = asyncio.get_running_loop().time() + self._turn_seconds()
            if seat.is_bot:
                self._run(self._auto(self.seats.index(seat), AI_DELAY))
            else:
                self._run(self._timer(self.seats.index(seat)))
            await self.broadcast_state()
            return
        if no_more:
            await self._nagari()
            return
        await self._begin_turn((self.seats.index(seat) + 1) % len(self.seats))

    async def decide(self, player: Player, go: Any) -> str | None:
        seat = self.seat_of(player)
        if self.finished or seat is None or self.turn is None or self.seats[self.turn] is not seat or self.phase != "gostop":
            return "지금은 고·스톱을 고를 때가 아니에요."
        seat.away = False
        self._cancel()
        await self._decide(seat, bool(go))
        return None

    async def _decide(self, seat: Seat, go: bool) -> None:
        if go:
            seat.gos += 1
            seat.go_score = score(seat.captured)["total"]
            await self.room.system(f"{seat.player.name}: {seat.gos}고! ({seat.go_score}점)")
            self.last = {"id": seat.id, "name": seat.player.name, "events": [f"{seat.gos}고"], "played": [], "taken": [], "flipped": None}
            self.seq += 1
            await self._begin_turn((self.seats.index(seat) + 1) % len(self.seats))
            return
        await self._settle(self.seats.index(seat))

    # 정산: 이긴 사람 점수 × 배수를 진 사람마다 (박은 2배씩, 고박이면 고 한 사람이 다 냄)
    async def _settle(self, wi: int, chongtong: int | None = None) -> None:
        self.turn = None
        self.phase = "result"
        win = self.seats[wi]
        ws = score(win.captured)
        base = CHONGTONG_POINTS if chongtong else ws["total"]
        points = base if chongtong else go_points(base, win.gos)
        mult = 2 ** (win.shakes + win.bombs) * self.nagari
        pays = []
        for s in self.seats:
            if s is win:
                continue
            baks = [] if chongtong else loser_bak(ws, score(s.captured))
            if len(self.seats) == 2 and s.gos > 0:
                baks.append("고박")
            pays.append({"seat": s, "baks": baks, "amount": points * mult * (2 ** len(baks)) * self.settings.point_value})
        goers = [p for p in pays if p["seat"].gos > 0]
        if len(self.seats) > 2 and goers:                          # 3인 고박: 고 했던 사람이 혼자 다 냄
            total = sum(p["amount"] for p in pays)
            for p in pays:
                p["amount"] = total if p is goers[0] else 0
                if p is goers[0]:
                    p["baks"].append("고박")
        out = []
        for p in pays:
            amount = min(p["amount"], p["seat"].chips)
            p["seat"].chips -= amount
            win.chips += amount
            out.append({"id": p["seat"].id, "name": p["seat"].player.name, "amount": amount, "baks": p["baks"]})
        self.result = {
            "type": "win", "winner_id": win.id, "name": win.player.name, "score": base, "gos": win.gos, "points": points,
            "parts": {} if chongtong else ws["parts"], "chongtong": chongtong, "shakes": win.shakes, "bombs": win.bombs,
            "nagari": self.nagari, "mult": mult, "pays": out, "won": sum(p["amount"] for p in out),
        }
        detail = f"{base}점" + (f" · {win.gos}고" if win.gos else "") + (f" · ×{mult}" if mult > 1 else "")
        await self.room.system(f"[{self.round_no}번째 판] {win.player.name}님 승리! ({detail}) {self.result['won']:,}칩을 받아요.")
        self.leader = wi
        self.nagari = 1
        self._run(self._next_round())
        await self.broadcast_state()

    async def _nagari(self) -> None:
        self.turn = None
        self.phase = "result"
        self.nagari *= 2
        self.result = {"type": "nagari", "nagari": self.nagari}
        await self.room.system(f"[{self.round_no}번째 판] 나가리! 다음 판은 {self.nagari}배예요.")
        self._run(self._next_round())
        await self.broadcast_state()

    async def _next_round(self) -> None:
        try:
            await asyncio.sleep(RESULT_PAUSE)
        except asyncio.CancelledError:
            return
        self._task = None
        await self._start_round()

    # ---- 나감·끝 ----

    async def remove_player(self, player: Player) -> None:
        """나간 사람 자리는 AI가 이어서 둔다. 사람이 아무도 없으면 끝."""
        seat = self.seat_of(player)
        if self.finished or seat is None:
            return
        seat.player = Bot(len(self.seats) + self.seats.index(seat), f"{player.name}(AI)")
        if not any(not s.is_bot for s in self.seats):
            await self.finish()
            return
        await self.room.system(f"{player.name}님 자리는 AI가 이어서 해요.")
        if self.turn is not None and self.seats[self.turn] is seat and self.phase in ("play", "gostop"):
            self._run(self._auto(self.turn, AI_DELAY))
        await self.broadcast_state()

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self.turn = None
        self._cancel()
        order = sorted(self.seats, key=lambda s: -s.chips)
        self.winner = order[0].player
        self.room.record_result(None if getattr(self.winner, "is_bot", False) else self.winner)
        await self.broadcast_state()
        await self.room.broadcast({
            "type": "game_over",
            "winner": self.winner.public(),
            "ranking": [{**s.player.public(), "score": s.chips} for s in order],
            "rounds": self.round_no,
        })
        await self.room.end_game(self)
