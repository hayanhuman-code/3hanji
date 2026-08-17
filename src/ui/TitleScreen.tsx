/**
 * TitleScreen.tsx — 시나리오·세력 선택과 옵션.
 */

import { useState } from 'react';
import { PLAYABLE_FACTIONS, SCENARIOS, castleName, factionDef } from '../core/data';
import { hasSave } from '../core/save';
import { readSaveFile } from '../core/save';
import { useGame } from './store';

export function TitleScreen() {
  const newGame = useGame((s) => s.newGame);
  const loadSaved = useGame((s) => s.loadSaved);
  const adoptState = useGame((s) => s.adoptState);
  const notify = useGame((s) => s.notify);
  const setScreen = useGame((s) => s.setScreen);

  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [faction, setFaction] = useState('silla');
  const [historical, setHistorical] = useState(true);
  const [autoBattle, setAutoBattle] = useState(false);
  const [victory, setVictory] = useState<'unification' | 'hegemony'>('hegemony');

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const playable = PLAYABLE_FACTIONS.filter((f) => (scenario.ownership[f.id] ?? []).length > 0);
  const chosen = playable.some((f) => f.id === faction) ? faction : playable[0]?.id;

  return (
    <div className="title-screen">
      <div className="title-inner">
        <h1 className="title-main">
          삼한지
          <small>三韓志 · 천하삼분</small>
        </h1>
        <p className="title-lead">
          고구려·백제·신라 가운데 하나를 골라 내정·외교·전쟁으로 한반도를 통일하라. 단, 대륙의
          제국과 바다 건너 왜가 지켜보고 있다.
        </p>

        <div className="section-label">시나리오</div>
        <div className="card-grid">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`card${s.id === scenarioId ? ' selected' : ''}`}
              onClick={() => setScenarioId(s.id)}
            >
              <h3>{s.name}</h3>
              <div className="faint" style={{ fontSize: 12 }}>
                {s.startYear}년 {['봄', '여름', '가을', '겨울'][s.startSeason]}
              </div>
              <p>{s.desc}</p>
            </button>
          ))}
        </div>

        <div className="section-label">세력</div>
        <div className="card-grid">
          {playable.map((f) => {
            const owned = scenario.ownership[f.id] ?? [];
            return (
              <button
                key={f.id}
                className={`card${f.id === chosen ? ' selected' : ''}`}
                onClick={() => setFaction(f.id)}
              >
                <h3>
                  <span className="swatch" style={{ background: f.color }} />
                  {f.name}
                </h3>
                <p>{f.blurb}</p>
                <p>
                  <b className="muted">강점</b> {f.strength}
                  <br />
                  <b className="muted">약점</b> {f.weakness}
                </p>
                <p className="faint">
                  거점 {owned.length} — {owned.map(castleName).join(' · ')}
                </p>
              </button>
            );
          })}
        </div>

        <div className="section-label">설정</div>
        <div className="opt-row">
          <label>
            <input
              type="checkbox"
              checked={historical}
              onChange={(e) => setHistorical(e.target.checked)}
            />
            역사 이벤트 — 켜면 사서의 사건이 재현되고, 끄면 완전 샌드박스
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoBattle}
              onChange={(e) => setAutoBattle(e.target.checked)}
            />
            전투 위임 — 전술 화면 없이 자동 계산
          </label>
        </div>
        <div className="opt-row" style={{ marginTop: 8 }}>
          <label>
            <input
              type="radio"
              checked={victory === 'hegemony'}
              onChange={() => setVictory('hegemony')}
            />
            패권 — 다른 나라를 모두 조공국으로 복속 (권장)
          </label>
          <label>
            <input
              type="radio"
              checked={victory === 'unification'}
              onChange={() => setVictory('unification')}
            />
            통일 — 전 거점 점령
          </label>
        </div>

        <div className="row" style={{ marginTop: 28, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            disabled={!chosen}
            onClick={() =>
              chosen &&
              newGame({
                scenarioId,
                playerFaction: chosen,
                options: { historicalEvents: historical, autoBattle, victory },
              })
            }
          >
            {factionDef(chosen ?? 'silla').name}(으)로 시작
          </button>

          <button
            className="btn"
            disabled={!hasSave('auto') && !hasSave('manual')}
            onClick={() => {
              if (!loadSaved()) notify('불러올 세이브가 없습니다.');
            }}
          >
            이어하기
          </button>

          <label className="btn" style={{ display: 'inline-block' }}>
            세이브 파일 열기
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  adoptState(await readSaveFile(file));
                } catch (err) {
                  notify(`불러오기 실패: ${(err as Error).message}`);
                }
              }}
            />
          </label>

          <button className="btn ghost" onClick={() => setScreen('field')}>
            전장 시뮬레이터 (전투 v2)
          </button>

        </div>

        <p className="faint" style={{ marginTop: 26, fontSize: 12, maxWidth: 660 }}>
          M1 프로토타입입니다. 인물 능력치와 영토 표기는 사료를 바탕으로 한 게임적 해석이며,
          고증을 확정하는 것이 아닙니다. 자세한 범위와 남은 과제는 저장소의 README 를 보십시오.
        </p>
      </div>
    </div>
  );
}
