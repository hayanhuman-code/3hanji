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
```

- 입력: `tools/asset_pipeline/raw/` — AI 생성 원본 PNG
- 출력: `tools/asset_pipeline/processed/` — 게임용 에셋
  - `processed/factions/` — 유닛별 3진영 색상 변형
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

## 설정 항목 (`process.py` 상단 설정부)

| 항목 | 기본값 | 설명 |
|---|---|---|
| `TARGET_SIZES` / `SIZE_OVERRIDES` | — | 접두사별 목표 크기 / 파일별 예외 |
| `TILE_EDGE_TRIM` | 0.08 | 타일 가장자리 잘라내는 비율 (한 변당) |
| `QUANT_COLORS` | 32 | 이미지당 최대 색상 수 |
| `BG_REFERENCE` | (145,145,145) | 배경 기준색 (자동 추정 실패 시 폴백) |
| `BG_THRESHOLD` | 40 | 배경으로 간주할 색 거리 |
| `BG_RESIDUE_LIMIT` | 0.02 | rembg 폴백을 발동하는 테두리 잔존 비율 |
| `SWAP_SOURCE` | 갈색/보라 계열 | 치환 기준색 (갑옷·의복) |
| `SWAP_EXCLUDE` | 피부·무기·근흑색 | 전 유닛 공통 보호색 |
| `SWAP_EXCLUDE_EXTRA` | 말 색 등 | 특정 유닛 전용 보호색 (stem 키) |
| `SWAP_THRESHOLD` | 34 | 치환을 허용하는 최대 색 거리 |
| `SWAP_LUMA_MIN` | 26 | 이보다 어두운 픽셀은 치환 금지 (윤곽선 보호) |
| `SWAP_MIN_CHROMA` | 5 | 무채색(회색) 픽셀 치환 금지 (AA 혼합 픽셀 보호) |
| `FACTIONS` | 고구려 남색 / 백제 금갈색 / 신라 적색 | 진영별 명암 램프 (어두운→밝은 5단계) |
| `SWAP_LUMA_RANGE` | (8, 125) | 원본 밝기 → 램프 단계 매핑 범위 |

### 튜닝 요령

- **배경 잔여물이 남을 때**: `BG_THRESHOLD`를 올린다 (너무 올리면 스프라이트
  가장자리가 깎임). 그래도 지저분하면 `pip install rembg` 후 재실행.
- **스왑 오염(말·무기·피부에 진영색)**: 오염된 원본색을 `SWAP_EXCLUDE`(공통)나
  `SWAP_EXCLUDE_EXTRA`(해당 유닛만)에 추가하거나 `SWAP_THRESHOLD`를 내린다.
- **스왑 누락(갑옷이 안 물듦)**: 누락 부위의 원본색을 `SWAP_SOURCE`에 추가하거나
  `SWAP_THRESHOLD`를 올린다.
- 스왑 설정만 바꿨다면 `--swap-only`로 빠르게 재실행하며 확인한다.
