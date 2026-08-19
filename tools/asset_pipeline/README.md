# 에셋 파이프라인 (asset_pipeline)

AI 생성 원본 이미지를 게임용 픽셀아트 에셋으로 변환하는 후처리 도구.
게임 코드와 완전히 독립되어 있으며, 산출물(`processed/`)만 게임에서 사용한다.

## 사용법

```bash
# 의존성 (Pillow + numpy만 필수)
pip install Pillow numpy

# 전체 일괄 처리: raw/ → processed/
python tools/asset_pipeline/process.py

# 진영색 팔레트 스왑 + 미리보기만 재실행 (스왑 설정 튜닝 시)
python tools/asset_pipeline/process.py --swap-only

# 타일 배경화 톤 다운만 재실행 (톤 설정 튜닝 시)
python tools/asset_pipeline/process.py --tone-only

# 지형 경계 전환 타일(오토타일)만 재생성 (마스크 파라미터 튜닝 시)
python tools/asset_pipeline/process.py --autotile-only
```

- 입력: `tools/asset_pipeline/raw/` — AI 생성 원본 PNG
- 출력: `tools/asset_pipeline/processed/` — 게임용 에셋
  - `processed/factions/` — 유닛별 3진영 색상 변형
  - `processed/toned/` — 타일 배경화(톤 다운)본. 게임은 이쪽을 쓴다
    (`scripts/sync-assets.mjs` 가 타일에 한해 toned 를 우선 복사)
  - `processed/autotile/` — 지형 경계 전환 타일 (`<낮은지형>_<높은지형>_<패턴>.png`)
  - `processed/_work/` — 배경 제거된 원본 해상도 중간물 (`--swap-only`용 캐시, 커밋 안 함)

## 파일명 규칙과 목표 크기

| 접두사 | 용도 | 목표 크기 | 비고 |
|---|---|---|---|
| `tile_*.png` | 지형 타일 | 32×32 | 중앙 크롭 후 축소, 불투명 |
| `obj_*.png` | 오브젝트 | 32×32 | 배경 제거 → 투명 PNG |
| `unit_*.png` | 유닛 | 32×32 | 배경 제거 + 진영색 3벌 생성 |
| `portrait_*.png` | 초상화 | 96×96 | 규칙만 준비 (현재 에셋 없음) |

예외 크기는 `SIZE_OVERRIDES`에 파일명 단위로 지정한다
(현재 `obj_gate` → 64×32, 가로로 넓은 구조물).

## 처리 단계

1. **[타일] 중앙 크롭** — 바깥 `TILE_EDGE_TRIM`(기본 8%)씩 잘라내고 중앙 84%만 사용.
   AI 생성물의 가장자리 어두운 테두리 제거.
2. **다운스케일** — NEAREST 방식으로 목표 크기로 축소.
   비정사각 원본은 내용물(불투명 영역) 중심으로 목표 비율에 맞게 크롭 후 축소.
3. **색상 양자화** — 이미지당 `QUANT_COLORS`(기본 32)색 이하, 디더링 없음.
4. **[유닛/오브젝트] 배경 제거** — 회색 단색 배경(RGB 145 부근)을 투명 처리.
   테두리 픽셀에서 배경색을 자동 추정하고, 색 거리 `BG_THRESHOLD` 이내이면서
   이미지 테두리에 연결된 픽셀만 플러드필로 제거한다(스프라이트 내부의 비슷한
   회색은 보존). 제거 후 테두리 잔존율이 `BG_RESIDUE_LIMIT`를 넘으면
   rembg가 설치된 경우 rembg로 폴백한다.
4¼. **[성벽 부품 전용] `obj_wall_h`·`obj_wall_v`·`obj_wall_corner`** —
   배경 제거 후 내용물 bbox 를 완전히 잘라내고, 코너의 팔 두께를 실측해
   가로/세로 벽을 같은 두께의 띠로 만들어 코너와 같은 변(하단/우측)에
   정렬한다. 가로벽은 끝 기둥(`WALL_H_SPAN`), 세로벽은 지붕 끝단
   장식(`WALL_V_BAND`)을 잘라 중앙 반복 구간만 쓴다. 극단적 축소이므로
   이 부품들만 NEAREST 대신 면적평균(BOX)으로 눌러 벽돌 결을 남긴다.
   렌더러에서 이어 쓸 때: 띠는 바깥 변에 붙어 있으므로 북쪽 변은 가로벽을
   상하 반전, 서쪽 변은 세로벽을 좌우 반전해 쓴다(코너는 반전 조합).
4¾. **[타일] 오토타일 — 지형 경계 전환 타일** — 경계 타일을 AI 로 따로
   만들지 않고, 톤 다운된 타일 **두 장을 마스크로 합성해 코드가 만든다**
   (그래야 색·화풍이 어긋날 여지가 없다). `TERRAIN_PRIORITY` 가 정한
   낮은 지형 위에 높은 지형이 얹히며, 패턴은 4방위 비트마스크 16가지
   (N=1·E=2·S=4·W=8)에 대각 전용 4가지를 더한 20가지다(0=전환 없음이라
   쌍마다 19장). 경계는 직선이 아니라 가장자리를 따라 흔들리는 깊이
   (`AT_JITTER`)와 그 주변에 픽셀을 흩뿌리는 띠(`AT_DITHER`)로 침식감을
   준다. 흔들림은 변의 양 끝에서 0 으로 수렴시켜 같은 전환이 이어지는 옆
   타일과 만나도 계단이 생기지 않게 했다. 시드(`AT_SEED`)가 쌍·패턴에서만
   나오므로 몇 번을 돌려도 같은 그림이다. 실제 전장에서 맞닿는 지형 쌍만
   만든다(현재 18쌍 × 19패턴 = 342장).
4½. **[타일] 배경화 톤 다운** — 지형은 무대, 유닛이 주인공. 전체 타일의
   채도·대비를 낮추고 살짝 밝히며(`TONE_*`), 완전 검정 픽셀을
   `TONE_BLACK_FLOOR` 밝기까지 끌어올린다(숲·산의 검은 구멍 완화).
   원본 `processed/tile_*.png` 는 보존하고 `processed/toned/` 에 출력.
5. **[유닛] 진영색 팔레트 스왑** — 갑옷·의복 색(`SWAP_SOURCE`)을 진영별 명암
   램프(`FACTIONS`)로 치환해 `processed/factions/unit_이름_진영.png` 3벌 생성.
   양자화로 색이 병합되기 전인 원본 해상도 중간물에서 수행한다.
6. **미리보기 생성** — 아래 3종.

## 미리보기

| 파일 | 내용 |
|---|---|
| `processed/_preview.png` | 전 에셋 처리 전후 비교 (투명부는 체커보드) |
| `processed/_tiling_preview.png` | 각 타일 3×3 이어붙임 — 이음새 확인용 |
| `processed/_faction_preview.png` | 유닛별 원본 + 고구려/백제/신라 나란히 |
| `processed/_visibility_preview.png` | 어두운 지형(`VISIBILITY_TILES`) 3×3 위에 3진영 보병 — 가독성 확인용 |
| `processed/_wall_assembly_preview.png` | 성벽 부품으로 ㅁ자 성곽 조립 (모서리 4 + 벽 + 성문 + 망루) — 이음 검증용 |
| `processed/_autotile_preview.png` | 같은 지형도를 전환 타일 적용 전/후로 그린 비교 (풀↔숲·풀↔산·풀↔강) |

## 설정 항목 (`process.py` 상단 설정부)

| 항목 | 기본값 | 설명 |
|---|---|---|
| `TARGET_SIZES` / `SIZE_OVERRIDES` | — | 접두사별 목표 크기 / 파일별 예외 |
| `TILE_EDGE_TRIM` | 0.08 | 타일 가장자리 잘라내는 비율 (한 변당) |
| `QUANT_COLORS` | 32 | 이미지당 최대 색상 수 |
| `BG_REFERENCE` | (145,145,145) | 배경 기준색 (자동 추정 실패 시 폴백) |
| `BG_THRESHOLD` | 40 | 배경으로 간주할 색 거리 |
| `BG_RESIDUE_LIMIT` | 0.02 | rembg 폴백을 발동하는 테두리 잔존 비율 |
| `TERRAIN_PRIORITY` | grass<road<sand<forest<hill<ridge<mountain<ford<river | 오토타일: 낮은 쪽 위에 높은 쪽이 얹힌다 |
| `AT_DEPTH` | 9.0 | 오토타일: 높은 지형이 파고드는 기본 깊이(px) |
| `AT_JITTER` | 3.2 | 오토타일: 경계 들쭉날쭉함의 진폭(px). 0 이면 직선 |
| `AT_DITHER` | 2.2 | 오토타일: 경계 주변 흩뿌림 띠의 폭(px) |
| `AT_CORNER_R` | 13.0 | 오토타일: 대각 패턴의 모서리 반지름(px) |
| `AT_SEED` | 20260819 | 오토타일: 시드. 같은 조합은 언제나 같은 결과 |
| `WALL_H_SPAN` | (0.065, 0.935) | 가로벽: bbox 중 사용할 가로 구간 (끝 기둥 제거) |
| `WALL_V_BAND` | (0.175, 0.775) | 세로벽: bbox 중 사용할 세로 구간 (지붕 끝단 제거) |
| `WALL_T_DEFAULT` | 9 | 코너 실측 실패 시 벽 두께(px) |
| `TONE_SATURATION` | 0.70 | 톤 다운: 채도 배율 (-30%) |
| `TONE_CONTRAST` | 0.65 | 톤 다운: 대비 배율 (-35%, 중심 128) |
| `TONE_BRIGHTNESS` | 6 | 톤 다운: 밝기 가산 |
| `TONE_BLACK_FLOOR` | 30 | 톤 다운: 검정 픽셀 밝기 하한 |
| `SWAP_SOURCE` | 갈색/보라 계열 | 치환 기준색 (갑옷·의복) |
| `SWAP_EXCLUDE` | 피부·무기·근흑색 | 전 유닛 공통 보호색 |
| `SWAP_EXCLUDE_EXTRA` | 말 색 등 | 특정 유닛 전용 보호색 (stem 키) |
| `SWAP_THRESHOLD` | 34 | 치환을 허용하는 최대 색 거리 |
| `SWAP_LUMA_MIN` | 26 | 이보다 어두운 픽셀은 치환 금지 (윤곽선 보호) |
| `SWAP_MIN_CHROMA` | 5 | 무채색(회색) 픽셀 치환 금지 (AA 혼합 픽셀 보호) |
| `FACTIONS` | 고구려 검정(조의선인) / 백제 자주색(자색 도포) / 신라 금색(금관) | 진영별 명암 램프 (어두운→밝은 4단계). 고구려는 어두운 지형 가독성을 위해 원안보다 한 단계 밝게 시프트됨 |
| `SWAP_LUMA_RANGE` | (8, 125) | 원본 밝기 → 램프 단계 매핑 범위 |
| `VISIBILITY_TILES` / `VISIBILITY_UNIT` | forest·mountain / infantry | 가독성 미리보기에 쓸 지형·유닛 |

### 튜닝 요령

- **배경 잔여물이 남을 때**: `BG_THRESHOLD`를 올린다 (너무 올리면 스프라이트
  가장자리가 깎임). 그래도 지저분하면 `pip install rembg` 후 재실행.
- **스왑 오염(말·무기·피부에 진영색)**: 오염된 원본색을 `SWAP_EXCLUDE`(공통)나
  `SWAP_EXCLUDE_EXTRA`(해당 유닛만)에 추가하거나 `SWAP_THRESHOLD`를 내린다.
- **스왑 누락(갑옷이 안 물듦)**: 누락 부위의 원본색을 `SWAP_SOURCE`에 추가하거나
  `SWAP_THRESHOLD`를 올린다.
- 스왑 설정만 바꿨다면 `--swap-only`로 빠르게 재실행하며 확인한다.
