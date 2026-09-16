import { useEffect } from 'react';
import { GameScreen } from './ui/GameScreen';
import { TitleScreen } from './ui/TitleScreen';
import { FieldBattle } from './ui/field/FieldBattle';
import { FieldSim } from './ui/field/FieldSim';
import { AudioBoot } from './ui/AudioBoot';
import { useGame } from './ui/store';

export default function App() {
  const screen = useGame((s) => s.screen);
  const field = useGame((s) => s.field);
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
      {/* 아무것도 그리지 않는다 — 소리를 깨우고 화면에 맞는 배경음을 건다 */}
      <AudioBoot />
      {screen === 'field' ? (
        <FieldSim />
      ) : screen === 'game' && field ? (
        <FieldBattle />
      ) : screen === 'game' ? (
        <GameScreen />
      ) : (
        <TitleScreen />
      )}
      {message && <div className="toast">{message}</div>}
    </>
  );
}
