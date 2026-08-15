/**
 * ArmyMarkers.tsx — 행군 중인 부대.
 *
 * 거점 기호와 달리 축척 역보정을 걸지 않는다. 부대는 매 턴 위치가 바뀌어
 * 어차피 다시 그려지고, 지도를 당겼을 때 함께 커지는 편이 "어디쯤 와 있는가"를
 * 읽기에 낫다.
 */

import { castleDef, factionColor, officerName } from '../../core/data';
import { armyTroops } from '../../core/state';
import type { GameState } from '../../core/types';
import { fmtTroops } from '../../core/util';

export function ArmyMarkers({ state }: { state: GameState }) {
  return (
    <g pointerEvents="none">
      {Object.values(state.armies).map((army) => {
        const at = castleDef(army.location);
        const next = army.path[0] ? castleDef(army.path[0]) : null;
        // 다음 목적지 쪽으로 조금 나가 있게 그린다. 멈춰 있으면 성 위쪽에.
        const dx = next ? (next.position.x - at.position.x) * 0.28 : 0;
        const dy = next ? (next.position.y - at.position.y) * 0.28 : -26;
        const x = at.position.x + dx;
        const y = at.position.y + dy;
        const color = factionColor(army.faction);

        return (
          <g key={army.id}>
            {next && (
              <line
                className="map-march"
                x1={at.position.x}
                y1={at.position.y}
                x2={next.position.x}
                y2={next.position.y}
                style={{ stroke: color }}
              />
            )}
            <polygon
              className="map-army"
              points={`${x},${y - 11} ${x + 9},${y + 7} ${x - 9},${y + 7}`}
              fill={color}
            />
            <text className="map-army-label" x={x} y={y + 24} textAnchor="middle">
              {officerName(army.commander)} {fmtTroops(armyTroops(army))}
            </text>
          </g>
        );
      })}
    </g>
  );
}
