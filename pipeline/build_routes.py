"""
성간 이동로 생성
 - 육로: 육지 격자 위 A* 탐색 → 산맥 회피 가중 → 곡선 스무딩
 - 수로: 바다 격자 위 A* 탐색 → 항구-항구만 연결
결과를 mapdata.json에 routes로 저장
"""
import json, math, heapq

d = json.load(open('mapdata.json'))
W, H = d['width'], d['height']

# ── 육지 판정 준비 ──
def subpaths(p):
    for seg in p.split('M '):
        seg = seg.strip().rstrip('Z').strip()
        if not seg: continue
        pts = []
        for tok in seg.split(' L '):
            a, b = tok.split(); pts.append((float(a), float(b)))
        if len(pts) >= 3: yield pts

rings = list(subpaths(d['land'])) + list(subpaths(d['islets']))

def inside(x, y):
    cnt = 0
    for r in rings:
        n = len(r); j = n-1; c = False
        for i in range(n):
            xi, yi = r[i]; xj, yj = r[j]
            if ((yi > y) != (yj > y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi):
                c = not c
            j = i
        if c: cnt += 1
    return cnt % 2 == 1

# ── 격자 구성 ──
CELL = 6.0
GW, GH = int(W/CELL)+1, int(H/CELL)+1
print(f'격자 {GW}x{GH} (cell={CELL})')

land = [[False]*GH for _ in range(GW)]
for gx in range(GW):
    for gy in range(GH):
        land[gx][gy] = inside(gx*CELL, gy*CELL)
print('육지 셀:', sum(sum(1 for v in col if v) for col in land))

# ── 산맥 통행비용 (능선 근처는 육로 비용 증가) ──
mount = [[0.0]*GH for _ in range(GW)]
for path in d['ranges'].values():
    for seg in path.split('M '):
        seg = seg.strip()
        if not seg: continue
        mid = seg.split(' L ')[1].split()
        mx, my = float(mid[0]), float(mid[1])
        g0x, g0y = int(mx/CELL), int(my/CELL)
        R = 3
        for dx in range(-R, R+1):
            for dy in range(-R, R+1):
                gx, gy = g0x+dx, g0y+dy
                if 0 <= gx < GW and 0 <= gy < GH:
                    dist = math.hypot(dx, dy)
                    if dist <= R:
                        mount[gx][gy] = max(mount[gx][gy], (1-dist/R)*2.4)

# ── 경계 근접도: 곡선 부풀림을 흡수할 여유를 확보 ──
def nearcount(gx, gy, want, R):
    n = 0
    for dx in range(-R, R+1):
        for dy in range(-R, R+1):
            x, y = gx+dx, gy+dy
            if 0 <= x < GW and 0 <= y < GH and land[x][y] == want: n += 1
    return n

# ── 하천을 뱃길로 인정 (수군은 강을 거슬러 올랐음) ──
import re as _re
navig = [[False]*GH for _ in range(GW)]     # 강 = 통항 가능 수역
RIVER_R = 1                                  # 강 주변 반경(셀)
for rpath in d['rivers'].values():
    for seg in rpath.split('M '):
        seg = seg.strip()
        if not seg: continue
        pts = []
        for tok in seg.split(' L '):
            v = tok.split()
            if len(v) >= 2: pts.append((float(v[0]), float(v[1])))
        for i in range(len(pts)-1):
            (x1,y1),(x2,y2) = pts[i], pts[i+1]
            steps = max(2, int(math.hypot(x2-x1, y2-y1)/(CELL*0.5)))
            for k in range(steps+1):
                t = k/steps
                gx, gy = int((x1+(x2-x1)*t)/CELL), int((y1+(y2-y1)*t)/CELL)
                for dx in range(-RIVER_R, RIVER_R+1):
                    for dy in range(-RIVER_R, RIVER_R+1):
                        x, y = gx+dx, gy+dy
                        if 0 <= x < GW and 0 <= y < GH: navig[x][y] = True
print('통항 하천 셀:', sum(sum(1 for v in col if v) for col in navig))

edge_land = [[0.0]*GH for _ in range(GW)]   # 육로용: 물가 회피
edge_sea  = [[0.0]*GH for _ in range(GW)]   # 수로용: 뭍가 회피 + 먼바다 약간 회피
for gx in range(GW):
    for gy in range(GH):
        if land[gx][gy]:
            w = nearcount(gx, gy, False, 2)          # 주변 물 셀 수
            edge_land[gx][gy] = min(w*0.30, 3.0)
        else:
            l = nearcount(gx, gy, True, 2)           # 주변 뭍 셀 수
            edge_sea[gx][gy] = min(l*0.16, 1.5)
            if nearcount(gx, gy, True, 7) == 0:      # 먼바다
                edge_sea[gx][gy] += 0.35

NB = [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]

def astar(start, goal, want_land):
    """격자 A*. want_land=True면 육지만, False면 바다만 통행"""
    sx, sy = start; gx, gy = goal
    def ok(x, y):
        if not (0 <= x < GW and 0 <= y < GH): return False
        if want_land: return land[x][y]
        return not land[x][y]
    def cost(x, y):
        if want_land: return 1.0 + mount[x][y] + edge_land[x][y]
        return 1.0 + edge_sea[x][y]
    def h(x, y): return math.hypot(x-gx, y-gy)

    openh = [(h(sx,sy), 0.0, (sx,sy))]
    came = {}; g = {(sx,sy): 0.0}
    seen = set()
    while openh:
        f, gc, cur = heapq.heappop(openh)
        if cur in seen: continue
        seen.add(cur)
        if cur == (gx, gy):
            path = [cur]
            while cur in came:
                cur = came[cur]; path.append(cur)
            return path[::-1]
        cx, cy = cur
        for dx, dy in NB:
            nx, ny = cx+dx, cy+dy
            if not ok(nx, ny): continue
            step = math.hypot(dx, dy) * cost(nx, ny)
            ng = gc + step
            if ng < g.get((nx,ny), 1e18):
                g[(nx,ny)] = ng; came[(nx,ny)] = cur
                heapq.heappush(openh, (ng + h(nx,ny), ng, (nx,ny)))
    return None

def nearest_ok(px, py, want_land):
    """거점 좌표에서 가장 가까운 통행가능 격자"""
    g0x, g0y = int(round(px/CELL)), int(round(py/CELL))
    best = None
    for R in range(0, 14):
        for dx in range(-R, R+1):
            for dy in range(-R, R+1):
                if max(abs(dx), abs(dy)) != R: continue
                x, y = g0x+dx, g0y+dy
                if not (0 <= x < GW and 0 <= y < GH): continue
                passable = land[x][y] if want_land else not land[x][y]
                if passable:
                    dd = math.hypot(x-g0x, y-g0y)
                    if best is None or dd < best[0]: best = (dd, (x,y))
        if best: return best[1]
    return None

# ── 경로 단순화 + 스무딩 ──
def simplify(pts, tol):
    if len(pts) < 3: return pts
    dmax, idx = 0.0, 0
    (x1,y1),(x2,y2) = pts[0], pts[-1]
    dx, dy = x2-x1, y2-y1
    den = math.hypot(dx, dy)
    for i in range(1, len(pts)-1):
        px, py = pts[i]
        dist = abs(dy*px-dx*py+x2*y1-y2*x1)/den if den else math.hypot(px-x1, py-y1)
        if dist > dmax: dmax, idx = dist, i
    if dmax > tol:
        return simplify(pts[:idx+1], tol)[:-1] + simplify(pts[idx:], tol)
    return [pts[0], pts[-1]]

def catmull(pts):
    """Catmull-Rom → 3차 베지어 SVG path (길처럼 부드럽게)"""
    if len(pts) < 2: return ''
    if len(pts) == 2:
        return f'M {pts[0][0]:.1f} {pts[0][1]:.1f} L {pts[1][0]:.1f} {pts[1][1]:.1f}'
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = [f'M {pts[0][0]:.1f} {pts[0][1]:.1f}']
    for i in range(1, len(p)-2):
        p0, p1, p2, p3 = p[i-1], p[i], p[i+1], p[i+2]
        c1 = (p1[0]+(p2[0]-p0[0])/11, p1[1]+(p2[1]-p0[1])/11)
        c2 = (p2[0]-(p3[0]-p1[0])/11, p2[1]-(p3[1]-p1[1])/11)
        out.append(f'C {c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}')
    return ' '.join(out)

# ── 도로 목록 로드 ──
import re
src = open('build_html.py').read()
m = re.search(r'ROADS = \[(.*?)\n\]', src, re.S)
ROADS = re.findall(r"\('([a-z]+)','([a-z]+)'\)", m.group(1))
pos = {c['id']: (c['x'], c['y']) for c in d['castles']}
typ = {c['id']: c['type'] for c in d['castles']}
nm  = {c['id']: c['name'] for c in d['castles']}

routes = {'land': [], 'sea': []}
fail = []

def build(a, b, want_land):
    ax, ay = pos[a]; bx, by = pos[b]
    s = nearest_ok(ax, ay, want_land)
    g = nearest_ok(bx, by, want_land)
    if not s or not g: return None
    gp = astar(s, g, want_land)
    if not gp: return None
    pts = [(x*CELL, y*CELL) for x, y in gp]
    pts = [(ax, ay)] + pts[1:-1] + [(bx, by)]
    return simplify(pts, 1.1)

# 수로는 명시 큐레이션 — 사서에 남은 항로 중심 (수군은 보조 개념)
SEA_ROUTES = [
    ('deokmul','hanganggu'),   # 덕적도 - 한강구
    ('deokmul','ungjingu'),    # 660 소정방 함대의 항로
    ('deokmul','gibeolpo'),    # 백강 방면
    ('michuhol','deokmul'),    # 미추홀 - 덕적도
    ('danghang','deokmul'),    # 당항성 - 덕적도 (대당 항로)
    ('paesu','danghang'),      # 대동강구 - 당항성 서해 연안
    ('bisa','seoanpyeong'),    # 요동반도 연안
    ('bisa','pyeongwon'),      # 요동만
    ('tamna','geumgwan'),      # 제주 항로
    ('tamna','chimmi'),        # 제주 - 서남해안
    ('haseulla','usanguk'),    # 우산국 정벌 항로
    ('nakdonggu','ulsan'),     # 남해 - 동해 연안
    ('geumgwan','sapryang'),   # 낙동강 하구 - 왕경 방면
]
SEA_SET = set(tuple(sorted(x)) for x in SEA_ROUTES)

# 육로 목록에서 수로로 옮길 쌍은 제외
land_pairs = [(a,b) for a,b in ROADS if tuple(sorted((a,b))) not in SEA_SET]

for a, b in land_pairs:
    pts = build(a, b, True)
    if not pts:
        fail.append((a, b, 'land-nopath')); continue
    routes['land'].append({'a': a, 'b': b, 'd': catmull(pts)})

for a, b in SEA_ROUTES:
    pts = build(a, b, False)
    if not pts:
        fail.append((a, b, 'sea-nopath')); continue
    routes['sea'].append({'a': a, 'b': b, 'd': catmull(pts)})

print(f"\n육로 {len(routes['land'])}개 / 수로 {len(routes['sea'])}개")
if fail:
    print('실패:')
    for a, b, why in fail: print(f'  {nm[a]}-{nm[b]} ({why})')

d['routes'] = routes
json.dump(d, open('mapdata.json', 'w'), ensure_ascii=False)
print('mapdata.json 저장 완료')
