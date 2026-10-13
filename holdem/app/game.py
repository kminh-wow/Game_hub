"""홀덤 한 게임(토너먼트): 모두 같은 칩으로 시작해 마지막 1명이 남을 때까지 판을 이어 간다.

한 판: 블라인드 → 개인 카드 2장 → 프리플랍 → 플랍 → 턴 → 리버 → 쇼다운.
노리밋. 섞기·판정은 모두 서버에서 하고, 개인 카드는 본인에게만 보낸다(쇼다운 때 공개).
"""
from __future__ import annotations

import asyncio
import random
import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .rules import best_hand, current_name, hand_name, new_deck, sort_five, split_pots

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

# 블라인드 단계 (시작 칩 1000 기준, 시작 칩에 비례해 늘림)
BLIND_LEVELS = [(10, 20), (15, 30), (25, 50), (50, 100), (75, 150), (100, 200), (150, 300), (200, 400),
                (300, 600), (400, 800), (500, 1000), (750, 1500), (1000, 2000), (1500, 3000), (2000, 4000),
                (3000, 6000), (5000, 10000)]
STREET_DELAY = 0.9        # 베팅이 끝나고 다음 카드까지(초)
RUNOUT_DELAY = 1.4        # 모두 올인일 때 카드 한 장씩 펼치는 간격
SHOWDOWN_PAUSE = 5.0      # 쇼다운 결과 보여 주는 시간
FOLD_WIN_PAUSE = 2.5      # 다 폴드해서 끝났을 때
AWAY_TIME = 4             # 자리 비움이면 이 시간 뒤 자동 체크·폴드
STREETS = ["preflop", "flop", "turn", "river"]
STREET_NAMES = {"preflop": "프리플랍", "flop": "플랍", "turn": "턴", "river": "리버", "showdown": "쇼다운"}


@dataclass(eq=False)
class Seat:
    player: Any
    chips: int
    cards: list[str] = field(default_factory=list)
    bet: int = 0              # 이번 베팅 라운드에 낸 칩
    total: int = 0            # 이번 판에 낸 칩
    folded: bool = False
    allin: bool = False
    acted: bool = False       # 이번 라운드에 행동했는지 (레이즈가 나오면 다시 False)
    can_raise: bool = True    # 모자란 올인 레이즈 뒤에는 이미 행동한 사람은 콜·폴드만
    out: bool = False         # 칩이 떨어져 탈락
    shown: bool = False       # 쇼다운에서 카드 공개
    away: bool = False        # 시간 초과로 자리 비움 (짧은 시간 뒤 자동 진행)
    last: str = ""            # 마지막 행동 표시 ("콜 40" 등)
    stack0: int = 0           # 판 시작 때 칩 (같은 판 탈락 순서)

    @property
    def id(self) -> str:
        return self.player.id

    @property
    def in_hand(self) -> bool:
        return not self.out and not self.folded and bool(self.cards)

    @property
    def can_act(self) -> bool:
        return self.in_hand and not self.allin


class Game:
    def __init__(self, room: Room, rng: random.Random | None = None):
        self.room = room
        self.settings = room.settings.copy()
        self.rng = rng or secrets.SystemRandom()
        players = list(room.players)
        self.rng.shuffle(players)
        self.seats = [Seat(p, self.settings.start_chips) for p in players]
        self.scale = max(1, self.settings.start_chips // 1000)
        self.hand_no = 0
        self.dealer = -1
        self.sb_i = self.bb_i = -1
        self.deck: list[str] = []
        self.board: list[str] = []
        self.street = "preflop"
        self.current_bet = 0
        self.min_raise = 0
        self.turn: int | None = None
        self.deadline = 0.0
        self.results: list[dict[str, Any]] = []   # 이번 판 쇼다운·획득 결과
        self.busted: list[Any] = []              # 탈락 순서 (먼저 떨어진 사람이 앞)
        self.finished = False
        self.winner: Any = None
        self._task: asyncio.Task | None = None

    # ---- 조회 ----

    def blinds(self, hand_no: int | None = None) -> tuple[int, int]:
        level = min(len(BLIND_LEVELS) - 1, max(0, (hand_no or self.hand_no) - 1) // self.settings.blind_every)
        sb, bb = BLIND_LEVELS[level]
        return sb * self.scale, bb * self.scale

    @property
    def level(self) -> int:
        return min(len(BLIND_LEVELS) - 1, max(0, self.hand_no - 1) // self.settings.blind_every) + 1

    @property
    def pot(self) -> int:
        return sum(s.total for s in self.seats)

    def seat_of(self, player: Any) -> Seat | None:
        return next((s for s in self.seats if s.player is player), None)

    def _next(self, i: int, pred) -> int | None:
        n = len(self.seats)
        for k in range(1, n + 1):
            j = (i + k) % n
            if pred(self.seats[j]):
                return j
        return None

    # 내가 할 수 있는 것 (차례일 때만)
    def options(self, seat: Seat) -> dict[str, Any] | None:
        if self.finished or self.turn is None or self.seats[self.turn] is not seat:
            return None
        to_call = min(self.current_bet - seat.bet, seat.chips)
        stack = seat.bet + seat.chips
        others = [s.bet + s.chips for s in self.seats if s is not seat and s.can_act]
        can_raise = seat.can_raise and stack > self.current_bet and bool(others)
        min_to = min(stack, self.current_bet + self.min_raise)
        return {
            "to_call": to_call,
            "can_check": to_call == 0,
            "can_raise": can_raise,
            "min_to": min_to,
            "max_to": stack,
            "bet_word": "벳" if self.current_bet == 0 else "레이즈",
        }

    def state(self, viewer: Any = None) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        sb, bb = self.blinds()
        next_sb, next_bb = self.blinds(self.hand_no + 1)
        seats = []
        for i, s in enumerate(self.seats):
            mine = viewer is not None and s.player is viewer
            seats.append({
                "id": s.id, "name": s.player.name, "chips": s.chips, "bet": s.bet, "total": s.total,
                "folded": s.folded, "allin": s.allin, "out": s.out, "away": s.away, "last": s.last,
                "has_cards": s.in_hand or (bool(s.cards) and s.shown),
                "cards": s.cards if (mine or s.shown) and s.cards else None,
                "dealer": i == self.dealer, "sb": i == self.sb_i, "bb": i == self.bb_i,
            })
        me = self.seat_of(viewer) if viewer is not None else None
        mine = None
        if me and me.cards and not me.out:
            mine = {"hand": current_name(me.cards + self.board), "options": self.options(me)}
        return {
            "seats": seats,
            "board": self.board,
            "pot": self.pot,
            "street": self.street,
            "street_name": STREET_NAMES.get(self.street, ""),
            "current_bet": self.current_bet,
            "turn_id": self.seats[self.turn].id if self.turn is not None and not self.finished else None,
            "hand_no": self.hand_no,
            "blinds": [sb, bb],
            "level": self.level,
            "next_blinds": [next_sb, next_bb] if (next_sb, next_bb) != (sb, bb) else None,
            "hands_to_next": self.settings.blind_every - (self.hand_no - 1) % self.settings.blind_every,
            "time_left_ms": 0 if self.turn is None else max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": self._turn_seconds() * 1000 if self.turn is not None else 0,
            "results": self.results,
            "me": mine,
            "finished": self.finished,
            "winner_id": self.winner.id if self.winner else None,
        }

    async def broadcast_state(self) -> None:
        await asyncio.gather(*(p.send({"type": "game", "game": self.state(p)}) for p in self.room.audience))

    # 관전자 입장 시 현재 상태 (개인 카드는 안 보임)
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(player)}]

    # ---- 진행 ----

    async def start(self) -> None:
        await self.room.system(f"홀덤 시작! 시작 칩 {self.settings.start_chips:,} · 블라인드 {self.settings.blind_every}판마다 올라요.")
        await self._start_hand()

    def _run(self, coro) -> None:
        self._cancel()
        self._task = asyncio.create_task(coro)

    def _cancel(self) -> None:
        if self._task and self._task is not asyncio.current_task():
            self._task.cancel()
        self._task = None

    # 새 판 (딜러 이동, 블라인드, 카드 2장씩)
    async def _start_hand(self) -> None:
        alive = [s for s in self.seats if not s.out]
        if len(alive) <= 1:
            await self.finish(alive[0].player if alive else None)
            return
        self.hand_no += 1
        sb, bb = self.blinds()
        if self.hand_no > 1 and (self.hand_no - 1) % self.settings.blind_every == 0:
            await self.room.system(f"블라인드가 올랐어요: {sb:,} / {bb:,}")
        self.deck = new_deck()
        self.rng.shuffle(self.deck)
        self.board = []
        self.results = []
        self.street = "preflop"
        for s in self.seats:
            s.cards, s.bet, s.total = [], 0, 0
            s.folded = s.allin = s.acted = s.shown = False
            s.can_raise = True
            s.last = ""
            s.stack0 = s.chips
        alive_i = lambda s: not s.out
        self.dealer = self._next(self.dealer, alive_i)
        if len(alive) == 2:                       # 둘이면 딜러가 스몰 블라인드
            self.sb_i = self.dealer
        else:
            self.sb_i = self._next(self.dealer, alive_i)
        self.bb_i = self._next(self.sb_i, alive_i)
        for s in self.seats:
            if not s.out:
                s.cards = [self.deck.pop(), self.deck.pop()]
        self._put(self.seats[self.sb_i], sb)
        self.seats[self.sb_i].last = f"SB {self.seats[self.sb_i].bet:,}"
        self._put(self.seats[self.bb_i], bb)
        self.seats[self.bb_i].last = f"BB {self.seats[self.bb_i].bet:,}"
        self.current_bet = bb
        self.min_raise = bb
        await self._advance(self.bb_i)

    # 칩 내기 (가진 것보다 많으면 올인)
    def _put(self, seat: Seat, amount: int) -> int:
        amount = max(0, min(amount, seat.chips))
        seat.chips -= amount
        seat.bet += amount
        seat.total += amount
        if seat.chips == 0:
            seat.allin = True
        return amount

    # 다음 차례 정하기 (라운드가 끝났으면 다음 카드·쇼다운)
    async def _advance(self, after: int) -> None:
        live = [s for s in self.seats if s.in_hand]
        if len(live) == 1:
            await self._fold_win(live[0])
            return
        nxt = self._next(after, lambda s: s.can_act and (not s.acted or s.bet < self.current_bet))
        if nxt is not None and not (len([s for s in live if s.can_act]) == 1 and self.seats[nxt].bet >= self.current_bet):
            await self._start_turn(nxt)
            return
        self.turn = None
        self._run(self._end_round())

    def _turn_seconds(self) -> int:
        if self.turn is not None and self.seats[self.turn].away:
            return AWAY_TIME
        return self.settings.turn_time

    async def _start_turn(self, i: int) -> None:
        self.turn = i
        self.deadline = asyncio.get_running_loop().time() + self._turn_seconds()
        self._run(self._turn_timer(i))
        await self.broadcast_state()

    async def _turn_timer(self, i: int) -> None:
        try:
            await asyncio.sleep(self._turn_seconds())
        except asyncio.CancelledError:
            return
        seat = self.seats[i]
        if self.turn != i:
            return
        if not seat.away:
            seat.away = True
            await self.room.system(f"{seat.player.name}님 시간 초과 · 자리 비움 (아무 행동이나 하면 돌아와요)")
        await self._apply(seat, "check" if self.current_bet <= seat.bet else "fold", 0)

    # 베팅 라운드 끝 → 칩 모으고 다음 카드 (모두 올인이면 끝까지 펼침)
    async def _end_round(self) -> None:
        try:
            await self.broadcast_state()
            await asyncio.sleep(STREET_DELAY)
            while True:
                for s in self.seats:
                    s.bet, s.acted, s.can_raise = 0, False, True
                    if s.in_hand and not s.allin:
                        s.last = ""
                self.current_bet = 0
                self.min_raise = self.blinds()[1]
                if self.street == "river":
                    await self._showdown()
                    return
                self.street = STREETS[STREETS.index(self.street) + 1]
                self.deck.pop()                                    # 한 장 버리기
                for _ in range(3 if self.street == "flop" else 1):
                    self.board.append(self.deck.pop())
                if sum(1 for s in self.seats if s.can_act) >= 2:
                    first = self._next(self.dealer, lambda s: s.can_act)
                    self._task = None
                    await self._start_turn(first)
                    return
                await self.broadcast_state()                       # 더 베팅할 사람이 없으면 다음 카드로
                await asyncio.sleep(RUNOUT_DELAY)
        except asyncio.CancelledError:
            return

    async def act(self, player: Player, action: Any, amount: Any) -> str | None:
        seat = self.seat_of(player)
        if self.finished or seat is None or self.turn is None or self.seats[self.turn] is not seat:
            return "지금은 내 차례가 아니에요."
        if action not in ("fold", "check", "call", "raise", "allin"):
            return "알 수 없는 행동이에요."
        try:
            amount = int(amount or 0)
        except (TypeError, ValueError):
            return "금액이 잘못됐어요."
        seat.away = False
        return await self._apply(seat, action, amount)

    # 행동 처리 (사람·시간 초과 공통)
    async def _apply(self, seat: Seat, action: str, amount: int) -> str | None:
        opts = self.options(seat)
        if opts is None:
            return "지금은 내 차례가 아니에요."
        to_call = self.current_bet - seat.bet
        if action == "check" and to_call > 0:
            return "콜하거나 폴드해야 해요."
        if action == "call" and to_call <= 0:
            action = "check"
        if action == "raise" and amount >= opts["max_to"]:
            action = "allin"
        if action in ("raise", "allin") and not opts["can_raise"]:
            if action == "raise":
                return "지금은 레이즈할 수 없어요."
            action = "call" if to_call > 0 else "check"
        if action == "raise" and amount < opts["min_to"]:
            return f"최소 {opts['min_to']:,}까지 올려야 해요."

        self._cancel()
        if action == "fold":
            seat.folded = True
            seat.last = "폴드"
        elif action == "check":
            seat.last = "체크"
        elif action == "call":
            paid = self._put(seat, to_call)
            seat.last = "올인" if seat.allin else f"콜 {paid:,}"
        else:
            target = opts["max_to"] if action == "allin" else amount
            word = opts["bet_word"]
            self._put(seat, target - seat.bet)
            if seat.bet > self.current_bet:
                raised = seat.bet - self.current_bet
                full = raised >= self.min_raise
                for s in self.seats:
                    if s is not seat and s.can_act:
                        if not full and s.acted:
                            s.can_raise = False
                        s.acted = False
                if full:
                    self.min_raise = raised
                self.current_bet = seat.bet
            seat.last = "올인" if seat.allin else f"{word} {seat.bet:,}"
        seat.acted = True
        await self._advance(self.seats.index(seat))
        return None

    # 혼자 남음 (나머지 폴드)
    async def _fold_win(self, seat: Seat) -> None:
        self.turn = None
        won = self.pot
        seat.chips += won
        self.results = [{"id": seat.id, "name": seat.player.name, "amount": won, "hand": None}]
        await self.room.system(f"{seat.player.name}님이 {won:,} 칩을 가져갔어요.")
        self._clear_bets()
        self._run(self._after_hand(FOLD_WIN_PAUSE))
        await self.broadcast_state()

    # 나눠 준 뒤 판의 칩 정리
    def _clear_bets(self) -> None:
        for s in self.seats:
            s.bet = s.total = 0
        self.current_bet = 0

    # 쇼다운: 남은 사람 카드 공개, 팟마다 가장 좋은 패가 가져감
    async def _showdown(self) -> None:
        self.street = "showdown"
        live = [s for s in self.seats if s.in_hand]
        values = {}
        for s in live:
            s.shown = True
            values[s.id] = best_hand(s.cards + self.board)
        committed = {s.id: s.total for s in self.seats if s.total}
        won: dict[str, int] = {}
        for size, eligible in split_pots(committed, {s.id for s in live}):
            top = max(values[k][0] for k in eligible)
            winners = [k for k in eligible if values[k][0] == top]
            share, odd = divmod(size, len(winners))
            order = [self.seats[(self.dealer + k) % len(self.seats)].id for k in range(1, len(self.seats) + 1)]
            winners.sort(key=order.index)
            for n, k in enumerate(winners):
                won[k] = won.get(k, 0) + share + (1 if n < odd else 0)
        self.results = []
        for s in live:
            value, five = values[s.id]
            amount = won.get(s.id, 0)
            s.chips += amount
            s.last = hand_name(value)
            self.results.append({"id": s.id, "name": s.player.name, "amount": amount, "hand": hand_name(value), "best": sort_five(five)})
        self.results.sort(key=lambda r: -r["amount"])
        for r in self.results:
            if r["amount"]:
                await self.room.system(f"{r['name']}님이 {r['hand']}(으)로 {r['amount']:,} 칩을 가져갔어요.")
        self._clear_bets()
        self._run(self._after_hand(SHOWDOWN_PAUSE))
        await self.broadcast_state()

    # 판 끝: 칩 없는 사람 탈락, 다음 판
    async def _after_hand(self, pause: float) -> None:
        try:
            await asyncio.sleep(pause)
        except asyncio.CancelledError:
            return
        broke = [s for s in self.seats if not s.out and s.chips == 0]
        broke.sort(key=lambda s: s.stack0)             # 같은 판에 떨어지면 작은 스택이 먼저
        for s in broke:
            s.out = True
            s.cards = []
            self.busted.append(s.player)
            await self.room.system(f"{s.player.name}님 탈락 ({self._place_of(s)}위)")
        self._task = None
        await self._start_hand()

    def _place_of(self, seat: Seat) -> int:
        return sum(1 for s in self.seats if not s.out) + 1

    # ---- 나감·끝 ----

    async def remove_player(self, player: Player) -> None:
        seat = self.seat_of(player)
        if self.finished or seat is None or seat.out:
            return
        was_turn = self.turn is not None and self.seats[self.turn] is seat
        seat.folded = True
        seat.out = True
        seat.chips = 0
        seat.last = "나감"
        self.busted.append(player)
        alive = [s for s in self.seats if not s.out]
        if len(alive) <= 1:
            await self.finish(alive[0].player if alive else None)
            return
        if was_turn:
            self._cancel()
            await self._advance(self.seats.index(seat))
        elif self.turn is not None and len([s for s in self.seats if s.in_hand]) == 1:
            self._cancel()
            await self._advance(self.turn)
        else:
            await self.broadcast_state()

    async def finish(self, winner: Any = None) -> None:
        if self.finished:
            return
        self.finished = True
        self.turn = None
        self._cancel()
        self.winner = winner
        if winner is not None:
            seat = self.seat_of(winner)
            if seat:
                seat.chips += self.pot                 # 판 도중에 끝나면 걸린 칩은 남은 사람에게
                self._clear_bets()
        order = ([winner] if winner else []) + list(reversed(self.busted))
        self.room.record_result(winner)
        await self.broadcast_state()
        await self.room.broadcast({
            "type": "game_over",
            "winner": winner.public() if winner else None,
            "ranking": [p.public() for p in order],
            "hands": self.hand_no,
        })
        await self.room.end_game(self)
