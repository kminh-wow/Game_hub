# 이 폴더에서 pytest 를 돌릴 때 저장소 루트의 common 패키지를 찾을 수 있게 한다.
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 테스트에서는 로컬 LLM 을 부르지 않는다 (미리 써 둔 대사만)
os.environ.setdefault("BANTER_LLM_URL", "off")
