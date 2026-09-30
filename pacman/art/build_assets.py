"""Run in Blender via MCP. Original primitive-based arcade assets, Z-up source.

The glTF exporter converts these to Y-up. Pacman faces +X; Chomp is a
shape-key animation shared by the normal and powered material variants.
"""
import bpy
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.get('Pacman_Asset_Studio') or bpy.data.scenes.new('Pacman_Asset_Studio')
bpy.context.window.scene = scene
for name in ['Pacman', 'PacmanPower', 'GhostBody', 'EyeWhite', 'EyePupil', 'Pellet', 'PowerPellet', 'WallTile']:
    obj = scene.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 13

def material(name, color, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    node = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = .32
    node.inputs['Coat Weight'].default_value = .25
    node.inputs['Emission Color'].default_value = (*color, 1)
    node.inputs['Emission Strength'].default_value = emission
    return m

yellow = material('Pacman_Lemon', (1, .66, .025))
gold = material('Pacman_Power_Gold', (1, .83, .16), .65)
blue = material('Maze_Perwinkle', (.16, .27, .78))
coral = material('Ghost_Coral', (.96, .19, .26))
white = material('Eyes_Porcelain', (.97, .98, 1))
ink = material('Eyes_Ink', (.025, .04, .09))
mouth = material('Mouth_Interior', (.055, .018, .008))
crumb = material('Pellet_Vanilla', (1, .76, .32), .15)
power = material('Power_Star_Magenta', (.8, .008, .22), .45)

def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    data.materials.append(mat)
    for poly in data.polygons:
        poly.use_smooth = True
    return obj

def pac_vertices(angle):
    verts = []
    for j in range(25):
        lat = math.pi * j / 24
        r = .49 * math.sin(lat)
        z = .49 * math.cos(lat)
        for i in range(49):
            a = angle + (2 * math.pi - 2 * angle) * i / 48
            verts.append((r * math.cos(a), r * math.sin(a), z))
    verts += [(0, 0, .49 * math.cos(math.pi*j/24)) for j in range(25)]
    return verts

faces = []
for j in range(24):
    for i in range(48):
        a = j*49+i
        faces.append((a, a+49, a+50, a+1))
    a, b, c = j*49, (j+1)*49, 25*49+j
    faces.append((c, c+1, b, a))
    faces.append((a+48, b+48, c+1, c))

for name, mat, offset in [('Pacman', yellow, -2), ('PacmanPower', gold, 0)]:
    obj = mesh(name, pac_vertices(.035), faces, mat)
    obj.data.materials.append(mouth)
    for polygon in obj.data.polygons:
        if polygon.index % 50 >= 48:
            polygon.material_index = 1
            polygon.use_smooth = False
    obj.location = (offset, 0, .7)
    obj.shape_key_add(name='Basis')
    key = obj.shape_key_add(name='Chomp')
    for v, co in zip(key.data, pac_vertices(.86)):
        v.co = co
    for frame, value in [(1, 0), (5, 1), (9, 1), (13, 0)]:
        key.value = value
        key.keyframe_insert('value', frame=frame)
    obj.data.shape_keys.animation_data.action.name = name + '_Chomp'

verts, faces = [], []
for j in range(13):
    a = j / 12 * math.pi / 2
    r = .45 * math.sin(a)
    z = .48 + .46 * math.cos(a)
    for i in range(32):
        t = i/32*math.tau
        verts.append((r*math.cos(t), r*math.sin(t), z))
for i in range(32):
    t = i/32*math.tau
    verts.append((.49*math.cos(t), .49*math.sin(t), -.29+.17*math.cos(5*t)))
for j in range(13):
    for i in range(32):
        a, b = j*32+i, j*32+(i+1)%32
        faces.append((a, a+32, b+32, b))
ghost = mesh('GhostBody', verts, faces, coral)
ghost.location = (2, 0, .6)

def sphere(name, radius, mat, location):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj

sphere('EyeWhite', .16, white, (3.5, 0, .5))
sphere('EyePupil', .075, ink, (4, 0, .5))
sphere('Pellet', .085, crumb, (-2, -2, .3))
# Broad five-point star, facing upward so it reads from the game camera.
outline = []
for i in range(10):
    angle = math.pi / 2 + i * math.pi / 5
    radius = .48 if i % 2 == 0 else .225
    outline.append((radius * math.cos(angle), radius * math.sin(angle)))
vertices = [(x, y, z) for z in [-.09, .09] for x, y in outline]
faces = [tuple(reversed(range(10))), tuple(range(10, 20))]
faces += [(i, (i+1)%10, (i+1)%10+10, i+10) for i in range(10)]
star = mesh('PowerPellet', vertices, faces, power)
star.location = (0, -2, .3)
for polygon in star.data.polygons:
    polygon.use_smooth = False
bpy.context.view_layer.objects.active = star
bevel = star.modifiers.new('Star_soft_edges', 'BEVEL')
bevel.width, bevel.segments = .025, 2
bpy.ops.object.modifier_apply(modifier=bevel.name)
bpy.ops.mesh.primitive_cube_add(size=1, location=(2, -2, .25))
wall = bpy.context.object
wall.name = 'WallTile'
wall.scale = (.99, .99, .50)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
wall.data.materials.append(blue)
bevel = wall.modifiers.new('Soft_edges', 'BEVEL')
bevel.width, bevel.segments = .085, 3
bpy.context.view_layer.objects.active = wall
bpy.ops.object.modifier_apply(modifier=bevel.name)

scene.frame_set(7)
for obj in scene.objects:
    obj.select_set(True)
# Defaults are GLB; avoid version-dependent dynamic enum identifiers.
bpy.ops.export_scene.gltf(filepath=str(OUT / 'arcade-kit.glb'), use_selection=False, use_active_scene=True, export_animations=True, export_force_sampling=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'art' / 'pacman-assets.blend'))
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        region = next(r for r in area.regions if r.type == 'WINDOW')
        with bpy.context.temp_override(area=area, region=region):
            bpy.ops.view3d.view_selected()
print('Saved Blender source and GLB:', OUT / 'arcade-kit.glb')
