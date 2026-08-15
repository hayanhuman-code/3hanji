import json, re
d=json.load(open('mapdata.json'))
def subpaths(p):
    for seg in p.split('M '):
        seg=seg.strip().rstrip('Z').strip()
        if not seg: continue
        pts=[]
        for tok in seg.split(' L '):
            a,b=tok.split(); pts.append((float(a),float(b)))
        if len(pts)>=3: yield pts
rings=list(subpaths(d['land']))+list(subpaths(d['islets']))
def inside(x,y):
    cnt=0
    for r in rings:
        n=len(r); j=n-1; c=False
        for i in range(n):
            xi,yi=r[i]; xj,yj=r[j]
            if ((yi>y)!=(yj>y)) and (x<(xj-xi)*(y-yi)/(yj-yi+1e-12)+xi): c=not c
            j=i
        if c: cnt+=1
    return cnt%2==1
def sample(dstr):
    toks=re.findall(r'([MLC])([^MLC]*)', dstr); pts=[]; cur=None
    for cmd,arg in toks:
        v=[float(x) for x in arg.split()]
        if cmd in 'ML': cur=(v[0],v[1]); pts.append(cur)
        else:
            p0=cur; c1=(v[0],v[1]); c2=(v[2],v[3]); p1=(v[4],v[5])
            for i in range(1,9):
                t=i/8; mt=1-t
                pts.append((mt**3*p0[0]+3*mt*mt*t*c1[0]+3*mt*t*t*c2[0]+t**3*p1[0],
                            mt**3*p0[1]+3*mt*mt*t*c1[1]+3*mt*t*t*c2[1]+t**3*p1[1]))
            cur=p1
    return pts
def mid(pts,frac=0.12):
    n=len(pts); a=int(n*frac); b=int(n*(1-frac))
    return pts[a:b] if b>a else []
names={c['id']:c['name'] for c in d['castles']}

tot_l=tot_s=0
print('=== 육로 위반 ===')
for r in d['routes']['land']:
    m=mid(sample(r['d'])); sea=sum(1 for x,y in m if not inside(x,y))
    if sea>1: tot_l+=1; print(f"  {names[r['a']]:<7}-{names[r['b']]:<7} 바다 {sea}/{len(m)}")
print(f'  → {tot_l} / {len(d["routes"]["land"])}')
print('=== 수로 위반 ===')
for r in d['routes']['sea']:
    m=mid(sample(r['d'])); lnd=sum(1 for x,y in m if inside(x,y))
    if lnd>1: tot_s+=1; print(f"  {names[r['a']]:<7}-{names[r['b']]:<7} 육지 {lnd}/{len(m)}")
print(f'  → {tot_s} / {len(d["routes"]["sea"])}')
