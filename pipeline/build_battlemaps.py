"""
거점별 전장(戰場) 맵 생성
  실측 데이터 : 해안선·하천 (Natural Earth 10m) → 거점 주변 7×5km를 잘라 타일화
  산출 데이터 : 산지·구릉 = 능선(백두대간 등) 근접도 + 명명 봉우리 + 결정론적 기복
  구조물     : 성벽·성문·항구, 진입로(전략맵 연결 방향에서)
출력: battlemaps.json
"""
import json, math, sys, zlib
import castleworks as CW

sys.setrecursionlimit(50000)

MAP = json.load(open('mapdata.json'))
BOX_KM = (7.0, 5.0)          # 전장 실제 크기 (가로 × 세로)
GRID   = (48, 32)            # 타일 수
KM_LAT = 110.57

# ── 원본 지리 데이터 ──
land = json.load(open('land.geojson'))
rivers = json.load(open('rivers.geojson'))

def rings_of(gj):
    out = []
    for ft in gj['features']:
        g = ft['geometry']
        if not g: continue
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            for ring in poly:
                if len(ring) < 4: continue
                xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
                out.append(((min(xs), min(ys), max(xs), max(ys)),
                            [(p[0], p[1]) for p in ring]))
    return out

def lines_of(gj):
    out = []
    for ft in gj['features']:
        g = ft['geometry']
        if not g: continue
        parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for part in parts:
            pts = [(p[0], p[1]) for p in part if len(p) >= 2]
            if len(pts) < 2: continue
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            out.append(((min(xs), min(ys), max(xs), max(ys)), pts))
    return out

REGION = (117.5, 31.5, 134.0, 47.5)     # 한반도·만주 권역
def in_region(bb):
    return not (bb[2] < REGION[0] or bb[0] > REGION[2]
                or bb[3] < REGION[1] or bb[1] > REGION[3])

LAND_RINGS  = [r for r in rings_of(land)   if in_region(r[0])]
RIVER_LINES = [l for l in lines_of(rivers) if in_region(l[0])]
print(f'권역 내 육지 링 {len(LAND_RINGS)} / 하천 선 {len(RIVER_LINES)}')

# ── 사각형 클리핑 (거대 링을 거점 주변 조각으로 줄인다) ──
def clip_ring(ring, bx):
    def ins(p, e):
        return (p[0] >= bx[0]) if e == 0 else (p[0] <= bx[2]) if e == 1 \
            else (p[1] >= bx[1]) if e == 2 else (p[1] <= bx[3])
    def isect(a, b, e):
        (x1, y1), (x2, y2) = a, b
        if e in (0, 1):
            xe = bx[0] if e == 0 else bx[2]
            t = (xe - x1) / (x2 - x1) if x2 != x1 else 0
            return (xe, y1 + t*(y2-y1))
        ye = bx[1] if e == 2 else bx[3]
        t = (ye - y1) / (y2 - y1) if y2 != y1 else 0
        return (x1 + t*(x2-x1), ye)
    out = ring
    for e in range(4):
        if not out: return []
        inp, out = out, []
        prev = inp[-1]
        for cur in inp:
            if ins(cur, e):
                if not ins(prev, e): out.append(isect(prev, cur, e))
                out.append(cur)
            elif ins(prev, e):
                out.append(isect(prev, cur, e))
            prev = cur
    return out

# Natural Earth 10m에는 큰 강만 실려 있다.
# 전장 규모(7km)에서 도하전을 성립시키려면 주요 하천을 직접 넣어야 한다.
MANUAL_RIVERS = {
  '대동강': [(126.95,40.08),(126.80,39.95),(126.72,39.82),(126.52,39.76),(126.38,39.62),
            (126.20,39.55),(126.09,39.41),(125.94,39.34),(125.86,39.20),(125.78,39.03),
            (125.66,38.95),(125.55,38.83),(125.40,38.76),(125.25,38.65),(125.08,38.60)],
  '청천강': [(126.62,40.32),(126.40,40.15),(126.15,39.98),(126.02,39.86),(125.90,39.75),
            (125.78,39.68),(125.66,39.62),(125.50,39.58),(125.32,39.56)],   # 살수
  '금강':   [(127.62,35.90),(127.55,36.10),(127.48,36.32),(127.30,36.44),(127.12,36.45),
            (126.98,36.36),(126.91,36.28),(126.82,36.15),(126.72,36.02),(126.60,35.98)],
  '영산강': [(127.00,35.32),(126.88,35.20),(126.76,35.08),(126.71,35.03),(126.58,34.92),
            (126.44,34.82)],
  # 호로고루(연천)는 임진강 주상절리 위의 성이다. 원래 선은 강안을 20km 남서로
  # 비껴가 성 앞에 강이 없었다 — 「강안대지성」이 강 없이 서 있었다(§7.5 위반).
  '임진강': [(127.40,38.62),(127.28,38.42),(127.18,38.22),(127.10,38.04),
            (127.05,37.92),(127.06,37.85),(127.02,37.82),(126.94,37.85),(126.86,37.86),
            (126.78,37.83),(126.68,37.80)],
  '예성강': [(126.55,38.55),(126.48,38.28),(126.42,38.02),(126.35,37.85),(126.30,37.78)],
  '섬진강': [(127.38,35.62),(127.48,35.40),(127.60,35.20),(127.72,35.05),(127.78,34.95)],
  '동진강': [(126.95,35.72),(126.85,35.82),(126.78,35.90),(126.70,35.98)],
  '태화강': [(129.15,35.60),(129.25,35.55),(129.35,35.52)],
  '형산강': [(129.18,35.85),(129.28,35.98),(129.38,36.05)],
  '남한강': [(128.30,37.10),(128.05,37.25),(127.85,37.15),(127.60,37.30),(127.35,37.45)],
  '북한강': [(127.75,38.05),(127.60,37.85),(127.45,37.68),(127.30,37.55)],
  '혼강':   [(126.20,41.60),(125.90,41.35),(125.60,41.15),(125.35,41.00),(125.10,40.85)],
}
for _nm, _pts in MANUAL_RIVERS.items():
    _xs=[p[0] for p in _pts]; _ys=[p[1] for p in _pts]
    RIVER_LINES.append(((min(_xs),min(_ys),max(_xs),max(_ys)), _pts))
print(f'수동 보강 하천 {len(MANUAL_RIVERS)}개 추가')

# ── 산지 판정용: 능선 + 명명 봉우리 ──
RIDGES = {
    'baekdudaegan': [(128.06,42.01),(127.98,41.52),(127.62,41.10),(127.35,40.60),
        (127.35,40.10),(127.20,39.75),(127.15,39.40),(127.30,39.05),(127.65,38.80),
        (128.15,38.66),(128.46,38.12),(128.44,37.92),(128.54,37.79),(128.60,37.55),
        (128.75,37.30),(128.92,37.09),(128.70,37.02),(128.48,36.96),(128.10,36.72),
        (127.87,36.54),(127.80,36.18),(127.75,35.86),(127.78,35.60),(127.73,35.34)],
    'nangnim':   [(126.90,40.72),(126.50,40.40),(126.15,40.05),(125.98,39.70)],
    'cheonsan':  [(123.80,41.60),(123.20,41.00),(122.70,40.40),(122.20,39.70)],
    'hamgyeong': [(129.60,41.60),(129.10,41.20),(128.60,41.00),(128.20,42.00)],
}
PEAKS = [(128.47,38.12,1708),(127.73,35.34,1915),(128.06,42.01,2744),
         (126.55,40.03,1788),(126.53,33.36,1950)]

def km(dlon, dlat, lat):
    return math.hypot(dlon * 111.32 * math.cos(math.radians(lat)), dlat * KM_LAT)

def dist_to_poly(x, y, pts, lat):
    best = 1e9
    for i in range(len(pts) - 1):
        ax, ay = pts[i]; bx, by = pts[i+1]
        dx, dy = bx-ax, by-ay
        L = dx*dx + dy*dy
        t = 0 if L == 0 else max(0, min(1, ((x-ax)*dx + (y-ay)*dy) / L))
        px, py = ax + dx*t, ay + dy*t
        best = min(best, km(x-px, y-py, lat))
    return best

def inside(x, y, rings):
    cnt = 0
    for bb, r in rings:
        if not (bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3]): continue
        n = len(r); j = n-1; c = False
        for i in range(n):
            xi, yi = r[i]; xj, yj = r[j]
            if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi):
                c = not c
            j = i
        if c: cnt += 1
    return cnt % 2 == 1

def noise(ix, iy, seed):
    """결정론적 기복. 저주파 두 겹을 겹쳐 자연스러운 굴곡을 만든다."""
    def h(a, b, s):
        n = (a*374761393 + b*668265263 + s*1442695040888963407) & 0xFFFFFFFF
        n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
        return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0
    def smooth(fx, fy, s):
        x0, y0 = int(fx // 1), int(fy // 1)
        tx, ty = fx - x0, fy - y0
        tx = tx*tx*(3-2*tx); ty = ty*ty*(3-2*ty)
        a = h(x0, y0, s);   b = h(x0+1, y0, s)
        c = h(x0, y0+1, s); d = h(x0+1, y0+1, s)
        return (a*(1-tx)+b*tx)*(1-ty) + (c*(1-tx)+d*tx)*ty
    return smooth(ix/7.0, iy/7.0, seed)*0.6 + smooth(ix/3.0, iy/3.0, seed+7)*0.4

TILE = {'plain':'.', 'forest':'f', 'hill':'h', 'mountain':'m', 'cliff':'X',
        'river':'~', 'ford':'=', 'sea':'s', 'marsh':'M',
        'wall':'W', 'gate':'G', 'port':'P', 'road':'r',
        # §7.1 — 성곽 규격이 요구하는 셋
        'chi':'T', 'ongseong':'O', 'moat':'D'}

def build(castle):
    lon, lat = castle['lon'], castle['lat']
    ctype = castle['type']
    hlon = (BOX_KM[0]/2) / (111.32 * math.cos(math.radians(lat)))
    hlat = (BOX_KM[1]/2) / KM_LAT
    box = (lon-hlon, lat-hlat, lon+hlon, lat+hlat)

    # 거대 링을 상자 크기로 잘라 국지 폴리곤으로 줄인다 (속도 핵심)
    pad = (box[0]-hlon*0.4, box[1]-hlat*0.4, box[2]+hlon*0.4, box[3]+hlat*0.4)
    rings = []
    for bb, r in LAND_RINGS:
        if bb[2] < pad[0] or bb[0] > pad[2] or bb[3] < pad[1] or bb[1] > pad[3]:
            continue
        c = clip_ring(r, pad)
        if len(c) >= 4:
            xs = [p[0] for p in c]; ys = [p[1] for p in c]
            rings.append(((min(xs), min(ys), max(xs), max(ys)), c))
    # 상자가 링에 완전히 포함되면(클립 결과 없음) 육지 내부로 간주
    fully_inland = not rings and any(
        bb[0] <= lon <= bb[2] and bb[1] <= lat <= bb[3] for bb, _ in LAND_RINGS)

    rivs = []
    for bb, pts in RIVER_LINES:
        if bb[2] < pad[0] or bb[0] > pad[2] or bb[3] < pad[1] or bb[1] > pad[3]:
            continue
        # 점만 걸러내면 상자를 관통하는 강이 선분을 잃는다 → 앞뒤 점을 함께 남긴다
        m = 0.05
        keep = set()
        for i, p in enumerate(pts):
            if pad[0]-m <= p[0] <= pad[2]+m and pad[1]-m <= p[1] <= pad[3]+m:
                keep.update((i-1, i, i+1))
        idx = sorted(i for i in keep if 0 <= i < len(pts))
        if len(idx) >= 2: rivs.append([pts[i] for i in idx])

    # 능선·봉우리 근접도 (전장 전체에 걸친 상수)
    ridge_km = min(dist_to_poly(lon, lat, pts, lat) for pts in RIDGES.values())
    peak_km  = min(km(lon-px, lat-py, lat) for px, py, _ in PEAKS)
    # zlib.crc32 — 파이썬 hash() 는 PYTHONHASHSEED 로 실행마다 달라져서
    # **같은 명령을 두 번 돌리면 76개 맵이 통째로 바뀐다**(실측). 재현이 안 되면
    # §7.6 검증도, 「같은 시드면 같은 전투」도 성립하지 않는다.
    seed = zlib.crc32(castle['id'].encode()) % 100000

    # 산악도 — 능선이 가까울수록, 산성일수록 높다
    mtn = 0.0
    mtn += max(0.0, 1 - ridge_km/60) * 0.55
    mtn += max(0.0, 1 - peak_km/90) * 0.15
    if ctype == 'fort':    mtn += 0.30
    elif ctype == 'port':  mtn -= 0.18
    elif ctype == 'capital': mtn -= 0.08
    mtn = max(0.0, min(1.0, mtn))

    GW, GH = GRID
    grid = []
    has_sea = has_river = False
    for gy in range(GH):
        row = []
        for gx in range(GW):
            x = box[0] + (gx+0.5)/GW * (box[2]-box[0])
            y = box[3] - (gy+0.5)/GH * (box[3]-box[1])

            if not fully_inland and not inside(x, y, rings):
                row.append(TILE['sea']); has_sea = True; continue

            rd = min((dist_to_poly(x, y, p, lat) for p in rivs), default=99)
            if rd < 0.22:
                row.append(TILE['river']); has_river = True; continue

            n = noise(gx, gy, seed)
            relief = n*0.55 + mtn*0.65
            if rd < 0.7 and n < 0.42:
                row.append(TILE['marsh'])
            elif relief > 0.80:
                row.append(TILE['mountain'])
            elif relief > 0.60:
                row.append(TILE['hill'])
            elif n > 0.62:
                row.append(TILE['forest'])
            else:
                row.append(TILE['plain'])
        grid.append(row)

    # 험지 — 사방이 산악인 산괴 중심부만 통행 불가로 만든다.
    # 산악 전체를 막으면 전장이 통째로 봉쇄되므로 가장자리는 남겨 고갯길이 생긴다.
    for gy in range(GH):
        for gx in range(GW):
            if grid[gy][gx] != TILE['mountain']: continue
            nb = [(gx+1,gy),(gx-1,gy),(gx,gy+1),(gx,gy-1)]
            if all(0 <= a < GW and 0 <= b < GH and grid[b][a] == TILE['mountain']
                   for a, b in nb):
                grid[gy][gx] = TILE['cliff']

    # 도하 지점 — 강을 가로지르는 여울 2곳
    if has_river:
        cand = [(gy, gx) for gy in range(GH) for gx in range(GW)
                if grid[gy][gx] == TILE['river']]
        if cand:
            for k in (len(cand)//3, 2*len(cand)//3):
                gy, gx = cand[k]
                for d in (-1, 0, 1):
                    yy = min(GH-1, max(0, gy+d))
                    if grid[yy][gx] == TILE['river']:
                        grid[yy][gx] = TILE['ford']

    # ── 성곽 축조 (§7) ──
    #
    # 예전에는 76곳 전부를 가운데 사각형 + 성문 2개로 깎았다. 그래서 산악
    # 63%인 안시성의 성 안이 평지였고, 강이 성벽을 관통했고, 옹성·치·해자가
    # 아예 없었다. 지금은 유형을 판정해 자리를 탐색하고 규격대로 세운다.
    works = None
    if ctype in ('capital', 'major', 'fort', 'port'):
        if castle['id'] in CW.TWIN:
            works = CW.build_twin(grid, castle['id'], ctype, mtn, seed, GW, GH)
        else:
            works = CW.build_castle(grid, castle['id'], ctype, mtn,
                                    has_river, seed, GW, GH)

    # 항구 타일은 성벽 안쪽에 둔다 (§7.2 — port 는 읍성 규칙 + 바다 접면)
    if ctype == 'port' and works:
        sea_side = sorted(works['inner'],
                          key=lambda p: min((abs(p[0]-x)+abs(p[1]-y)
                                             for y in range(GH) for x in range(GW)
                                             if grid[y][x] == TILE['sea']), default=999))
        for (x, y) in sea_side[:4]:
            grid[y][x] = TILE['port']

    # 계곡수를 넣었으면 hasRiver 로 잡힌다 — 플래그를 타일 실측과 맞춘다 (§7.6-7)
    has_river = any(TILE['river'] in ''.join(r) for r in [grid[i] for i in range(GH)])
    has_sea = any(TILE['sea'] in ''.join(r) for r in [grid[i] for i in range(GH)])

    # 진입 방향 — 전략맵에서 실제로 이어진 거점 쪽에서 들어온다
    approaches = []
    for r in MAP['routes']['land'] + MAP['routes']['sea']:
        other = r['b'] if r['a'] == castle['id'] else r['a'] if r['b'] == castle['id'] else None
        if not other: continue
        o = next((c for c in MAP['castles'] if c['id'] == other), None)
        if not o: continue
        brg = (math.degrees(math.atan2(o['lon']-lon, o['lat']-lat)) + 360) % 360
        edge = ('N' if brg < 45 or brg >= 315 else 'E' if brg < 135
                else 'S' if brg < 225 else 'W')
        # 그 변이 물로 막혀 있으면 도하·상륙이 필요하다고 표시
        col = {'N': [grid[0][x] for x in range(GW)],
               'S': [grid[GH-1][x] for x in range(GW)],
               'W': [grid[y][0] for y in range(GH)],
               'E': [grid[y][GW-1] for y in range(GH)]}[edge]
        water = sum(1 for c in col if c in (TILE['sea'], TILE['river'])) / len(col)
        approaches.append({'from': other, 'bearing': round(brg), 'edge': edge,
                           'sea': r in MAP['routes']['sea'],
                           'needsWater': water > 0.6})

    info = {
        'form': works['form'] if works else 'none',
        'gates': len(works['gates']) if works else 0,
        'chi': len(works['chi']) if works else 0,
        'ongseong': len(works['ongseong']) if works else 0,
        'moat': len(works['moat']) if works else 0,
        'doubleWall': bool(works and works.get('doubleWall')),
        'twinCastle': bool(works and works.get('twinCastle')),
        'waterSource': bool(works and works.get('waterSource')),
        'rectRatio': works['rectRatio'] if works else 1.0,
    } if works else {'form': 'none', 'gates': 0, 'chi': 0, 'ongseong': 0,
                     'moat': 0, 'doubleWall': False, 'twinCastle': False,
                     'waterSource': False, 'rectRatio': 1.0}

    return {
        'id': castle['id'],
        # §7.5 — 당대 고유어 지명이 확인되면 그것을 정식 표기로 (id 는 그대로)
        'name': CW.RENAME.get(castle['id'], castle['name']), 'type': ctype,
        'w': GW, 'h': GH, 'kmW': BOX_KM[0], 'kmH': BOX_KM[1],
        'mountainous': round(mtn, 2),
        'hasSea': has_sea, 'hasRiver': has_river,
        'ridgeKm': round(ridge_km, 1),
        'tiles': [''.join(r) for r in grid],
        'approaches': approaches,
        **info,
    }

# 하천이 반드시 있어야 하는 거점 (이름이 물길이거나 도하 지점)
MUST_RIVER = {'salsu','paesu','hanganggu','nakdonggu','gibeolpo','ungjingu','pyeong'}

out = {}
for i, c in enumerate(MAP['castles']):
    out[c['id']] = build(c)
    if (i+1) % 20 == 0: print(f'  {i+1}/{len(MAP["castles"])} …')

miss = [out[i]['name'] for i in MUST_RIVER
        if i in out and not (out[i]['hasRiver'] or out[i]['hasSea'])]
if miss:
    print('⚠ 물길이 없는 수변 거점:', ', '.join(miss))

json.dump({'legend': {v: k for k, v in TILE.items()}, 'maps': out},
          open('battlemaps.json', 'w'), ensure_ascii=False)

# ── 리포트 ──
from collections import Counter
print(f'\n전장 {len(out)}개 생성  ({GRID[0]}×{GRID[1]} 타일 / {BOX_KM[0]}×{BOX_KM[1]}km)')
print(f'해안 포함 {sum(1 for m in out.values() if m["hasSea"])}개  '
      f'/ 하천 포함 {sum(1 for m in out.values() if m["hasRiver"])}개')
_cf = sum(sum(r.count('X') for r in m['tiles']) for m in out.values())
_tt = sum(m['w']*m['h'] for m in out.values())
print(f'험지(통행불가) {_cf}타일 / 전체 {_tt} = {_cf*100/_tt:.1f}%  '
      f'(험지 있는 전장 {sum(1 for m in out.values() if any("X" in r for r in m["tiles"]))}개)')
print('\n지형 성격 상위·하위')
srt = sorted(out.values(), key=lambda m: -m['mountainous'])
for m in srt[:5]:
    print(f'  산악 {m["mountainous"]:.2f}  {m["name"]:<7} 능선 {m["ridgeKm"]:.0f}km')
for m in srt[-4:]:
    print(f'  평지 {m["mountainous"]:.2f}  {m["name"]:<7} 능선 {m["ridgeKm"]:.0f}km')
print('\n타일 구성 표본')
for cid in ['ansi', 'bisa', 'salsu', 'geumgwan', 'pyeong']:
    if cid not in out: continue
    m = out[cid]
    cnt = Counter(ch for row in m['tiles'] for ch in row)
    tot = sum(cnt.values())
    top = ', '.join(f'{ {v:k for k,v in TILE.items()}[c] } {n*100//tot}%'
                    for c, n in cnt.most_common(4))
    print(f'  {m["name"]:<7} {top}')
