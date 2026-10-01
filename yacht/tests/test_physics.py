import random

import pytest

from app.physics import initial_poses, throw_dice, top_face


@pytest.mark.parametrize("seed", range(12))
def test_throw_settles_and_scores_visible_face(seed):
    result = throw_dice(random.Random(seed), initial_poses(), [False] * 5)
    assert result["frames"][-1] == result["poses"]
    assert result["duration_ms"] > 500
    assert all(pose[1] >= 3 for pose in result["frames"][0])
    for face, pose in zip(result["dice"], result["poses"]):
        actual, alignment = top_face(pose[3:])
        assert actual == face and alignment > .995
        assert abs(pose[0]) < 4.6 and abs(pose[2]) < 1.2
        assert .64 < pose[1] < .8


def test_held_dice_keep_pose_through_whole_throw():
    first = throw_dice(random.Random(71), initial_poses(), [False] * 5)
    held = [True, False, True, False, True]
    second = throw_dice(random.Random(72), first["poses"], held)
    for i in (0, 2, 4):
        assert second["dice"][i] == first["dice"][i]
        for frame in second["frames"]:
            assert frame[i] == pytest.approx(first["poses"][i], abs=2e-6)


def test_each_face_normal_can_be_read():
    import pybullet as p
    import math
    for euler, expected in [([0,0,0],1), ([math.pi,0,0],6),
                            ([-math.pi/2,0,0],2), ([math.pi/2,0,0],5),
                            ([0,0,math.pi/2],3), ([0,0,-math.pi/2],4)]:
        face, alignment = top_face(p.getQuaternionFromEuler(euler))
        assert face == expected and alignment == pytest.approx(1)
