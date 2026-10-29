// 화투 그림 (섯다·고스톱이 함께 씀). 카드 그림은 hwatu/ 폴더의 SVG(Louie Mantia, CC BY-SA 4.0, hwatu/README.md)를 쓰고
// 그 위에 광(光)·쌍피·월 표시를 덧그린다.
//   Hwatu.svg(월, 종류, n)  → 카드 앞면 SVG 문자열.  종류: gwang(광) yeol(열끗) hong(홍단) cheong(청단) cho(초단) tti(띠) pi(피) ssangpi(쌍피)
//                            n: 같은 월·같은 종류 중 몇 번째인지 (피 두 장 구분, 기본 0)
//   Hwatu.back()           → 뒷면 SVG 문자열
//   Hwatu.label(월, 종류)   → "1월 광" 같은 글자
(() => {
  const W = 61;
  const H = 100;
  const BASE = new URL("hwatu/", document.currentScript?.src || location.href).href;
  // 월마다 카드 네 장의 종류 (그림 파일 번호 순서, gostop/app/rules.py KINDS 와 같음)
  const KINDS = {
    1: ["gwang", "hong", "pi", "pi"],
    2: ["yeol", "hong", "pi", "pi"],
    3: ["gwang", "hong", "pi", "pi"],
    4: ["yeol", "cho", "pi", "pi"],
    5: ["yeol", "cho", "pi", "pi"],
    6: ["yeol", "cheong", "pi", "pi"],
    7: ["yeol", "cho", "pi", "pi"],
    8: ["gwang", "yeol", "pi", "pi"],
    9: ["yeol", "cheong", "pi", "pi"],
    10: ["yeol", "cheong", "pi", "pi"],
    11: ["gwang", "ssangpi", "pi", "pi"],
    12: ["gwang", "yeol", "tti", "ssangpi"],
  };
  const MONTHS = { 1: "송학", 2: "매조", 3: "벚꽃", 4: "흑싸리", 5: "난초", 6: "모란", 7: "홍싸리", 8: "공산", 9: "국화", 10: "단풍", 11: "오동", 12: "비" };
  const KIND_NAMES = { gwang: "광", yeol: "열끗", hong: "홍단", cheong: "청단", cho: "초단", tti: "띠", pi: "피", ssangpi: "쌍피" };
  const TTI_KINDS = ["hong", "cheong", "cho", "tti"];

  // 그림 파일 번호 (같은 종류가 여러 장이면 n 번째, 띠 종류가 다르게 불려도 띠 자리로)
  function fileNo(m, kind, n = 0) {
    const kinds = KINDS[m] || KINDS[1];
    const same = kinds.map((k, i) => [k, i]).filter(([k]) => k === kind || (TTI_KINDS.includes(k) && TTI_KINDS.includes(kind)));
    const hit = same[Math.min(n, same.length - 1)];
    return (hit ? hit[1] : 0) + 1;
  }

  // 덧그리는 표시: 광은 왼쪽 위 光, 쌍피는 왼쪽 위 쌍피, 오른쪽 아래 월
  function marks(m, kind) {
    let s = "";
    if (kind === "gwang")
      s += `<circle cx="11" cy="11" r="7.5" fill="#d9342b" stroke="#fff" stroke-width="1.2"/><text x="11" y="14.6" font-size="10" text-anchor="middle" fill="#fff" font-weight="900">光</text>`;
    else if (kind === "ssangpi")
      s += `<rect x="4" y="4" width="17" height="10" rx="2.5" fill="#c47a12" stroke="#fff" stroke-width="1"/><text x="12.5" y="11.6" font-size="6.8" text-anchor="middle" fill="#fff" font-weight="800">쌍피</text>`;
    s += `<rect x="${W - 17}" y="${H - 14}" width="13" height="10" rx="2.5" fill="rgba(58,22,14,.85)"/>` +
      `<text x="${W - 10.5}" y="${H - 6.3}" font-size="7.5" text-anchor="middle" fill="#fff" font-weight="800">${m}</text>`;
    return s;
  }

  // 카드 앞면
  function svg(m, kind, n = 0) {
    return `<svg class="hwatu" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label(m, kind)}">` +
      `<image href="${BASE}${m}-${fileNo(m, kind, n)}.svg" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>` +
      marks(m, kind) + "</svg>";
  }

  // 뒷면
  function back() {
    return `<svg class="hwatu" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="뒷면">` +
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="5" fill="#7d1410"/>` +
      `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="3" fill="#b3261e" stroke="#e8b04a" stroke-width="1"/>` +
      `<circle cx="${W / 2}" cy="${H / 2}" r="11" fill="none" stroke="#e8b04a" stroke-width="1.5"/>` +
      `<circle cx="${W / 2}" cy="${H / 2}" r="4.5" fill="#e8b04a"/></svg>`;
  }

  function label(m, kind) {
    return `${m}월 ${KIND_NAMES[kind] || ""}`.trim();
  }

  // 그림 미리 받기 (처음 뒤집을 때 비어 보이지 않게)
  function preload() {
    for (const m of Object.keys(KINDS))
      for (let i = 1; i <= 4; i++) new Image().src = `${BASE}${m}-${i}.svg`;
  }

  window.Hwatu = { svg, back, label, preload, MONTHS, KIND_NAMES, KINDS };
})();
