# 포트리스 에셋 생성 기록

내장 image_gen 사용. 차체는 사용자 제공, 포신은 이전 수정본 사용.
실사용 PNG: fortress/static/assets/. 실제 알파 투명 배경 유지.
포구 효과: 2×2 / 4프레임. 폭발: 4×2 / 8프레임.

## normal

Create one isolated BASIC ARTILLERY SHELL icon for a cute toy tank game: short chunky ivory bullet with orange tip and dark teal thick outline, gray metal band, polished simple cel shading, side view tilted slightly upright, bold readable silhouette, no text, no UI frame, no shadow or background. Single object centered in square canvas with 15 percent padding. True transparent PNG. Match a cream and gray toy tank with dark teal outlines.

## heavy

Single isolated HEAVY ARTILLERY SHELL inventory icon for cute toy tank game. Very squat wide chunky shell, noticeably wider than a normal bullet, burnt orange rounded nose, ivory metal body, TWO dark gray reinforcing bands, thick dark teal outline, polished simple cel shading, tilted upright toward upper right. Bold readable silhouette. Centered with generous padding, square canvas, real transparent background. No text, no numbers, no frame, no ground shadow.

## fuel

Single fuel jerrycan icon for a cute toy tank game. Squat rounded ivory can, dark teal handle and thick outline, gray cap, orange inset panel with a simple dark droplet symbol (no text). Polished clean cel shading, predominantly front view, chunky readable silhouette. Square canvas, 15 percent padding, true transparent background, no ground shadow, no labels, no letters or UI frame.

## muzzle

Game VFX sprite sheet, four animation frames in EXACT equal 2 by 2 grid on square transparent canvas. Read left to right top row then bottom row. Each quadrant independent with ample transparent padding. Cute cartoon toy tank MUZZLE FLASH pointing right. Frame 1 small yellow spark; frame 2 large cream white core orange starburst; frame 3 small orange flame with cream smoke; frame 4 soft fading smoke puff. All frames have the same origin at 25 percent of each cell width and 50 percent cell height. Flat clean cel shaded rounded forms, orange gold cream, no heavy black outlines. True transparent background. No cannon, no objects, no labels, no numbers, no gridlines. Do not let frames overlap cell boundaries.

## blast

Eight frame explosion animation sprite sheet for cute cartoon artillery game. EXACT 4 columns by 2 rows equally sized cells on a wide 2:1 canvas. Playback left to right top row then bottom row. Every effect centered at exact cell center with generous 15 percent transparent margin, no overlap. Frame 1 tiny cream yellow star; frame 2 expanding yellow orange burst; frame 3 full rounded orange fireball; frame 4 largest bright orange fireball; frame 5 orange flame mixed tan smoke; frame 6 round tan smoke cloud; frame 7 separated smaller pale smoke puffs; frame 8 very faint tiny residual puffs. Clean cel shaded cartoon effects, warm cream gold orange taupe. True transparent background, no ground, no objects, no text, no numbers, no grid lines, no labels. All eight frames visible and strictly separated.


## 4인 차체 변형
내장 image_gen 편집으로 원본 차체의 실루엣·회색 기계부·아이보리 바퀴를 유지하고 포탑과 장갑판만 cobalt blue / golden yellow / emerald green으로 변경. 실제 투명 배경, 포신 제외, 같은 캔버스와 여백.
출력: tank-body-blue.png, tank-body-yellow.png, tank-body-green.png (fortress/static/assets).

## 랜덤 지형 에셋
내장 image_gen 사용.
soil.png: Seamless warm muted brown clay, subtle small rounded pebbles, low contrast, flat uniform lighting, no grass or horizon.
bedrock.png: Seamless dark warm umber underground rock, small rounded stone facets, quiet cel shading, no distinct large features.
grass.png: Three side-view grass tuft variants in equal horizontal cells, muted green and lime highlights, transparent background, no soil or shadows.
rocks.png: Three side-view rock variants in equal horizontal cells (rounded pebble, paired stones, faceted stone), warm taupe, transparent background.
실사용: fortress/static/assets. 텍스처는 렌더링 시 거울 반복으로 경계를 연결하고, 장식 시트는 알파 경계로 프레임을 추출한다. 원본 PNG는 보존한다.
