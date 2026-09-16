/**
 * audio — 소리의 창구. 화면은 이 파일만 부른다.
 *
 * 안쪽 네 파일이 하는 일:
 *   scale.ts   음계와 가락  (Web Audio 를 모른다 — 그래서 시험할 수 있다)
 *   voices.ts  악기         (대금·가야금·아쟁·편경·북·징)
 *   engine.ts  컨텍스트와 설정
 *   bgm.ts     배경음 예약기
 */

export { getSettings, onSettings, setSettings, unlock, type AudioSettings } from './engine';
export { play, playWithUnlock, type SfxName } from './sfx';
export { setTrack, stop as stopBgm, currentTrack, type Track } from './bgm';
