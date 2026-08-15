/**
 * 브라우저 스모크 — 실제 화면을 띄워 콘솔 오류 없이 한 판이 돌아가는지 확인한다.
 *
 * Playwright 는 CI 를 무겁게 하지 않으려고 의존성에 넣지 않았다. 쓸 때만 설치한다:
 *   npm i -D playwright && npx playwright install chromium
 *   npm run dev &
 *   npm run smoke:browser -- http://127.0.0.1:5173/ /tmp/shots
 *
 * 브라우저 경로는 CHROME_PATH 로 덮어쓸 수 있다.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:5178/';
const OUT = process.argv[3] ?? '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-title.png` });
console.log('title:', await page.locator('.title-main').innerText());

// 신라로 시작
await page.getByRole('button', { name: /신라/ }).first().click();
await page.getByRole('button', { name: /으로 시작|로 시작/ }).click();
await page.waitForSelector('.game', { timeout: 10000 });
await page.screenshot({ path: `${OUT}/02-map.png` });

/* ---------------- 지도 조작 ---------------- *
 * 지명은 축척에 따라 나타났다 사라지므로 이름으로 찾으면 안 된다.
 * 거점 <g> 에 붙은 data-castle-id 로 짚는다. */
const zoomLevel = () => page.locator('.map-hud.zoom .lv').innerText();

const before = await zoomLevel();
await page.getByRole('button', { name: '확대' }).click();
await page.waitForTimeout(200);
const after = await zoomLevel();
if (before === after) throw new Error(`확대 버튼이 배율을 바꾸지 않았습니다 (${before})`);
console.log('줌:', before, '→', after);

// 끌면 화면이 움직이되 거점이 선택되지는 않아야 한다.
const worldTf = () => page.locator('.map-svg > g').getAttribute('transform');
const selNow = () => page.locator('.node.sel').getAttribute('data-castle-id').catch(() => null);
const tfBefore = await worldTf();
const selBefore = await selNow();
const stage = page.locator('.map-stage');
const box = await stage.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 140, box.y + box.height / 2 - 90, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(200);
if (await worldTf() === tfBefore) throw new Error('끌었는데 화면이 움직이지 않았습니다');
if (await selNow() !== selBefore) throw new Error('끌기가 거점 선택으로 잘못 처리되었습니다');

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

// 거점 클릭 → 개발 명령
await page.locator('[data-castle-id="geumseong"]').click({ force: true });
await page.waitForTimeout(250);
const picked = await page.locator('.side-body h2').first().innerText();
if (!/금성/.test(picked)) throw new Error('거점 선택이 패널에 반영되지 않았습니다: ' + picked);
const devBtn = page.getByRole('button', { name: '농업 개발' });
if (await devBtn.count()) { await devBtn.first().click(); await page.waitForTimeout(150); }
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
  await page.locator('.node.target').first().click({ force: true });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '취소' }).click();
  await page.waitForTimeout(150);
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

// 전투 시뮬레이터 단독 실행
await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /전투 시뮬레이터/ }).click();
await page.waitForSelector('.battle', { timeout: 10000 });

await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/11-sandbox.png` });

// 수비 측을 직접 지휘해 본다: 부대 선택 → 차례 종료
const turnLabel = await page.locator('.battle-head').innerText();
if (!/아군 차례/.test(turnLabel)) throw new Error('수비 측 차례로 넘어오지 않았습니다: ' + turnLabel);
await page.locator('.unit-card').nth(1).click();
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/12-sandbox-select.png` });
await page.getByRole('button', { name: '차례 종료' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/13-sandbox-turn2.png` });
console.log('전투 진행:', (await page.locator('.battle-head .tag').first().innerText()));

await browser.close();
if (errors.length) { console.error('콘솔 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('브라우저 스모크 통과 — 콘솔 오류 없음');
