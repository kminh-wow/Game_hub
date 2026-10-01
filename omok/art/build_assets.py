"""Run inside Blender. Builds only the dedicated Omok_Asset_Studio scene."""
from pathlib import Path
import bpy
import numpy as np
from mathutils import Quaternion

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'static' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.get('Omok_Asset_Studio') or bpy.data.scenes.new('Omok_Asset_Studio')
bpy.context.window.scene = scene
for obj in list(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

def material(name, color, roughness, metal=0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    mat.diffuse_color = (*color, 1)
    return mat

maple = material('Omok_Maple', (.64, .45, .235), .58)
navy = material('Omok_Walnut', (.19, .082, .028), .46)
ink = material('Omok_Inlay', (.115, .08, .048), .75)
brass = material('Omok_Edge', (.30, .15, .059), .46)
black = material('Omok_Black', (.009, .011, .014), .30)
white = material('Omok_White', (.88, .87, .82), .21)

# Packed wood color texture survives glTF export; Blender-only procedural nodes do not.
rng=np.random.default_rng(27)
y,x=np.mgrid[0:1024,0:1024].astype(np.float32)/1024
warp=x+.006*np.sin(y*11)+.009*np.sin(y*4+x*10)
grain=np.sin(warp*650+1.8*np.sin(warp*85)+.7*np.sin(y*6))
fine=np.sin(warp*2450+np.sin(y*17))
growth=np.power(np.maximum(0,grain),12)
variation=.024*np.sin(warp*75)+.010*fine-.058*growth+rng.normal(0,.003,x.shape)
rgba=np.ones((1024,1024,4),dtype=np.float32)
for channel,base in enumerate([.73,.49,.255]):rgba[:,:,channel]=np.clip(base+variation,0,1)
img=bpy.data.images.get('Omok_Maple_Grain') or bpy.data.images.new('Omok_Maple_Grain',width=1024,height=1024)
img.pixels.foreach_set(rgba.ravel());img.pack()
for wood in [maple,navy]:
 shader=next(n for n in wood.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 tex=next((n for n in wood.node_tree.nodes if n.type=='TEX_IMAGE'),None) or wood.node_tree.nodes.new('ShaderNodeTexImage')
 tex.image=img
 wood.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color'])
 shader.inputs['Roughness'].default_value=.48
for stone in [black,white]:
 shader=next(n for n in stone.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 shader.inputs['Coat Weight'].default_value=.10 if stone==black else .20
 shader.inputs['Coat Roughness'].default_value=.24

def slab(name, location, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Soft edges', 'BEVEL')
        mod.width, mod.segments = bevel, 5
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

slab('BoardBase', (0, 0, -.30), (16.6, 16.6, .80), navy, .10)
slab('BoardRim', (0, 0, .045), (16.45, 16.45, .16), brass, .17)
top=slab('BoardTop', (0, 0, .14), (16.25, 16.25, .30), maple, .09)
for face in top.data.polygons:
    for loop in face.loop_indices:
        co=top.data.vertices[top.data.loops[loop].vertex_index].co
        top.data.uv_layers.active.data[loop].uv=(co.x/16.25+.5,co.y/16.25+.5)
lines = []
for i in range(-7, 8):
    lines.append(slab('GridSegment', (i, 0, .295), (.026, 14.03, .008), ink))
    lines.append(slab('GridSegment', (0, i, .295), (14.03, .026, .008), ink))
for x,y in [(-4,-4),(4,-4),(0,0),(-4,4),(4,4)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=8, radius=1, location=(x,y,.297))
    obj=bpy.context.object
    obj.scale=(.085,.085,.012)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(ink)
    lines.append(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in lines: obj.select_set(True)
bpy.context.view_layer.objects.active=lines[0]
bpy.ops.object.join()
lines[0].name='BoardGrid'
for name,mat,x in [('BlackStone',black,-1),('WhiteStone',white,1)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=24, radius=1, location=(x,0,.485))
    obj=bpy.context.object
    obj.name=name
    obj.scale=(.47,.47,.19)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons: poly.use_smooth=True

bpy.ops.export_scene.gltf(filepath=str(OUT/'omok-kit.glb'),use_active_scene=True)
# Saving a copy keeps the user's currently opened file as their working file.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'omok-assets.blend'),copy=True)
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_rotation=Quaternion((1,0,0),.38)
        area.spaces.active.region_3d.view_distance=24
        area.spaces.active.region_3d.view_location=(0,0,0)
print('Exported six Omok meshes:', OUT/'omok-kit.glb')
