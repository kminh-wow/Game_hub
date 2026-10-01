"""행맨 한 판: 방에 들어온 순서대로 돌아가며 출제하고, 나머지가 차례대로 추측한다.

추측하는 사람마다 교수대가 따로 있다. 틀리면 자기 교수대에만 한 획이 그려지고,
교수대가 완성되면 그 라운드에서 탈락(차례에서 빠짐)한다.

라운드 진행:  setting(출제) → guessing(추측) → break(정답 공개) → 다음 라운드
"""
from __future__ import annotations

import asyncio
import random
from typing import TYPE_CHECKING, Any

from .words import MAX_LEN, MIN_LEN, WORD_RE, normalize

if TYPE_CHECKING:
    from common.multiplayer import Player
    from .room import Room

SET_TIME = 60          # 출제 제한 시간(초). 넘기면 쉬운 단어를 자동 출제
ROUND_BREAK = 4.0      # 정답 공개 후 다음 라운드까지(초)
CANCEL_BREAK = 2.0     # 출제자가 나가서 라운드를 취소했을 때
LETTER_SCORE = 10      # 맞힌 글자 1개당
SOLVE_BONUS = 30       # 단어를 통째로 맞히면 (남은 빈칸 × LETTER_SCORE) + 보너스
HANG_PENALTY = 20      # 내 교수대가 완성되면(탈락) 깎이는 점수
HANG_BONUS = 20        # 교수대가 완성된 사람 1명당 출제자가 받는 점수
MAX_HINT = 40


class Game:
    def __init__(self, room: Room):
        self.room = room
        self.words = room.words
        self.settings = room.settings.copy()
        self.order: list[Player] = list(room.players)   # 들어온 순서
        self.scores: dict[str, int] = {p.id: 0 for p in self.order}
        self.set_counts: dict[str, int] = {p.id: 0 for p in self.order}

        self.round = 0
        self.setter_idx = -1
        self.guesser_idx: int | None = None
        self.phase = "setting"
        self._reset_round()

        self.events: list[dict[str, Any]] = []   # 다음 상태 전송 때 함께 보낼 알림
        self.finished = False
        self._timer: asyncio.Task | None = None
        self.deadline = 0.0
        self.timer_total = 0.0

    def _reset_round(self) -> None:
        self.word = ""
        self.hint = ""
        self.hint_shown = False
        self.hint_letter: str | None = None
        self.revealed: set[str] = set()
        self.wrong_letters: list[str] = []
        self.wrong_words: list[str] = []
        self.strikes: dict[str, int] = {}   # 추측자별 틀린 횟수
        self.hanged: list[str] = []         # 교수대가 완성돼 탈락한 추측자 (탈락 순서)
        self.setter_gain = 0
        self.misses = 0   # 틀린 추측 횟수 (힌트 공개 기준)
        self.solver: Player | None = None

    # ---- 조회 ----

    @property
    def setter(self) -> Player:
        return self.order[self.setter_idx]

    @property
    def guesser(self) -> Player | None:
        return self.order[self.guesser_idx] if self.guesser_idx is not None else None

    @property
    def total_rounds(self) -> int:
        remaining = sum(self.settings.cycles - self.set_counts[p.id] for p in self.order)
        return self.round + max(remaining, 0)

    def _alive(self, i: int) -> bool:
        return i != self.setter_idx and self.order[i].id not in self.hanged

    def alive_guessers(self) -> list[Player]:
        return [p for i, p in enumerate(self.order) if self._alive(i)]

    def solved(self) -> bool:
        return all(c in self.revealed for c in self.word)

    def pattern(self) -> list[str | None]:
        return [c if c in self.revealed else None for c in self.word]

    def state_for(self, player: Player) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        show_word = self.phase == "break" or player is self.setter
        return {
            "phase": self.phase,
            "round": self.round,
            "total_rounds": self.total_rounds,
            "order": [p.id for p in self.order],
            "setter_id": self.setter.id,
            "guesser_id": self.guesser.id if self.phase == "guessing" and self.guesser else None,
            "word": self.word if show_word else None,
            "pattern": self.pattern() if self.word else [],
            "wrong_letters": self.wrong_letters,
            "wrong_words": self.wrong_words,
            "strikes": {p.id: self.strikes.get(p.id, 0) for p in self.order},
            "hanged": self.hanged,
            "lives": self.settings.lives,
            "hint": self.hint if (self.hint_shown or show_word) and self.hint else None,
            "hint_letter": self.hint_letter,
            "hint_in": 0 if self.hint_shown else max(self.settings.hint_turn - self.misses, 0),
            "solver_id": self.solver.id if self.solver else None,
            "scores": self.scores,
            "time_left_ms": max(int((self.deadline - loop.time()) * 1000), 0),
            "time_total_ms": int(self.timer_total * 1000),
        }

    async def broadcast_state(self) -> None:
        events, self.events = self.events, []
        await asyncio.gather(*(
            p.send({"type": "game", "game": self.state_for(p), "events": events})
            for p in self.room.audience
        ))

    # 관전자 입장 시 현재 상태 (관전자는 출제자가 아니므로 정답은 정답 공개 때만 보인다)
    def watch_messages(self, player: Player) -> list[dict[str, Any]]:
        return [{"type": "game", "game": self.state_for(player), "events": []}]

    # ---- 타이머 ----

    def _start_timer(self, seconds: float, callback) -> None:
        self._cancel_timer()
        self.deadline = asyncio.get_running_loop().time() + seconds
        self.timer_total = seconds
        self._timer = asyncio.create_task(self._run_timer(seconds, callback))

    async def _run_timer(self, seconds: float, callback) -> None:
        try:
            await asyncio.sleep(seconds)
        except asyncio.CancelledError:
            return
        self._timer = None
        await callback()

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    # ---- 라운드 ----

    async def start(self) -> None:
        await self._next_round()

    def _pick_setter(self) -> int | None:
        """직전 출제자 다음 사람부터, 아직 출제 횟수가 남은 사람을 고른다."""
        n = len(self.order)
        for k in range(1, n + 1):
            i = (self.setter_idx + k) % n
            if self.set_counts[self.order[i].id] < self.settings.cycles:
                return i
        return None

    async def _next_round(self) -> None:
        if self.finished:
            return
        idx = self._pick_setter() if len(self.order) >= 2 else None
        if idx is None:
            await self.finish()
            return
        self.round += 1
        self.setter_idx = idx
        self.set_counts[self.setter.id] += 1
        self.guesser_idx = None
        self.phase = "setting"
        self._reset_round()
        self.events.append({"kind": "round_start", "round": self.round, "setter_id": self.setter.id})
        self._start_timer(SET_TIME, self._on_set_timeout)
        await self.broadcast_state()

    async def _on_set_timeout(self) -> None:
        self.word = self.words.random_common()
        self.events.append({"kind": "auto_word", "setter_id": self.setter.id})
        await self._begin_guessing()

    async def set_word(self, player: Player, word: str, hint: str) -> str | None:
        if self.phase != "setting" or player is not self.setter:
            return "지금은 출제할 수 없어요."
        w = normalize(word)
        if not WORD_RE.fullmatch(w):
            return "영어 알파벳만 쓸 수 있어요."
        if not MIN_LEN <= len(w) <= MAX_LEN:
            return f"{MIN_LEN}~{MAX_LEN}글자 단어만 낼 수 있어요."
        if w not in self.words:
            return "사전에 없는 단어예요."
        self.word = w
        self.hint = hint.strip()[:MAX_HINT]
        self.events.append({"kind": "word_set", "setter_id": player.id, "length": len(w)})
        await self._begin_guessing()
        return None

    async def _begin_guessing(self) -> None:
        self.phase = "guessing"
        self.guesser_idx = self.setter_idx
        self._advance_guesser()
        await self._start_turn()

    def _advance_guesser(self) -> bool:
        """다음 추측자: 들어온 순서대로, 출제자와 탈락자는 건너뛴다. 남은 사람이 없으면 False."""
        n = len(self.order)
        i = self.guesser_idx if self.guesser_idx is not None else self.setter_idx
        for _ in range(n):
            i = (i + 1) % n
            if self._alive(i):
                self.guesser_idx = i
                return True
        return False

    async def _start_turn(self) -> None:
        # 힌트 공개 조건
        if not self.hint_shown and self.misses >= self.settings.hint_turn:
            self._reveal_hint()
        self._start_timer(self.settings.turn_time, self._on_turn_timeout)
        await self.broadcast_state()

    def _reveal_hint(self) -> None:
        """힌트를 공개한다. 출제자가 힌트를 안 적었으면 빈칸 하나를 열어 준다(마지막 빈칸은 제외)."""
        self.hint_shown = True
        if self.hint:
            self.events.append({"kind": "hint", "hint": self.hint})
            return
        hidden = sorted({c for c in self.word if c not in self.revealed})
        if len(hidden) >= 2:
            letter = random.choice(hidden)
            self.revealed.add(letter)
            self.hint_letter = letter
            self.events.append({"kind": "hint_letter", "letter": letter})

    async def _on_turn_timeout(self) -> None:
        self.events.append({"kind": "timeout", "player_id": self.guesser.id})
        await self._next_guesser()

    async def guess(self, player: Player, text: str) -> str | None:
        if self.phase != "guessing" or player is not self.guesser:
            return "지금은 내 차례가 아니에요."
        g = normalize(text)
        if not WORD_RE.fullmatch(g):
            return "영어 알파벳만 입력할 수 있어요."

        if len(g) == 1:
            if g in self.revealed or g in self.wrong_letters:
                return "이미 나온 글자예요."
            count = self.word.count(g)
            if count:
                self.revealed.add(g)
                gain = LETTER_SCORE * count
                self.scores[player.id] += gain
                self.events.append({"kind": "letter_ok", "player_id": player.id, "letter": g, "count": count, "gain": gain})
                if self.solved():
                    await self._end_round(solver=player)
                else:
                    await self._start_turn()   # 맞히면 같은 사람이 한 번 더
                return None
            self.wrong_letters.append(g)
            self.misses += 1
            self.events.append({"kind": "letter_fail", "player_id": player.id, "letter": g})
        else:
            if g in self.wrong_words:
                return "이미 틀린 단어예요."
            if g == self.word:
                blanks = sum(1 for c in self.word if c not in self.revealed)
                gain = blanks * LETTER_SCORE + SOLVE_BONUS
                self.scores[player.id] += gain
                self.revealed = set(self.word)
                self.events.append({"kind": "word_ok", "player_id": player.id, "word": g, "gain": gain})
                await self._end_round(solver=player)
                return None
            self.wrong_words.append(g)
            self.misses += 1
            self.events.append({"kind": "word_fail", "player_id": player.id, "word": g})

        self._strike(player)
        await self._next_guesser()
        return None

    def _strike(self, player: Player) -> None:
        """틀린 추측: 그 사람 교수대에만 한 획. 완성되면 탈락, 감점, 출제자 가점."""
        self.strikes[player.id] = self.strikes.get(player.id, 0) + 1
        self.events[-1]["strikes"] = self.strikes[player.id]
        if self.strikes[player.id] >= self.settings.lives:
            self.hanged.append(player.id)
            self.scores[player.id] -= HANG_PENALTY
            self.scores[self.setter.id] += HANG_BONUS
            self.setter_gain += HANG_BONUS
            self.events.append({
                "kind": "hanged",
                "player_id": player.id,
                "penalty": HANG_PENALTY,
                "setter_id": self.setter.id,
                "setter_gain": HANG_BONUS,
            })

    async def _next_guesser(self) -> None:
        if self._advance_guesser():
            await self._start_turn()
        else:
            await self._end_round(solver=None)   # 모두 탈락

    async def _end_round(self, solver: Player | None) -> None:
        self._cancel_timer()
        self.phase = "break"
        self.solver = solver
        self.events.append({
            "kind": "round_end",
            "word": self.word,
            "solver_id": solver.id if solver else None,
            "setter_id": self.setter.id,
            "setter_gain": self.setter_gain,
        })
        self._start_timer(ROUND_BREAK, self._next_round)
        await self.broadcast_state()

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self._cancel_timer()
        ranking = sorted(
            ({**p.public(), "score": self.scores[p.id]} for p in self.order),
            key=lambda r: r["score"],
            reverse=True,
        )
        await self.room.broadcast({"type": "game_over", "ranking": ranking})
        await self.room.end_game(self)

    # ---- 퇴장 ----

    async def remove_player(self, player: Player) -> None:
        if self.finished or player not in self.order:
            return
        idx = self.order.index(player)
        was_setter = idx == self.setter_idx
        was_guesser = self.phase == "guessing" and idx == self.guesser_idx
        self.order.remove(player)

        if len(self.order) < 2:
            await self.finish()
            return

        n = len(self.order)
        if idx < self.setter_idx:
            self.setter_idx -= 1
        if self.guesser_idx is not None and idx < self.guesser_idx:
            self.guesser_idx -= 1

        if was_setter and self.phase in ("setting", "guessing"):
            # 출제자가 나가면 그 라운드는 취소. 다음 출제자는 나간 사람 자리의 다음 사람.
            self.setter_idx = (idx - 1) % n
            self.guesser_idx = None
            self.phase = "break"
            self.word = ""
            self.events.append({"kind": "round_cancel", "player_id": player.id})
            self._start_timer(CANCEL_BREAK, self._next_round)
            await self.broadcast_state()
            return
        if was_setter:
            # 정답 공개 중에 나감: 다음 라운드는 그대로 진행
            self.setter_idx = (idx - 1) % n

        self.setter_idx %= n
        if was_guesser:
            self.guesser_idx = (idx - 1) % n
            await self._next_guesser()
            return
        if self.guesser_idx is not None:
            self.guesser_idx %= n
        if self.phase == "guessing" and not self.alive_guessers():
            await self._end_round(solver=None)
            return
        await self.broadcast_state()
