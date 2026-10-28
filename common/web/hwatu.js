// 화투 그림 (섯다·고스톱이 함께 씀). 이미지 파일 없이 SVG 로 직접 그린다.
//   Hwatu.svg(월, 종류)  → 카드 앞면 SVG 문자열.  종류: gwang(광) yeol(열끗) hong(홍단) cheong(청단) cho(초단) tti(띠) pi(피) ssangpi(쌍피)
//   Hwatu.back()         → 뒷면 SVG 문자열
//   Hwatu.label(월, 종류) → "1월 광" 같은 글자
// 진짜 화투 그림과 똑같지는 않고, 월마다 상징(소나무·매화·벚꽃 …)과 종류 표시로 한눈에 알아보게 그린다.
(() => {
  const W = 56;
  const H = 88;
  const MONTHS = {
    1: { name: "송학", sky: "#f6ead2" },
    2: { name: "매조", sky: "#f7e9e4" },
    3: { name: "벚꽃", sky: "#f8e8ec" },
    4: { name: "흑싸리", sky: "#efece2" },
    5: { name: "난초", sky: "#ece9f2" },
    6: { name: "모란", sky: "#f6e6e6" },
    7: { name: "홍싸리", sky: "#f7e7df" },
    8: { name: "공산", sky: "#e9493a" },
    9: { name: "국화", sky: "#f7efd2" },
    10: { name: "단풍", sky: "#f6e4d6" },
    11: { name: "오동", sky: "#efe7da" },
    12: { name: "비", sky: "#e4e6e3" },
  };
  const KIND_NAMES = { gwang: "광", yeol: "열끗", hong: "홍단", cheong: "청단", cho: "초단", tti: "띠", pi: "피", ssangpi: "쌍피" };

  const circle = (x, y, r, fill, extra = "") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
  const ellipse = (x, y, rx, ry, fill, rot = 0) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${rot} ${x} ${y})"/>`;
  const path = (d, fill = "none", stroke = "none", w = 1) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

  // 꽃 한 송이 (꽃잎 n개)
  function flower(x, y, r, petal, center, n = 5) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      s += circle((x + Math.cos(a) * r * 0.55).toFixed(1), (y + Math.sin(a) * r * 0.55).toFixed(1), r * 0.5, petal);
    }
    return s + circle(x, y, r * 0.28, center);
  }

  // 단풍잎
  function maple(x, y, r, fill) {
    let d = "";
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? r * 0.45 : r;
      d += `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)} `;
    }
    return path(d + "Z", fill);
  }

  // 작은 새
  function bird(x, y, s, body, wing = "#3a2a20") {
    return ellipse(x, y, 6 * s, 3.4 * s, body, -10) + path(`M${x - 2 * s} ${y - 1 * s} q${-3 * s} ${-5 * s} ${-7 * s} ${-3 * s}`, "none", wing, 1.6 * s) +
      circle(x + 5 * s, y - 1.5 * s, 1.8 * s, body) + path(`M${x + 6.6 * s} ${y - 1.6 * s} l${2.4 * s} ${0.6 * s}`, "none", "#d9a400", 1.2 * s);
  }

  // 월마다 배경 그림
  const SCENES = {
    1: () => path("M28 88 L28 46", "none", "#5b3a22", 4) +
      [[18, 30], [30, 22], [40, 32], [24, 40], [36, 44], [14, 46]].map(([x, y]) => ellipse(x, y, 10, 6, "#2f5d3a") + ellipse(x, y - 2, 7, 3.5, "#3f7a4b")).join(""),
    2: () => path("M6 80 Q22 54 30 34 T50 10", "none", "#3a2a20", 3) + path("M30 34 Q40 40 50 38", "none", "#3a2a20", 2) +
      [[14, 64, 1], [24, 46, 0], [34, 30, 1], [44, 18, 0], [42, 38, 1]].map(([x, y, w]) => flower(x, y, 6, w ? "#ffffff" : "#e8577a", "#f4c542")).join(""),
    3: () => [[12, 16], [26, 12], [40, 18], [18, 28], [34, 30], [46, 32], [10, 40], [26, 42], [42, 46]].map(([x, y]) => flower(x, y, 6.5, "#f3a5bd", "#d64f7a")).join(""),
    4: () => [10, 20, 30, 40, 48].map((x, i) => path(`M${x} 4 Q${x + 4} 30 ${x - 2} ${52 + (i % 2) * 8}`, "none", "#2b2328", 1.6) +
      [14, 26, 38, 50].map((y) => ellipse(x + 2 + (y % 3), y, 2.4, 5, "#3b2f3b", 20)).join("")).join(""),
    5: () => [10, 20, 32, 44].map((x) => path(`M${x} 88 Q${x + 2} 50 ${x + 6} 30`, "none", "#3f7a4b", 2)).join("") +
      [[18, 26], [36, 20], [28, 38]].map(([x, y]) => ellipse(x, y, 4, 8, "#6b4fa0", -20) + ellipse(x + 4, y + 1, 4, 7, "#8a6cc4", 25) + circle(x + 2, y + 4, 1.6, "#f4c542")).join(""),
    6: () => ellipse(14, 52, 12, 5, "#3f7a4b", -30) + ellipse(42, 54, 12, 5, "#3f7a4b", 30) + ellipse(28, 62, 10, 4, "#2f5d3a", 0) +
      circle(28, 36, 15, "#c7243a") + circle(28, 36, 11, "#e04760") + circle(28, 36, 7, "#f17b8f") + circle(28, 36, 3, "#f4c542"),
    7: () => [8, 22, 36, 50].map((x) => path(`M${x} 6 Q${x + 10} 30 ${x + 2} 58`, "none", "#6b3a2a", 1.4) +
      [14, 24, 34, 44, 52].map((y) => circle(x + 3 + (y % 4), y, 2.6, "#d8434f")).join("")).join(""),
    8: () => path("M0 60 Q14 40 28 52 Q42 40 56 56 L56 88 L0 88 Z", "#1f1a1a") + [10, 22, 34, 46].map((x) => path(`M${x} 60 l2 -10 l2 10`, "#3a3232")).join(""),
    9: () => path("M28 88 L28 50", "none", "#3f7a4b", 2.4) + ellipse(20, 62, 8, 3.5, "#3f7a4b", -30) + ellipse(36, 66, 8, 3.5, "#3f7a4b", 30) +
      flower(28, 34, 16, "#f2c230", "#c47a12", 12) + flower(28, 34, 9, "#f7d660", "#c47a12", 8),
    10: () => [[14, 18, 9], [36, 14, 8], [26, 32, 10], [44, 36, 8], [12, 44, 8], [32, 52, 9]].map(([x, y, r]) => maple(x, y, r, "#c9302c")).join(""),
    11: () => [[18, 30], [38, 28], [28, 46]].map(([x, y]) => ellipse(x, y, 10, 13, "#3d3a2e")).join("") +
      [[22, 14], [30, 12], [38, 16]].map(([x, y]) => ellipse(x, y, 2.6, 6, "#9a6fb4")).join(""),
    12: () => [8, 18, 28, 38, 48].map((x) => path(`M${x} 0 Q${x - 6} 40 ${x + 2} 70`, "none", "#3f6b3a", 1.6)).join("") +
      [6, 16, 26, 36, 46].map((x) => path(`M${x} 74 l4 -10`, "none", "#5d7fa8", 1.2)).join(""),
  };

  // 종류마다 얹는 그림
  function overlay(m, kind) {
    let s = "";
    if (kind === "gwang") {
      if (m === 1) s += circle(40, 18, 9, "#d9342b") + ellipse(22, 58, 9, 6, "#ffffff") + path("M28 56 Q34 44 30 36", "none", "#222", 2) + circle(30, 35, 2.4, "#d9342b");
      if (m === 3) s += [10, 18, 26, 34, 42].map((x, i) => `<rect x="${x}" y="54" width="8" height="22" fill="${i % 2 ? "#ffffff" : "#d9342b"}"/>`).join("");
      if (m === 8) s += circle(28, 28, 14, "#fbf3dc");
      if (m === 11) s += ellipse(28, 62, 12, 7, "#d9342b") + path("M18 60 Q10 50 16 42", "none", "#3a8f4b", 3) + circle(36, 56, 3, "#f4c542");
      if (m === 12) s += path("M14 58 L30 40 L46 58 Z", "#d9342b") + path("M30 58 L30 76", "none", "#222", 2) + circle(22, 70, 4, "#222");
      s += circle(11, 11, 8, "#d9342b") + `<text x="11" y="15" font-size="10" text-anchor="middle" fill="#fff" font-weight="900">光</text>`;
    } else if (kind === "yeol") {
      if ([2, 4].includes(m)) s += bird(28, 60, 1.3, m === 2 ? "#c7c43c" : "#5a4a3a");
      if (m === 5) s += path("M6 70 Q28 52 50 70", "none", "#8a5a2b", 4) + path("M10 74 L10 66 M28 66 L28 60 M46 74 L46 66", "none", "#8a5a2b", 2);
      if (m === 6) s += path("M14 66 l6 -6 l0 8 Z M20 60 l6 6 l-6 2 Z", "#f4c542") + path("M36 72 l6 -6 l0 8 Z M42 66 l6 6 l-6 2 Z", "#f4c542");
      if (m === 7) s += ellipse(28, 70, 13, 7, "#6b4428") + circle(40, 67, 4, "#6b4428") + path("M18 76 l0 6 M36 76 l0 6", "none", "#3a2a20", 2);
      if (m === 8) s += [[16, 18], [28, 12], [40, 20]].map(([x, y]) => path(`M${x - 5} ${y - 2} L${x} ${y + 2} L${x + 5} ${y - 2}`, "none", "#222", 2)).join("");
      if (m === 9) s += path("M18 60 L38 60 L34 74 L22 74 Z", "#c9302c") + `<text x="28" y="70" font-size="8" text-anchor="middle" fill="#f4c542" font-weight="900">壽</text>`;
      if (m === 10) s += ellipse(28, 70, 11, 6, "#a8743a") + circle(38, 62, 4, "#a8743a") + path("M38 58 l-3 -6 M40 58 l3 -6", "none", "#6b4428", 1.5);
      if (m === 12) s += path("M14 66 L28 74 L42 62", "none", "#222", 3) + circle(28, 72, 3, "#d9342b");
      s += `<rect x="3" y="3" width="15" height="9" rx="2" fill="#3a2a20"/><text x="10.5" y="10" font-size="6.5" text-anchor="middle" fill="#fff" font-weight="800">열끗</text>`;
    } else if (["hong", "cheong", "cho", "tti"].includes(kind)) {
      const color = kind === "cheong" ? "#2d58b8" : "#d9342b";
      const text = { hong: "홍단", cheong: "청단", cho: "초단", tti: "" }[kind];
      s += `<g transform="rotate(-8 28 56)"><rect x="18" y="38" width="20" height="40" rx="2" fill="${color}" stroke="#fff" stroke-width="1.2"/>` +
        (text ? `<text x="28" y="62" font-size="8" text-anchor="middle" fill="#fff" font-weight="900" writing-mode="tb">${text}</text>` : "") + "</g>";
    } else if (kind === "ssangpi") {
      if (m === 12) s += circle(28, 58, 10, "#d9342b") + circle(28, 58, 5, "#f4c542");
      s += `<rect x="3" y="3" width="15" height="9" rx="2" fill="#c47a12"/><text x="10.5" y="10" font-size="6.5" text-anchor="middle" fill="#fff" font-weight="800">쌍피</text>`;
    }
    return s;
  }

  // 카드 앞면
  function svg(m, kind) {
    const info = MONTHS[m];
    return `<svg class="hwatu" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label(m, kind)}">` +
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="5" fill="#2b1d16"/>` +
      `<rect x="2.5" y="2.5" width="${W - 5}" height="${H - 5}" rx="3.5" fill="${info.sky}"/>` +
      `<svg x="2.5" y="2.5" width="${W - 5}" height="${H - 5}" viewBox="0 0 56 88" preserveAspectRatio="none">${SCENES[m]()}${overlay(m, kind)}</svg>` +
      `<rect x="${W - 17}" y="${H - 13}" width="14" height="10" rx="2" fill="rgba(43,29,22,.82)"/>` +
      `<text x="${W - 10}" y="${H - 5.5}" font-size="7.5" text-anchor="middle" fill="#fff" font-weight="800">${m}</text>` +
      "</svg>";
  }

  function back() {
    return `<svg class="hwatu" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="뒷면">` +
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="5" fill="#7d1410"/>` +
      `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="3" fill="#b3261e" stroke="#e8b04a" stroke-width="1"/>` +
      `<circle cx="${W / 2}" cy="${H / 2}" r="10" fill="none" stroke="#e8b04a" stroke-width="1.5"/>` +
      `<circle cx="${W / 2}" cy="${H / 2}" r="4" fill="#e8b04a"/></svg>`;
  }

  function label(m, kind) {
    return `${m}월 ${KIND_NAMES[kind] || ""}`.trim();
  }

  window.Hwatu = { svg, back, label, MONTHS, KIND_NAMES };
})();
