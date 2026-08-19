/**
 * sync-assets.mjs — 에셋 파이프라인 산출물을 게임이 참조하는 폴더로 복사한다.
 *
 * 원본은 tools/asset_pipeline/processed/ 에 유지하고, 게임(vite)은
 * public/assets/sprites/ 만 본다. 미리보기(_*.png)와 중간물(_work/)은
 * 게임에 필요 없으므로 거른다.
 *
 *   node scripts/sync-assets.mjs   (npm run sync:assets)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'tools/asset_pipeline/processed';
const DST = 'public/assets/sprites';

rmSync(DST, { recursive: true, force: true });
mkdirSync(join(DST, 'factions'), { recursive: true });

let n = 0;
let toned = 0;
for (const f of readdirSync(SRC)) {
  if (f.startsWith('_') || !f.endsWith('.png')) continue;
  // 타일은 배경화 톤 다운본(toned/)이 있으면 그쪽을 쓴다 — 지형은 무대다
  const tonedPath = join(SRC, 'toned', f);
  if (f.startsWith('tile_') && existsSync(tonedPath)) {
    cpSync(tonedPath, join(DST, f));
    toned++;
  } else {
    cpSync(join(SRC, f), join(DST, f));
  }
  n++;
}
for (const f of readdirSync(join(SRC, 'factions'))) {
  if (!f.endsWith('.png')) continue;
  cpSync(join(SRC, 'factions', f), join(DST, 'factions', f));
  n++;
}
// 지형 경계 전환 타일 — 장수가 많으므로 디렉터리째 복사한다
let auto = 0;
if (existsSync(join(SRC, 'autotile'))) {
  mkdirSync(join(DST, 'autotile'), { recursive: true });
  for (const f of readdirSync(join(SRC, 'autotile'))) {
    if (!f.endsWith('.png')) continue;
    cpSync(join(SRC, 'autotile', f), join(DST, 'autotile', f));
    auto++;
    n++;
  }
}
console.log(
  `sync-assets: ${n}개 파일 → ${DST} ` +
    `(타일 톤 다운본 ${toned}개 적용, 전환 타일 ${auto}개)`
);
