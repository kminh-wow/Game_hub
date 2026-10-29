"""섯다 한 게임: 모두 같은 칩으로 시작해 판을 이어 간다. 칩이 떨어지면 탈락.
마지막 1명이 남거나, 정한 판 수가 끝나면 칩이 많은 순으로 순위.

한 판(세 장 섯다): 모두 판돈(앤티) → 두 장씩 → 첫 베팅(다이·체크·삥·콜·하프·따당·올인)
→ 한 장 더 → 세 장 중 두 장 고르기(동시에, 버린 한 장은 모두에게 공개) → 마지막 베팅 → 고른 두 장을 공개해서 승부.
구사·멍텅구리 구사 조건이면 남은 사람끼리 다시 받아서 한 번 더(재경기, 판돈은 그대로).
섞기·판정은 서버에서만 하고, 패는 본인에게만 보낸다(공개 때만 모두에게).
"""
from __future__ import annotations

import asyncio
import random
import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .rules import best_pair, evaluate, needs_redeal, new_deck, split_pots, winners

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

ANTE_STEPS = [1, 1.5, 2, 3, 4, 5, 7.5, 10, 15, 20, 30, 50, 75, 100]   # 기본 판돈의 배수 (판 수에 따라 오름)
DEAL_DELAY = 0.6          # 카드 나눠 주고 첫 차례까지(초)
SHOWDOWN_PAUSE = 7.0      # 패 공개 결과 보여 주는 시간
FOLD_WIN_PAUSE = 3.0      # 다 죽어서 끝났을 때
REDEAL_PAUSE = 4.0        # 재경기 알림을 보여 주는 시간
MAX_REDEALS = 3           # 재경기가 이어지면 이 횟수 뒤엔 그냥 나눔
AWAY_TIME = 4             # 자리 비움이면 이 시간 뒤 자동 체크·다이


@dataclass(eq=False)
class Seat:
    player: Any
    chips: int
    cards: list[str] = field(default_factory=list)
    pick: list[str] = field(default_factory=list)      # 세 장 중 고른 두 장
    bet: int = 0              # 이번 베팅에 낸 칩
    total: int = 0            # 이번 판에 낸 칩 (판돈 포함)
    folded: bool = False
    allin: bool = False
    acted: bool = False
    can_raise: bool = True
    out: bool = False
    shown: bool = False
    away: bool = False
    last: str = ""
    stack0: int = 0

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
        self.base_ante = max(1, self.settings.start_chips // 100)
        self.hand_no = 0
        self.dealer = -1
        self.deck: list[str] = []
        self.current_bet = 0
        self.min_raise = 0
        self.turn: int | None = None
        self.deadline = 0.0
        self.phase = "betting"                   # betting → choose → betting → showdown / redeal
        self.street = 1                          # 1: 두 장 베팅, 2: 세 장째 받고 마지막 베팅
        self.redeals = 0
        self.notice = ""                         # 화면에 크게 띄울 알림 (재경기 등)
        self.results: list[dict[str, Any]] = []
        self.busted: list[Any] = []
        self.finished = False
        self.winner: Any = None
        self._task: asyncio.Task | None = None

    # ---- 조회 ----

    def ante(self, hand_no: int | None = None) -> int:
        n = hand_no or self.hand_no
        step = min(len(ANTE_STEPS) - 1, max(0, n - 1) // self.settings.ante_every)
        return max(1, round(self.base_ante * ANTE_STEPS[step]))

    @property
    def pot(self) -> int:
        return sum(s.total for s in self.seats)

    # 승부에 쓸 두 장
    def hand_of(self, seat: Seat) -> list[str]:
        return seat.pick or best_pair(seat.cards)

    def seat_of(self, player: Any) -> Seat | None:
        return next((s for s in self.seats if s.player is player), None)

    def _next(self, i: int, pred) -> int | None:
        n = len(self.seats)
        for k in range(1, n + 1):
            j = (i + k) % n
            if pred(self.seats[j]):
                return j
        return None

    # 내가 할 수 있는 것과 각 행동의 금액 (차례일 때만). 금액은 "이번 베팅에 낸 총액"
    def options(self, seat: Seat) -> dict[str, Any] | None:
        if self.finished or self.turn is None or self.seats[self.turn] is not seat:
            return None
        to_call = min(self.current_bet - seat.bet, seat.chips)
        stack = seat.bet + seat.chips
        others = [s for s in self.seats if s is not seat and s.can_act]
        can_raise = seat.can_raise and stack > self.current_bet and bool(others)
        ante = self.ante()
        pot_after_call = self.pot + to_call

        def cap(to: int) -> int:
            return min(stack, max(to, self.current_bet + self.min_raise))

        return {
            "to_call": to_call,
            "call_allin": to_call > 0 and to_call >= seat.chips,
            "can_check": to_call == 0,
            "can_raise": can_raise,
            "bbing": cap(ante) if can_raise and self.current_bet == 0 else None,
            "half": cap(self.current_bet + max(ante, -(-pot_after_call // 2))) if can_raise else None,
            "ddadang": cap(self.current_bet * 2) if can_raise and self.current_bet > 0 else None,
            "max_to": stack,
        }

    def state(self, viewer: Any = None) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        seats = []
        for i, s in enumerate(self.seats):
            mine = viewer is not None and s.player is viewer
            seats.append({
                "id": s.id, "name": s.player.name, "chips": s.chips, "bet": s.bet, "total": s.total,
                "folded": s.folded, "allin": s.allin, "out": s.out, "away": s.away, "last": s.last,
                "has_cards": s.in_hand or (bool(s.cards) and s.shown),
                "cards": s.cards if (mine or s.shown) and s.cards else None,
                "n_cards": len(s.cards) if s.in_hand or s.shown else 0,
                "pick": s.pick if (mine or s.shown) and s.pick else None,
                "picked": bool(s.pick),
                "discard": next((c for c in s.cards if c not in s.pick), None) if s.pick and len(s.cards) == 3 and s.in_hand else None,
                "dealer": i == self.dealer,
            })
        me = self.seat_of(viewer) if viewer is not None else None
        mine = None
        if me and me.cards and not me.out:
            mine = {
                "hand": evaluate(self.hand_of(me))[1],
                "options": self.options(me),
                "choose": self.phase == "choose" and me.in_hand and not me.pick,
            }
        ante = self.ante()
        next_ante = self.ante(self.hand_no + 1)
        timed = self.turn is not None or self.phase == "choose"
        return {
            "seats": seats,
            "pot": self.pot,
            "phase": self.phase,
            "street": self.street,
            "redeals": self.redeals,
            "current_bet": self.current_bet,
            "turn_id": self.seats[self.turn].id if self.turn is not None and not self.finished else None,
            "hand_no": self.hand_no,
            "max_hands": self.settings.max_hands,
            "ante": ante,
            "next_ante": next_ante if next_ante != ante else None,
            "hands_to_next": self.settings.ante_every - (self.hand_no - 1) % self.settings.ante_every,
            "time_left_ms": max(int((self.deadline - loop.time()) * 1000), 0) if timed else 0,
            "time_total_ms": self._turn_seconds() * 1000 if timed else 0,
            "notice": self.notice,
            "results": self.results,
            "me": mine,
            "finished": self.finished,
            "winner_id": self.winner.id if self.winner else None,
        }

    async def broadcast_state(self) -> None:
        await asyncio.gather(*(p.send({"type": "game", "game": self.state(p)}) for p in self.room.audience))

    # 관전자 입장 시 현재 상태 (패는 안 보임)
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state(player)}]

    # ---- 진행 ----

    async def start(self) -> None:
        limit = f"{self.settings.max_hands}판" if self.settings.max_hands else "마지막 1명이 남을 때까지"
        await self.room.system(f"섯다 시작! 시작 칩 {self.settings.start_chips:,} · 판돈 {self.ante(1):,} ({self.settings.ante_every}판마다 올라요) · {limit}")
        await self._start_hand()

    def _run(self, coro) -> None:
        self._cancel()
        self._task = asyncio.create_task(coro)

    def _cancel(self) -> None:
        if self._task and self._task is not asyncio.current_task():
            self._task.cancel()
        self._task = None

    # 새 판: 선(딜러) 이동, 판돈, 두 장씩
    async def _start_hand(self) -> None:
        alive = [s for s in self.seats if not s.out]
        if len(alive) <= 1 or (self.settings.max_hands and self.hand_no >= self.settings.max_hands):
            await self.finish()
            return
        self.hand_no += 1
        ante = self.ante()
        if self.hand_no > 1 and (self.hand_no - 1) % self.settings.ante_every == 0:
            await self.room.system(f"판돈이 올랐어요: {ante:,}")
        self.results = []
        self.notice = ""
        self.redeals = 0
        for s in self.seats:
            s.cards, s.pick, s.bet, s.total = [], [], 0, 0
            s.folded = s.allin = s.acted = s.shown = False
            s.can_raise = True
            s.last = ""
            s.stack0 = s.chips
        self.dealer = self._next(self.dealer, lambda s: not s.out)
        for s in alive:
            self._put(s, ante)
            s.bet = 0                                  # 판돈은 팟에만 (베팅 금액과는 따로)
            s.last = f"판돈 {s.total:,}"
        await self._deal()

    # 카드 두 장씩 나누고 첫 베팅
    async def _deal(self) -> None:
        self.deck = new_deck()
        self.rng.shuffle(self.deck)
        self.street = 1
        for s in self.seats:
            s.shown = False
            s.pick = []
            if not s.out and not s.folded:
                s.cards = [self.deck.pop(), self.deck.pop()]
        await self._start_betting()

    # 베팅 한 바퀴 시작 (낸 판돈·베팅은 팟에 그대로)
    async def _start_betting(self) -> None:
        self.phase = "betting"
        for s in self.seats:
            s.bet, s.acted, s.can_raise = 0, False, True
        self.current_bet = 0
        self.min_raise = self.ante()
        if sum(1 for s in self.seats if s.can_act) >= 2:
            first = self._next(self.dealer, lambda s: s.can_act)
            await self._start_turn(first)
        else:
            self.turn = None
            self._run(self._end_round())

    def _put(self, seat: Seat, amount: int) -> int:
        amount = max(0, min(amount, seat.chips))
        seat.chips -= amount
        seat.bet += amount
        seat.total += amount
        if seat.chips == 0:
            seat.allin = True
        return amount

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
        await self._apply(seat, "check" if self.current_bet <= seat.bet else "die")

    # 베팅이 끝나면 잠깐 보여 주고, 첫 베팅이면 세 장째, 마지막이면 공개
    async def _end_round(self) -> None:
        try:
            await self.broadcast_state()
            await asyncio.sleep(DEAL_DELAY)
            self._task = None
            if self.street == 1:
                await self._third_card()
            else:
                await self._showdown()
        except asyncio.CancelledError:
            return

    # 세 장째 나누고 두 장 고르기 (자리 비움이면 바로 가장 센 두 장)
    async def _third_card(self) -> None:
        self.street = 2
        self.phase = "choose"
        for s in self.seats:
            if s.in_hand:
                s.cards.append(self.deck.pop())
                s.pick = best_pair(s.cards) if s.away else []
                if not s.allin:
                    s.last = ""
        if all(s.pick for s in self.seats if s.in_hand):
            await self._start_betting()
            return
        self.deadline = asyncio.get_running_loop().time() + self.settings.turn_time
        self._run(self._choose_timer())
        await self.broadcast_state()

    async def _choose_timer(self) -> None:
        try:
            await asyncio.sleep(self.settings.turn_time)
        except asyncio.CancelledError:
            return
        self._task = None
        for s in self.seats:
            if s.in_hand and not s.pick:
                s.pick = best_pair(s.cards)
                s.away = True
                await self.room.system(f"{s.player.name}님 시간 초과 · 가장 센 두 장으로 골랐어요")
        await self._start_betting()

    # 세 장 중 두 장 고르기
    async def choose(self, player: Player, cards: Any) -> str | None:
        seat = self.seat_of(player)
        if self.finished or self.phase != "choose" or seat is None or not seat.in_hand:
            return "지금은 고를 때가 아니에요."
        if seat.pick:
            return "이미 골랐어요."
        ok = isinstance(cards, list) and len(cards) == 2 and all(isinstance(c, str) and c in seat.cards for c in cards)
        if not ok or cards[0] == cards[1]:
            return "카드 두 장을 골라 주세요."
        seat.pick = [c for c in seat.cards if c in cards]
        seat.away = False
        if all(s.pick for s in self.seats if s.in_hand):
            self._cancel()
            await self._start_betting()
        else:
            await self.broadcast_state()
        return None

    async def act(self, player: Player, action: Any) -> str | None:
        seat = self.seat_of(player)
        if self.finished or seat is None or self.turn is None or self.seats[self.turn] is not seat:
            return "지금은 내 차례가 아니에요."
        if action not in ("die", "check", "call", "bbing", "half", "ddadang", "allin"):
            return "알 수 없는 행동이에요."
        seat.away = False
        return await self._apply(seat, action)

    # 행동 처리 (사람·시간 초과 공통)
    async def _apply(self, seat: Seat, action: str) -> str | None:
        opts = self.options(seat)
        if opts is None:
            return "지금은 내 차례가 아니에요."
        to_call = self.current_bet - seat.bet
        if action == "check" and to_call > 0:
            return "콜하거나 다이해야 해요."
        if action == "call" and to_call <= 0:
            action = "check"
        target = None
        if action in ("bbing", "half", "ddadang"):
            target = opts[action]
            if target is None:
                return "지금은 그렇게 할 수 없어요."
        elif action == "allin":
            if not opts["can_raise"]:
                action = "call" if to_call > 0 else "check"
            else:
                target = opts["max_to"]

        self._cancel()
        words = {"bbing": "삥", "half": "하프", "ddadang": "따당", "allin": "올인"}
        if action == "die":
            seat.folded = True
            seat.last = "다이"
        elif action == "check":
            seat.last = "체크"
        elif action == "call":
            paid = self._put(seat, to_call)
            seat.last = "올인" if seat.allin else f"콜 {paid:,}"
        else:
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
            seat.last = "올인" if seat.allin else f"{words[action]} {seat.bet:,}"
        seat.acted = True
        await self._advance(self.seats.index(seat))
        return None

    # 혼자 남음 (나머지 다이)
    async def _fold_win(self, seat: Seat) -> None:
        self.turn = None
        self.phase = "showdown"
        won = self.pot
        seat.chips += won
        self.results = [{"id": seat.id, "name": seat.player.name, "amount": won, "hand": None, "fold": True}]
        await self.room.system(f"[{self.hand_no}번째 판] 다른 사람이 모두 다이해서 {seat.player.name}님이 {won:,} 칩을 가져갔어요.")
        self._clear_bets()
        self._run(self._after_hand(FOLD_WIN_PAUSE))
        await self.broadcast_state()

    def _clear_bets(self) -> None:
        for s in self.seats:
            s.bet = s.total = 0
        self.current_bet = 0

    # 공개: 재경기인지 보고, 아니면 팟마다 가장 센 패가 가져감
    async def _showdown(self) -> None:
        live = [s for s in self.seats if s.in_hand]
        hands = {s.id: self.hand_of(s) for s in live}
        for s in live:
            s.shown = True
            s.pick = hands[s.id]
            s.last = evaluate(s.pick)[1]
        why = needs_redeal(hands)
        if why and self.redeals < MAX_REDEALS:
            self.redeals += 1
            self.phase = "redeal"
            self.notice = f"{why}! 재경기 — 남은 사람끼리 다시 받아요 (판돈 {self.pot:,} 그대로)"
            await self.room.system(f"[{self.hand_no}번째 판] {why}(이)라 재경기해요.")
            self._run(self._redeal())
            await self.broadcast_state()
            return
        self.phase = "showdown"
        self.notice = ""
        committed = {s.id: s.total for s in self.seats if s.total}
        won: dict[str, int] = {}
        order = [self.seats[(self.dealer + k) % len(self.seats)].id for k in range(1, len(self.seats) + 1)]
        for size, eligible in split_pots(committed, {s.id for s in live}):
            best = winners({k: hands[k] for k in eligible})
            best.sort(key=order.index)
            share, odd = divmod(size, len(best))
            for n, k in enumerate(best):
                won[k] = won.get(k, 0) + share + (1 if n < odd else 0)
        self.results = []
        for s in live:
            amount = won.get(s.id, 0)
            s.chips += amount
            self.results.append({"id": s.id, "name": s.player.name, "amount": amount, "hand": evaluate(s.pick)[1], "cards": list(s.pick), "all": list(s.cards)})
        self.results.sort(key=lambda r: -r["amount"])
        for r in self.results:
            if r["amount"]:
                await self.room.system(f"[{self.hand_no}번째 판] {r['name']}님이 {r['hand']}(으)로 {r['amount']:,} 칩을 가져갔어요.")
        self._clear_bets()
        self._run(self._after_hand(SHOWDOWN_PAUSE))
        await self.broadcast_state()

    # 재경기: 잠깐 보여 준 뒤 남은 사람에게 다시 두 장부터
    async def _redeal(self) -> None:
        try:
            await asyncio.sleep(REDEAL_PAUSE)
        except asyncio.CancelledError:
            return
        self._task = None
        self.notice = ""
        await self._deal()

    async def _after_hand(self, pause: float) -> None:
        try:
            await asyncio.sleep(pause)
        except asyncio.CancelledError:
            return
        broke = [s for s in self.seats if not s.out and s.chips == 0]
        broke.sort(key=lambda s: s.stack0)
        for s in broke:
            s.out = True
            s.cards = []
            self.busted.append(s.player)
            await self.room.system(f"{s.player.name}님 탈락 ({sum(1 for t in self.seats if not t.out) + 1}위)")
        self._task = None
        await self._start_hand()

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
            await self.finish()
            return
        if self.phase == "choose":
            live = [s for s in self.seats if s.in_hand]
            if len(live) == 1:
                self._cancel()
                await self._fold_win(live[0])
            elif all(s.pick for s in live):
                self._cancel()
                await self._start_betting()
            else:
                await self.broadcast_state()
            return
        if was_turn:
            self._cancel()
            await self._advance(self.seats.index(seat))
        elif self.turn is not None and len([s for s in self.seats if s.in_hand]) == 1:
            self._cancel()
            await self._advance(self.turn)
        else:
            await self.broadcast_state()

    # 끝: 남은 사람은 칩 순, 탈락한 사람은 늦게 떨어진 순
    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self.turn = None
        self._cancel()
        alive = [s for s in self.seats if not s.out]
        if self.pot and alive:                         # 판 도중에 끝나면 걸린 칩은 낸 만큼 돌려줌
            for s in self.seats:
                if not s.out:
                    s.chips += s.total
            self._clear_bets()
        alive.sort(key=lambda s: -s.chips)
        self.winner = alive[0].player if alive else None
        ranking = [{**s.player.public(), "score": s.chips} for s in alive] + [p.public() for p in reversed(self.busted)]
        self.room.record_result(self.winner)
        await self.broadcast_state()
        await self.room.broadcast({
            "type": "game_over",
            "winner": self.winner.public() if self.winner else None,
            "ranking": ranking,
            "hands": self.hand_no,
        })
        await self.room.end_game(self)
