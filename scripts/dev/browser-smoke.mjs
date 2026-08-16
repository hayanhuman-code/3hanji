/**
 * 브라우저 스모크 — 실제 화면을 띄워 콘솔 오류 없이 한 판이 돌아가는지 확인한다.
 *
 * Playwright 는 CI 를 무겁게 하지 않으려고 의존성에 넣지 않았다. 쓸 때만 설치한다:
 *   npm i -D playwright && npx playwright install chromium
 *   npm run dev &
 *   npm run smoke:browser -- http://127.0.0.1:5173/ /tmp/shots
 *   npm run smoke:browser -- http://127.0.0.1:5173/ /tmp/shots phone
 *
 * 세 번째 인자가 프로파일이다. 폰에서는 화면이 「좁아진 데스크톱」이 아니라
 * 다른 물건이 된다 — 창이 바텀 시트가 되고 국력 바가 두 줄로 접힌다.
 * 같은 각본을 두 번 돌리되 갈라지는 곳만 프로파일로 나눈다.
 *
 * 브라우저 경로는 CHROME_PATH 로 덮어쓸 수 있다.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:5178/';
const OUT = process.argv[3] ?? '/tmp/shots';
const PROFILE = process.argv[4] ?? 'desktop';
const PHONE = PROFILE === 'phone';
mkdirSync(OUT, { recursive: true });
console.log(`── 프로파일: ${PROFILE} ──`);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage(
  PHONE
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
    : { viewport: { width: 1440, height: 900 } }
);

/** 폰에서는 탭으로 고른다. 마우스 클릭으로만 검사하면 터치 경로는 한 번도 안 밟힌다. */
const poke = (loc) => (PHONE ? loc.tap({ force: true }) : loc.click({ force: true }));

/*
 * 진짜 손가락으로 끌기.
 *
 * `page.mouse` 는 hasTouch 문맥에서도 pointerType:"mouse" 를 낸다. 그래서
 * M단계까지 「폰 프로파일 통과」라고 해 놓고 터치 경로는 한 번도 안 밟았고,
 * 실기기에서 지도가 안 밀리는 것을 못 잡았다. Playwright 에 터치 드래그 API 가
 * 없으므로 CDP 로 직접 만든다.
 */
const cdp = PHONE ? await page.context().newCDPSession(page) : null;
async function touchDrag(x, y, dx, dy, steps = 12) {
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await send('touchStart', [{ x, y }]);
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }]);
  }
  await send('touchEnd', []);
  await page.waitForTimeout(200);
}

/** 가로 스크롤은 전면 지도 화면에서 가장 나쁜 증상이다. 요소 하나가 문서를 밀어도 걸린다. */
async function noSideScroll(where) {
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    win: window.innerWidth,
    vis: Math.round(window.visualViewport?.width ?? window.innerWidth),
  }));
  if (m.doc > m.vis || m.win > m.vis) {
    throw new Error(`가로로 넘쳤습니다 (${where}): ${JSON.stringify(m)}`);
  }
}

const errors = [];
const fontIssues = [];
// 웹폰트는 외부 CDN 이라 샌드박스·사내망에서 끊길 수 있다. 그 경우 명조 폴백으로
// 떨어지도록 설계되어 있으므로(문서 §2.1) 실패로 치지 않고 따로 센다.
const isFontCdn = (t) => /fonts\.(googleapis|gstatic)\.com/.test(t);
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  (isFontCdn(m.location()?.url ?? '') ? fontIssues : errors).push(m.text());
});
page.on('requestfailed', (r) => { if (isFontCdn(r.url())) fontIssues.push(r.url()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-title.png` });
console.log('title:', await page.locator('.title-main').innerText());

// 명조가 실제로 잡혔는지. 고딕으로 떨어지면 고지도 성격이 사라진다 (문서 §2.1).
const fonts = await page.evaluate(() => ({
  serif: document.fonts.check("16px 'Noto Serif KR'"),
  mono: document.fonts.check("16px 'JetBrains Mono'"),
  body: getComputedStyle(document.body).fontFamily,
}));
console.log('서체:', fonts.serif ? 'Noto Serif KR ✓' : 'Noto Serif KR ✗(폴백)',
            '/', fonts.mono ? 'JetBrains Mono ✓' : 'JetBrains Mono ✗(폴백)');
if (!/serif/i.test(fonts.body)) throw new Error('본문이 명조 계열이 아닙니다: ' + fonts.body);

// 신라로 시작
await page.getByRole('button', { name: /신라/ }).first().click();
await page.getByRole('button', { name: /으로 시작|로 시작/ }).click();
await page.waitForSelector('.game', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-map.png` });
if (PHONE) await noSideScroll('전략맵');

/* ---------------- 지도 조작 ---------------- *
 * 지명은 축척에 따라 나타났다 사라지므로 이름으로 찾으면 안 된다.
 * 거점 <g> 에 붙은 data-castle-id 로 짚는다. */
const zoomLevel = () => page.locator('.map-hud.zoom .lv').innerText();

/** 폰에서는 지도를 만지기 전에 시트를 엿보기로 접는다 — 사람이 하는 것과 같다. */
async function collapseSheet() {
  if (!PHONE) return;
  const hd = await page.locator('.win.sheet .win-hd').boundingBox();
  if (!hd) return;
  await page.mouse.move(hd.x + hd.width / 2, hd.y + 10);
  await page.mouse.down();
  await page.mouse.move(hd.x + hd.width / 2, hd.y + 330, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}
await collapseSheet();

const before = await zoomLevel();
await page.getByRole('button', { name: '확대' }).click();
await page.waitForTimeout(200);
const after = await zoomLevel();
if (before === after) throw new Error(`확대 버튼이 배율을 바꾸지 않았습니다 (${before})`);
console.log('줌:', before, '→', after);

// 끌면 화면이 움직이되 거점이 선택되지는 않아야 한다.
const worldTf = () => page.locator('.map-svg > g').getAttribute('transform');
const selNow = () => page.locator('.node.sel').getAttribute('data-castle-id').catch(() => null);
const stage = page.locator('.map-stage');
const box = await stage.boundingBox();
{
  const tfBefore = await worldTf();
  const selBefore = await selNow();
  const cx = box.x + box.width / 2;
  const cy = box.y + (PHONE ? 160 : box.height / 2); // 폰은 아래쪽이 시트에 가린다
  if (PHONE) await touchDrag(cx, cy, -140, -90);
  else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 140, cy - 90, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  if ((await worldTf()) === tfBefore) throw new Error('끌었는데 화면이 움직이지 않았습니다');
  if ((await selNow()) !== selBefore) throw new Error('끌기가 거점 선택으로 잘못 처리되었습니다');
}

/*
 * 폰 — 네 방향이 다 밀려야 한다.
 *
 * 여기서 잡으려는 것: 시트가 가린 영역까지 「화면」으로 세면 남은 여백이 전부
 * 시트 뒤에 있어 clampView 가 「더 갈 곳 없음」으로 판정하고, 위로 미는 것만
 * 통째로 죽는다. 한 방향만 재면 안 잡힌다.
 */
if (PHONE) {
  const dead = [];
  for (const [name, dx, dy] of [['←', -110, 0], ['→', 110, 0], ['↑', 0, -110], ['↓', 0, 110]]) {
    const t0 = await worldTf();
    await touchDrag(box.x + box.width / 2, box.y + 180, dx, dy);
    if ((await worldTf()) === t0) dead.push(name);
    else await touchDrag(box.x + box.width / 2, box.y + 180, -dx, -dy); // 되돌려 다음 방향에 영향 없게
  }
  if (dead.length) throw new Error('손가락으로 밀리지 않는 방향: ' + dead.join(' '));
  console.log('터치 팬: 네 방향 모두 ✅');
}

await page.getByRole('button', { name: '전체 보기' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/02b-map-fit.png` });

// 당겨 보기 — 축척이 오르면 산성·항구 이름까지 드러나야 한다
for (let i = 0; i < 5; i++) { await page.getByRole('button', { name: '확대' }).click(); }
await page.waitForTimeout(300);
const deepLabels = await page.locator('.node .lbl:visible').count();
console.log('확대 시 배율/보이는 지명:', await zoomLevel(), '/', deepLabels);
if (deepLabels < 20) throw new Error('확대해도 지명이 드러나지 않습니다: ' + deepLabels);
await page.screenshot({ path: `${OUT}/02c-map-zoom.png` });
await page.getByRole('button', { name: '전체 보기' }).click();
await page.waitForTimeout(200);

/* 거점 선택 → 개발 명령. 폰에서는 마우스가 아니라 탭으로.
 *
 * <g> 가 아니라 그 안의 .hit 원을 짚는다 — <g> 의 경계 상자에는 세로 지명까지
 * 들어가서 중심이 거점에서 밀린다.
 *
 * 그리고 폰에서는 한 번에 짚히지 않는다. 터치 원은 화면 좌표로 44px 고정인데
 * 반도 전체가 들어오는 축척에서는 거점 사이가 20px 도 안 되어 이웃과 겹친다.
 * 사람이 하는 대로 — 대충 짚어 그 근방으로 데려간 뒤, 당겨서 정확히 짚는다. */
await poke(page.locator('[data-castle-id="geumseong"] .hit'));
await page.waitForTimeout(250);
const picked = await page.locator('.win-bd h2').first().innerText();
if (PHONE) {
  // 어느 거점이 잡히는지까지는 묻지 않는다. 반도 전체가 들어오는 축척에서는
  // 거점 사이가 20px 도 안 되는데 터치 원은 44px 이라 이웃과 겹친다 —
  // 정확히 짚으려면 사람도 당겨야 한다. 여기서 볼 것은 "탭이 선택으로
  // 이어지고 그것이 시트에 그대로 나타나는가" 다.
  const sel = await page.locator('.node.sel').getAttribute('data-castle-id');
  if (!sel) throw new Error('탭했는데 거점이 선택되지 않았습니다');
  if (!picked.trim()) throw new Error('탭한 거점이 시트에 나타나지 않았습니다');
  console.log('탭으로 선택된 거점:', sel, '/ 시트 표제:', picked.split('\n')[0]);
  // 터치 원이 실제로 커졌는지 (문서: 44px 기준)
  const rr = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.node .hit')).r)
  );
  if (rr < 20) throw new Error('거점 터치 원이 손가락에 비해 작습니다: r=' + rr);
  console.log('거점 터치 원: r =', rr);
} else if (!/금성/.test(picked)) {
  throw new Error('거점 선택이 패널에 반영되지 않았습니다: ' + picked);
}
// 고른 거점에 따라 개발이 막혀 있을 수 있다(한계치·인물 부족). 눌리는 때만 누른다.
const devBtn = page.getByRole('button', { name: '농업 개발' });
if ((await devBtn.count()) && (await devBtn.first().isEnabled())) {
  await devBtn.first().click();
  await page.waitForTimeout(150);
}
await page.screenshot({ path: `${OUT}/03-castle.png` });

// 출진 — 지도에서 목적지를 찍는다
const marchBtn = page.getByRole('button', { name: /출진/ }).first();
if (await marchBtn.count()) {
  await marchBtn.click();
  await page.waitForSelector('.march-panel', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/03b-march.png` });
  const lit = await page.locator('.node.target').count();
  console.log('출진 후보 거점:', lit);
  if (lit === 0) throw new Error('지도에 출진 후보가 하나도 밝혀지지 않았습니다');
  if (PHONE) await noSideScroll('출진 편성');
  await poke(page.locator('.node.target').first());
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '취소' }).click();
  await page.waitForTimeout(150);
}

/* ---------------- 창(窓) ---------------- *
 * 데스크톱은 자유 좌표로 끌고 닫았다 다시 연다.
 * 폰은 아래에 붙은 시트라 위아래로 끌어 3단으로 여닫는다. 닫기 버튼은 없다. */
if (PHONE) {
  const sheet = page.locator('.win.sheet');
  const h = async () => Math.round((await sheet.boundingBox()).height);
  const dragHead = async (dy) => {
    const hb = await sheet.locator('.win-hd').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 10);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 10 + dy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  };
  const half = await h();
  await dragHead(320);
  const peek = await h();
  await page.screenshot({ path: `${OUT}/03c-sheet-peek.png` });
  await dragHead(-600);
  const full = await h();
  console.log('시트 3단:', peek, '/', half, '/', full);
  if (!(peek < half && half < full)) throw new Error(`시트 스냅이 3단으로 움직이지 않았습니다: ${peek}/${half}/${full}`);
  if (peek > 90) throw new Error('엿보기 단이 지도를 너무 가립니다: ' + peek);
  await page.screenshot({ path: `${OUT}/03c-sheet-full.png` });
  // 절반으로 되돌린다. 가득 편 상태에서는 줌 위젯이 시트 뒤로 들어가 못 누른다.
  await dragHead(320);

  /* 끌어서 접는 것은 축척을 건드리지 않는다 — 지도를 잠깐 살피려는 동작이다 */
  {
    await page.getByRole('button', { name: '확대' }).click();
    await page.waitForTimeout(250);
    const z0 = await zoomLevel();
    await dragHead(320);
    const z1 = await zoomLevel();
    if (z0 !== z1) throw new Error(`끌어서 접었는데 배율이 바뀌었습니다: ${z0} → ${z1}`);
    await dragHead(-200);
  }

  /* ✕ 는 시트를 엿보기로 접고 지도를 전체 보기로 되돌린다 */
  {
    const z0 = await zoomLevel();
    await page.locator('.win.sheet .win-x').tap();
    await page.waitForTimeout(500);
    const z1 = await zoomLevel();
    const h = Math.round((await sheet.boundingBox()).height);
    if (h > 90) throw new Error('✕ 를 눌렀는데 시트가 안 접혔습니다: ' + h);
    if (z0 === z1) throw new Error(`✕ 를 눌렀는데 전체 보기로 안 돌아갔습니다 (${z0})`);
    console.log('✕ → 시트', h, 'px · 배율', z0, '→', z1);
    await page.screenshot({ path: `${OUT}/03d-sheet-closed.png` });
  }

  /* 전체 보기 아래로는 못 줄인다 — 그 구간은 밀어도 안 움직이는 죽은 배율이다 */
  {
    const zFit = await zoomLevel();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '축소' }).click();
      await page.waitForTimeout(120);
    }
    const zMin = await zoomLevel();
    if (zMin !== zFit) throw new Error(`전체 보기(${zFit}) 아래로 줄어들었습니다: ${zMin}`);
    console.log('줄이기 하한:', zMin, '= 전체 보기 ✅');
  }

  // 손가락 크기. 44 는 못 맞추더라도 36 아래로 내려가면 못 누른다.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('.topbar .btn, .win.sheet .tabs button')]
      // 폰에서 시트로 옮겨 간 버튼들은 display:none 이라 높이가 0 이다. 셈에서 뺀다.
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ t: b.innerText.trim(), h: Math.round(b.getBoundingClientRect().height) }))
      .filter((x) => x.h < 36)
  );
  if (small.length) throw new Error('손가락에 비해 작은 버튼: ' + JSON.stringify(small));
} else {
  const win = page.locator('.win').first();
  const head = win.locator('.win-hd');
  const before = await win.boundingBox();
  const hb = await head.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 120, hb.y + hb.height / 2 + 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await win.boundingBox();
  if (Math.abs(after.x - before.x) < 40) throw new Error('창을 끌었는데 움직이지 않았습니다');
  console.log('창 이동:', Math.round(before.x), '→', Math.round(after.x));
  await page.screenshot({ path: `${OUT}/03c-window.png` });

  // 닫으면 사라지고, 지도는 전체 보기로 돌아간다.
  // 먼저 당겨 두어야 「돌아갔다」를 확인할 수 있다 — 이미 전체 보기면 아무 차이가 없다.
  await page.getByRole('button', { name: '전체 보기' }).click();
  await page.waitForTimeout(250);
  const zFit = await zoomLevel();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '확대' }).click();
  await page.waitForTimeout(250);
  const zBeforeClose = await zoomLevel();
  if (zBeforeClose === zFit) throw new Error('확대가 안 됐습니다: ' + zFit);

  const n0 = await page.locator('.win').count();
  await page.locator('.win-hd .win-x').first().click();
  await page.waitForTimeout(300);
  if ((await page.locator('.win').count()) !== n0 - 1) throw new Error('창이 닫히지 않았습니다');
  const zAfterClose = await zoomLevel();
  if (zAfterClose !== zFit) {
    throw new Error(`창을 닫았는데 전체 보기(${zFit})로 안 돌아갔습니다: ${zAfterClose}`);
  }
  console.log('창 닫기 → 배율', zBeforeClose, '→', zAfterClose, '(전체 보기)');
  await page.getByRole('button', { name: '사초', exact: true }).click();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: '거점창', exact: true }).click();
  await page.waitForTimeout(200);
  if (await page.locator('.win').count() === 0) throw new Error('창을 다시 열지 못했습니다');
}

// 각 탭
for (const [tab, shot] of [['인물','04-officers'],['외교','05-diplomacy'],['제도','06-institutions'],['연대기','07-chronicle']]) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${shot}.png` });
}
await page.getByRole('button', { name: '거점', exact: true }).click();

// 여러 턴 돌리기 (이벤트/결산/전투 처리 포함)
for (let i = 0; i < 14; i++) {
  const battle = await page.locator('.battle').count();
  if (battle) {
    await page.screenshot({ path: `${OUT}/09-battle.png` });
    const delegate = page.getByRole('button', { name: /위임/ });
    if (PHONE) {
      await noSideScroll('전투');
      // 폰에서 30합을 손으로 두는 것은 무리다. 이게 빠져나갈 구멍이므로
      // 스크롤 없이 첫 화면에 보여야 한다.
      if (!(await delegate.count()) || !(await delegate.first().isVisible())) {
        throw new Error('전투 첫 화면에 「위임」이 보이지 않습니다');
      }
      const canvasH = (await page.locator('.battle-canvas-wrap canvas').boundingBox()).height;
      console.log('세로 전투 — 육각판 높이:', Math.round(canvasH));
      if (canvasH < 240) throw new Error('세로 화면에서 육각판이 너무 눌렸습니다: ' + Math.round(canvasH));
    }
    if (await delegate.count()) await delegate.click();
    await page.waitForTimeout(400);
    const back = page.getByRole('button', { name: /전략맵으로/ });
    if (await back.count()) await back.click();
    await page.waitForTimeout(400);
    continue;
  }
  const choice = page.locator('.choice');
  if (await choice.count()) {
    await page.screenshot({ path: `${OUT}/08-event.png` });
    if (PHONE) await noSideScroll('사건 대화상자');
    await choice.first().click();
    await page.waitForTimeout(400);
    continue;
  }
  const next = page.getByRole('button', { name: '다음 계절로' });
  if (await next.count()) { await next.click(); await page.waitForTimeout(250); continue; }
  const end = page.getByRole('button', { name: /턴 종료/ });
  if (await end.count() && await end.isEnabled()) { await end.click(); await page.waitForTimeout(500); }
  else await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/10-later.png` });
const date = await page.locator('.topbar .date').innerText().catch(() => '(전투 중)');
console.log('진행 후 시점:', date);

// 겨울이면 원해 항로가 닫혀 있어야 한다 (탐라·우산국·덕물도 방면)
if (/겨울/.test(date)) {
  const closed = await page.locator('.map-searoad.closed').count();
  console.log('겨울 폐쇄 항로:', closed);
  if (closed === 0) throw new Error('겨울인데 닫힌 항로가 하나도 없습니다');
  await page.screenshot({ path: `${OUT}/10b-winter.png` });
}

// 전투 시뮬레이터 단독 실행
await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /전투 시뮬레이터/ }).click();
await page.waitForSelector('.battle', { timeout: 10000 });

await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/11-sandbox.png` });
if (PHONE) {
  await noSideScroll('전투 시뮬레이터');
  if (!(await page.getByRole('button', { name: /위임/ }).first().isVisible())) {
    throw new Error('전투 시뮬레이터 첫 화면에 「위임」이 보이지 않습니다');
  }
  // 전투 기록은 한 줄로 접혀 있다가 눌러서 펼쳐진다
  const logBox = page.locator('.battle-log');
  const h0 = (await logBox.boundingBox()).height;
  await logBox.tap();
  await page.waitForTimeout(250);
  const h1 = (await logBox.boundingBox()).height;
  if (h1 <= h0) throw new Error(`전투 기록이 펼쳐지지 않았습니다: ${Math.round(h0)} → ${Math.round(h1)}`);
  console.log('전투 기록 접기/펼치기:', Math.round(h0), '→', Math.round(h1));
  await logBox.tap();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/11b-sandbox-portrait.png` });
}

// 수비 측을 직접 지휘해 본다: 부대 선택 → 차례 종료
const turnLabel = await page.locator('.battle-head').innerText();
if (!/아군 차례/.test(turnLabel)) throw new Error('수비 측 차례로 넘어오지 않았습니다: ' + turnLabel);
await poke(page.locator('.unit-card').nth(1));
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/12-sandbox-select.png` });
await page.getByRole('button', { name: '차례 종료' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/13-sandbox-turn2.png` });
console.log('전투 진행:', (await page.locator('.battle-head .tag').first().innerText()));

// 문서 §7 — 이모지·현대적 아이콘 금지
const emoji = await page.evaluate(() =>
  (document.body.innerText.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).join('')
);
if (emoji) throw new Error('화면에 이모지가 있습니다: ' + emoji);

await browser.close();
if (fontIssues.length) console.log(`(웹폰트 요청 ${fontIssues.length}건 실패 — 폴백으로 동작. 배포망에서는 정상)`);
if (errors.length) { console.error('콘솔 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('브라우저 스모크 통과 — 콘솔 오류 없음');
