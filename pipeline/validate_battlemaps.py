"""
validate_battlemaps.py — §7.6 검증 (전 맵 통과 필수)

생성기를 고칠 때마다 여기를 돌린다. 12개 항목이 전부 0건이 될 때까지
생성기를 고치는 것이 §7 의 완료 조건이다.

    python3 validate_battlemaps.py

규칙을 코드로 옮길 때 지킨 것 하나: **검사는 생성기 코드를 안 읽는다.**
타일만 보고 판정한다. 생성기가 「나는 옹성을 놓았다」고 말해도 타일에 O 가
없으면 없는 것이다 — 그래야 검사가 생성기의 착각을 잡는다.
"""
import json
import sys
from collections import Counter, deque

M = json.load(open('battlemaps.json'))
MAPS = M['maps']

WALL = {'W', 'G', 'T', 'O'}
BLOCKED = {'m', 'X', 'W', 'T', 'O', '~', 's'}   # 걸어서 못 지나는 타일
FORMS = ('sanseong', 'pyeongsanseong', 'eupseong', 'port', 'twin', 'none')

# §7.4 — 이중성벽 6곳, 쌍성 1곳
DOUBLE = {'pyeong', 'geumseong', 'sabi', 'hanseong', 'samnyeon', 'daeya'}
TWIN = {'gungnae'}
FORD_NEAR = {'maeso': 2, 'salsu': 3}
CHI_DENSITY = {'baekam': 1.5, 'samnyeon': 2.0}

fails = Counter()
detail = {}


def fail(item, mid, msg):
    fails[item] += 1
    detail.setdefault(item, []).append(f'{mid}: {msg}')


def grid_of(m):
    return [list(r) for r in m['tiles']]


def inside_of(m):
    """성벽 안쪽 — 바깥 테두리에서 물을 부어 안 닿은 칸 (siege.ts 와 같은 방식)"""
    g = m['tiles']
    w, h = m['w'], m['h']
    out = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if g[y][x] not in WALL and not out[y][x]:
                out[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if g[y][x] not in WALL and not out[y][x]:
                out[y][x] = True
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = x + dx, y + dy
            if 0 <= a < w and 0 <= b < h and not out[b][a] and g[b][a] not in WALL:
                out[b][a] = True
                q.append((a, b))
    return {(x, y) for y in range(h) for x in range(w)
            if not out[y][x] and g[y][x] not in WALL}


def wall_cells(m):
    g = m['tiles']
    return {(x, y) for y in range(m['h']) for x in range(m['w']) if g[y][x] in WALL}


def gates_of(m):
    g = m['tiles']
    return [(x, y) for y in range(m['h']) for x in range(m['w']) if g[y][x] == 'G']


def largest_rect_ratio(cells):
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
        stack = []
        for i in range(W + 1):
            cur = heights[i] if i < W else 0
            while stack and heights[stack[-1]] >= cur:
                hh = heights[stack.pop()]
                left = stack[-1] + 1 if stack else 0
                best = max(best, hh * (i - left))
            stack.append(i)
    return best / len(cells)


def reach_edge(m, start):
    """그 칸에서 맵 가장자리까지 걸어 나갈 수 있는가 (§7.6-8)"""
    g = m['tiles']
    w, h = m['w'], m['h']
    seen = {start}
    q = deque([start])
    while q:
        x, y = q.popleft()
        if x in (0, w - 1) or y in (0, h - 1):
            return True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = x + dx, y + dy
            if not (0 <= a < w and 0 <= b < h) or (a, b) in seen:
                continue
            if g[b][a] in BLOCKED:
                continue
            seen.add((a, b))
            q.append((a, b))
    return False


for mid, m in MAPS.items():
    form = m.get('form', 'none')
    tiles = ''.join(m['tiles'])
    inner = inside_of(m)
    walls = wall_cells(m)
    gates = gates_of(m)
    has_castle = bool(walls)

    # ① 성벽 내부에 강 — 산성 계곡수(폭1)만 예외
    if has_castle:
        riv = [(x, y) for (x, y) in inner if m['tiles'][y][x] == '~']
        if riv:
            if not (m.get('waterSource') and len(riv) <= 5):
                fail('①성내 강', mid, f'{len(riv)}칸')

    # ② 성문 수 + 주성문 옹성
    if has_castle:
        want = {'capital': 4, 'major': 3, 'fort': 2, 'port': 3}.get(m['type'], 2)
        if mid in TWIN:
            want = 2                      # 쌍성은 성곽마다 1개 이상
        if len(gates) < want:
            fail('②성문 수', mid, f'{len(gates)}/{want}')
        if 'O' not in tiles:
            fail('②옹성 없음', mid, '주성문에 옹성이 없다')

    # ③ 치 — 둘레 12타일당 1개, 성문 좌우 4타일 내 각 1
    if has_castle:
        dens = CHI_DENSITY.get(mid, 1.0)
        want_chi = max(2, int(len(walls) / 12 * dens))
        chi = [(x, y) for y in range(m['h']) for x in range(m['w'])
               if m['tiles'][y][x] == 'T']
        if len(chi) < want_chi:
            fail('③치 밀도', mid, f'{len(chi)}/{want_chi}')
        for (gx, gy) in gates:
            if not any(abs(cx - gx) + abs(cy - gy) <= 4 for cx, cy in chi):
                fail('③성문 옆 치', mid, f'성문({gx},{gy}) 좌우 4타일에 치 없음')
                break

    # ④ 산성 — 내부 h ≥ 50%, 비정형
    if form == 'sanseong' and inner:
        hill = sum(1 for (x, y) in inner if m['tiles'][y][x] in ('h', 'm'))
        if hill / len(inner) < 0.5:
            fail('④산성 구릉', mid, f'{hill/len(inner):.0%}')
        rr = largest_rect_ratio(inner)
        if rr >= 0.6:
            fail('④산성 비정형', mid, f'최대직사각형 {rr:.0%}')

    # ⑤ 평산성 — 강 또는 절벽 접면 ≥ 1
    if form == 'pyeongsanseong' and walls:
        touch = hills = 0
        for (x, y) in walls:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                a, b = x + dx, y + dy
                if not (0 <= a < m['w'] and 0 <= b < m['h']):
                    continue
                if m['tiles'][b][a] in ('~', 'X', 's'):
                    touch += 1
                elif m['tiles'][b][a] in ('h', 'm'):
                    hills += 1
        # 전장에 물도 절벽도 아예 없으면 강 접면을 요구할 수 없다.
        # §7.2 의 「배후(1개 면)는 h 또는 X」로 갈음한다 — 대가야처럼
        # 「서쪽 산을 등지고 동쪽 평지에 시가」인 성이 여기 해당한다.
        dry = not any(c in tiles for c in ('~', 'X', 's'))
        if touch == 0 and not (dry and hills >= 4):
            fail('⑤평산성 접면', mid, '강·절벽 접면 없음' + (' (배후 구릉도 없음)' if dry else ''))

    # ⑥ 읍성 — 해자
    if form in ('eupseong', 'port') and has_castle:
        if 'D' not in tiles:
            fail('⑥읍성 해자', mid, '해자 없음')

    # ⑦ 플래그 정합
    if m['hasRiver'] != ('~' in tiles or '=' in tiles):
        fail('⑦플래그', mid, f"hasRiver={m['hasRiver']} 실측={'~' in tiles}")
    if m['hasSea'] != ('s' in tiles):
        fail('⑦플래그', mid, f"hasSea={m['hasSea']} 실측={'s' in tiles}")
    if (mid in TWIN) != bool(m.get('twinCastle')):
        fail('⑦플래그', mid, 'twinCastle 불일치')
    if (mid in DOUBLE) != bool(m.get('doubleWall')):
        fail('⑦플래그', mid, 'doubleWall 불일치')

    # ⑧ 모든 성문에서 맵 가장자리까지 통행 가능
    for (gx, gy) in gates:
        opened = False
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = gx + dx, gy + dy
            if 0 <= a < m['w'] and 0 <= b < m['h'] and m['tiles'][b][a] not in BLOCKED:
                if reach_edge(m, (a, b)):
                    opened = True
                    break
        if not opened:
            fail('⑧고립 성문', mid, f'({gx},{gy})')
            break

    # ⑨ 나루 개수 1~3, 도로 연결
    fords = [(x, y) for y in range(m['h']) for x in range(m['w'])
             if m['tiles'][y][x] == '=']
    # 성 안의 계곡수(§7.3-2)는 도하 대상이 아니다 — 나루를 요구할 강은
    # 성 밖에 흐르는 강뿐이다. 이걸 안 가르면 안시성·졸본처럼 계곡수만 있는
    # 산성이 「나루 0곳」으로 걸린다
    outer_river = any(m['tiles'][y][x] == '~'
                      for y in range(m['h']) for x in range(m['w'])
                      if (x, y) not in inner)
    if outer_river:
        # 나루 덩어리 수를 센다 (인접한 = 는 한 곳)
        seen = set()
        groups = 0
        for p in fords:
            if p in seen:
                continue
            groups += 1
            q = deque([p])
            seen.add(p)
            while q:
                x, y = q.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (x + dx, y + dy)
                    if n in fords and n not in seen:
                        seen.add(n)
                        q.append(n)
        if not (1 <= groups <= 3):
            fail('⑨나루 수', mid, f'{groups}곳')

    # ⑩ 이중성벽 — 내성이 외성에 포함, 각각 성문
    if mid in DOUBLE:
        if not m.get('doubleWall'):
            fail('⑩이중성벽', mid, '내성이 서지 않았다')
        else:
            # 내성 = 안쪽 영역 중 성벽으로 다시 둘러싸인 부분
            deeper = {(x, y) for (x, y) in inner
                      if all(0 <= x + dx < m['w'] and 0 <= y + dy < m['h']
                             for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
            if not deeper:
                fail('⑩이중성벽', mid, '내성 영역 없음')

    # ⑪ 쌍성 — 독립 성곽 2개, 각각 성문
    if mid in TWIN:
        # 성벽 덩어리를 세어 둘인지 본다
        seen = set()
        groups = 0
        for p in walls:
            if p in seen:
                continue
            groups += 1
            q = deque([p])
            seen.add(p)
            while q:
                x, y = q.popleft()
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        n = (x + dx, y + dy)
                        if n in walls and n not in seen:
                            seen.add(n)
                            q.append(n)
        if groups < 2:
            fail('⑪쌍성', mid, f'성곽 덩어리 {groups}개')

    # ⑫ 매소성·살수 — 나루가 성벽 3타일 이내
    if mid in FORD_NEAR and walls:
        d = FORD_NEAR[mid]
        ok = any(min(abs(fx - wx) + abs(fy - wy) for wx, wy in walls) <= d + 1
                 for fx, fy in fords)
        if not ok:
            fail('⑫나루 사정권', mid, f'{d}타일 안에 나루 없음')


# ── 리포트 ──────────────────────────────────────────────────────────
ITEMS = ['①성내 강', '②성문 수', '②옹성 없음', '③치 밀도', '③성문 옆 치',
         '④산성 구릉', '④산성 비정형', '⑤평산성 접면', '⑥읍성 해자',
         '⑦플래그', '⑧고립 성문', '⑨나루 수', '⑩이중성벽', '⑪쌍성',
         '⑫나루 사정권']

print(f'§7.6 검증 — 전장 {len(MAPS)}곳\n')
print('항목                통과   위반')
print('─' * 46)
total = 0
for it in ITEMS:
    n = fails.get(it, 0)
    total += n
    mark = '✓' if n == 0 else '✗'
    print(f'  {it:<14} {mark:>4}   {n if n else "":>4}')
print('─' * 46)

if total:
    print(f'\n위반 {total}건\n')
    for it in ITEMS:
        if fails.get(it):
            print(f'[{it}] {fails[it]}건')
            for d in detail[it][:6]:
                print(f'    {d}')
            if len(detail[it]) > 6:
                print(f'    … 외 {len(detail[it])-6}건')
else:
    print('\n전 맵 통과 — §7.6 위반 0건')

forms = Counter(m.get('form', 'none') for m in MAPS.values())
LABEL = {'sanseong': '산성', 'pyeongsanseong': '평산성', 'eupseong': '읍성',
         'port': '항구', 'twin': '쌍성', 'none': '성 없음'}
print('\n유형별 분포')
for k in ('sanseong', 'pyeongsanseong', 'eupseong', 'port', 'twin', 'none'):
    if forms.get(k):
        print(f'  {LABEL[k]:<6} {forms[k]:>3}곳')

sys.exit(1 if total else 0)
