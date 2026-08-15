/**
 * Territory.tsx — 세력 영향권 음영.
 *
 * 거점 76개를 기호만으로 보면 누가 어디까지 뻗어 있는지 읽히지 않는다.
 * 거점마다 옅은 원을 두고 흐릿하게 번지게 한 뒤 해안선으로 잘라 낸다.
 * 전선이 어디에 서 있는지가 한눈에 들어온다.
 *
 * 소유권이 바뀔 때만 다시 그린다. 블러는 비싸므로 매 프레임 돌면 안 된다.
 */

import { memo, useId } from 'react';
import { CASTLES, MAP, factionColor } from '../../core/data';
import type { GameState } from '../../core/types';

/**
 * 등급이 높을수록 넓게 물든다.
 * 옅게 까는 이유: 지(紙) 바탕 위에서 진하면 얼룩처럼 보인다.
 * 이것은 장식이 아니라 "어디까지가 누구 땅인가"를 말하는 정보다 (문서 §0 원칙 ③).
 */
const RADIUS: Record<string, number> = { capital: 125, major: 96, port: 78, fort: 76 };

export const Territory = memo(function Territory({ state }: { state: GameState }) {
  const uid = useId().replace(/:/g, '');
  const clipId = `mapLand-${uid}`;
  const blurId = `mapBlur-${uid}`;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={MAP.land} />
          <path d={MAP.islets} />
        </clipPath>
        <filter id={blurId}>
          <feGaussianBlur stdDeviation="26" />
        </filter>
      </defs>
      <g clipPath={`url(#${clipId})`} filter={`url(#${blurId})`} opacity="0.2" pointerEvents="none">
        {CASTLES.map((def) => {
          const owner = state.castles[def.id]?.owner;
          if (!owner) return null;
          return (
            <circle
              key={def.id}
              cx={def.position.x}
              cy={def.position.y}
              r={RADIUS[def.type] ?? 80}
              fill={factionColor(owner)}
            />
          );
        })}
      </g>
    </>
  );
});
