// 팩맨 규칙: 미로, 타일 단위 이동, 유령 목표 계산.
// 화면 그리기(game.js)와 분리해 두어서 `node --test` 로 검사할 수 있다.

// '#' 벽, '-' 유령 집 문, '.' 점, 'o' 파워 점, ' ' 빈 길
export const MAZE = [
  "############################",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#o####.#####.##.#####.####o#",
  "#.####.#####.##.#####.####.#",
  "#..........................#",
  "#.####.##.########.##.####.#",
  "#.####.##.########.##.####.#",
  "#......##....##....##......#",
  "######.##### ## #####.######",
  "     #.##### ## #####.#     ",
  "     #.##          ##.#     ",
  "     #.## ###--### ##.#     ",
  "######.## #      # ##.######",
  "      .   #      #   .      ",
  "######.## #      # ##.######",
  "     #.## ######## ##.#     ",
  "     #.##          ##.#     ",
  "     #.## ######## ##.#     ",
  "######.## ######## ##.######",
  "#............##............#",
  "#.####.#####.##.#####.####.#",
  "#.####.#####.##.#####.####.#",
  "#o..##.......  .......##..o#",
  "###.##.##.########.##.##.###",
  "###.##.##.########.##.##.###",
  "#......##....##....##......#",
  "#.##########.##.##########.#",
  "#.##########.##.##########.#",
  "#..........................#",
  "############################",
];

export const W = MAZE[0].length;
export const H = MAZE.length;
export const TUNNEL_ROW = 14;

export const PAC_START = { x: 13, y: 23 };
export const HOUSE_EXIT = { x: 13, y: 11 };   // 유령 집 문 바로 위
export const HOUSE_CENTER = { x: 13, y: 14 };

export const DIRS = {
  up: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};
// 갈림길에서 거리가 같으면 이 순서대로 고른다 (원작과 같은 우선순위).
export const DIR_ORDER = ["up", "left", "down", "right"];
export const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

export const SCATTER = {
  blinky: { x: 25, y: -3 },
  pinky: { x: 2, y: -3 },
  inky: { x: 27, y: 31 },
  clyde: { x: 0, y: 31 },
};

// 흩어지기/쫓기 모드 전환 시간(초). 마지막 쫓기는 끝이 없다.
export const MODE_SCHEDULE = [7, 20, 7, 20, 5, 20, 5, Infinity];

export function wrapX(x) {
  return ((x % W) + W) % W;
}

export function cellAt(x, y) {
  if (y < 0 || y >= H) return "#";
  return MAZE[y][wrapX(x)];
}

/** 지나갈 수 있는 칸인가. 유령 집 문은 door 옵션이 있을 때만 통과한다. */
export function isOpen(x, y, { door = false } = {}) {
  const c = cellAt(x, y);
  return c !== "#" && (door || c !== "-");
}

/** 점 위치 목록. key는 "x,y", 값은 "dot" 또는 "power". */
export function createPellets() {
  const pellets = new Map();
  MAZE.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === ".") pellets.set(`${x},${y}`, "dot");
      if (ch === "o") pellets.set(`${x},${y}`, "power");
    });
  });
  return pellets;
}

// ---- 이동 ----
// 엔티티는 타일(x, y)과 다음 타일까지의 진행도 p(0~1), 방향 dir 로 나타낸다.

export function createEntity(x, y, dir = null) {
  return { x, y, dir, p: 0 };
}

export function position(e) {
  if (!e.dir) return { x: e.x, y: e.y };
  const d = DIRS[e.dir];
  return { x: e.x + d.x * e.p, y: e.y + d.y * e.p };
}

export function nextTile(e, dir) {
  const d = DIRS[dir];
  return { x: wrapX(e.x + d.x), y: e.y + d.y };
}

/**
 * dist(타일 단위)만큼 움직인다. 타일 중앙에 닿을 때마다 choose(e)로 다음 방향을 정한다.
 * choose 가 null 을 돌려주면 그 자리에 멈춘다.
 */
export function step(e, dist, choose) {
  for (let guard = 0; dist > 1e-9 && guard < 20; guard++) {
    if (e.p === 0) {
      e.dir = choose(e);
      if (!e.dir) return;
    }
    const need = 1 - e.p;
    if (dist < need) {
      e.p += dist;
      return;
    }
    dist -= need;
    const next = nextTile(e, e.dir);
    e.x = next.x;
    e.y = next.y;
    e.p = 0;
  }
}

/** 타일 중간에서 바로 뒤로 돈다. */
export function reverse(e) {
  if (!e.dir) return;
  if (e.p > 0) {
    const next = nextTile(e, e.dir);
    e.x = next.x;
    e.y = next.y;
    e.p = 1 - e.p;
  }
  e.dir = OPPOSITE[e.dir];
}

// ---- 유령 AI ----

function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/**
 * 유령이 갈 방향. 뒤로는 돌지 않고(막다른 길 제외), 목표까지 직선거리가 가장 짧은 쪽으로 간다.
 * random 함수를 주면(겁먹은 상태) 갈 수 있는 방향 중 아무거나 고른다.
 */
export function chooseGhostDir(g, target, random = null) {
  const options = DIR_ORDER.filter((d) => {
    if (d === OPPOSITE[g.dir]) return false;
    const n = nextTile(g, d);
    return isOpen(n.x, n.y);
  });
  if (options.length === 0) return g.dir ? OPPOSITE[g.dir] : null;
  if (random) return options[Math.floor(random() * options.length)];

  let best = options[0];
  let bestDist = Infinity;
  for (const d of options) {
    const n = nextTile(g, d);
    const dd = dist2(n, target);
    if (dd < bestDist) {
      best = d;
      bestDist = dd;
    }
  }
  return best;
}

/**
 * 유령별 목표 타일 (원작 규칙을 단순화).
 * - blinky: 팩맨 위치
 * - pinky: 팩맨이 보는 방향으로 4칸 앞
 * - inky: 팩맨 2칸 앞을 기준으로 blinky 위치를 뒤집은 곳
 * - clyde: 팩맨과 8칸보다 멀면 팩맨, 가까우면 자기 구석
 */
export function ghostTarget(name, mode, { pac, pacDir, self, blinky }) {
  if (mode === "scatter") return SCATTER[name];
  const d = DIRS[pacDir] || { x: 0, y: 0 };
  switch (name) {
    case "blinky":
      return pac;
    case "pinky":
      return { x: pac.x + 4 * d.x, y: pac.y + 4 * d.y };
    case "inky": {
      const pivot = { x: pac.x + 2 * d.x, y: pac.y + 2 * d.y };
      return { x: 2 * pivot.x - blinky.x, y: 2 * pivot.y - blinky.y };
    }
    case "clyde":
      return dist2(pac, self) > 64 ? pac : SCATTER.clyde;
    default:
      return pac;
  }
}

/** 레벨 시작 후 t초(겁먹은 시간 제외)일 때 모드. schedule 은 난이도마다 다르다. */
export function modeAt(t, schedule = MODE_SCHEDULE) {
  let acc = 0;
  for (let i = 0; i < schedule.length; i++) {
    acc += schedule[i];
    if (t < acc) return i % 2 === 0 ? "scatter" : "chase";
  }
  return "chase";
}

export function inTunnel(e) {
  return e.y === TUNNEL_ROW && (e.x <= 5 || e.x >= W - 6);
}
