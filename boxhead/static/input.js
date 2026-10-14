// 박스헤드 입력: 키보드(WASD·방향키 8방향)와 폰 조이스틱·버튼을 하나의 값으로 모은다.
//   const input = createInput({ board, onPause });  input.read() → { dx, dy, fire, lock, weapon? }
// 대각선: W+A 같이 누르면 북서. Shift 를 누르고 있으면 걷지 않고 방향만 바꿈. 숫자 1~3, Q/E 로 무기 바꿈.

const MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const FIRE = new Set(["Space", "KeyJ", "KeyK"]);

export function createInput({ board, onPause = () => {}, weaponCount = 3 }) {
  const keys = new Set();
  let mouse = false;
  let weapon = undefined;
  let current = 0;                                // 지금 무기 (Q/E 로 돌릴 때 기준)
  const touch = { dx: 0, dy: 0, fire: false, lock: false };

  const typing = (e) => e.target.closest?.("input, textarea, select");
  window.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    if (MOVE[e.code] || FIRE.has(e.code) || e.code === "ShiftLeft" || e.code === "ShiftRight") e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= weaponCount) weapon = Number(e.code.slice(5)) - 1;
    if (e.code === "KeyQ") weapon = (current + weaponCount - 1) % weaponCount;
    if (e.code === "KeyE") weapon = (current + 1) % weaponCount;
    if (e.code === "Escape" || e.code === "KeyP") onPause();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => {
    keys.clear();
    mouse = false;
  });
  board.addEventListener("mousedown", (e) => {
    if (e.button === 0) mouse = true;
  });
  window.addEventListener("mouseup", () => (mouse = false));
  board.addEventListener("contextmenu", (e) => e.preventDefault());

  // 폰: 왼쪽 조이스틱(8방향으로 맞춤), 오른쪽 버튼
  const pad = document.querySelector("#pad");
  if (pad) {
    const knob = pad.querySelector("i");
    let id = null;
    const move = (e) => {
      const r = pad.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      const len = Math.hypot(x, y);
      const max = r.width / 2;
      const k = len > max ? max / len : 1;
      knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
      if (len < max * 0.28) {
        touch.dx = touch.dy = 0;
        return;
      }
      const a = Math.atan2(y, x);
      const i = (Math.round(a / (Math.PI / 4)) + 8) % 8;                    // 8방향으로 맞춤
      const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][i];
      [touch.dx, touch.dy] = D;
    };
    pad.addEventListener("pointerdown", (e) => {
      id = e.pointerId;
      pad.setPointerCapture(id);
      move(e);
    });
    pad.addEventListener("pointermove", (e) => e.pointerId === id && move(e));
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      touch.dx = touch.dy = 0;
      knob.style.transform = "";
    };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
  }
  const hold = (sel, key) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      touch[key] = true;
      el.classList.add("on");
    });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(ev, () => {
      touch[key] = false;
      el.classList.remove("on");
    });
  };
  hold("#t-fire", "fire");
  hold("#t-lock", "lock");
  document.querySelector("#t-weapon")?.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    weapon = (current + 1) % weaponCount;
  });

  return {
    // 지금 눌린 상태 (무기 바꾸기는 한 번만 전달)
    read() {
      let dx = touch.dx;
      let dy = touch.dy;
      for (const k of keys) {
        const m = MOVE[k];
        if (m) {
          dx += m[0];
          dy += m[1];
        }
      }
      const out = {
        dx: Math.sign(dx), dy: Math.sign(dy),
        fire: mouse || touch.fire || [...keys].some((k) => FIRE.has(k)),
        lock: touch.lock || keys.has("ShiftLeft") || keys.has("ShiftRight"),
      };
      if (weapon !== undefined) {
        out.weapon = weapon;
        weapon = undefined;
      }
      return out;
    },
    setCurrent(w) {
      current = w;
    },
    reset() {
      keys.clear();
      mouse = false;
      weapon = undefined;
    },
  };
}
