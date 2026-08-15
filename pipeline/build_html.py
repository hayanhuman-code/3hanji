import json

M = json.load(open('mapdata.json'))
W, H = M['width'], M['height']

# 거점 부가 데이터 (라벨 방향 · 개발치 · 한계)
EXTRA = {
    'jolbon':   dict(lp='l', agri=30, comm=22, wall=62, army=44, cap=(52,42,82,72), note='고구려 시조의 옛 도읍'),
    'gungnae':  dict(lp='r', agri=36, comm=32, wall=80, army=56, cap=(58,58,95,86), note='두 번째 도읍. 압록 중류의 요충'),
    'yodong':   dict(lp='r', agri=30, comm=26, wall=74, army=62, cap=(52,48,95,92), note='요하 방어선의 관문'),
    'ansi':     dict(lp='l', agri=22, comm=14, wall=90, army=50, cap=(40,30,100,76), note='험산에 기대어 대군을 막아온 성'),
    'bisa':     dict(lp='l', agri=20, comm=40, wall=58, army=32, cap=(36,72,80,60), note='요동반도 남단. 등주로 향하는 뱃길'),
    'chaekseong':dict(lp='r',agri=18, comm=24, wall=54, army=30, cap=(34,46,74,58), note='동북 변경. 말갈과 접함'),
    'pyeong':   dict(lp='l', agri=54, comm=60, wall=86, army=72, cap=(86,92,100,96), note='대동강을 낀 도읍'),
    'hanseong': dict(lp='r', agri=50, comm=54, wall=62, army=46, cap=(82,86,90,80), note='한강 유역. 삼국이 번갈아 차지한 땅'),
    'danghang': dict(lp='l', agri=26, comm=48, wall=52, army=28, cap=(44,80,74,56), note='당으로 가는 바닷길의 출구'),
    'gugwon':   dict(lp='r', agri=38, comm=30, wall=66, army=40, cap=(62,52,86,72), note='남한강 수운의 결절'),
    'silji':    dict(lp='r', agri=24, comm=20, wall=56, army=32, cap=(46,40,76,62), note='동해안 방면 전진 기지'),
    'geumseong':dict(lp='r', agri=48, comm=52, wall=78, army=64, cap=(80,84,96,94), note='신라의 도읍'),
    'ungjin':   dict(lp='r', agri=46, comm=42, wall=72, army=44, cap=(72,66,90,76), note='웅진 천도의 산성 도읍'),
    'sabi':     dict(lp='l', agri=52, comm=64, wall=78, army=58, cap=(82,96,96,88), note='백제의 마지막 도읍'),
    'daeya':    dict(lp='l', agri=30, comm=22, wall=76, army=48, cap=(52,42,94,74), note='642년 백제가 취한 신라 서변의 요새'),
    'daegaya':  dict(lp='r', agri=32, comm=38, wall=58, army=34, cap=(56,72,78,62), note='가야 연맹의 맹주'),
    'geumgwan': dict(lp='r', agri=28, comm=58, wall=52, army=28, cap=(48,90,72,56), note='철과 바다의 나라'),
    'tamna':    dict(lp='l', agri=18, comm=34, wall=40, army=18, cap=(32,62,58,40), note='바다 건너 복속한 섬'),
    # ── 광개토대왕 정복지 (북방) ──
    'sinseong': dict(lp='l', agri=20, comm=18, wall=76, army=52, cap=(38,34,92,78), note='요동 북쪽을 지키는 관문. 여러 왕조가 다투어 온 성'),
    'ogol':     dict(lp='r', agri=22, comm=16, wall=70, army=40, cap=(40,32,88,64), note='요동에서 평양으로 가는 길목을 지키는 성'),
    'buyeo':    dict(lp='r', agri=26, comm=20, wall=58, army=34, cap=(46,38,78,58), note='410년 광개토대왕이 정복한 옛 부여의 땅. 영역의 북쪽 끝'),
    # ── 밀도 보강 ──
    'haseulla': dict(lp='r', agri=24, comm=22, wall=54, army=30, cap=(44,42,74,52), note='동해안을 다스리는 관문. 이사부가 우산국을 도모한 곳'),
    'iksan':    dict(lp='l', agri=40, comm=36, wall=48, army=26, cap=(66,60,68,46), note='무왕이 새 도읍으로 삼은 곳. 미륵사가 섰다'),
    'aragaya':  dict(lp='l', agri=30, comm=34, wall=44, army=24, cap=(52,58,64,42), note='가야 연맹의 또 다른 중심. 남강 유역을 다스렸다'),
    # ── 내륙 행정중심지 보강 ──
    'nampyeong':dict(lp='l', agri=38, comm=34, wall=54, army=30, cap=(62,58,78,52), note='고구려의 남쪽 별도(別都)로 전하는 재령 일대'),
    'daebang':  dict(lp='r', agri=36, comm=40, wall=48, army=26, cap=(60,66,70,46), note='한 군현이 있던 옛 땅. 삼국이 번갈아 다툰 자리'),
    'gaemo':    dict(lp='l', agri=20, comm=14, wall=68, army=42, cap=(36,28,88,66), note='요동 내륙을 지키는 성. 당군의 첫 공격로였다'),
    'sangju':   dict(lp='r', agri=42, comm=32, wall=50, army=28, cap=(68,56,72,48), note='낙동강 상류를 다스리는 신라의 오랜 거점'),
    'sapryang': dict(lp='r', agri=26, comm=24, wall=52, army=30, cap=(46,44,74,50), note='왕경으로 통하는 길목. 항쟁기의 배후기지'),
    'apdok':    dict(lp='l', agri=24, comm=20, wall=46, army=24, cap=(42,38,68,42), note='일찍이 신라에 편입된 낙동강 서편의 요지'),
    'changnyeong':dict(lp='r',agri=28, comm=22, wall=50, army=28, cap=(48,40,72,46), note='진흥왕이 순수비를 세워 새 강역을 새긴 곳'),
    'wansan':   dict(lp='l', agri=44, comm=38, wall=52, army=30, cap=(70,64,74,50), note='훗날 후백제의 도읍이 되는 호남 내륙의 중심'),
    'balla':    dict(lp='l', agri=40, comm=44, wall=44, army=24, cap=(66,72,64,42), note='영산강 유역을 다스리는 백제 남방의 중심'),
    'tanhyeon': dict(lp='r', agri=14, comm=10, wall=58, army=32, cap=(26,20,80,50), note='백제 방어선의 마지막 고개'),
    'goseong':  dict(lp='l', agri=28, comm=40, wall=42, army=22, cap=(48,68,60,38), note='소가야의 터전. 남해를 낀 작은 나라'),
    'seongju':  dict(lp='r', agri=26, comm=24, wall=44, army=22, cap=(44,40,64,38), note='가야 연맹 북단, 낙동강 서안의 소국'),
    # ── 요동 서변·부여 접경 ──
    'seoanpyeong':dict(lp='l',agri=18,comm=44, wall=46, army=28, cap=(32,74,66,44), note='압록강 어귀. 대륙으로 통하는 뱃길의 시작'),
    'baekam':   dict(lp='r', agri=20, comm=16, wall=72, army=44, cap=(36,30,90,68), note='요동 내륙의 험성. 당군이 험로 끝에 마주친 성'),
    'geonan':   dict(lp='l', agri=22, comm=18, wall=66, army=38, cap=(38,32,84,60), note='요동반도 서편을 지키는 성'),
    'namso':    dict(lp='r', agri=18, comm=14, wall=64, army=36, cap=(34,26,82,58), note='요동에서 내지로 드는 또 다른 길목'),
    'usu':      dict(lp='l', agri=26, comm=18, wall=50, army=28, cap=(46,34,70,46), note='한강 상류를 굽어보는 고구려 접경 고을'),
    # ── 동예·옥저 ──
    'okjeo':    dict(lp='r', agri=24, comm=20, wall=40, army=22, cap=(44,38,60,38), note='함흥평야의 옛 나라. 어물과 소금이 나던 땅'),
    'dongye':   dict(lp='l', agri=22, comm=18, wall=38, army=20, cap=(40,34,56,36), note='단궁과 과하마로 알려진 동해안의 옛 종족'),
    # ── 신라 내륙·동해 ──
    'ulsan':    dict(lp='r', agri=24, comm=42, wall=40, army=22, cap=(42,68,58,38), note='왕경의 관문항. 이후 대외 교역이 번성한 포구'),
    'uiseong':  dict(lp='l', agri=30, comm=22, wall=42, army=24, cap=(52,38,62,40), note='소문국의 옛 터전'),
    'gammun':   dict(lp='r', agri=26, comm=20, wall=40, army=22, cap=(46,36,60,38), note='감문국이 있던 낙동강 서편 고을'),
    'usanguk':  dict(lp='l', agri=8,  comm=14, wall=30, army=12, cap=(16,26,46,22), note='이사부가 나무 사자로 복속시킨 동해의 섬나라'),
    'daegu':    dict(lp='l', agri=36, comm=34, wall=46, army=26, cap=(60,58,66,44), note='달구화현. 낙동강과 금호강이 만나는 분지'),
    'samnyeon': dict(lp='r', agri=18, comm=12, wall=68, army=40, cap=(32,24,88,62), note='신라가 쌓아 백제와의 접경을 지킨 산성'),
    'gwansan':  dict(lp='l', agri=22, comm=18, wall=48, army=30, cap=(40,32,70,48), note='554년 백제 성왕이 전사한 자리'),
    'gyerim':   dict(lp='r', agri=14, comm=16, wall=44, army=26, cap=(26,28,64,42), note='소백산맥을 넘나드는 옛 고개'),
    # ── 백제 내륙·남해안 ──
    'michuhol': dict(lp='l', agri=26, comm=46, wall=36, army=20, cap=(44,74,54,34), note='비류가 나라를 세웠다는 건국설화의 땅'),
    'gosaburi': dict(lp='r', agri=32, comm=26, wall=38, army=22, cap=(54,44,56,36), note='호남평야 서편의 오랜 고을'),
    'imjon':    dict(lp='l', agri=20, comm=16, wall=62, army=36, cap=(36,28,84,56), note='백제 부흥군이 마지막까지 버틴 성'),
    'mokji':    dict(lp='r', agri=38, comm=32, wall=40, army=22, cap=(62,54,58,36), note='마한 맹주국이 있던 자리로 전한다'),
    'chimmi':   dict(lp='l', agri=20, comm=30, wall=32, army=16, cap=(36,52,48,28), note='한반도 서남단, 바닷길이 열리는 끝자락'),
    'amak':     dict(lp='r', agri=16, comm=12, wall=54, army=32, cap=(28,22,74,50), note='백제·신라·가야가 맞닿은 산길의 요새'),
    'hwangsan': dict(lp='l', agri=18, comm=10, wall=30, army=26, cap=(32,20,46,40), note='660년 계백이 최후를 맞은 벌판'),
    # ── 가야 소국 ──
    'taksun':   dict(lp='r', agri=22, comm=36, wall=34, army=18, cap=(38,60,50,30), note='낙동강 하구를 낀 가야의 교역 소국'),
    'samul':    dict(lp='l', agri=20, comm=32, wall=32, army=16, cap=(36,54,48,28), note='포상팔국 중 하나로 전하는 남해의 소국'),
    # ── 고구려 대중국 방어선 ──
    'musunra':  dict(lp='l', agri=12, comm=10, wall=56, army=38, cap=(22,18,76,60), note='요하를 건너오는 대군이 반드시 지나는 도하 지점'),
    'yosu':     dict(lp='l', agri=14, comm=26, wall=52, army=34, cap=(26,46,72,54), note='요하 수로의 관문. 수·당 수군이 거슬러 오르던 길'),
    'bakjak':   dict(lp='r', agri=16, comm=22, wall=64, army=36, cap=(28,40,84,56), note='압록강 하구를 막는 성. 당 수군의 상류 진입을 저지'),
    'daehaeng': dict(lp='l', agri=20, comm=18, wall=62, army=38, cap=(36,32,82,58), note='평양으로 드는 서쪽 관문. 도성의 마지막 방벽'),
    'salsu':    dict(lp='r', agri=18, comm=14, wall=46, army=34, cap=(32,26,66,54), note='612년 을지문덕이 수의 30만을 수장시킨 강'),
    'pyeongwon':dict(lp='l', agri=16, comm=30, wall=50, army=30, cap=(28,52,70,48), note='요동만의 수군 기지. 발해를 건너오는 함대를 맞는 곳'),
    # ── 나당전쟁 임진강선 ──
    'chiljung': dict(lp='r', agri=16, comm=12, wall=66, army=40, cap=(28,22,86,62), note='675년 유인궤의 당군에 함락된 임진강선의 요새'),
    'maeso':    dict(lp='r', agri=18, comm=14, wall=60, army=44, cap=(32,26,80,68), note='675년 이근행의 20만 대군이 말 3만 필을 버리고 물러난 곳'),
    'cheonseong':dict(lp='l',agri=14, comm=24, wall=48, army=32, cap=(26,42,68,52), note='675년 설인귀의 보급 함대를 격퇴한 포구'),
    # ── 백제 멸망전 ──
    'gibeolpo': dict(lp='l', agri=14, comm=32, wall=44, army=30, cap=(26,54,64,50), note='백강. 백제가 당 수군을 막으려 진을 친 하구'),
    'ungjingu': dict(lp='r', agri=16, comm=30, wall=42, army=28, cap=(28,52,60,46), note='660년 소정방의 함대가 실제로 상륙한 금강 어귀'),
    'deokmul':  dict(lp='r', agri=6,  comm=18, wall=24, army=10, cap=(12,32,38,20), note='660년 소정방과 김법민이 만나 백제 침공을 논의한 섬'),
    'jusan':    dict(lp='l', agri=18, comm=14, wall=60, army=34, cap=(32,26,80,56), note='백제 부흥군이 왕자 풍을 옹립하고 버틴 산성'),
    # ── 내륙 수로 요충 ──
    'paesu':    dict(lp='l', agri=22, comm=40, wall=46, army=26, cap=(38,68,64,42), note='대동강 하구. 평양으로 오르는 뱃길의 입구'),
    'hanganggu':dict(lp='l', agri=24, comm=44, wall=42, army=24, cap=(42,72,60,40), note='한강 하구. 내륙 수운과 서해가 만나는 목'),
    'nakdonggu':dict(lp='r', agri=22, comm=46, wall=38, army=22, cap=(38,76,56,36), note='낙동강 하구. 가야 철이 바다로 나가는 출구'),
}

# 밀집구간 클릭 표적 분산 — 표시 픽셀 위치만 보정(지리좌표는 유지)
NUDGE = {
    'sabi':(1.1,-3.1), 'seoanpyeong':(-1.9,-1.1), 'michuhol':(0.0,0.1), 'bakjak':(1.9,1.1),
    'gibeolpo':(-2.6,-2.1), 'ungjingu':(-1.1,3.1), 'jusan':(2.6,2.1), 'hanganggu':(0.0,-0.1),
}

# 항구별 병선 정원 (수군은 보조 개념 — 항구에서만 운용)
NAVY = {
    'bisa':(14,30), 'seoanpyeong':(10,24), 'pyeongwon':(12,26), 'yosu':(8,20),
    'paesu':(12,26), 'danghang':(14,30), 'michuhol':(10,22), 'hanganggu':(12,26),
    'deokmul':(6,16), 'gibeolpo':(12,26), 'ungjingu':(10,24),
    'geumgwan':(16,34), 'nakdonggu':(12,26), 'ulsan':(10,24),
    'tamna':(6,16), 'usanguk':(4,12), 'chimmi':(8,20),
}

castles = []
for c in M['castles']:
    e = EXTRA[c['id']]
    nx, ny = NUDGE.get(c['id'], (0, 0))
    castles.append({
        'id': c['id'], 'name': c['name'], 'type': c['type'], 'f': c['f'],
        'x': round(c['x'] + nx, 1), 'y': round(c['y'] + ny, 1),
        'lp': e['lp'], 'note': e['note'],
        'agri': e['agri'], 'comm': e['comm'], 'wall': e['wall'], 'army': e['army'],
        'cap': dict(zip(('agri', 'comm', 'wall', 'army'), e['cap'])),
    })
    if c['id'] in NAVY:
        n, nc = NAVY[c['id']]
        castles[-1]['navy'] = n
        castles[-1]['cap']['navy'] = nc

ROADS = [
    ('jolbon','gungnae'),('jolbon','yodong'),('yodong','ansi'),('ansi','bisa'),
    ('gungnae','pyeong'),('gungnae','chaekseong'),('jolbon','pyeong'),
    ('pyeong','hanseong'),('hanseong','danghang'),('hanseong','gugwon'),
    ('gugwon','silji'),('gugwon','geumseong'),('hanseong','ungjin'),
    ('ungjin','sabi'),('sabi','daeya'),('daeya','geumseong'),('daeya','daegaya'),
    ('daegaya','geumgwan'),('geumgwan','geumseong'),('silji','geumseong'),
    ('danghang','ungjin'),('tamna','geumgwan'),
    ('yodong','sinseong'),('sinseong','gungnae'),('ansi','ogol'),('ogol','pyeong'),
    ('gungnae','buyeo'),('buyeo','chaekseong'),
    ('silji','haseulla'),('haseulla','gugwon'),
    ('sabi','iksan'),('iksan','daeya'),
    ('daegaya','aragaya'),('aragaya','geumgwan'),
    ('pyeong','nampyeong'),('nampyeong','daebang'),('daebang','hanseong'),
    ('yodong','gaemo'),('gaemo','sinseong'),
    ('sangju','gugwon'),('sangju','geumseong'),('sangju','daeya'),
    ('sapryang','geumseong'),('sapryang','haseulla'),
    ('apdok','geumseong'),('apdok','sangju'),
    ('changnyeong','daeya'),('changnyeong','aragaya'),('changnyeong','geumseong'),
    ('wansan','sabi'),('wansan','iksan'),('wansan','daeya'),
    ('balla','sabi'),('balla','iksan'),
    ('tanhyeon','ungjin'),('tanhyeon','daeya'),
    ('goseong','daegaya'),('goseong','geumgwan'),
    ('seongju','daegaya'),('seongju','gugwon'),
    # 요동 서변·부여 접경
    ('bisa','seoanpyeong'),('seoanpyeong','pyeong'),
    ('yodong','baekam'),('baekam','ansi'),
    ('ansi','geonan'),('geonan','bisa'),
    ('gungnae','namso'),('namso','sinseong'),
    ('hanseong','usu'),('usu','gugwon'),
    # 동예·옥저
    ('nampyeong','okjeo'),('okjeo','dongye'),('dongye','usu'),('okjeo','chaekseong'),
    # 신라 내륙·동해
    ('geumseong','ulsan'),('ulsan','sapryang'),
    ('gugwon','uiseong'),('uiseong','sangju'),
    ('sangju','gammun'),('gammun','geumseong'),
    ('haseulla','usanguk'),
    ('geumseong','daegu'),('daegu','apdok'),('daegu','changnyeong'),
    ('gugwon','samnyeon'),('samnyeon','gwansan'),
    ('gwansan','ungjin'),
    ('gugwon','gyerim'),('gyerim','sangju'),
    # 백제 내륙·남해안
    ('hanseong','michuhol'),
    ('sabi','gosaburi'),('gosaburi','balla'),
    ('ungjin','imjon'),('imjon','hanseong'),
    ('hanseong','mokji'),('mokji','ungjin'),
    ('balla','chimmi'),
    ('daeya','amak'),('amak','aragaya'),
    ('sabi','hwangsan'),('hwangsan','daeya'),
    # 가야 소국
    ('geumgwan','taksun'),('taksun','aragaya'),
    ('goseong','samul'),('samul','geumgwan'),
    # 고구려 대중국 방어선
    ('musunra','yodong'),('musunra','geonan'),('yosu','musunra'),('yosu','pyeongwon'),
    ('pyeongwon','geonan'),('bakjak','seoanpyeong'),('bakjak','ogol'),
    ('daehaeng','pyeong'),('daehaeng','paesu'),('salsu','pyeong'),('salsu','ogol'),
    # 나당전쟁 임진강선
    ('chiljung','hanseong'),('chiljung','maeso'),('maeso','hanseong'),
    ('cheonseong','chiljung'),('cheonseong','hanganggu'),
    # 백제 멸망전
    ('gibeolpo','ungjingu'),('ungjingu','sabi'),('gibeolpo','jusan'),
    ('jusan','gosaburi'),('deokmul','hanganggu'),('deokmul','ungjingu'),
    # 수로 요충
    ('paesu','pyeong'),('paesu','nampyeong'),
    ('hanganggu','hanseong'),('hanganggu','michuhol'),
    ('nakdonggu','geumgwan'),('nakdonggu','taksun'),
]

payload = {
    'w': W, 'h': H,
    'land': M['land'], 'lakes': M['lakes'], 'islets': M['islets'],
    'rivers': M['rivers'], 'ranges': M['ranges'],
    'castles': castles, 'roads': ROADS, 'routes': M['routes'],
}

tpl = open('template.html', encoding='utf-8').read()
out = tpl.replace('/*__MAPDATA__*/', json.dumps(payload, ensure_ascii=False))
open('/mnt/user-data/outputs/삼한지_전략맵.html', 'w', encoding='utf-8').write(out)
print('bytes:', len(out))
