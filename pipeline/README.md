# 삼한지 지도 생성 파이프라인

전략맵 HTML을 만들어내는 스크립트 모음. 거점을 추가하거나 지도 범위를
바꿀 때 이 순서대로 다시 돌리면 된다.

## 실행 순서

```bash
python3 build_map.py      # ① 지형·산맥·거점 좌표 생성 → mapdata.json
python3 build_routes.py   # ② 육로/수로 경로탐색 → mapdata.json에 routes 추가
python3 build_html.py     # ③ template.html + mapdata.json → 최종 HTML
python3 validate_routes.py  # ④ 검증(선택): 길이 지형을 위반하는지 확인
```

## 파일 역할

| 파일 | 역할 |
|---|---|
| `build_map.py` | Natural Earth 데이터 → 람베르트 정각원추도법 투영 → 해안선·하천·산맥·거점 좌표 |
| `build_routes.py` | 격자 A* 경로탐색. 육로는 육지만·수로는 바다만 통과, 산맥 회피 가중 |
| `build_html.py` | 거점 부가데이터(개발치·설명·병선) + 도로 목록 정의, 템플릿에 주입 |
| `validate_routes.py` | 생성된 경로가 지형을 지키는지 자동 검사 |
| `template.html` | UI 템플릿. `/*__MAPDATA__*/` 자리에 지도 데이터가 주입됨 |
| `mapdata.json` | 생성 결과물 (지형 패스, 거점, 경로) — 재생성 가능 |

## 최초 1회 필요한 원본 데이터

`build_map.py`는 Natural Earth 10m 데이터를 읽는다. 같은 폴더에 아래를 받아둘 것.

```bash
curl -sLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
curl -sL -o rivers.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson
curl -sL -o lakes.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
mv ne_10m_land.geojson land.geojson
```
(퍼블릭 도메인)

## 거점 추가하는 법

1. `build_map.py`의 `CASTLES` 리스트에 `(id, 이름, 경도, 위도, 유형, 세력)` 추가
2. `build_html.py`의 `EXTRA`에 개발치·설명 추가, `ROADS`에 연결 추가
   - 항구면 `NAVY`에 병선 정원도 추가
3. 위 실행 순서대로 재생성

## 주의점 (실패했던 것들)

- 산맥 능선 좌표는 반드시 육지 위여야 함. `build_map.py`가 자동 검사하지
  않으므로 추가 후 눈으로 확인할 것 (원산만·동해안 구간에서 실수하기 쉬움)
- 수로는 `build_routes.py`의 `SEA_ROUTES`에 명시된 쌍만 생성됨.
  "양쪽이 항구면 자동 수로" 규칙은 인접 해안까지 배로 돌게 만들어 폐기함
- 하천을 통항 수역으로 인정하면 배가 내륙 하천으로 몰림. 시도했다가 폐기함
- Catmull-Rom 장력 계수는 1/11. 기본값 1/6은 급커브에서 해안선을 넘음

## 전장맵 (battlemaps.json)

```bash
# 지리 원본을 내려받는다 (저장소에 넣지 않는다 — 17MB)
curl -sL -o land.geojson   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson
curl -sL -o rivers.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson
cp ../src/data/mapdata.json .

python3 build_battlemaps.py      # 지형 + 성곽(§7) → battlemaps.json
python3 validate_battlemaps.py   # §7.6 검증 12항목 — 위반 0 이어야 한다
python3 build_bmviewer.py        # ../docs/battlemap-viewer.html
cp battlemaps.json ../src/data/
```

`castleworks.py` 가 §7 성곽 규격을 맡는다. 지형은 `build_battlemaps.py`,
성은 `castleworks.py` — §7 을 고칠 때 지리 코드를 건드릴 일이 없게 나눠 두었다.

**생성은 결정론적이다.** 같은 입력이면 76곳이 한 타일도 안 바뀐다.
(예전에는 `hash()` 를 써서 실행할 때마다 전부 달라졌다.)
