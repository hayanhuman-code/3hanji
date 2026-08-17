import { useEffect } from 'react';
import { BattleScreen } from './ui/BattleScreen';
import { GameScreen } from './ui/GameScreen';
import { TitleScreen } from './ui/TitleScreen';
import { FieldSim } from './ui/field/FieldSim';
import { useGame } from './ui/store';

export default function App() {
  const screen = useGame((s) => s.screen);
  const battle = useGame((s) => s.battle);
  const message = useGame((s) => s.message);
  const notify = useGame((s) => s.notify);

  // 안내 문구는 잠깐 보여 주고 스스로 사라진다.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => notify(null), 3200);
    return () => clearTimeout(t);
  }, [message, notify]);

  return (
    <>
      {screen === 'field' ? (
        <FieldSim />
      ) : screen === 'sandbox' || (screen === 'game' && battle) ? (
        <BattleScreen />
      ) : screen === 'game' ? (
        <GameScreen />
      ) : (
        <TitleScreen />
      )}
      {message && <div className="toast">{message}</div>}
    </>
  );
}
