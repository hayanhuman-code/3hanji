/**
 * Terrain.tsx — 해안선·섬·호수·하천·산맥.
 *
 * 게임 상태와 무관한 지리다. 한 번 그리면 다시 그릴 일이 없다 —
 * MAP.land 하나가 10만 자가 넘는 path 문자열이라 리렌더가 비싸다.
 * 계절만 예외로, 겨울에는 큰 강이 언 표시를 한다.
 */

import { memo } from 'react';
import { MAP } from '../../core/data';
import type { Season } from '../../core/types';

/** 겨울에 어는 강. 얼면 도하 페널티가 사라진다 (formulas.ts 의 riversFrozen). */
const FREEZING = new Set(['Yalu', 'Taedong', 'Han', 'Namhan', 'Tumen']);

export const Terrain = memo(function Terrain({ season }: { season: Season }) {
  const winter = season === 3;
  return (
    <g pointerEvents="none">
      <path className="map-land" d={MAP.land} />
      <path className="map-land" d={MAP.islets} />
      <path className="map-lake" d={MAP.lakes} />

      <g>
        {Object.entries(MAP.ranges).map(([name, d]) => (
          // 산맥은 열린 폴리라인이다. fill 을 주면 시커먼 덩어리가 된다.
          <path key={name} className="map-range" d={d} />
        ))}
      </g>

      <g>
        {Object.entries(MAP.rivers).map(([name, d]) => (
          <path
            key={name}
            className={`map-river${winter && FREEZING.has(name) ? ' frozen' : ''}`}
            d={d}
          />
        ))}
      </g>

      <text className="map-sea-label" x={MAP.width * 0.1} y={MAP.height * 0.72}>
        西海
      </text>
      <text
        className="map-sea-label"
        x={MAP.width * 0.9}
        y={MAP.height * 0.52}
        transform={`rotate(90 ${MAP.width * 0.9} ${MAP.height * 0.52})`}
      >
        東海
      </text>
    </g>
  );
});
