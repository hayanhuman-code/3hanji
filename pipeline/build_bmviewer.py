"""
build_bmviewer.py — 전장맵 뷰어 HTML 생성

    python3 build_battlemaps.py && python3 build_bmviewer.py

battlemaps.json 을 템플릿에 박아 넣어 ../docs/battlemap-viewer.html 을 만든다.
브라우저로 열면 76곳을 넘겨 보며 성곽 규격(§7)이 실제로 어떻게 앉았는지
눈으로 확인할 수 있다 — 검증기가 통과시켜도 이상해 보이면 여기서 걸린다.
"""
import json

data = json.load(open('battlemaps.json', encoding='utf-8'))
tpl = open('bmviewer_template.html', encoding='utf-8').read()
out = tpl.replace('/*__BMDATA__*/', json.dumps(data, ensure_ascii=False))
open('../docs/battlemap-viewer.html', 'w', encoding='utf-8').write(out)
print(f'뷰어 생성 — docs/battlemap-viewer.html ({len(out)//1024} KB, 전장 {len(data["maps"])}곳)')
