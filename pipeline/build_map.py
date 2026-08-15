import sys
sys.setrecursionlimit(50000)
"""
Natural Earth 10m 데이터 → 삼한지 전략맵 SVG 지오메트리 생성
투영: Lambert Conformal Conic (표준위선 35N / 42N, 중앙자오선 125E)
"""
import json, math


# ── 원본 지리 데이터 확보 (Natural Earth 10m, 퍼블릭 도메인) ──
# 파일이 없으면 자동으로 내려받는다. 최초 1회만 필요하며 약 22MB.
import os, urllib.request
_NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
_NEED = {
    "land.geojson":   "ne_10m_land.geojson",
    "rivers.geojson": "ne_10m_rivers_lake_centerlines.geojson",
    "lakes.geojson":  "ne_10m_lakes.geojson",
}
for _local, _remote in _NEED.items():
    if os.path.exists(_local):
        continue
    print(f"[원본 데이터] {_local} 없음 → 내려받는 중… ({_remote})")
    try:
        urllib.request.urlretrieve(_NE + _remote, _local)
        print(f"           완료: {os.path.getsize(_local)//1024:,} KB")
    except Exception as e:
        print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 원본 지리 데이터를 내려받지 못했습니다.  ({e})

 인터넷이 막혀 있다면 아래 세 파일을 직접 받아
 이 스크립트와 같은 폴더에 두세요. (Natural Earth, 퍼블릭 도메인)

   {_NE}ne_10m_land.geojson                    → land.geojson
   {_NE}ne_10m_rivers_lake_centerlines.geojson → rivers.geojson
   {_NE}ne_10m_lakes.geojson                   → lakes.geojson

 참고: 지도 범위나 거점을 바꾸지 않는다면 이 스크립트는
       돌릴 필요가 없습니다. 기존 mapdata.json을 그대로 쓰면 됩니다.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")
        raise SystemExit(1)

# ── 표시 영역 (경위도) ──
LON0, LON1 = 118.4, 132.6
LAT0, LAT1 = 32.9, 46.6
PAD = 1.2                      # 클리핑 여유 (잘린 변이 화면 밖으로)
OUT_W = 1760.0                  # SVG 폭

# ── Lambert Conformal Conic ──
P1, P2, LC, PC = math.radians(35), math.radians(44), math.radians(125), math.radians(39.5)
_n = math.log(math.cos(P1) / math.cos(P2)) / math.log(
    math.tan(math.pi/4 + P2/2) / math.tan(math.pi/4 + P1/2))
_F = math.cos(P1) * math.tan(math.pi/4 + P1/2)**_n / _n
_r0 = _F / math.tan(math.pi/4 + PC/2)**_n


def lcc(lon, lat):
    lat = max(min(lat, 89.0), -89.0)
    r = _F / math.tan(math.pi/4 + math.radians(lat)/2)**_n
    t = _n * (math.radians(lon) - LC)
    return r*math.sin(t), _r0 - r*math.cos(t)


# 화면 좌표 보정값 산출 (표시 영역 모서리 기준)
_xs, _ys = [], []
for lo in [LON0 + i*(LON1-LON0)/24 for i in range(25)]:
    for la in (LAT0, LAT1):
        x, y = lcc(lo, la); _xs.append(x); _ys.append(y)
for la in [LAT0 + i*(LAT1-LAT0)/24 for i in range(25)]:
    for lo in (LON0, LON1):
        x, y = lcc(lo, la); _xs.append(x); _ys.append(y)
MINX, MAXX, MINY, MAXY = min(_xs), max(_xs), min(_ys), max(_ys)
SCALE = OUT_W / (MAXX - MINX)
OUT_H = round((MAXY - MINY) * SCALE, 1)


def screen(lon, lat):
    x, y = lcc(lon, lat)
    return ((x - MINX) * SCALE, (MAXY - y) * SCALE)


# ── Sutherland–Hodgman 사각형 클리핑 ──
CLIP = (LON0-PAD, LAT0-PAD, LON1+PAD, LAT1+PAD)

def _inside(p, edge):
    x, y = p
    return (x >= CLIP[0]) if edge == 0 else (x <= CLIP[2]) if edge == 1 \
        else (y >= CLIP[1]) if edge == 2 else (y <= CLIP[3])

def _isect(a, b, edge):
    (x1, y1), (x2, y2) = a, b
    if edge in (0, 1):
        xe = CLIP[0] if edge == 0 else CLIP[2]
        t = (xe - x1) / (x2 - x1)
        return (xe, y1 + t*(y2 - y1))
    ye = CLIP[1] if edge == 2 else CLIP[3]
    t = (ye - y1) / (y2 - y1)
    return (x1 + t*(x2 - x1), ye)

def clip_poly(ring):
    out = ring
    for e in range(4):
        if not out: return []
        inp, out = out, []
        prev = inp[-1]
        for cur in inp:
            if _inside(cur, e):
                if not _inside(prev, e): out.append(_isect(prev, cur, e))
                out.append(cur)
            elif _inside(prev, e):
                out.append(_isect(prev, cur, e))
            prev = cur
    return out

def clip_line(line):
    """LineString을 bbox로 잘라 조각 목록 반환"""
    segs, cur = [], []
    def ok(p): return CLIP[0] <= p[0] <= CLIP[2] and CLIP[1] <= p[1] <= CLIP[3]
    for p in line:
        if ok(p): cur.append(p)
        else:
            if len(cur) > 1: segs.append(cur)
            cur = []
    if len(cur) > 1: segs.append(cur)
    return segs


# ── Douglas–Peucker (투영 후 픽셀 기준) ──
def dp(pts, tol):
    if len(pts) < 3: return pts
    dmax, idx = 0.0, 0
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2-x1, y2-y1
    den = math.hypot(dx, dy)
    for i in range(1, len(pts)-1):
        px, py = pts[i]
        d = abs(dy*px - dx*py + x2*y1 - y2*x1)/den if den else math.hypot(px-x1, py-y1)
        if d > dmax: dmax, idx = d, i
    if dmax > tol:
        return dp(pts[:idx+1], tol)[:-1] + dp(pts[idx:], tol)
    return [pts[0], pts[-1]]


def _area(pr):
    a = 0.0
    for i in range(len(pr)):
        x1, y1 = pr[i]; x2, y2 = pr[(i+1) % len(pr)]
        a += x1*y2 - x2*y1
    return abs(a)/2


def path_of(rings, tol=0.55, close=True, minarea=0.0):
    out = []
    for r in rings:
        pr = [screen(*p) for p in r]
        if minarea and _area(pr) < minarea: continue
        pr = dp(pr, tol)
        if len(pr) < (3 if close else 2): continue
        d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pr)
        out.append(d + (' Z' if close else ''))
    return ' '.join(out)


def bbox_hit(coords):
    xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    return not (max(xs) < CLIP[0] or min(xs) > CLIP[2]
                or max(ys) < CLIP[1] or min(ys) > CLIP[3])


# ══ 육지 ══
land_rings = []
for f in json.load(open('land.geojson'))['features']:
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ring in poly:
            if len(ring) < 4 or not bbox_hit(ring): continue
            c = clip_poly([(p[0], p[1]) for p in ring])
            if len(c) >= 4: land_rings.append(c)

# ══ 하천 ══
KEEP = {'Yalu', 'Tumen', 'Han', 'Namhan', 'Nakdong', 'Liao', 'Xiliao',
        'Di\u2019er Songhua', 'Erdao'}
river_named = {}
for f in json.load(open('rivers.geojson'))['features']:
    g = f['geometry']; nm = f['properties'].get('name')
    if not g or nm not in KEEP: continue
    parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    for part in parts:
        pts = [(p[0], p[1]) for p in part]
        if not bbox_hit(pts): continue
        for seg in clip_line(pts):
            river_named.setdefault(nm, []).append(seg)

# 대동강 — Natural Earth 10m 미수록, 실제 유로 기준 수동 보정
river_named['Taedong'] = [[(126.95, 40.08), (126.80, 39.95), (126.72, 39.82),
                           (126.52, 39.76), (126.38, 39.62), (126.20, 39.55),
                           (126.09, 39.41), (125.94, 39.34), (125.86, 39.20),
                           (125.78, 39.03), (125.66, 38.95), (125.55, 38.83),
                           (125.40, 38.76), (125.25, 38.65), (125.08, 38.60)]]

# ══ 호수 (백두산 천지 등 큰 것만) ══
lake_rings = []
for f in json.load(open('lakes.geojson'))['features']:
    g = f['geometry']
    if not g or (f['properties'].get('scalerank') or 9) > 4: continue
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ring in poly:
            if len(ring) < 4 or not bbox_hit(ring): continue
            c = clip_poly([(p[0], p[1]) for p in ring])
            if len(c) >= 4: lake_rings.append(c)

# ══ 산맥 ══
RANGES = {
    'baekdudaegan': [  # 백두산 → 금강 → 설악 → 오대 → 두타 → 태백 → 소백 → 덕유 → 지리
        (128.06, 42.01), (127.98, 41.52), (127.62, 41.10), (127.35, 40.60),
        (127.35, 40.10), (127.20, 39.75), (127.15, 39.40), (127.30, 39.05),
        (127.65, 38.80), (128.15, 38.66),
        (128.46, 38.12), (128.44, 37.92), (128.54, 37.79), (128.60, 37.55),
        (128.75, 37.30), (128.92, 37.09), (128.70, 37.02), (128.48, 36.96), (128.10, 36.72),
        (127.87, 36.54), (127.80, 36.18), (127.75, 35.86), (127.78, 35.60),
        (127.73, 35.34)],
    'nangnim': [       # 낭림 → 묘향 (평안 내륙)
        (126.90, 40.72), (126.50, 40.40), (126.15, 40.05), (125.98, 39.70)],
    'cheonsan': [      # 천산산맥 (요동)
        (123.80, 41.60), (123.20, 41.00), (122.70, 40.40), (122.20, 39.70)],
    'hamgyeong': [     # 함경산맥
        (129.60, 41.60), (129.10, 41.20), (128.60, 41.00), (128.20, 42.00)],
}

def peaks(pts, step=10.5, h=8.0, w=5.6):
    """능선 폴리라인 위에 일정 간격으로 산 기호(삼각) 배치"""
    sp = [screen(*p) for p in pts]
    segs, acc = [], 0.0
    total = sum(math.hypot(sp[i+1][0]-sp[i][0], sp[i+1][1]-sp[i][1])
                for i in range(len(sp)-1))
    d = 0.0; i = 0
    while d < total and i < len(sp)-1:
        # d 위치의 좌표 찾기
        run, j = 0.0, 0
        while j < len(sp)-1:
            L = math.hypot(sp[j+1][0]-sp[j][0], sp[j+1][1]-sp[j][1])
            if run + L >= d: break
            run += L; j += 1
        L = math.hypot(sp[j+1][0]-sp[j][0], sp[j+1][1]-sp[j][1]) or 1
        t = (d - run)/L
        x = sp[j][0] + (sp[j+1][0]-sp[j][0])*t
        y = sp[j][1] + (sp[j+1][1]-sp[j][1])*t
        k = len(segs)
        v = 0.78 + 0.34 * (((k*2654435761) % 1000)/1000.0)   # 봉우리 높이 변주
        u = 0.86 + 0.28 * (((k*40503) % 997)/997.0)          # 폭 변주
        hh, ww = h*v, w*u
        segs.append(f'M {x-ww:.1f} {y+hh*0.42:.1f} L {x:.1f} {y-hh*0.58:.1f} L {x+ww:.1f} {y+hh*0.42:.1f}')
        d += step * (0.9 + 0.22*(((k*97) % 100)/100.0))
    return ' '.join(segs)

# ══ 거점 — 실제 비정지 좌표 ══
CASTLES = [
    ('jolbon',   '졸본',    125.35, 41.30, 'major',   'goguryeo'),
    ('gungnae',  '국내성',  126.19, 41.13, 'major',   'goguryeo'),
    ('yodong',   '요동성',  123.17, 41.27, 'major',   'goguryeo'),
    ('ansi',     '안시성',  122.75, 40.85, 'fort',    'goguryeo'),
    ('bisa',     '비사성',  121.70, 39.10, 'port',    'goguryeo'),
    ('chaekseong','책성',   130.36, 42.87, 'fort',    'goguryeo'),
    ('pyeong',   '평양성',  125.75, 39.02, 'capital', 'goguryeo'),
    ('hanseong', '한성',    127.12, 37.53, 'major',   'silla'),
    ('danghang', '당항성',  126.80, 37.10, 'port',    'silla'),
    ('gugwon',   '국원성',  127.93, 36.97, 'fort',    'silla'),
    ('silji',    '실직주',  129.17, 37.45, 'fort',    'silla'),
    ('geumseong','금성',    129.21, 35.84, 'capital', 'silla'),
    ('ungjin',   '웅진',    127.12, 36.45, 'major',   'baekje'),
    ('sabi',     '사비',    126.91, 36.28, 'capital', 'baekje'),
    ('daeya',    '대야성',  128.17, 35.57, 'fort',    'baekje'),
    ('daegaya',  '대가야',  128.26, 35.73, 'major',   'gaya'),
    ('geumgwan', '금관',    128.89, 35.23, 'port',    'gaya'),
    ('tamna',    '탐라',    126.53, 33.50, 'port',    'silla'),
    # ── 광개토대왕 정복지 (북방) ──
    ('sinseong', '신성',    123.92, 41.87, 'fort',    'goguryeo'),
    ('ogol',     '오골성',  124.07, 40.45, 'fort',    'goguryeo'),
    ('buyeo',    '부여성',  125.18, 44.43, 'fort',    'goguryeo'),
    # ── 밀도 보강 ──
    ('haseulla', '하슬라',  128.90, 37.75, 'fort',    'silla'),
    ('iksan',    '익산',    126.96, 35.94, 'major',   'baekje'),
    ('aragaya',  '아라가야', 128.41, 35.27, 'major',  'gaya'),
    # ── 내륙 행정중심지 보강 ──
    ('nampyeong','남평양',  125.62, 38.15, 'major',  'goguryeo'),
    ('daebang',  '대방',    125.75, 38.50, 'major',  'goguryeo'),
    ('gaemo',    '개모성',  123.35, 41.55, 'fort',    'goguryeo'),
    ('sangju',   '상주',    128.16, 36.41, 'major',  'silla'),
    ('sapryang', '삽량주',  129.16, 35.34, 'fort',    'silla'),
    ('apdok',    '압독',    128.74, 35.82, 'fort',    'silla'),
    ('changnyeong','창녕',  128.49, 35.54, 'fort',    'silla'),
    ('wansan',   '완산',    127.15, 35.82, 'major',  'baekje'),
    ('balla',    '발라',    126.71, 35.03, 'major',  'baekje'),
    ('tanhyeon', '탄현',    127.42, 36.15, 'fort',    'baekje'),
    ('goseong',  '고성',    128.32, 34.97, 'major',  'gaya'),
    ('seongju',  '성주',    128.28, 35.92, 'fort',    'gaya'),
    # ── 요동 서변·부여 접경 (고구려) ──
    ('seoanpyeong','서안평', 124.33, 40.13, 'port',    'goguryeo'),
    ('baekam',   '백암성',  123.35, 41.27, 'fort',    'goguryeo'),
    ('geonan',   '건안성',  122.35, 40.40, 'fort',    'goguryeo'),
    ('namso',    '남소성',  125.05, 41.70, 'fort',    'goguryeo'),
    ('usu',      '우수주',  127.73, 37.88, 'fort',    'goguryeo'),
    # ── 동예·옥저 (동해안 북부, 고구려 복속지) ──
    ('okjeo',    '옥저',    127.53, 39.92, 'fort',    'goguryeo'),
    ('dongye',   '동예',    127.44, 39.15, 'fort',    'goguryeo'),
    # ── 신라 내륙·동해 보강 ──
    ('ulsan',    '울산',    129.31, 35.54, 'port',    'silla'),
    ('uiseong',  '의성',    128.70, 36.35, 'fort',    'silla'),
    ('gammun',   '감문',    128.11, 36.13, 'fort',    'silla'),
    ('usanguk',  '우산국',  130.90, 37.48, 'port',    'silla'),
    ('daegu',    '대구',    128.60, 35.87, 'major',  'silla'),
    ('samnyeon', '삼년산성', 127.73, 36.49, 'fort',    'silla'),
    ('gwansan',  '관산성',  127.58, 36.31, 'fort',    'silla'),
    ('gyerim',   '계립령',  128.05, 36.75, 'fort',    'silla'),
    # ── 백제 내륙·남해안 보강 ──
    ('michuhol', '미추홀',  126.65, 37.48, 'port',    'baekje'),
    ('gosaburi', '고사부리', 126.86, 35.56, 'fort',    'baekje'),
    ('imjon',    '임존성',  126.83, 36.68, 'fort',    'baekje'),
    ('mokji',    '목지국',  127.15, 36.81, 'major',  'baekje'),
    ('chimmi',   '침미다례', 126.60, 34.57, 'fort',    'baekje'),
    ('amak',     '아막성',  127.39, 35.40, 'fort',    'baekje'),
    ('hwangsan', '황산벌',  127.16, 36.18, 'fort',    'baekje'),
    # ── 가야 소국 보강 ──
    ('taksun',   '탁순국',  128.68, 35.23, 'fort',    'gaya'),
    ('samul',    '사물국',  128.08, 34.94, 'fort',    'gaya'),
    # ══ 고구려 대중국 방어선 (수·당 침공로) ══
    ('musunra',  '무려라',  121.70, 41.40, 'fort',    'goguryeo'),   # 요하 도하지점
    ('yosu',     '요수진',  122.20, 41.15, 'port',    'goguryeo'),   # 요하 수로 관문
    ('bakjak',   '박작성',  124.42, 40.09, 'fort',    'goguryeo'),   # 압록강 하구 방어
    ('daehaeng', '대행성',  125.15, 38.85, 'fort',    'goguryeo'),   # 평양 서측 관문
    ('salsu',    '살수',    125.90, 39.75, 'fort',    'goguryeo'),   # 청천강, 612 살수대첩
    ('pyeongwon','평곽',    122.20, 40.68, 'port',    'goguryeo'),   # 요동만 수군기지
    # ══ 나당전쟁 방어선 (임진강선) ══
    ('chiljung', '칠중성',  126.90, 37.93, 'fort',    'silla'),      # 675 칠중성 전투
    ('maeso',    '매소성',  127.06, 37.83, 'fort',    'silla'),      # 675 매소성 전투
    ('cheonseong','천성',   126.70, 37.78, 'port',    'silla'),      # 675 설인귀 함대 격퇴
    # ══ 백제 멸망전 (660) ══
    ('gibeolpo', '기벌포',  126.72, 36.02, 'port',    'baekje'),     # 백강, 당군 상륙지
    ('ungjingu', '웅진구',  126.88, 36.22, 'port',    'baekje'),     # 소정방 실제 상륙
    ('deokmul',  '덕물도',  126.30, 37.23, 'port',    'silla'),      # 나당 수군 회합지
    ('jusan',    '주류성',  126.78, 35.98, 'fort',    'baekje'),     # 부흥운동 거점
    # ══ 내륙 수로 요충 ══
    ('paesu',    '패수',    125.42, 38.74, 'port',    'goguryeo'),   # 대동강 하구
    ('hanganggu','한강구',  126.60, 37.58, 'port',    'silla'),      # 한강 하구
    ('nakdonggu','낙동강구', 128.98, 35.13, 'port',   'gaya'),       # 낙동강 하구
]

out = {
    'width': round(OUT_W, 1), 'height': OUT_H,
    'land': path_of(land_rings, 0.5, minarea=1.8),
    'islets': path_of([[(126.26,37.26),(126.33,37.27),(126.36,37.24),
                        (126.34,37.20),(126.28,37.19),(126.24,37.22)]], 0.2),  # 덕물도(덕적도)
    'lakes': path_of(lake_rings, 0.5),
    'rivers': {k: path_of(v, 0.4, close=False) for k, v in river_named.items()},
    'ranges': {k: peaks(v) for k, v in RANGES.items()},
    'castles': [
        {'id': i, 'name': n, 'type': t, 'f': fc,
         'x': round(screen(lo, la)[0], 1), 'y': round(screen(lo, la)[1], 1),
         'lon': lo, 'lat': la}
        for i, n, lo, la, t, fc in CASTLES
    ],
}
json.dump(out, open('mapdata.json', 'w'), ensure_ascii=False)

print(f'viewBox 0 0 {OUT_W:.0f} {OUT_H:.0f}')
print(f'land path chars : {len(out["land"]):,}')
print(f'land rings kept : {len(land_rings)}')
print(f'lakes           : {len(lake_rings)}')
for k, v in out['rivers'].items():
    print(f'  river {k:<16} {len(v):>6,} chars')
print('\n산맥 기호:')
for k, v in out['ranges'].items():
    print(f'  {k:<14} {v.count(chr(77)):>3}개 봉우리')
print('\n거점 화면좌표:')
for c in out['castles']:
    print(f'  {c["name"]:<7} ({c["x"]:6.1f}, {c["y"]:6.1f})')
