/**
 * dialogs.tsx — 출진 편성 / 이벤트 컷 / 턴 결산 / 게임 종료
 */

import { useMemo, useState } from 'react';
import { castleDef, castleName, factionName, officerDef, unitDef } from '../core/data';
import { B } from '../core/formulas';
import { findMarchPath, isSeaRoute, validateMarch } from '../core/military';
import { availableOfficersAt } from '../core/state';
import { victoryLabel } from '../core/victory';
import type { EventDef, GameState, MarchCommand, TurnReport, UnitStack } from '../core/types';
import { fmt, fmtTroops, sum } from '../core/util';
import { useGame } from './store';

/* ------------------------------------------------------------------ *
 * 출진
 * ------------------------------------------------------------------ */

/**
 * 도달 가능한 거점을 가까운 순으로. GameScreen 이 지도를 밝히는 데도 쓰므로
 * 대화상자 안에 가둬 두지 않는다.
 */
export function reachableFrom(state: GameState, faction: string, from: string) {
  // 그 거점에 있는 병력 전부를 데려간다고 보고 잰다 — 수군이 있으면
  // 적이 지키는 항로도 후보에 든다. 실제 편성은 아래 슬라이더가 정한다.
  const units = state.castles[from]?.composition;
  return Object.values(state.castles)
    .filter((c) => c.id !== from)
    .filter((c) => !!findMarchPath(state, faction, from, c.id, units))
    .sort((a, b) => {
      const pa = findMarchPath(state, faction, from, a.id, units)?.length ?? 99;
      const pb = findMarchPath(state, faction, from, b.id, units)?.length ?? 99;
      return pa - pb;
    });
}

/**
 * 출진 편성.
 *
 * 전체 화면을 덮는 모달이 아니라 **지도 옆에 떠 있는 창**이다.
 * 거점이 76개나 되어 목적지를 드롭다운 이름으로 찾는 것이 고역이므로,
 * 대화상자를 띄운 채로 지도에서 직접 찍을 수 있어야 한다.
 */
export function MarchDialog({
  state,
  from,
  target,
  onTarget,
  onClose,
}: {
  state: GameState;
  from: string;
  target: string;
  onTarget: (id: string) => void;
  onClose: () => void;
}) {
  const issue = useGame((s) => s.issue);
  const faction = state.playerFaction;
  const castle = state.castles[from];
  const officers = availableOfficersAt(state, from);

  const [commander, setCommander] = useState(officers[0]?.id ?? '');
  const [escorts, setEscorts] = useState<string[]>([]);
  const [mode, setMode] = useState<'assault' | 'encircle'>('assault');
  const [ratio, setRatio] = useState(0.7);

  const reachable = useMemo(
    () => reachableFrom(state, faction, from),
    [state, from, faction]
  );

  const units: UnitStack[] = castle.composition
    .map((u) => ({ unitType: u.unitType, count: Math.floor(u.count * ratio) }))
    .filter((u) => u.count > 0);
  const total = sum(units.map((u) => u.count));
  const grain = Math.min(
    state.factions[faction].resources.grain,
    Math.round(total * B.grainPerTroop * B.fieldUpkeepMultiplier * 5)
  );

  const cmd: MarchCommand = {
    kind: 'march',
    faction,
    from,
    target,
    commander,
    officers: escorts,
    units,
    grain,
    siegeMode: mode,
  };
  const error = target ? validateMarch(state, cmd) : '목적지를 고르십시오.';
  const path = target ? findMarchPath(state, faction, from, target, units) : null;

  return (
    <div className="march-panel">
      <div className="modal">
        <div className="modal-head">
          <h2>{castleName(from)}에서 출진</h2>
          <button className="btn ghost small" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body stack">
          <div>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              지휘관
            </div>
            <select
              className="btn small block"
              value={commander}
              onChange={(e) => setCommander(e.target.value)}
            >
              {officers.length === 0 && <option value="">출진할 인물이 없습니다</option>}
              {officers.map((o) => {
                const d = officerDef(o.id);
                return (
                  <option key={o.id} value={o.id}>
                    {d.name} — 통{d.stats.lead} 무{d.stats.war} 지{d.stats.int}
                  </option>
                );
              })}
            </select>
            {officers.length > 1 && (
              <div className="row" style={{ flexWrap: 'wrap', marginTop: 6, gap: 5 }}>
                {officers
                  .filter((o) => o.id !== commander)
                  .map((o) => (
                    <button
                      key={o.id}
                      className="btn small"
                      style={{
                        borderColor: escorts.includes(o.id) ? 'var(--jinsa)' : undefined,
                      }}
                      onClick={() =>
                        setEscorts((prev) =>
                          prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]
                        )
                      }
                    >
                      {officerDef(o.id).name} 동행
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              목적지
            </div>
            <select
              className="btn small block"
              value={target}
              onChange={(e) => onTarget(e.target.value)}
            >
              <option value="">— 고르십시오 —</option>
              {reachable.map((c) => {
                const d = castleDef(c.id);
                const dist = findMarchPath(state, faction, from, c.id)?.length ?? 0;
                return (
                  <option key={c.id} value={c.id}>
                    {d.name} ({factionName(c.owner)}, {dist}거점, 병력 {fmtTroops(c.troops)})
                  </option>
                );
              })}
            </select>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              {path && path.length > 0 ? (
                <>
                  경로: {castleName(from)}
                  {path.map((id, i) => {
                    const prev = i === 0 ? from : path[i - 1];
                    // 뱃길 구간은 표시해 준다 — 겨울에 닫히는 길인지 알아야 한다.
                    return (
                      <span key={id}>
                        {isSeaRoute(prev, id) ? ' ⇢배로⇢ ' : ' → '}
                        {castleName(id)}
                      </span>
                    );
                  })}{' '}
                  ({path.length}계절)
                </>
              ) : (
                '지도에서 밝게 표시된 거점을 눌러도 됩니다.'
              )}
            </div>
          </div>

          <div>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              병력 — {fmt(total)} / 주둔 {fmt(castle.troops)}
            </div>
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={ratio}
              onChange={(e) => setRatio(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div className="faint" style={{ fontSize: 12 }}>
              {units.map((u) => `${unitDef(u.unitType).name} ${fmt(u.count)}`).join(' · ') || '없음'}
              <br />
              휴대 병량 {fmt(grain)}섬 (약 5계절분)
            </div>
          </div>

          <div>
            <div className="section-label" style={{ margin: '0 0 6px' }}>
              공성 방식
            </div>
            <div className="row">
              <button
                className="btn small"
                style={{ borderColor: mode === 'assault' ? 'var(--jinsa)' : undefined }}
                onClick={() => setMode('assault')}
              >
                강공 — 성벽을 두드린다
              </button>
              <button
                className="btn small"
                style={{ borderColor: mode === 'encircle' ? 'var(--jinsa)' : undefined }}
                onClick={() => setMode('encircle')}
              >
                포위 — 병량을 말린다
              </button>
            </div>
            <p className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
              {mode === 'assault'
                ? '도착 즉시 전투가 벌어진다. 성곽이 높으면 큰 피해를 각오해야 한다.'
                : '싸우지 않고 성을 둘러싼다. 비축 병량이 다하면 성이 열리지만, 아군보다 수비가 강하면 기습을 당한다.'}
            </p>
          </div>

          {error && <div className="tag" style={{ borderColor: 'var(--jinsa)' }}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={!!error}
            onClick={() => {
              if (issue(cmd)) onClose();
            }}
          >
            출진한다
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 이벤트 컷
 * ------------------------------------------------------------------ */

export function EventModal({ def, onChoose }: { def: EventDef; onChoose: (i: number) => void }) {
  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-head">
          <h2>{def.name}</h2>
          {def.historical && <span className="tag">사서에 남은 일</span>}
        </div>
        <div className="modal-body">
          {def.quote && (
            <blockquote className="quote">
              {def.quote}
              {def.source && <cite>— {def.source}</cite>}
            </blockquote>
          )}
          <p className="event-text">{def.text}</p>
          {def.choices.map((c, i) => (
            <button key={i} className="choice" onClick={() => onChoose(i)}>
              {c.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 턴 결산
 * ------------------------------------------------------------------ */

export function ReportModal({
  report,
  year,
  season,
  onClose,
}: {
  report: TurnReport | undefined;
  year: number;
  season: number;
  onClose: () => void;
}) {
  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h2>
            {year}년 {['봄', '여름', '가을', '겨울'][season]} 결산
          </h2>
        </div>
        <div className="modal-body">
          {!report && <p className="muted">보고할 것이 없습니다.</p>}
          {report && (
            <>
              <div className="report-grid">
                <div className="stat-tile">
                  <div className="label">곡물 수지</div>
                  <div className={`value ${report.net.grain >= 0 ? 'good' : 'bad'}`}>
                    {report.net.grain >= 0 ? '+' : ''}
                    {fmt(report.net.grain)}
                  </div>
                  <div className="faint" style={{ fontSize: 11 }}>
                    수입 {fmt(report.income.grain)} · 병량 {fmt(report.upkeep.grain)}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="label">재화</div>
                  <div className="value">+{fmt(report.income.gold)}</div>
                </div>
                <div className="stat-tile">
                  <div className="label">철</div>
                  <div className="value">+{fmt(report.income.iron)}</div>
                </div>
              </div>

              {report.battles.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 4 }}>
                    싸움
                  </div>
                  <table className="grid">
                    <thead>
                      <tr>
                        <th>장소</th>
                        <th>결과</th>
                        <th className="n">아군 피해</th>
                        <th className="n">적 피해</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.battles.map((b, i) => {
                        const weAttacked = b.attacker === report.faction;
                        return (
                          <tr key={i}>
                            <td>{b.castleName}</td>
                            <td className={b.winner === report.faction ? 'good' : 'bad'}>
                              {b.winner === report.faction ? '승리' : '패배'}
                              {b.captured ? ' · 함락' : ''}
                            </td>
                            <td className="n">
                              {fmt(weAttacked ? b.attackerLoss : b.defenderLoss)}
                            </td>
                            <td className="n">
                              {fmt(weAttacked ? b.defenderLoss : b.attackerLoss)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {report.highlights.length > 0 && (
                <>
                  <div className="section-label">그 밖에</div>
                  {report.highlights.map((h, i) => (
                    <div key={i} style={{ fontSize: 13 }}>
                      · {h}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>
            다음 계절로
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 종료
 * ------------------------------------------------------------------ */

export function GameOverModal({ state }: { state: GameState }) {
  const setScreen = useGame((s) => s.setScreen);
  if (!state.result) return null;
  const won = state.result.winner === state.playerFaction && state.result.kind !== 'player_defeated';

  return (
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-head">
          <h2>{won ? '대업을 이루다' : '사직이 끊기다'}</h2>
        </div>
        <div className="modal-body">
          <p className="event-text">
            {state.result.year}년, {factionName(state.result.winner)}이(가){' '}
            {victoryLabel(state.result.kind)}
            {won ? '으로 천하를 얻었다.' : '을 이루었다.'}
          </p>
          <div className="section-label">연대기</div>
          {state.chronicle.slice(-14).map((c, i) => (
            <div className="chronicle-item" key={i}>
              <span className="yr">{c.year}년</span>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={() => setScreen('title')}>
            처음으로
          </button>
        </div>
      </div>
    </div>
  );
}
