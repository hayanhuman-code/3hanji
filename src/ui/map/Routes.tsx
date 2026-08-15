/**
 * Routes.tsx — 길. 육로와 수로.
 *
 * 지도 파이프라인이 산맥과 하천을 피해 그린 곡선을 그대로 쓴다(직선을 다시 긋지 않는다).
 * 육로는 두 겹이다 — 넓은 노반 위에 파선을 얹어야 '길'로 보인다.
 */

import { memo } from 'react';
import { ROUTES, factionColor } from '../../core/data';
import type { GameState } from '../../core/types';

/**
 * 겨울에 닫히는 원해 항로. 연안 항해와 달리 먼 바다는 풍랑에 막힌다.
 * (통행 규칙 자체는 D단계에서 military.ts 에 넣는다. 여기서는 표시만.)
 */
export const OPEN_SEA = new Set(['usanguk', 'tamna', 'deokmul']);

export const Routes = memo(function Routes({ state }: { state: GameState }) {
  const winter = state.season === 3;

  return (
    <g fill="none" pointerEvents="none">
      {/* 노반 — 길의 바닥 */}
      <g>
        {ROUTES.filter((r) => !r.sea).map((r) => (
          <path key={`bed-${r.a}-${r.b}`} className="map-road-bed" d={r.d} />
        ))}
      </g>

      {/* 노면 — 파선. 양쪽이 같은 세력이면 그 색으로 물들어 판세가 한눈에 보인다. */}
      <g>
        {ROUTES.filter((r) => !r.sea).map((r) => {
          const oa = state.castles[r.a]?.owner;
          const ob = state.castles[r.b]?.owner;
          const same = oa && oa === ob;
          return (
            <path
              key={`road-${r.a}-${r.b}`}
              className={`map-road${same ? ' owned' : ''}`}
              style={same ? { stroke: factionColor(oa) } : undefined}
              d={r.d}
            />
          );
        })}
      </g>

      {/* 수로 */}
      <g>
        {ROUTES.filter((r) => r.sea).map((r) => {
          const closed = winter && (OPEN_SEA.has(r.a) || OPEN_SEA.has(r.b));
          return (
            <path
              key={`sea-${r.a}-${r.b}`}
              className={`map-searoad${closed ? ' closed' : ''}`}
              d={r.d}
            />
          );
        })}
      </g>
    </g>
  );
});
