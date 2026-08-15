/**
 * GameScreen.tsx — 전략 화면 전체 조립 (상단 바 + 전략맵 + 사이드 패널 + 로그)
 */

import { useState } from 'react';
import { factionColor, factionName } from '../core/data';
import { downloadSave, saveToStorage } from '../core/save';
import { factionCastles, factionTroops } from '../core/state';
import { EventModal, GameOverModal, MarchDialog, ReportModal } from './dialogs';
import {
  CastlePanel,
  ChroniclePanel,
  DiplomacyPanel,
  InstitutionPanel,
  OfficerPanel,
} from './panels';
import { StrategyMap } from './StrategyMap';
import { useGame, type SidePanel } from './store';
import { fmt, fmtTroops } from '../core/util';

const TABS: Array<{ id: SidePanel; label: string }> = [
  { id: 'castle', label: '거점' },
  { id: 'officers', label: '인물' },
  { id: 'diplomacy', label: '외교' },
  { id: 'institutions', label: '제도' },
  { id: 'chronicle', label: '연대기' },
];

export function GameScreen() {
  const state = useGame((s) => s.state);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const panel = useGame((s) => s.panel);
  const setPanel = useGame((s) => s.setPanel);
  const endTurn = useGame((s) => s.endTurn);
  const busy = useGame((s) => s.busy);
  const event = useGame((s) => s.event);
  const chooseEvent = useGame((s) => s.chooseEvent);
  const showReport = useGame((s) => s.showReport);
  const closeReport = useGame((s) => s.closeReport);
  const setScreen = useGame((s) => s.setScreen);
  const notify = useGame((s) => s.notify);
  // 코어가 상태를 제자리에서 고치므로 revision 을 구독해 다시 그린다.
  useGame((s) => s.revision);

  const [marchFrom, setMarchFrom] = useState<string | null>(null);

  if (!state) return null;
  const me = state.factions[state.playerFaction];
  const r = me.resources;
  const myReport = state.reports.find((x) => x.faction === state.playerFaction);
  const pending = Object.values(state.officers).filter(
    (o) => o.faction === state.playerFaction && o.status === 'active' && !o.acted && !o.armyId
  ).length;

  return (
    <div className="game">
      <div className="topbar">
        <span className="date">
          {state.year}년 {['봄', '여름', '가을', '겨울'][state.season]}
        </span>
        <span className="faction-name" style={{ color: factionColor(state.playerFaction) }}>
          {factionName(state.playerFaction)}
        </span>
        <div className="res num">
          <span>
            <b>곡물</b>
            {fmt(r.grain)}
          </span>
          <span>
            <b>재화</b>
            {fmt(r.gold)}
          </span>
          <span>
            <b>철</b>
            {fmt(r.iron)}
          </span>
          <span>
            <b>명분</b>
            {Math.round(r.cause)}
          </span>
          <span>
            <b>거점</b>
            {factionCastles(state, state.playerFaction).length}
          </span>
          <span>
            <b>병력</b>
            {fmtTroops(factionTroops(state, state.playerFaction))}
          </span>
          <span>
            <b>지지</b>
            {Math.round(me.councilSupport)}
          </span>
        </div>
        <div className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          대기 인물 {pending}
        </span>
        <button
          className="btn small"
          onClick={() => {
            saveToStorage(state, 'manual');
            notify('저장했습니다.');
          }}
        >
          저장
        </button>
        <button className="btn small" onClick={() => downloadSave(state)}>
          내보내기
        </button>
        <button className="btn small ghost" onClick={() => setScreen('title')}>
          나가기
        </button>
        <button
          className="btn primary"
          onClick={endTurn}
          disabled={busy || state.phase !== 'command'}
        >
          {busy ? '처리 중…' : '턴 종료'}
        </button>
      </div>

      <div className="body">
        <div className="map-wrap">
          <StrategyMap state={state} selected={selected} onSelect={select} />
        </div>

        <div className="side">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={panel === t.id ? 'on' : ''}
                onClick={() => setPanel(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="side-body">
            {panel === 'castle' && (
              <CastlePanel state={state} onMarch={() => selected && setMarchFrom(selected)} />
            )}
            {panel === 'officers' && <OfficerPanel state={state} />}
            {panel === 'diplomacy' && <DiplomacyPanel state={state} />}
            {panel === 'institutions' && <InstitutionPanel state={state} />}
            {panel === 'chronicle' && <ChroniclePanel state={state} />}
          </div>
          <div className="log">
            {state.log
              .filter((l) => l.faction === null || l.faction === state.playerFaction || l.kind === 'battle')
              .slice(-80)
              .reverse()
              .map((l, i) => (
                <div key={i}>
                  <span className="when">
                    {l.year}
                    {['봄', '여름', '가을', '겨울'][l.season]}
                  </span>
                  {l.text}
                </div>
              ))}
          </div>
        </div>
      </div>

      {marchFrom && (
        <MarchDialog state={state} from={marchFrom} onClose={() => setMarchFrom(null)} />
      )}
      {event && <EventModal def={event.def} onChoose={chooseEvent} />}
      {showReport && !state.result && (
        <ReportModal
          report={myReport}
          year={myReport?.year ?? state.year}
          season={myReport?.season ?? state.season}
          onClose={closeReport}
        />
      )}
      {state.result && <GameOverModal state={state} />}
    </div>
  );
}
