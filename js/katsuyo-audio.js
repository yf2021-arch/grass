// A reward completes when the sound ends, rather than when playback starts.
export function createRewardAudio() {
  let cancel = () => {};
  const stop = () => { cancel(); cancel = () => {}; };
  async function play(text, url = null) {
    stop();
    let cancelled = false;
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    let audio = null;
    let utterance = null;
    const timer = setTimeout(() => { stop(); finish(false); }, 15000);
    const settle = ok => { clearTimeout(timer); finish(ok); };
    cancel = () => {
      cancelled = true;
      if (audio) { audio.onended = audio.onerror = null; audio.pause(); }
      if (utterance) window.speechSynthesis?.cancel();
      settle(false);
    };
    const speak = () => {
      if (cancelled) return;
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { settle(false); return; }
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'ja-JP';
      const voice = window.speechSynthesis.getVoices().find(v => /^ja(?:-|_|$)/i.test(v.lang));
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      utterance.onend = () => settle(true);
      utterance.onerror = () => settle(false);
      try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); } catch { settle(false); }
    };
    if (url) {
      try {
        audio = new Audio(url);
        audio.onended = () => settle(true);
        let fallback = false;
        const useSpeech = () => { if (fallback) return; fallback = true; audio.pause(); speak(); };
        audio.onerror = useSpeech;
        Promise.resolve(audio.play()).catch(useSpeech);
      } catch { speak(); }
    } else speak();
    return done;
  }
  return { play, stop };
}
