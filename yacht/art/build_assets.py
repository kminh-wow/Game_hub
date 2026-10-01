"""Run in Blender to build the isolated Yacht_Asset_Studio scene."""
from pathlib import Path
import bpy, math
from mathutils import Quaternion
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'static'/'assets'; OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes.get('Yacht_Asset_Studio') or bpy.data.scenes.new('Yacht_Asset_Studio')
bpy.context.window.scene=scene
for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
def mat(name,color,rough):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True
 n=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=rough
 m.diffuse_color=(*color,1);return m
navy=mat('Yacht_Navy',(.025,.04,.085),.43)
felt=mat('Yacht_Blue_Felt',(.055,.105,.24),.95)
ivory=mat('Yacht_Ivory',(.88,.84,.73),.23)
resin=next(n for n in ivory.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
resin.inputs['Coat Weight'].default_value=.28
resin.inputs['Coat Roughness'].default_value=.18
ink=mat('Yacht_Ink',(.012,.017,.028),.34)
def box(name,loc,size,material,bevel):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 b=o.modifiers.new('Rounded edges','BEVEL');b.width=bevel;b.segments=5
 bpy.ops.object.modifier_apply(modifier=b.name)
 return o
box('TrayBase',(0,0,-.12),(10.6,3.9,.38),navy,.23)
box('TrayFelt',(0,0,.045),(10.02,3.32,.14),felt,.20)
def boundary(w,h,r):
 points=[]
 for cx,cy,start in [(w/2-r,h/2-r,0),(-w/2+r,h/2-r,90),(-w/2+r,-h/2+r,180),(w/2-r,-h/2+r,270)]:
  for j in range(9):
   a=math.radians(start+j*90/8);points.append((cx+r*math.cos(a),cy+r*math.sin(a)))
 return points
outer=boundary(10.6,3.9,.38);inner=boundary(10.02,3.32,.25);n=len(outer)
verts=[(x,y,z) for pts,z in [(outer,0),(outer,.42),(inner,.42),(inner,.08)] for x,y in pts]
faces=[]
for j in range(n):
 k=(j+1)%n
 for layer in range(3): faces.append((layer*n+j,layer*n+k,(layer+1)*n+k,(layer+1)*n+j))
mesh=bpy.data.meshes.new('TrayRimMesh');mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('TrayRim',mesh);scene.collection.objects.link(o);o.data.materials.append(navy)
bpy.context.view_layer.objects.active=o;o.select_set(True)
b=o.modifiers.new('Rounded rim','BEVEL');b.width=.055;b.segments=3;bpy.ops.object.modifier_apply(modifier=b.name)
# Dice use conventional opposite pairs 1/6, 2/5, 3/4.
die=box('Die',(0,0,0),(.96,.96,.96),ivory,.145)
parts=[die];cutters=[]
patterns={1:[(0,0)],2:[(-1,-1),(1,1)],3:[(-1,-1),(0,0),(1,1)],4:[(-1,-1),(-1,1),(1,-1),(1,1)],5:[(-1,-1),(-1,1),(0,0),(1,-1),(1,1)],6:[(-1,-1),(-1,0),(-1,1),(1,-1),(1,0),(1,1)]}
for value,(axis,sign) in {1:(2,1),6:(2,-1),2:(1,-1),5:(1,1),3:(0,1),4:(0,-1)}.items():
 other=[a for a in range(3) if a!=axis]
 for u,v in patterns[value]:
  loc=[0,0,0];loc[axis]=sign*.535;loc[other[0]]=u*.225;loc[other[1]]=v*.225
  bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,radius=.105,location=loc)
  cutters.append(bpy.context.object)
  # Concave enamel bowl sits inside the cut, leaving an ivory bevel around its lip.
  verts=[];faces=[];segments=32;rings=6
  for ring in range(rings+1):
   radius=.077*ring/rings
   for j in range(segments):
    angle=2*math.pi*j/segments;co=list(loc)
    co[axis]=sign*(.535-math.sqrt(.105**2-radius**2)+.001)
    co[other[0]]+=radius*math.cos(angle);co[other[1]]+=radius*math.sin(angle);verts.append(co)
  for ring in range(rings):
   for j in range(segments):
    k=(j+1)%segments
    face=(ring*segments+j,(ring+1)*segments+j,(ring+1)*segments+k,ring*segments+k)
    if sign!=(-1 if axis==1 else 1):face=tuple(reversed(face))
    faces.append(face)
  mesh=bpy.data.meshes.new('RecessedEnamel');mesh.from_pydata(verts,[],faces);mesh.update()
  p=bpy.data.objects.new('PipEnamel',mesh);scene.collection.objects.link(p);p.data.materials.append(ink)
  for f in mesh.polygons:f.use_smooth=True
  parts.append(p)
bpy.ops.object.select_all(action='DESELECT')
for c in cutters:c.select_set(True)
bpy.context.view_layer.objects.active=cutters[0];bpy.ops.object.join();cutter=cutters[0]
bpy.context.view_layer.objects.active=die
cut=die.modifiers.new('Real recessed pips','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
bpy.ops.object.modifier_apply(modifier=cut.name);bpy.data.objects.remove(cutter,do_unlink=True)
for f in die.data.polygons:f.use_smooth=True
normal=die.modifiers.new('Weighted face normals','WEIGHTED_NORMAL');normal.keep_sharp=True;normal.weight=50
bpy.ops.object.modifier_apply(modifier=normal.name)
bpy.ops.object.select_all(action='DESELECT')
for p in parts:p.select_set(True)
bpy.context.view_layer.objects.active=die;bpy.ops.object.join();die.location.z=.61
bpy.ops.export_scene.gltf(filepath=str(OUT/'yacht-kit.glb'),use_active_scene=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art'/'yacht-assets.blend'),copy=True)
for area in bpy.context.screen.areas:
 if area.type=='VIEW_3D':
  area.spaces.active.region_3d.view_rotation=Quaternion((1,0,0),.5)
  area.spaces.active.region_3d.view_distance=15
  area.spaces.active.region_3d.view_location=(0,0,0)
print('Saved Yacht Blender source and GLB')
