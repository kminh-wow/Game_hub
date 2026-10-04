"use strict";

// 파괴 지형 렌더링 캐시
const FortressTerrain = (() => {
  let cache = null;
  // 캔버스 재사용 (새로 만들면 일부 브라우저에서 캔버스 메모리가 쌓인다)
  const surface = document.createElement("canvas");
  const rock = document.createElement("canvas");
  const fit = (canvas, width, height) => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }
    const painter = canvas.getContext("2d");
    painter.setTransform(1, 0, 0, 1, 0, 0);
    painter.globalCompositeOperation = "source-over";
    painter.clearRect(0, 0, width, height);
    return painter;
  };

  // 지형 표면 구성
  function build(terrain, tops, width, height) {
    const painter = fit(surface, width, height);
    const cols = terrain.map(c => typeof c === "number" ? [[0, c]] : c);
    const original = tops || cols.map(c => c[c.length - 1]?.[1]);
    const mask = new Path2D();
    cols.forEach((segments, x) => {
      for (const [lo, hi] of segments) mask.rect(x, height - hi, 1, hi - lo);
    });
    painter.save(); painter.clip(mask);
    painter.fillStyle = FortressArt.pattern(painter, "soil") || "#916039";
    painter.fillRect(0, 0, width, height);

    // 지하 암석층 혼합
    const rp = fit(rock, width, height);
    original.forEach((top, x) => {
      if (top === undefined) return;
      const depth = rp.createLinearGradient(0, height - top + 45, 0, height - top + 220);
      depth.addColorStop(0, "rgba(0,0,0,0)"); depth.addColorStop(1, "rgba(0,0,0,.85)");
      rp.fillStyle = depth; rp.fillRect(x, 0, 1, height);
    });
    rp.globalCompositeOperation = "source-in";
    rp.fillStyle = FortressArt.pattern(rp, "bedrock") || "#5c4331";
    rp.fillRect(0, 0, width, height);
    painter.drawImage(rock, 0, 0);

    // 지표 잔디와 노출 단면
    cols.forEach((segments, x) => {
      for (const [lo, hi] of segments) {
        const intact = original[x] === hi;
        painter.fillStyle = intact ? "#42672e" : "#523923";
        painter.fillRect(x, height - hi, 1, Math.min(intact ? 9 : 4, hi - lo));
        if (intact) {
          painter.fillStyle = "#79a64a";
          painter.fillRect(x, height - hi, 1, Math.min(4, hi - lo));
        }
        if (lo > 0) {
          painter.fillStyle = "#523923";
          painter.fillRect(x, height - lo - 3, 1, Math.min(3, hi - lo));
        }
      }
    });
    painter.restore();

    // 완만한 지표 장식 배치
    for (let x = 24; x < width - 24; x += 43) {
      const top = original[x];
      if (top === undefined) continue;
      const variant = (x * 17 + Math.round(top) * 7) % 3;
      const isRock = (x + Math.round(top)) % 4 === 0;
      const size = isRock ? 13 + variant * 2 : 15 + variant * 3;
      const half = Math.ceil(size / 2);
      const left = original[x - half], right = original[x + half];
      if (left === undefined || right === undefined || Math.abs(right - left) > size * .5) continue;
      let intact = true;
      for (let c = x - half; c <= x + half; c++) {
        if (cols[c][cols[c].length - 1]?.[1] !== original[c] || Math.abs(original[c] - top) > size * .4) { intact = false; break; }
      }
      if (!intact) continue;
      FortressArt.decoration(painter, isRock ? "rocks" : "grass", variant, x, height - top,
        size, Math.atan2(left - right, half * 2));
    }
    return surface;
  }

  // 전장 지형 출력
  function draw(ctx, terrain, tops, width, height) {
    const revision = FortressArt.revision();
    if (!cache || cache.terrain !== terrain || cache.tops !== tops || cache.revision !== revision || cache.width !== width || cache.height !== height) {
      cache = { terrain, tops, revision, width, height, surface: build(terrain, tops, width, height) };
    }
    ctx.drawImage(cache.surface, 0, 0);
  }
  return { draw };
})();
