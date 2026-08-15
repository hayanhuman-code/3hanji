/**
 * Routes.tsx — 길. 육로와 수로.
 *
 * 지도 파이프라인이 산맥과 하천을 피해 그린 곡선을 그대로 쓴다(직선을 다시 긋지 않는다).
 * 육로는 두 겹이다 — 넓은 노반 위에 파선을 얹어야 '길'로 보인다.
 */

import { memo } from 'react';
import { ROUTES, factionColor } from '../../core/data';
import { OPEN_SEA_PORTS, seaClosed } from '../../core/military';
import { atWar } from '../../core/state';
import type { GameState } from '../../core/types';

// 폐쇄 항로 목록은 규칙 쪽(military.ts)이 단일 출처다.
// 여기에 따로 두면 "화면에는 닫혔다는데 실제로는 지나가진다"가 된다.
export { OPEN_SEA_PORTS };

/**
 * `ownerKey` 와 `season` 은 이 컴포넌트가 읽지 않는다 — memo 가 볼 값이다.
 * 코어가 상태를 제자리에서 고치므로 `state` 만으로는 변화를 알 수 없다.
 */
export const Routes = memo(function Routes({
  state,
}: {
  state: GameState;
  ownerKey: string;
  season: number;
}) {
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

      {/* 수로 — 확보 여부와 겨울 폐쇄를 함께 보여 준다 */}
      <g>
        {ROUTES.filter((r) => r.sea).map((r) => {
          const closed = seaClosed(r.a, r.b, state.season);
          // 적이 한쪽을 쥐고 있으면 수군 없이는 못 건넌다. 왜 못 가는지 보이게 옅게.
          const me = state.playerFaction;
          const contested =
            !closed &&
            [r.a, r.b].some((id) => {
              const o = state.castles[id]?.owner;
              return !!o && o !== me && atWar(state, me, o);
            });
          return (
            <path
              key={`sea-${r.a}-${r.b}`}
              className={`map-searoad${closed ? ' closed' : contested ? ' contested' : ''}`}
              d={r.d}
            />
          );
        })}
      </g>
    </g>
  );
});
