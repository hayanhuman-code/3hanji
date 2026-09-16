/**
 * AudioControls.tsx — 소리 설정.
 *
 * 두 벌이 필요하다. 시작 화면에는 음량까지 있는 온전한 것이, 게임 중에는
 * 누르면 곧바로 꺼지는 버튼 하나가 맞다 — 소리가 거슬리는 순간에 설정을
 * 찾아 들어가게 만들면 그냥 탭을 닫는다.
 */

import { useEffect, useState } from 'react';
import { getSettings, onSettings, setSettings, unlock, type AudioSettings } from './audio';

/** 설정을 구독한다. 여러 자리에 있는 토글이 서로 어긋나지 않게 한다. */
function useAudioSettings(): AudioSettings {
  const [s, set] = useState(getSettings);
  useEffect(() => onSettings(set), []);
  return s;
}

/** 게임 중에 쓰는 것 — 버튼 하나. 소리 전체를 끈다. */
export function SoundToggle({ className = 'btn small' }: { className?: string }) {
  const s = useAudioSettings();
  const on = s.sfx || s.bgm;
  return (
    <button
      className={`${className}${on ? ' on' : ''}`}
      // 소리를 끄는 버튼이 소리를 내면 곤란하다.
      data-sfx="off"
      aria-pressed={on}
      title={on ? '소리 끄기' : '소리 켜기'}
      onClick={() => {
        unlock();
        setSettings({ sfx: !on, bgm: !on });
      }}
    >
      소리 {on ? '켬' : '끔'}
    </button>
  );
}

/** 시작 화면에 쓰는 것 — 효과음·배경음·음량 */
export function AudioOptions() {
  const s = useAudioSettings();
  return (
    <div className="opt-row audio-opts">
      <label>
        <input
          type="checkbox"
          checked={s.sfx}
          data-sfx="off"
          onChange={(e) => {
            unlock();
            setSettings({ sfx: e.target.checked });
          }}
        />
        효과음 — 북·징·편경. 명령과 전투에 소리가 붙는다
      </label>
      <label>
        <input
          type="checkbox"
          checked={s.bgm}
          data-sfx="off"
          onChange={(e) => {
            unlock();
            setSettings({ bgm: e.target.checked });
          }}
        />
        배경음 — 세력마다 다른 악기로 그때그때 지어 낸다
      </label>
      <label className="vol">
        음량
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s.volume * 100)}
          data-sfx="off"
          aria-label="음량"
          onChange={(e) => {
            unlock();
            setSettings({ volume: Number(e.target.value) / 100 });
          }}
        />
        <em>{Math.round(s.volume * 100)}</em>
      </label>
    </div>
  );
}
