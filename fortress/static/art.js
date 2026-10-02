"use strict";

// 게임 이미지 로딩
const FortressArt = (() => {
  const sprites = {};
  let revision = 0;
  const bodies = ["tank-body", "tank-body-blue", "tank-body-yellow", "tank-body-green"];
  const base = new URL("assets/", document.currentScript.src);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  for (const name of [...bodies, "tank-barrel", "normal", "heavy", "fuel", "muzzle", "explosion", "soil", "bedrock", "grass", "rocks"]) {
    const img = new Image();
    img.onload = () => {
      let bounds = [0, 0, img.width, img.height];
      // 탱크 투명 여백 측정
      if (name.startsWith("tank-")) {
        const surface = document.createElement("canvas");
        surface.width = img.width;
        surface.height = img.height;
        const painter = surface.getContext("2d");
        painter.drawImage(img, 0, 0);
        const pixels = painter.getImageData(0, 0, img.width, img.height).data;
        let left = img.width, top = img.height, right = 0, bottom = 0;
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            if (pixels[(y * img.width + x) * 4 + 3] < 24) continue;
            left = Math.min(left, x); top = Math.min(top, y);
            right = Math.max(right, x); bottom = Math.max(bottom, y);
          }
        }
        if (right >= left) bounds = [left, top, right - left + 1, bottom - top + 1];
      }
      sprites[name] = { img, bounds };
      // 지형 장식 프레임 측정
      if (name === "grass" || name === "rocks") {
        const surface = document.createElement("canvas");
        surface.width = img.width; surface.height = img.height;
        const painter = surface.getContext("2d");
        painter.drawImage(img, 0, 0);
        const pixels = painter.getImageData(0, 0, img.width, img.height).data;
        sprites[name].frames = Array.from({ length: 3 }, (_, frame) => {
          const start = Math.floor(frame * img.width / 3), end = Math.floor((frame + 1) * img.width / 3);
          let left = end, right = start, top = img.height, bottom = 0;
          for (let y = 0; y < img.height; y++) for (let x = start; x < end; x++) {
            if (pixels[(y * img.width + x) * 4 + 3] < 32) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
          return [left, top, Math.max(1, right - left + 1), Math.max(1, bottom - top + 1)];
        });
      }
      revision++;
    };
    img.src = new URL(`${name}.png`, base).href;
  }

  // 단일 스프라이트 렌더링
  function sprite(ctx, name, x, y, width, height) {
    const asset = sprites[name];
    if (!asset) return false;
    ctx.drawImage(asset.img, ...asset.bounds, x, y, width, height);
    return true;
  }

  // 효과 프레임 렌더링
  function effect(ctx, name, frame, x, y, size) {
    const asset = sprites[name];
    if (!asset) return false;
    const cols = name === "muzzle" ? 2 : 4;
    const w = asset.img.width / cols, h = asset.img.height / 2;
    ctx.drawImage(asset.img, frame % cols * w, Math.floor(frame / cols) * h, w, h,
      x - size / 2, y - size / 2, size, size);
    return true;
  }
  // 플레이어 차체 선택
  function body(color, dummy = false) {
    const name = dummy ? bodies[0] : bodies[color % bodies.length];
    return sprites[name] ? name : bodies[0];
  }
  // 지표 장식 렌더링
  function decoration(ctx, name, frame, x, y, width, angle = 0) {
    const asset = sprites[name];
    if (!asset?.frames) return false;
    const bounds = asset.frames[frame % 3], height = width * bounds[3] / bounds[2];
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.drawImage(asset.img, ...bounds, -width / 2, -height + 2, width, height);
    ctx.restore();
    return true;
  }

  // 경계가 이어지는 지형 패턴
  function pattern(ctx, name) {
    const asset = sprites[name];
    if (!asset) return null;
    if (!asset.tile) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = 512;
      const painter = tile.getContext("2d");
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        painter.save(); painter.translate(x ? 512 : 0, y ? 512 : 0);
        painter.scale(x ? -1 : 1, y ? -1 : 1);
        painter.drawImage(asset.img, 0, 0, 256, 256); painter.restore();
      }
      asset.tile = tile;
    }
    return ctx.createPattern(asset.tile, "repeat");
  }
  return { sprite, effect, body, decoration, pattern, reduced, revision: () => revision, ready: () => !!sprites["tank-body"] && !!sprites["tank-barrel"] };
})();
