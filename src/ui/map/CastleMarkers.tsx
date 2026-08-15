/**
 * CastleMarkers.tsx — 거점 기호와 지명.
 *
 * 두 가지가 축척(k)에 따라 달라진다. 둘 다 React 가 아니라 useMapView 의
 * onApply 훅에서 DOM 을 직접 만져 처리한다 — 확대하는 동안 76개 노드를
 * 매 프레임 리렌더할 수는 없다.
 *
 *  1. **크기 역보정** — 노드에 scale(1/k) 를 걸어 기호가 화면상 늘 같은 크기로 보인다.
 *     확대는 "땅이 넓어지는 것"이지 "성이 커지는 것"이 아니다.
 *  2. **지명 단계 노출** — 76개 이름을 다 쓰면 남부가 글자로 뒤덮인다.
 *     멀리서는 도성만, 당길수록 대성 → 항구 → 산성 순으로 이름이 드러난다.
 */

import { memo, useEffect, useRef } from 'react';
import { CASTLES, factionColor } from '../../core/data';
import type { GameState } from '../../core/types';
import { fmtTroops } from '../../core/util';
import type { MapViewApi, View } from './useMapView';

interface Props {
  api: MapViewApi;
  state: GameState;
  selected: string | null;
  marchTargets?: Set<string> | null;
}

/** 등급 점수. 높을수록 멀리서도 이름이 보인다. */
const RANK: Record<string, number> = { capital: 3, major: 2, port: 1, fort: 0 };

/** 축척 → 이 점수 이상만 이름을 쓴다 */
function labelTier(k: number): number {
  if (k < 0.42) return 3;
  if (k < 0.68) return 2;
  if (k < 1.0) return 1;
  return 0;
}

/** 병력 수는 이만큼 당겼을 때부터 */
const TROOPS_FROM = 0.8;

function glyph(type: string, color: string) {
  switch (type) {
    case 'capital':
      // 도성 — 이중 사각
      return (
        <>
          <rect className="gl" x={-5.5} y={-5.5} width={11} height={11} fill={color} />
          <rect className="gl" x={-9} y={-9} width={18} height={18} fill="none" />
        </>
      );
    case 'fort':
      // 산성 — 삼각
      return <path className="gl" d="M 0 -7.5 L 7 5 L -7 5 Z" fill={color} />;
    case 'port':
      // 항구 — 마름모
      return <path className="gl" d="M 0 -7.5 L 6.5 0 L 0 7.5 L -6.5 0 Z" fill={color} />;
    default:
      // 대성 — 원
      return <circle className="gl" cx={0} cy={0} r={6} fill={color} />;
  }
}

/** 지명은 세로쓰기. 한 글자씩 tspan 으로 내린다. */
function verticalLabel(name: string, capital: boolean) {
  const step = capital ? 12.5 : 11;
  return name.split('').map((ch, i) => (
    <tspan key={i} x={14} dy={i ? step : 0}>
      {ch}
    </tspan>
  ));
}

export const CastleMarkers = memo(function CastleMarkers({
  api,
  state,
  selected,
  marchTargets,
}: Props) {
  const groupRef = useRef<SVGGElement | null>(null);
  const { onApply, apply } = api;

  useEffect(() => {
    const handler = (v: View) => {
      const g = groupRef.current;
      if (!g) return;
      const inv = 1 / v.k;
      const tier = labelTier(v.k);
      const showTroops = v.k >= TROOPS_FROM;
      for (const node of g.querySelectorAll<SVGGElement>('[data-castle-id]')) {
        node.setAttribute(
          'transform',
          `translate(${node.dataset.x},${node.dataset.y}) scale(${inv})`
        );
        const label = node.querySelector<SVGTextElement>('.lbl');
        if (label) {
          // 고른 거점만 축척과 무관하게 이름을 보여 준다. 출진 후보 50여 개까지
          // 강제하면 화면이 글자로 덮인다 — 후보는 색과 흐림으로 이미 구분된다.
          const forced = node.classList.contains('forced');
          label.style.display = forced || Number(node.dataset.rank) >= tier ? '' : 'none';
        }
        const troops = node.querySelector<SVGTextElement>('.trp');
        if (troops) troops.style.display = showTroops ? '' : 'none';
      }
    };
    onApply.current = handler;
    apply(); // 방금 붙였으니 지금 상태로 한 번 돌린다
    return () => {
      if (onApply.current === handler) onApply.current = null;
    };
  }, [onApply, apply]);

  return (
    <g ref={groupRef}>
      {CASTLES.map((def) => {
        const c = state.castles[def.id];
        if (!c) return null;
        const isSel = selected === def.id;
        const isTarget = marchTargets?.has(def.id) ?? false;
        const dimmed = !!marchTargets && !isTarget;
        const color = factionColor(c.owner);

        return (
          <g
            key={def.id}
            className={[
              'node',
              isSel ? 'sel' : '',
              isTarget ? 'target' : '',
              dimmed ? 'dim' : '',
              isSel ? 'forced' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-castle-id={def.id}
            data-x={def.position.x}
            data-y={def.position.y}
            data-rank={RANK[def.type] ?? 0}
            role="button"
            aria-label={def.name}
          >
            {/* 손가락으로도 짚을 수 있도록 기호보다 넓은 투명 판 */}
            <circle className="hit" cx={0} cy={0} r={13} />
            {glyph(def.type, color)}

            {c.besiegedBy && <circle className="besieged" cx={0} cy={0} r={12} />}

            <text className={`lbl${def.type === 'capital' ? ' cap' : ''}`} y={-2}>
              {verticalLabel(def.name, def.type === 'capital')}
            </text>
            {/* 지명은 오른쪽으로 내려쓰므로 병력은 왼쪽에 붙인다. 겹치지 않게. */}
            <text className="trp" x={-13} y={4} textAnchor="end">
              {c.owner ? fmtTroops(c.troops) : '무주공산'}
            </text>
          </g>
        );
      })}
    </g>
  );
});
