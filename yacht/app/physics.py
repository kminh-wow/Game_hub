"""Authoritative rigid-body throws, in the renderer's Y-up coordinate system.

Only initial poses/velocities are random. Scores come from settled face normals.
Replay samples use [x, y, z, qx, qy, qz, qw], at 30 Hz.
"""
import math
import random

import pybullet as p

NORMALS = {1: (0, 1, 0), 6: (0, -1, 0), 2: (0, 0, 1),
           5: (0, 0, -1), 3: (1, 0, 0), 4: (-1, 0, 0)}
HALF = .96 * 1.12 / 2
DT = 1 / 240
SAMPLE_STEPS = 8


def top_face(quaternion):
    matrix = p.getMatrixFromQuaternion(quaternion)
    heights = {face: sum(matrix[3 + j] * normal[j] for j in range(3))
               for face, normal in NORMALS.items()}
    face = max(heights, key=heights.get)
    return face, heights[face]


def initial_poses():
    return [[(i - 2) * 1.7, .115 + HALF, 0, 0, 0, 0, 1] for i in range(5)]


def throw_dice(rng: random.Random, poses, held):
    client = p.connect(p.DIRECT)
    kw = {"physicsClientId": client}
    try:
        p.setGravity(0, -18, 0, **kw)
        p.setTimeStep(DT, **kw)
        p.setPhysicsEngineParameter(numSolverIterations=60, **kw)

        def body(half, position, mass=0, orientation=(0, 0, 0, 1)):
            shape = p.createCollisionShape(p.GEOM_BOX, halfExtents=half, **kw)
            obj = p.createMultiBody(mass, shape, basePosition=position,
                                    baseOrientation=orientation, **kw)
            p.changeDynamics(obj, -1, lateralFriction=.65, restitution=.28,
                             linearDamping=.12, angularDamping=.15, **kw)
            return obj

        body([5.3, .15, 1.95], [0, -.035, 0])
        for x in (-5.16, 5.16):
            body([.15, .21, 1.95], [x, .21, 0])
        for z in (-1.81, 1.81):
            body([5.3, .21, .15], [0, .21, z])
        bodies = [body([HALF] * 3, pose[:3], 0 if hold else 1, pose[3:])
                  for pose, hold in zip(poses, held)]

        def launch(i):
            # Uniform SO(3) orientation; never select a target face.
            u, v, w = rng.random(), rng.random(), rng.random()
            q = [math.sqrt(1-u)*math.sin(2*math.pi*v), math.sqrt(1-u)*math.cos(2*math.pi*v),
                 math.sqrt(u)*math.sin(2*math.pi*w), math.sqrt(u)*math.cos(2*math.pi*w)]
            p.resetBasePositionAndOrientation(bodies[i], [(i-2)*1.65, rng.uniform(3, 4), rng.uniform(-.3, .3)], q, **kw)
            p.resetBaseVelocity(bodies[i], [rng.uniform(-.6, .6), -rng.uniform(1, 3), rng.uniform(-.5, .5)],
                                [rng.uniform(-10, 10) for _ in range(3)], **kw)

        def snapshot():
            return [[round(v, 6) for group in p.getBasePositionAndOrientation(b, **kw) for v in group]
                    for b in bodies]

        for i in range(5):
            if not held[i]:
                launch(i)
        frames = [snapshot()]
        quiet = 0
        # Re-drop cocked/out-of-tray dice; a bounded failure never fabricates a value.
        for step in range(240 * 12):
            p.stepSimulation(**kw)
            if (step + 1) % SAMPLE_STEPS == 0:
                frames.append(snapshot())
            settled = True
            for i, b in enumerate(bodies):
                if held[i]:
                    continue
                pos, q = p.getBasePositionAndOrientation(b, **kw)
                linear, angular = p.getBaseVelocity(b, **kw)
                speed = sum(v*v for v in (*linear, *angular))
                valid = top_face(q)[1] > .995 and abs(pos[0]) < 4.6 and abs(pos[2]) < 1.2 and pos[1] < .8
                if pos[1] < -.5 or (step > 240 and speed < .002 and not valid):
                    launch(i)
                    settled = False
                elif speed >= .002 or not valid:
                    settled = False
            quiet = quiet + 1 if settled else 0
            if quiet >= 48 and (step + 1) % SAMPLE_STEPS == 0:
                final = frames[-1]
                return {"dice": [top_face(pose[3:])[0] for pose in final],
                        "poses": final, "frames": frames, "frame_ms": 1000 / 30,
                        "duration_ms": round((len(frames)-1)*1000/30)}
        raise RuntimeError("주사위가 멈추지 않았어요. 다시 굴려 주세요.")
    finally:
        p.disconnect(**kw)
