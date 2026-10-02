"use strict";

// 게임 이미지 로딩
const FortressArt = (() => {
  const sprites = {};
  const base = new URL("assets/", document.currentScript.src);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  for (const name of ["tank-body", "tank-barrel", "normal", "heavy", "fuel", "muzzle", "explosion"]) {
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
  return { sprite, effect, reduced, ready: () => !!sprites["tank-body"] && !!sprites["tank-barrel"] };
})();
