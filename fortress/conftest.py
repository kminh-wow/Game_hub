# 이 폴더에서 pytest 를 돌릴 때 저장소 루트의 common 패키지를 찾을 수 있게 한다.
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
