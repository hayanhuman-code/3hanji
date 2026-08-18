/**
 * sync-assets.mjs — 에셋 파이프라인 산출물을 게임이 참조하는 폴더로 복사한다.
 *
 * 원본은 tools/asset_pipeline/processed/ 에 유지하고, 게임(vite)은
 * public/assets/sprites/ 만 본다. 미리보기(_*.png)와 중간물(_work/)은
 * 게임에 필요 없으므로 거른다.
 *
 *   node scripts/sync-assets.mjs   (npm run sync:assets)
 */
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'tools/asset_pipeline/processed';
const DST = 'public/assets/sprites';

rmSync(DST, { recursive: true, force: true });
mkdirSync(join(DST, 'factions'), { recursive: true });

let n = 0;
for (const f of readdirSync(SRC)) {
  if (f.startsWith('_') || !f.endsWith('.png')) continue;
  cpSync(join(SRC, f), join(DST, f));
  n++;
}
for (const f of readdirSync(join(SRC, 'factions'))) {
  if (!f.endsWith('.png')) continue;
  cpSync(join(SRC, 'factions', f), join(DST, 'factions', f));
  n++;
}
console.log(`sync-assets: ${n}개 파일 → ${DST}`);
