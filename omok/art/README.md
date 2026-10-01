# Omok Blender assets

`omok-assets.blend` contains the editable `Omok_Asset_Studio` scene. Run `build_assets.py` inside Blender to rebuild that scene and export `../static/assets/omok-kit.glb`. Other scenes are preserved.

The six exported meshes are BoardBase, BoardRim, BoardTop, BoardGrid, BlackStone, and WhiteStone. Original geometry uses Blender Z-up; the GLB uses Y-up. Grid spacing is one unit, centered at the origin, with 15 intersections per side. The board surface is at Y=0.29; stone centers are at Y=0.485 with radius 0.445 and height 0.38.

The web renderer preserves server [column, row] coordinates and raycasts against the board surface. Last-move and winning-line indicators remain visible above stones. Assets and materials are original; Three.js is vendored with its MIT license. A failed asset/WebGL load leaves the original Canvas 2D renderer available.

Realism pass: packed maple grain texture, thicker wooden body, 0.47-radius stones and softbox reflections. The surface and server cell spacing remain unchanged.
