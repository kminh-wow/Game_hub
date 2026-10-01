# Pacman 3D assets

Original meshes authored in Blender 5.2 through Blender MCP. No external asset licenses are required. Three.js retains its MIT license in `web/vendor/three/LICENSE`.

- `pacman-assets.blend`: editable source, separate `Pacman_Asset_Studio` scene.
- `build_assets.py`: rebuild with Blender's `--python` option, or `runpy.run_path()` through MCP. Replaces only the eight named assets in `Pacman_Asset_Studio`, preserving other scenes and objects.
- `../web/assets/arcade-kit.glb`: eight lightweight meshes and two looping morph animations (`Pacman_Chomp`, `PacmanPower_Chomp`). Mouth animation is 12 frames at 30 fps.

Pacman faces +X. Source coordinates use Blender Z-up; export converts to glTF Y-up. The runtime uses Blender meshes for characters, eyes, pellets and instanced walls. Ghost colors share the same mesh. Powered Pacman has its own emissive gold material plus a runtime halo and local light. The final two seconds flash back toward normal; game timing is unchanged.

UI colors, font stack, border radius and dark theme follow the hub. No gameplay buttons, rules or scoring changes were added.

Readability revision: the camera looks down at approximately 53 degrees. Pacman's mouth opens in the horizontal plane with a dark interior and holds fully open on frames 5–9. Ghosts have taller bodies, five deep scallops and larger eyes. Runtime scales remain 1.4 for Pacman and 1.15 for ghosts; collision sizes are unchanged.

Validation: `node --test pacman/tests/*.test.mjs`.
