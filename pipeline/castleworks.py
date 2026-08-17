"""
castleworks.py — 성곽 축조 (기획서 §7)

build_battlemaps.py 가 실측 지리로 **땅**을 깔면, 이 모듈이 그 위에 **성**을 앉힌다.
둘을 나눈 이유: 지리는 Natural Earth 원본에서 오고 성곽은 규격에서 오므로,
§7 을 고칠 때 지리 코드를 건드릴 일이 없어야 한다.

§7 의 요지는 「성이 다 똑같이 생기면 안 된다」는 것이다. 예전 생성기는 76곳
전부를 가운데 사각형 + 성문 2개로 깎아 놓았다. 그래서 안시성이 산악 63%인데
성 안은 평지였고, 강이 성벽을 관통했고, 옹성·치·해자는 아예 없었다.

  산성    구릉 능선을 따라 **비정형**. 접근로 두 방향뿐, 나머지는 산이 막는다
  평산성  배후는 구릉·절벽, 한 면 이상은 강. 강이 천연 해자다
  읍성    평지 도로 교차점에 사각형. 대신 **해자를 둘러야** 한다

배치는 계산이 아니라 **탐색**이다. 성이 앉을 수 있는 자리를 여러 곳 시험해
§7 의 제약(강이 안 관통하고, 유형별 접면이 있고, 접근로가 살아 있는)을 가장
잘 만족하는 곳을 고른다. 규칙으로 좌표를 유도하려 했더니 전장마다 지형이
달라 예외가 끝없이 늘었다.
"""

# ── §7.1 타일 ──────────────────────────────────────────────────────
# 기존 legend 에 셋을 더한다. 셋 다 「성벽 취급」이거나 지형이므로
# 통행 판정을 쓰는 쪽(TS 의 TERRAIN·insideWallGrid)도 함께 알아야 한다.
CHI = 'T'   # 치(雉) — 성벽 돌출부. 성문 접근로를 측면에서 쏜다
ONG = 'O'   # 옹성벽 — 성문 바깥 이중문. HP 는 성벽의 0.6배
MOAT = 'D'  # 해자 — 통행은 되지만 그 라운드 방어 -30%

WALLS = (('W', 'G', CHI, ONG))
"""성벽으로 취급되는 타일. 물을 부어 안팎을 가를 때 이 넷이 벽이 된다"""

BLOCK = ('m', 'X', 's')
"""성이 못 앉는 땅 — 산악·절벽·바다"""


# ── §7.5 주요 25성 고증 지정표 ──────────────────────────────────────
#
# 자동 규칙과 충돌하면 **이 표가 이긴다**(§7 머리말). 값은 기계가 검사할 수
# 있는 것만 적는다 — 「능선을 따라」 같은 서술은 form 이 대신한다.
#
#   form        sanseong | pyeongsanseong | eupseong | port
#   approaches  성벽 외곽 접근로 최대 방향 수
#   water       riverFace / cliffFace / seaFace — 최소 접면 수
#   waterSource 성 안에 폭 1 계곡수 (포위 완화)
#   double      이중성벽 (내성 + 외성)
#   twin        쌍성 (국내성 전용)
#   chi         치 밀도 배율
#   ongAll      모든 성문에 옹성
#   moatLayers  해자 겹 수
#   fordNear    나루(=)를 성벽 몇 타일 안에 둘 것인가
OVERRIDE = {
    # ── 고구려 ──
    'jolbon':   dict(form='sanseong', approaches=1, cliffFace=3, waterSource=True),
    'gungnae':  dict(form='pyeongsanseong', twin=True, riverFace=1, waterSource=True),
    'yodong':   dict(form='eupseong', riverFace=1, moatLayers=2),
    'pyeong':   dict(form='pyeongsanseong', double=True, riverFace=2, hillBack=True),
    'ansi':     dict(form='sanseong', approaches=1, waterSource=True),
    'baekam':   dict(form='sanseong', approaches=2, cliffFace=1, riverFace=1, chi=1.5),
    'maeso':    dict(form='sanseong', approaches=1, cliffFace=2, riverFace=1, fordNear=2),
    'nampyeong': dict(form='eupseong', riverFace=1),
    'daebang':  dict(form='eupseong'),
    # ── 쟁탈지 ──
    'gugwon':   dict(form='pyeongsanseong', riverFace=2, hillBack=True),
    # ── 백제 ──
    'hanseong': dict(form='eupseong', double=True, riverFace=1),
    'ungjin':   dict(form='sanseong', approaches=2, cliffFace=1, riverFace=1),
    'sabi':     dict(form='pyeongsanseong', double=True, riverFace=2, hillBack=True),
    'iksan':    dict(form='eupseong', hillBack=True),
    'mokji':    dict(form='eupseong'),
    'wansan':   dict(form='eupseong'),
    'balla':    dict(form='eupseong', riverFace=1),
    # ── 신라 ──
    'geumseong': dict(form='pyeongsanseong', double=True, riverFace=1),
    'samnyeon': dict(form='sanseong', double=True, approaches=1, chi=2.0,
                     ongAll=True, waterSource=True),
    'daeya':    dict(form='sanseong', double=True, approaches=2, riverFace=1, cliffFace=1),
    'sangju':   dict(form='pyeongsanseong', riverFace=1, hillBack=True),
    'daegu':    dict(form='eupseong', riverFace=1),
    # ── 가야 ──
    'daegaya':  dict(form='pyeongsanseong', hillBack=True),
    'aragaya':  dict(form='pyeongsanseong', hillBack=True),
    'goseong':  dict(form='port', seaFace=1),
    # ── 살수 — 성을 유지하되 도하 감제형 (§7.5 말미) ──
    # 나루를 성문 사정권에 두고 성문→나루 도로를 직결한다. 수비측이 출성해
    # 도하 중인 적(피격 +30%)을 치기 쉬운 구조 — 살수대첩의 무대다.
    'salsu':    dict(form='sanseong', approaches=2, riverFace=1, fordNear=3),
}

DOUBLE_WALL = {k for k, v in OVERRIDE.items() if v.get('double')}
TWIN = {k for k, v in OVERRIDE.items() if v.get('twin')}

# 표시 이름 교체 (§7.5) — id 는 코드 호환을 위해 그대로 둔다
RENAME = {
    'maeso': '호로고루',
    'ungjin': '곰나루',
    'ungjingu': '곰나루어귀',
    'daegu': '달구벌',
}


# ── §7.2 유형 판정 ─────────────────────────────────────────────────

def castle_form(ctype, mountainous, has_river, has_relief=True):
    """
    자동 생성분의 성 유형. 고증표가 있으면 그쪽이 이긴다.

    `has_relief` — 이 전장에 강·절벽·바다가 하나라도 있는가.
    평산성은 §7.2 가 「한 면 이상이 강에 접한다」를 요구하므로, 물도 절벽도
    없는 벌판에서는 성립할 수 없다. 그런 곳은 읍성으로 내린다 — 산악도만
    보고 평산성이라 부르면 접면 없는 평산성이 21곳 나온다(실측).
    """
    if ctype == 'port':
        return 'port'
    if mountainous >= 0.45:
        return 'sanseong'
    if (mountainous >= 0.15 or has_river) and has_relief:
        return 'pyeongsanseong'
    return 'eupseong'


def size_of(ctype, form, double=False):
    """
    성의 반지름(타일). 격이 높으면 크고, 산성은 지형에 눌려 작다.

    이중성벽 성은 한 칸 키운다 — 외성 안에 내성이 **완전히** 들어가야 하는데
    (§7.6-10), 산성 크기 그대로면 삼년산성·대야성에서 내성이 못 섰다(실측).
    """
    base = {'capital': 7, 'major': 6, 'fort': 5, 'port': 5}.get(ctype, 5)
    if form == 'sanseong':
        # 산성은 지형에 눌려 작지만, 비정형으로 우그러뜨리면 안쪽이 더 줄어든다.
        # 반지름을 깎지 않고 그대로 둔다 — 깎으면 성 안이 열 칸도 안 남는다
        pass
    if double:
        base += 2
    return base


def gate_count(ctype):
    """§7.4 — fort 2 / major 3 / capital 4"""
    return {'capital': 4, 'major': 3, 'fort': 2, 'port': 3}.get(ctype, 2)


# ── 기하 도구 ──────────────────────────────────────────────────────

def _blob(cx, cy, r, seed, irregular):
    """
    성벽이 둘러쌀 영역. 산성은 능선을 따라 우그러지고 읍성은 사각형이다.

    비정형을 극좌표 반지름 r(θ) 로 낸다. 방위마다 다른 값을 주면 닫힌 고리가
    저절로 보장된다 — 다각형 꼭짓점을 이어 붙이려다 고리가 끊겨 물이 새는
    일을 여기서 피한다.
    """
    cells = set()
    if not irregular:
        for y in range(cy - r + 1, cy + r):
            for x in range(cx - int(r * 1.35) + 1, cx + int(r * 1.35)):
                cells.add((x, y))
        return cells

    import math
    # 방위 16칸으로 나눠 반지름을 흔든다.
    #
    # 처음에 12칸·0.62~1.15 배로 두었더니 최대직사각형이 70~90% 로 나와
    # 「비정형」이라 부를 수 없었다(실측). 능선을 따라 앉은 산성은 한쪽이
    # 길고 한쪽이 잘록해야 한다 — 폭을 0.5~1.25 로 넓히고, 이웃한 방위끼리
    # 엇갈리게(2차 조화) 흔들어 잘록한 허리를 만든다.
    #
    # 0.50~1.25 로는 최대직사각형이 60~70% 에 머물렀다(실측). 산성은 능선을
    # 따라 **한쪽으로 길고 허리가 잘록해야** 한다. 그래서 셋을 겹친다 —
    #   ① 방위마다의 잡음        (울퉁불퉁)
    #   ② 2주기 성분             (한쪽으로 길게)
    #   ③ 3주기 성분의 깊은 골    (잘록한 허리)
    lobes = []
    ang = (seed % 16) / 16.0 * 6.283
    for i in range(16):
        a = ((seed >> (i * 2)) & 15) / 15.0
        th = i / 16.0 * 6.283
        v = 0.62 + 0.34 * a
        v *= 1.0 + 0.26 * math.cos(2 * th + ang)
        v *= 1.0 - 0.20 * abs(math.sin(3 * th + ang * 1.7))
        # 아래로 너무 내려가면 고리가 실처럼 가늘어져 성 안이 없어진다 —
        # 산성 열여섯 곳이 「성이 설 자리 없음」으로 떨어진 적이 있다
        lobes.append(max(0.58, v))
    for y in range(cy - r - 3, cy + r + 4):
        for x in range(cx - r - 4, cx + r + 5):
            dx, dy = (x - cx) / 1.25, y - cy
            d = math.hypot(dx, dy)
            if d < 0.5:
                cells.add((x, y))
                continue
            th = (math.atan2(dy, dx) + math.pi) / (2 * math.pi) * 16
            i0 = int(th) % 16
            i1 = (i0 + 1) % 16
            t = th - int(th)
            rr = r * (lobes[i0] * (1 - t) + lobes[i1] * t)
            if d <= rr:
                cells.add((x, y))
    # 사방이 이웃에 둘러싸인 구멍은 메운다 — 안 그러면 성 안에 못이 생긴다
    if cells:
        xs = [p[0] for p in cells]; ys = [p[1] for p in cells]
        for y in range(min(ys), max(ys) + 1):
            for x in range(min(xs), max(xs) + 1):
                if (x, y) in cells:
                    continue
                if all((x + a, y + b) in cells for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    cells.add((x, y))
    return cells


def _ring(cells):
    """영역의 바깥 껍질 — 성벽이 놓일 자리"""
    out = set()
    for (x, y) in cells:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (x + dx, y + dy) not in cells:
                out.add((x, y))
                break
    return out


def _in_bounds(cells, w, h, pad=1):
    return all(pad <= x < w - pad and pad <= y < h - pad for (x, y) in cells)


def largest_rect_ratio(cells):
    """
    §7.6-4 — 내부에 들어가는 가장 큰 직사각형이 내부 면적의 몇 할인가.

    「비정형」을 눈으로 판정할 수 없으므로 수치로 만든다. 사각형 성은 1.0 에
    가깝고, 능선을 따라 우그러진 산성은 0.5 아래로 떨어진다.
    """
    if not cells:
        return 1.0
    xs = [x for x, _ in cells]
    ys = [y for _, y in cells]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W = x1 - x0 + 1
    best = 0
    heights = [0] * W
    for y in range(y0, y1 + 1):
        for i in range(W):
            heights[i] = heights[i] + 1 if (x0 + i, y) in cells else 0
        # 히스토그램 최대 직사각형
        stack = []
        for i in range(W + 1):
            cur = heights[i] if i < W else 0
            while stack and heights[stack[-1]] >= cur:
                hh = heights[stack.pop()]
                left = stack[-1] + 1 if stack else 0
                best = max(best, hh * (i - left))
            stack.append(i)
    return best / len(cells)


# ── 배치 탐색 ──────────────────────────────────────────────────────

def _faces(grid, ring, w, h):
    """
    성벽 고리가 무엇에 접해 있는가 — 강·절벽·바다·구릉 각각 몇 타일인가.
    §7.2 의 「강 접면 ≥ 1」·「배후 구릉」을 여기서 센다.
    """
    seen = {'~': 0, 'X': 0, 's': 0, 'h': 0, 'm': 0, '=': 0}
    for (x, y) in ring:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            a, b = x + dx, y + dy
            if 0 <= a < w and 0 <= b < h and grid[b][a] in seen:
                seen[grid[b][a]] += 1
    return seen


def _score(grid, inner, ring, spec, w, h, form):
    """
    이 자리가 §7 을 얼마나 잘 만족하는가. 클수록 좋고, -1e9 는 실격이다.

    실격 조건이 점수보다 중요하다 — **강이 성 안을 관통하면 그 자리는 없는
    자리다**(§7.3-1). 점수로 깎으면 마땅한 자리가 없는 전장에서 결국 관통을
    허용해 버린다.
    """
    # ① 성 안에 강·바다·절벽이 있으면 실격 (계곡수는 나중에 따로 넣는다)
    for (x, y) in inner:
        c = grid[y][x]
        if c in ('~', 's', 'X'):
            return -1e9
    # 산악이 성 안에 많으면 못 쓴다 (조금은 봐준다 — 산성은 산 위에 있다)
    mtn = sum(1 for (x, y) in inner if grid[y][x] == 'm')
    if mtn > len(inner) * 0.12:
        return -1e9

    f = _faces(grid, ring, w, h)
    s = 0.0

    # ② 유형별 접면 요구 (§7.2)
    need_river = spec.get('riverFace', 1 if form == 'pyeongsanseong' else 0)
    if need_river:
        # 강 접면이 필요한데 하나도 없으면 크게 깎는다 (실격은 아니다 —
        # 강이 전장 구석에만 있는 곳도 있다)
        s += min(f['~'], need_river * 6) * 8 - (0 if f['~'] else 60)
    if spec.get('cliffFace'):
        s += min(f['X'], spec['cliffFace'] * 4) * 6 - (0 if f['X'] else 40)
    if spec.get('seaFace') or form == 'port':
        s += min(f['s'], 6) * 8 - (0 if f['s'] else 50)
    if spec.get('hillBack') or form == 'pyeongsanseong':
        s += min(f['h'] + f['X'], 10) * 3

    # ③ 산성은 구릉 위에 앉는다 — 내부 h 비율 (§7.6-4)
    if form == 'sanseong':
        hill = sum(1 for (x, y) in inner if grid[y][x] in ('h', 'm'))
        s += (hill / max(1, len(inner))) * 120
        # 「비정형」을 점수에 직접 넣는다. 모양을 흔드는 것만으로는 마침
        # 네모반듯한 후보가 최고점을 받아 67~75% 가 남았다(실측). 검사하는
        # 값과 고르는 값이 같아야 수렴한다.
        rr = largest_rect_ratio(inner)
        s += max(0.0, 0.52 - rr) * 300 - max(0.0, rr - 0.52) * 900

    # ④ 읍성은 평지 도로 교차점 (§7.2)
    if form == 'eupseong':
        flat = sum(1 for (x, y) in inner if grid[y][x] in ('.', 'r', 'f'))
        s += (flat / max(1, len(inner))) * 60
        s += min(f['~'] + f['s'], 4) * 2  # 물이 조금 닿는 것은 나쁘지 않다

    # ⑤ 가운데에 가까울수록 좋다 — 진입로가 네 변에서 오므로
    cx0, cy0 = w / 2, h / 2
    cx = sum(x for x, _ in inner) / len(inner)
    cy = sum(y for _, y in inner) / len(inner)
    s -= (abs(cx - cx0) + abs(cy - cy0)) * 1.5
    return s


def place(grid, castle_id, ctype, mountainous, has_river, seed, w, h, band=None):
    """
    성이 앉을 자리를 찾아 (내부, 성벽고리, 유형) 을 돌려준다.

    후보를 격자로 훑는다. 48×32 에 반지름 4~7 이면 후보가 수백 개뿐이라
    전수 탐색이 가장 단순하고 빠르다.
    """
    spec = OVERRIDE.get(castle_id, {})
    relief = any(c in ('~', 'X', 's') for row in grid for c in row)
    form = spec.get('form') or castle_form(ctype, mountainous, has_river, relief)
    r = size_of(ctype, form, bool(spec.get('double')))
    irregular = form == 'sanseong'

    best = None
    best_s = -1e18
    y0, y1 = band if band else (0, h)
    for cy in range(max(r + 2, y0 + r), min(h - r - 1, y1 - r + 2)):
        for cx in range(r + 3, w - r - 2):
            # 반지름을 셋 시험한다. 둘만 보았더니 살수처럼 산이 많아 자리가
            # 몇 곳뿐인 전장에서 네모난 후보가 최고점으로 남았다
            for rr in (r, r - 1, r + 1, r - 2):
                if rr < 3:
                    continue
                cells = _blob(cx, cy, rr, seed + cx * 31 + cy * 17, irregular)
                if not _in_bounds(cells, w, h, pad=1):
                    continue
                ring = _ring(cells)
                inner = cells - ring
                if len(inner) < 8:
                    continue
                sc = _score(grid, inner, ring, spec, w, h, form)
                if sc > best_s:
                    best_s = sc
                    best = (inner, ring, cells)
    if not best:
        return None, None, form, spec
    inner, ring, _ = best

    # 자리를 다 뒤졌는데도 물·절벽에 못 닿았으면 평산성이 아니다 (§7.2).
    # 고증표가 평산성이라 못 박은 곳은 배후 구릉으로 갈음한다 — 대가야처럼
    # 「서쪽 산을 등지고 동쪽 평지에 시가」인 성이 여기 해당한다.
    if form == 'pyeongsanseong' and not spec.get('form'):
        f = _faces(grid, ring, w, h)
        if f['~'] + f['X'] + f['s'] == 0:
            form = 'eupseong'
    return inner, ring, form, spec


# ── §7.4 구조물 ────────────────────────────────────────────────────

def _outward(ring, inner, x, y):
    """이 성벽 타일에서 성 밖으로 향하는 방향"""
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if (x + dx, y + dy) not in inner and (x + dx, y + dy) not in ring:
            return dx, dy
    return 0, -1


def _gate_spots(grid, ring, inner, n, w, h):
    """
    성문 자리. 서로 8타일 이상 떨어뜨리고(§7.4), **밖이 트인 곳**에만 낸다.
    강·바다·절벽을 향한 성문은 진출입이 안 되므로 §7.3-4 위반이다.
    """
    import math
    cx = sum(x for x, _ in inner) / len(inner)
    cy = sum(y for _, y in inner) / len(inner)
    cand = []
    for (x, y) in ring:
        dx, dy = _outward(ring, inner, x, y)
        ox, oy = x + dx * 2, y + dy * 2
        if not (0 <= ox < w and 0 <= oy < h):
            continue
        # 성문 정면 두 칸이 걸어 나갈 수 있는 땅이어야 한다
        near = [grid[y + dy * k][x + dx * k] for k in (1, 2)
                if 0 <= y + dy * k < h and 0 <= x + dx * k < w]
        if len(near) < 2 or any(c in ('~', 's', 'X', 'm') for c in near):
            continue
        # 방위를 고르게 흩는다 — 한쪽에 몰리면 공격군이 한 면만 치면 된다
        cand.append((math.atan2(y - cy, x - cx), x, y))
    if not cand:
        return []
    cand.sort()
    picked = []
    for _, x, y in cand:
        if all(abs(x - a) + abs(y - b) >= 8 for a, b in picked):
            picked.append((x, y))
        if len(picked) >= n:
            break
    # 8타일 간격을 못 지킬 만큼 작은 성이면 간격을 낮춰서라도 채운다
    if len(picked) < n:
        for _, x, y in cand:
            if (x, y) in picked:
                continue
            if all(abs(x - a) + abs(y - b) >= 5 for a, b in picked):
                picked.append((x, y))
            if len(picked) >= n:
                break
    return picked[:n]


def _put_ongseong(grid, gate, dirv, w, h):
    """
    옹성(甕城) — 성문 바깥 이중문 (§7.4).

    ㄷ 자로 두르고 **개구부를 측면으로** 낸다. 정면에 내면 그냥 문이 하나 더
    있는 것이고, 측면으로 꺾어야 들어온 적이 세 방향에서 사격을 받는다.
    """
    gx, gy = gate
    dx, dy = dirv
    px, py = -dy, dx          # 성문 정면에 수직인 축

    # 옹성이 물을 가두면 그 물이 「성 안」이 되어 §7.3-1 을 깬다(실측 —
    # 한성·사비·발라에서 강 한 칸씩이 옹성 주머니에 갇혔다). 앞이 물이면
    # 이 성문에는 옹성을 두지 않는다.
    # 처음에는 앞이 물이면 통째로 포기했는데, 국원성처럼 두 면이 강인 성은
    # 모든 성문이 물을 마주해 옹성이 하나도 안 섰다. 물 **칸만** 건너뛴다.
    placed = []
    def watery(x, y):
        return not (0 <= x < w and 0 <= y < h) or grid[y][x] in ('~', 's')
    # 정면 2칸 앞을 막고, 양옆을 세워 ㄷ 자를 만든다. 한쪽 측면만 비운다
    for k in (-2, -1, 0, 1, 2):
        cells = [(gx + dx * 2 + px * k, gy + dy * 2 + py * k)]           # 앞면
        if abs(k) == 2:
            cells.append((gx + dx * 1 + px * k, gy + dy * 1 + py * k))   # 측면
        for (x, y) in cells:
            if watery(x, y):
                continue
            if grid[y][x] in WALLS:
                continue
            # 물을 등지고 세우면 그 물이 옹성 주머니에 갇혀 「성 안」이 된다
            if any(watery(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            # 개구부 — 한쪽 측면 한 칸은 비워 둔다
            if (x, y) == (gx + dx * 1 + px * 2, gy + dy * 1 + py * 2):
                continue
            grid[y][x] = ONG
            placed.append((x, y))
    return placed


def _put_chi(grid, ring, inner, gates, density, w, h, want=None):
    """
    치(雉) — 성벽 돌출부 (§7.4).

    둘레 12타일당 1개, 그리고 **성문 좌우 4타일 안에 최소 1개씩.** 성문
    접근로를 측면에서 쏘는 것이 치의 존재 이유이므로 이 조건이 본체다.

    치를 성벽 **바깥**으로 튀어나오게 놓아 봤는데, 바깥이 물이거나 해자이거나
    이미 옹성이면 자리가 없어 59곳에서 성문 옆 치가 비었다(실측). 치는
    「성벽 취급」이므로 고리 위에 놓아도 통행 불가·사격 규칙은 그대로다.
    고리 위에 놓으면 자리가 언제나 있고 성벽이 끊길 일도 없다.
    """
    ringl = sorted(p for p in ring if grid[p[1]][p[0]] == 'W')
    if want is None:
        want = max(2, int(len(ring) / 12 * density))
    placed = []

    def try_put(x, y):
        if grid[y][x] != 'W':
            return False
        grid[y][x] = CHI
        placed.append((x, y))
        return True

    # ① 성문 좌우 먼저 — 이쪽이 규격의 핵심이다
    for (gx, gy) in gates:
        near = sorted((p for p in ringl if 2 <= abs(p[0] - gx) + abs(p[1] - gy) <= 4),
                      key=lambda p: abs(p[0] - gx) + abs(p[1] - gy))
        for p in near:
            if try_put(*p):
                break
    # ② 나머지를 둘레에 고르게
    if len(placed) < want and ringl:
        rest = [p for p in ringl if p not in placed]
        stride = max(1, len(rest) // max(1, want - len(placed)))
        for i in range(0, len(rest), stride):
            if len(placed) >= want:
                break
            try_put(*rest[i])
    return placed


def _put_moat(grid, ring, inner, gates, layers, w, h):
    """
    해자(垓子) — 읍성 필수 (§7.2·§7.4).

    성벽 바깥을 두르되 **성문 앞은 비운다.** 다리 없이 두르면 §7.6-8(성문에서
    맵 가장자리까지 통행 가능)이 깨진다. 강·바다에 접한 면은 이미 천연 해자다.
    """
    front = set()
    for (gx, gy) in gates:
        dx, dy = _outward(ring, inner, gx, gy)
        for k in range(1, layers + 2):
            front.add((gx + dx * k, gy + dy * k))

    placed = []
    band = set(ring)
    for _ in range(layers):
        nxt = set()
        for (x, y) in band:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if not (0 <= a < w and 0 <= b < h):
                    continue
                if (a, b) in inner or (a, b) in ring or (a, b) in front:
                    continue
                if grid[b][a] in WALLS or grid[b][a] in ('s', '~', '=', 'X', 'm', MOAT):
                    continue
                grid[b][a] = MOAT
                placed.append((a, b))
                nxt.add((a, b))
        band = nxt
    return placed


# ── 지형 손질 ──────────────────────────────────────────────────────

def _shape_interior(grid, inner, form, seed):
    """
    성 안의 땅을 유형에 맞게 고친다.

    §7.6-4 는 산성 내부의 구릉 비율 ≥ 50% 를 요구한다. 안시성이 산악 63%인데
    성 안이 평지였던 것이 이 손질이 없어서다 — 성벽만 지형 위에 얹고 안쪽은
    건드리지 않았다.
    """
    cells = sorted(inner)
    if form == 'sanseong':
        # 구릉으로 채운다. 다만 전부 h 로 만들면 성 안이 평평한 언덕이 되므로
        # 결정론적으로 일부를 평지로 남겨 마당을 만든다
        # 여덟 중 일곱은 구릉으로. 넷 중 셋으로 두었더니 실제 내부(물을 부어
        # 재는 값)가 43% 까지 내려가 §7.6-4 의 50% 를 못 넘겼다 — 고리 안쪽
        # 여백까지 세므로 여유가 필요하다
        for i, (x, y) in enumerate(cells):
            if grid[y][x] in ('m', 'X'):
                grid[y][x] = 'h'
            elif grid[y][x] in ('.', 'f', 'M', 'r'):
                grid[y][x] = 'h' if ((seed >> (i % 11)) & 7) else '.'
    else:
        # 평산성·읍성 안쪽은 걸어 다닐 수 있어야 한다
        for (x, y) in cells:
            if grid[y][x] in ('m', 'X', 'M'):
                grid[y][x] = 'h' if form == 'pyeongsanseong' else '.'


def _water_source(grid, inner, seed):
    """
    §7.3-2 — 산성의 계곡수. 폭 1타일의 ~ 를 성 안에 흘린다.

    이 성은 포위해도 잘 안 마른다(§7.7 WATERSOURCE_SIEGE_RELIEF). 안시성을
    말려 죽이기 어려운 근거가 지형에 남아야 한다.
    """
    cells = sorted(inner)
    if len(cells) < 12:
        return False
    # 세로로 관통하지 않게 짧게 — 3~4칸
    start = cells[len(cells) // 2 + (seed % 3)]
    x, y = start
    n = 0
    for k in range(4):
        if (x, y + k) in inner:
            grid[y + k][x] = '~'
            n += 1
    return n > 0


def _open_approaches(grid, ring, inner, gates, form, max_dirs, w, h):
    """
    §7.2 — 산성의 성벽 외곽 접근로는 최대 2방향. 나머지는 산이 막는다.

    막되 **성문에서 맵 가장자리로 나가는 길은 남긴다**(§7.6-8). 그래서
    성문이 있는 방위를 살릴 방위로 고른다 — 규칙 둘이 부딪히지 않게.
    """
    if not max_dirs or form != 'sanseong':
        return
    import math
    cx = sum(x for x, _ in inner) / len(inner)
    cy = sum(y for _, y in inner) / len(inner)

    def quad(x, y):
        a = (math.degrees(math.atan2(y - cy, x - cx)) + 360) % 360
        return int(a // 90)  # 0:E 1:S 2:W 3:N

    keep = []
    for (gx, gy) in gates:
        q = quad(gx, gy)
        if q not in keep:
            keep.append(q)
    keep = keep[:max_dirs]
    if not keep:
        return

    # 성벽에서 3~5타일 띠를 골라, 살릴 방위가 아니면 산으로 채운다
    band = set()
    cur = set(ring)
    for _ in range(5):
        nxt = set()
        for (x, y) in cur:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                a, b = x + dx, y + dy
                if not (0 <= a < w and 0 <= b < h):
                    continue
                if (a, b) in inner or (a, b) in ring or (a, b) in band:
                    continue
                nxt.add((a, b))
        band |= nxt
        cur = nxt
    for (x, y) in band:
        if quad(x, y) in keep:
            continue
        if grid[y][x] in WALLS or grid[y][x] in ('s', '~', '=', MOAT, 'P'):
            continue
        # 성문 정면은 절대 막지 않는다
        if any(abs(x - gx) + abs(y - gy) <= 3 for gx, gy in gates):
            continue
        grid[y][x] = 'm'


def _road_to(grid, a, b, w, h):
    """두 점을 잇는 길. 성문↔나루, 쌍성끼리 연결에 쓴다"""
    (x0, y0), (x1, y1) = a, b
    x, y = x0, y0
    guard = 0
    while (x, y) != (x1, y1) and guard < 200:
        guard += 1
        if x != x1 and (y == y1 or guard % 2):
            x += 1 if x1 > x else -1
        elif y != y1:
            y += 1 if y1 > y else -1
        if not (0 <= x < w and 0 <= y < h):
            break
        if grid[y][x] in WALLS or grid[y][x] in ('~', 's', '='):
            continue
        if grid[y][x] in ('m', 'X', 'M', MOAT):
            grid[y][x] = 'r'
        elif grid[y][x] in ('.', 'f', 'h'):
            grid[y][x] = 'r'


def _ford_near(grid, ring, dist, w, h):
    """
    §7.5 — 나루(=)를 성벽 사정권에 둔다. 살수·호로고루의 구조다.

    수비측이 출성해 도하 중인 적(피격 +30%)을 치기 쉬워야 살수대첩이
    지형으로 성립한다. 강이 사정권에 없으면 아무것도 안 한다.
    """
    best = None
    bd = 1e9
    for y in range(h):
        for x in range(w):
            if grid[y][x] != '~':
                continue
            d = min(abs(x - a) + abs(y - b) for a, b in ring)
            if d < bd:
                bd = d
                best = (x, y)
    if not best or bd > dist + 4:
        return None
    x, y = best
    # 강을 가로지르는 폭으로 나루를 낸다
    made = []
    for d in (-1, 0, 1):
        for (a, b) in ((x, y + d), (x + d, y)):
            if 0 <= a < w and 0 <= b < h and grid[b][a] == '~':
                grid[b][a] = '='
                made.append((a, b))
    if made:
        near = min(ring, key=lambda p: abs(p[0] - x) + abs(p[1] - y))
        _road_to(grid, near, made[0], w, h)
    return made[0] if made else None


# ── 한 성을 세운다 ──────────────────────────────────────────────────

def _raise_wall(grid, ring, inner, gates, w, h):
    """고리를 성벽으로, 고른 자리를 성문으로 굳힌다"""
    for (x, y) in ring:
        if grid[y][x] == 's':
            continue
        grid[y][x] = 'W'
    for (x, y) in gates:
        grid[y][x] = 'G'


def _inner_castle(grid, inner, ctype, seed, w, h):
    """
    §7.4 이중성벽 — 외성 안에 내성.

    외성을 돌파해도 시가전이 아니라 **내성 공성으로 이행**한다. 수도와
    난공불락성 여섯 곳에만 둔다. 내성은 외성 내부에 완전히 들어가야 한다.
    """
    cells = sorted(inner)
    if len(cells) < 18:
        return None, None
    cx0 = sum(x for x, _ in cells) // len(cells)
    cy0 = sum(y for _, y in cells) // len(cells)
    # 가운데 한 자리만 시험했더니 우그러진 산성(삼년산성·대야성)에서 내성이
    # 한 번도 안 들어갔다. 가운데 언저리를 훑고, 크기도 작은 쪽까지 내려간다
    spots = [(cx0 + a, cy0 + b) for b in (0, -1, 1, -2, 2) for a in (0, -1, 1, -2, 2)]
    for r in (3, 2, 1):
        for (cx, cy) in spots:
            blob = _blob(cx, cy, r, seed, False)
            if not blob <= inner:
                continue
            ring2 = _ring(blob)
            in2 = blob - ring2
            if len(in2) < 2:
                continue
            # 내성은 자기 성문을 갖는다 (§7.6-10)
            g = _gate_spots(grid, ring2, in2, 1, w, h)
            if not g:
                # 내성 성문 앞이 다 막혔으면 고리 한 칸을 그냥 문으로 쓴다
                g = [sorted(ring2)[len(ring2) // 2]]
            _raise_wall(grid, ring2, in2, g, w, h)
        # 내성 둘레도 성벽이다 — 치 밀도(§7.6-3)는 전체 둘레로 재므로
        # 내성에도 놓아야 한다. 안 놓으면 이중성벽 여섯 곳이 전부 밀도 미달이다.
            _put_chi(grid, ring2, in2, g, 1.0, w, h)
            return in2, g
    return None, None


def _raise_backhill(grid, ring, inner, w, h):
    """성벽 한 면 뒤쪽을 구릉으로 돋운다 (§7.2 평산성의 배후)"""
    cx = sum(x for x, _ in inner) / len(inner)
    cy = sum(y for _, y in inner) / len(inner)
    # 맵 가장자리에서 가장 먼 면을 배후로 삼는다
    best = max(ring, key=lambda p: min(p[0], p[1], w - 1 - p[0], h - 1 - p[1]))
    bx, by = best
    ux, uy = bx - cx, by - cy
    n = (ux ** 2 + uy ** 2) ** 0.5 or 1
    ux, uy = ux / n, uy / n
    for k in range(1, 5):
        for j in (-2, -1, 0, 1, 2):
            x = int(round(bx + ux * k - uy * j))
            y = int(round(by + uy * k + ux * j))
            if not (0 <= x < w and 0 <= y < h):
                continue
            if grid[y][x] in WALLS or grid[y][x] in ('~', 's', '=', MOAT, 'P', 'G'):
                continue
            grid[y][x] = 'h'


def _notch(grid, ring, inner, w, h):
    """
    성벽을 안쪽으로 한두 칸 파고들게 한다 — 능선을 따라 쌓은 성벽의 굴곡.

    살수처럼 험지 31% 에 강이 가로지르는 전장은 성이 앉을 자리가 몇 곳뿐이라,
    아무리 모양을 흔들어도 후보가 다 네모반듯하게 나온다(최대직사각형 62%).
    그럴 때 벽 한 칸을 안으로 밀어 넣으면 §7.6-4 를 넘긴다. 고리에 붙여
    넣으므로 성벽이 끊기지 않는다.

    돌려주는 값: 줄어든 내부 (파고든 칸은 이제 성벽이다)
    """
    cur = set(inner)
    for _ in range(3):
        if largest_rect_ratio(cur) < 0.58:
            break
        best = None
        best_rr = 1.0
        for (x, y) in sorted(cur):
            # 고리에 닿은 칸만 — 성 한복판에 기둥을 세울 수는 없다
            if not any((x + a, y + b) in ring for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            trial = cur - {(x, y)}
            if len(trial) < 12:
                continue
            rr = largest_rect_ratio(trial)
            if rr < best_rr:
                best_rr = rr
                best = (x, y)
        if not best:
            break
        cur.discard(best)
        ring.add(best)
        grid[best[1]][best[0]] = 'W'
    return cur


def _ensure_exit(grid, gate, dirv, w, h):
    """
    성문에서 맵 가장자리까지 걸어 나갈 수 있게 한 줄을 뚫는다 (§7.6-8).

    접근로를 막는 규칙(§7.2 산성)과 고립 금지가 부딪히는 자리다. 막는 쪽이
    뒤에 오므로, 막고 난 뒤 여기서 성문 정면 한 줄만 되뚫어 준다.
    """
    from collections import deque
    blocked = {'m', 'X', 'W', CHI, ONG, '~', 's'}

    gx, gy = gate
    dx, dy = dirv
    start = (gx + dx, gy + dy)
    if not (0 <= start[0] < w and 0 <= start[1] < h):
        return
    if grid[start[1]][start[0]] not in blocked:
        seen = {start}
        q = deque([start])
        while q:
            x, y = q.popleft()
            if x in (0, w - 1) or y in (0, h - 1):
                return
            for ax, ay in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if not (0 <= ax < w and 0 <= ay < h) or (ax, ay) in seen:
                    continue
                if grid[ay][ax] in blocked:
                    continue
                seen.add((ax, ay))
                q.append((ax, ay))
    # 막혔다 — 성문 정면으로 곧장 뚫는다
    x, y = start
    for _ in range(max(w, h) + 2):
        if not (0 <= x < w and 0 <= y < h):
            return
        if grid[y][x] == ONG:
            # 옹성이 제 성문을 가둬 버렸다. 여기가 개구부다 — 한 칸을 연다.
            # (접근로를 막는 산이 옹성 옆구리까지 메워 삼년산성의 성문이
            #  제 옹성 안에 갇힌 적이 있다)
            grid[y][x] = '.'
        elif grid[y][x] in ('m', 'X'):
            grid[y][x] = 'r'
        elif grid[y][x] == '~':
            grid[y][x] = '='
        elif grid[y][x] == 's':
            # 바다는 뚫지 않는다. 섬 거점에서 바다를 가로질러 여울을 그어
            # 덕물도 한복판에 12칸짜리 나루가 생긴 적이 있다
            return
        if x in (0, w - 1) or y in (0, h - 1):
            return
        x += dx
        y += dy


def build_castle(grid, castle_id, ctype, mountainous, has_river, seed, w, h, band=None):
    """
    전장 하나에 성을 세운다. grid 를 제자리에서 고치고 요약을 돌려준다.

    순서가 중요하다 — 자리를 고르고(배치 탐색) → 안쪽 땅을 손질하고 →
    성벽·성문을 세우고 → 구조물을 붙이고 → 마지막에 접근로를 막는다.
    접근로를 먼저 막으면 성문 자리를 고를 때 「밖이 트인 곳」이 사라진다.
    """
    inner, ring, form, spec = place(grid, castle_id, ctype, mountainous,
                                    has_river, seed, w, h, band)
    if not inner:
        return None
    # 성이 설 땅이 모자라면 아예 세우지 않는다.
    #
    # 덕물도는 7×5km 안이 바다 93% 라 성벽 고리가 앉을 자리가 없다. 억지로
    # 세우면 성문 하나짜리 반쪽 성이 나와 §7.4 를 통째로 못 지킨다 —
    # 그런 곳은 「성이 없는 거점」으로 두는 편이 정직하다.
    land = sum(1 for (x, y) in (inner | ring) if grid[y][x] not in ('s', '~'))
    if land < len(inner | ring) * 0.6 or len(inner) < 12:
        return None

    _shape_interior(grid, inner, form, seed)

    # §7.5 가 「배후는 산(주산)」이라 못 박은 성은 그 산이 실제로 있어야 한다.
    # 대가야·아라가야처럼 7km 안에 하천도 절벽도 안 잡히는 곳이 있어서,
    # 없으면 만들어 준다 — 고증표가 자동 규칙을 이긴다는 §7 머리말대로다.
    if spec.get('hillBack'):
        _raise_backhill(grid, ring, inner, w, h)

    # 산성이 마침 네모반듯하게 나왔으면 성벽을 안으로 파고들게 한다 (§7.6-4)
    if form == 'sanseong':
        inner = _notch(grid, ring, inner, w, h)

    n_gate = gate_count(ctype)
    gates = _gate_spots(grid, ring, inner, n_gate, w, h)
    if not gates:
        gates = [sorted(ring)[len(ring) // 2]]
    _raise_wall(grid, ring, inner, gates, w, h)

    # 주성문에 옹성. capital 과 ongAll 은 전 성문에 (§7.4)
    ong_all = ctype == 'capital' or spec.get('ongAll')
    ong = []
    for g in (gates if ong_all else gates):
        got = _put_ongseong(grid, g, _outward(ring, inner, *g), w, h)
        ong += got
        # 주성문 하나면 되는 성은 **놓이는 순간** 멈춘다. 처음에는 gates[:1] 만
        # 시도했는데, 그 문 앞이 물이면(Fix D) 성 전체에 옹성이 없어졌다.
        if got and not ong_all:
            break

    chi = _put_chi(grid, ring, inner, gates, spec.get('chi', 1.0), w, h)

    # 해자 — 읍성 필수, 평산성은 강에 안 닿은 면에만, 산성은 지형이 해자다
    layers = spec.get('moatLayers', 1 if form in ('eupseong', 'port') else 0)
    moat = _put_moat(grid, ring, inner, gates, layers, w, h) if layers else []

    # 이중성벽 / 계곡수 / 나루
    inner2 = gates2 = None
    if spec.get('double'):
        inner2, gates2 = _inner_castle(grid, inner, ctype, seed, w, h)
    water_source = bool(spec.get('waterSource')) and _water_source(
        grid, (inner - set(inner2 or ())), seed)
    ford = _ford_near(grid, ring, spec['fordNear'], w, h) if spec.get('fordNear') else None

    # 접근로 제한은 맨 마지막 (§7.2 산성)
    _open_approaches(grid, ring, inner, gates, form,
                     spec.get('approaches', 2 if form == 'sanseong' else 0), w, h)

    # 그러고 나서 **성문마다 바깥으로 나가는 길이 살아 있는지** 확인한다.
    # 접근로를 막는 규칙(§7.2)과 고립 금지(§7.6-8)가 부딪히는 자리다 —
    # 막는 쪽이 뒤에 오므로 여기서 한 줄을 되뚫어 준다.
    for g in gates:
        _ensure_exit(grid, g, _outward(ring, inner, *g), w, h)

    # 옹성·내성이 서면 성벽 둘레가 늘어난다. 검사는 **최종 둘레**로 밀도를
    # 재므로(§7.6-3) 여기서 한 번 더 채운다 — 안 그러면 큰 성들이 늘 미달이다.
    total_wall = sum(1 for y in range(h) for x in range(w) if grid[y][x] in WALLS)
    want = max(2, int(total_wall / 12 * spec.get('chi', 1.0)))
    if len(chi) < want:
        # 모자란 **개수만큼만** 더 놓는다. 밀도를 크게 넣어 부르면 stride 가 1 이
        # 되어 성벽이 통째로 치가 된다 — 한성 북벽이 TTGTTTTTTTG 가 되어 있었다
        chi += _put_chi(grid, ring, inner, gates, 1.0, w, h, want=want - len(chi))

    return {
        'form': form,
        'inner': inner,
        'ring': ring,
        'gates': gates,
        'ongseong': ong,
        'chi': chi,
        'moat': moat,
        'doubleWall': bool(inner2),
        'innerGates': gates2 or [],
        'waterSource': bool(water_source),
        'fordNear': ford is not None,
        'rectRatio': round(largest_rect_ratio(inner), 3),
    }


def build_twin(grid, castle_id, ctype, mountainous, seed, w, h):
    """
    §7.4 쌍성 — 국내성 전용.

    평지의 국내성과 배후 산의 환도산성을 **한 맵에 둘 다** 둔다. 이중성벽이
    안팎으로 포개진 구조라면 쌍성은 떨어진 두 성이라, 공격측이 병력을 나누거나
    각개격파 순서를 정해야 한다. 두 성 사이는 도로로 잇는다.

    처음에는 반쪽 지형을 'X' 로 덮어 배치를 유도했는데, 그 덮어쓴 격자를
    도로 복사하는 바람에 맵 절반이 절벽이 되었다. 지금은 **자리만** 제한한다.
    """
    a = build_castle(grid, castle_id, ctype, mountainous, True, seed, w, h,
                     band=(h // 2, h))
    if not a:
        return None
    b = build_castle(grid, castle_id + '#hill', 'fort', 0.9, False, seed + 991,
                     w, h, band=(0, h // 2))
    if not b:
        return a

    # 두 성을 도로로 잇는다 (§7.6-11)
    _road_to(grid, sorted(a['gates'])[0], sorted(b['gates'])[0], w, h)

    a['twinCastle'] = True
    a['gates'] = list(a['gates']) + list(b['gates'])
    a['chi'] = list(a['chi']) + list(b['chi'])
    a['ongseong'] = list(a['ongseong']) + list(b['ongseong'])
    a['ring'] = a['ring'] | b['ring']
    a['form'] = 'twin'
    return a
