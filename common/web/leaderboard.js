// 점수 순위 (길건너기, 숫자러너, 팩맨, 사과게임, 박스헤드가 함께 씀). 허브 닉네임으로 올리고, 이번 주·전체 상위 10명을 보여 준다.
//   Leaderboard.begin("crossy")  → 판을 시작할 때 부름. 서버에서 입장권을 받아 둠 (걸린 시간은 서버가 이걸로 잼)
//   Leaderboard.submit("crossy", 점수)  → 결과(순위·목록) 또는 { error }. 입장권은 한 판에 한 번만 쓸 수 있음
//   Leaderboard.mount(요소, "crossy", { unit: "칸", result })  → 그 자리에 순위표 그리기
(() => {
  const API = new URL("../api/leaderboard/", document.currentScript.src);
  const read = (key) => {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  };

  // 브라우저 식별값 (나중에 이름을 브라우저에 묶을 때 쓰려고 같이 보냄)
  function token() {
    let t = read("gamehub-lb-token");
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      try {
        localStorage.setItem("gamehub-lb-token", t);
      } catch {}
    }
    return t;
  }

  async function load(board) {
    const r = await fetch(new URL(board, API));
    if (!r.ok) throw new Error(`순위를 불러오지 못했어요 (${r.status})`);
    return r.json();
  }

  const tickets = new Map();       // 게임 → 입장권 (판 하나에 하나)
  const waiting = new Map();       // 게임 → 입장권 받는 중인 요청

  // 판 시작: 서버에서 입장권 받아 두기 (실패해도 게임은 계속, 올릴 때 안내)
  function begin(board) {
    tickets.delete(board);
    const job = fetch(new URL(`${board}/start`, API), { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ticket) tickets.set(board, d.ticket);
      })
      .catch(() => {});
    waiting.set(board, job);
    return job;
  }

  // 점수 올리기 (닉네임이 없거나 0점이면 올리지 않음)
  async function submit(board, score) {
    const name = read("gamehub-name").trim();
    if (!name) return { error: "허브에서 닉네임을 정하면 순위에 올라가요." };
    if (!(score > 0)) return { error: null };
    await waiting.get(board);
    const ticket = tickets.get(board);
    if (!ticket) return { error: "순위 입장권이 없어요. 페이지를 새로고침하고 다시 해 주세요." };
    try {
      const r = await fetch(new URL(board, API), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, score: Math.floor(score), ticket, token: token() }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status !== 429) tickets.delete(board);               // 입장권은 한 번만 (너무 빨라서 거절된 경우만 다시 쓸 수 있음)
      if (!r.ok) return { error: data.detail || "순위에 올리지 못했어요." };
      return data;
    } catch {
      return { error: "순위 서버에 연결하지 못했어요." };
    }
  }

  let styled = false;
  // 순위표 모양 (각 게임의 색 변수를 그대로 씀)
  function style() {
    if (styled) return;
    styled = true;
    const css = document.createElement("style");
    css.textContent = `
.lb { text-align: left; font-size: 13px; color: var(--text, #173d33); }
.lb-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
.lb-tabs button { flex: 1; padding: 4px 0; border: 1px solid var(--line, #cdd4c7); border-radius: 8px; background: transparent; color: var(--muted, #53665c); font: inherit; font-size: 12px; cursor: pointer; }
.lb-tabs button.on { background: var(--accent, #245442); border-color: var(--accent, #245442); color: var(--on-accent, #fff); font-weight: 700; }
.lb ol { list-style: none; margin: 0; padding: 0; }
.lb li { display: flex; gap: 8px; padding: 3px 6px; border-radius: 6px; }
.lb li:nth-child(-n+3) b { color: #d9a400; }
.lb li b { width: 1.6em; text-align: right; font-variant-numeric: tabular-nums; }
.lb li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb li em { font-style: normal; font-weight: 700; font-variant-numeric: tabular-nums; }
.lb li.me { background: var(--accent-soft, rgba(36, 84, 66, .12)); font-weight: 700; }
.lb .lb-note { margin: 6px 0 0; color: var(--muted, #53665c); font-size: 12px; text-align: center; }
.lb .lb-empty { color: var(--muted, #53665c); text-align: center; padding: 6px 0; }`;
    document.head.append(css);
  }

  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };

  // 순위표 그리기 (탭: 이번 주 / 전체)
  function render(box, data, { unit = "점", tab = "week", note = "" } = {}) {
    style();
    const me = read("gamehub-name").trim();
    const draw = (which) => {
      const list = data[which] || [];
      const tabs = el("div", { className: "lb-tabs" },
        ...[["week", "이번 주"], ["all", "전체"]].map(([key, label]) => {
          const b = el("button", { type: "button", className: key === which ? "on" : "", textContent: label });
          b.onclick = () => draw(key);
          return b;
        }));
      const rows = list.length
        ? el("ol", {}, ...list.map((e, i) => el("li", { className: e.name === me ? "me" : "" },
          el("b", { textContent: String(i + 1) }), el("span", { textContent: e.name }), el("em", { textContent: `${e.score.toLocaleString()}${unit}` }))))
        : el("p", { className: "lb-empty", textContent: "아직 기록이 없어요. 첫 기록을 남겨 보세요!" });
      box.replaceChildren(el("div", { className: "lb" }, tabs, rows, ...(note ? [el("p", { className: "lb-note", textContent: note })] : [])));
    };
    draw(tab);
  }

  // 순위 문구 (올린 결과로)
  function resultNote(res) {
    if (!res) return "";
    if (res.error) return res.error;
    if (!res.rank) return "";
    return `이번 기록: 이번 주 ${res.week_rank}위 · 전체 ${res.rank}위`;
  }

  // 요소에 순위표 띄우기 (result 가 있으면 그걸로, 없으면 불러옴)
  async function mount(box, board, { unit = "점", result = null } = {}) {
    if (!box) return;
    if (result && !result.error && result.all) return render(box, result, { unit, note: resultNote(result) });
    try {
      render(box, await load(board), { unit, note: resultNote(result) });
    } catch (err) {
      style();
      box.replaceChildren(el("p", { className: "lb lb-empty", textContent: err.message }));
    }
  }

  window.Leaderboard = { load, begin, submit, render, mount, name: () => read("gamehub-name").trim() };
})();
