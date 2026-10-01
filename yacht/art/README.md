# Yacht Blender assets

`yacht-assets.blend` contains the editable `Yacht_Asset_Studio` scene. Rebuild by running `build_assets.py` in Blender. It preserves other scenes and exports `../static/assets/yacht-kit.glb`.

The asset contains TrayBase, TrayFelt, TrayRim and Die. The die has rounded edges and modeled pips on all six faces; opposite faces sum to seven. Blender Z-up converts to glTF Y-up: 1=+Y, 6=-Y, 2=+Z, 5=-Z, 3=+X, 4=-X. The renderer rotates those normals upward to display the server's authoritative values.

Five copies replay the server physics trajectory. Non-held dice fall and collide; held dice stay at their resting poses. All clients render the same trajectory and final values. Native buttons handle mouse, touch and keyboard input and expose values and held states. Reduced-motion users receive the final result immediately. Failed 3D loading retains the existing 2D controls.

Desktop: shared tray and scorecard at left, participants and chat at right. Mobile: sidebar below; scorecard scrolls horizontally with category and own score fixed. Scoring rules are unchanged; the server determines dice values from settled physics poses. Original geometry/materials; Three.js retains its MIT license under static/vendor/three/LICENSE.

Dice detail pass: the ivory body has softened edges and a clear coat; all 21 pips are genuine spherical recesses with concave dark enamel interiors. Runtime dice are 12% larger, lit by softbox reflections, with orientation and position supplied by the physics simulation.

Design restored: rounded ivory dice with the original 0.145 bevel and no black edge material; recessed pips and clear coat are retained. Physical throwing and server face detection remain enabled.
