"use client";

const lang = "en-US";

type RecognitionEvent = { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen() {
  return recognitionClass() !== null;
}

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === lang && v.localService) ?? voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith("en"));
}

// resolves when the sentence has been read, so listening never hears the app itself
export function speak(text: string): Promise<void> {
  if (!canSpeak() || !text) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    // some browsers never fire onend, so there is a time based fallback
    const fallback = window.setTimeout(resolve, 1500 + text.length * 80);
    const done = () => {
      window.clearTimeout(fallback);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

export function isSpeaking() {
  return canSpeak() && window.speechSynthesis.speaking;
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

export type ListenResult = { ok: true; text: string } | { ok: false; reason: "unsupported" | "no-speech" | "denied" | "error" };

// listens for one phrase and gives up after a few seconds of silence
export function listenOnce(timeoutMs = 8000): Promise<ListenResult> {
  const Recognition = recognitionClass();
  if (!Recognition) return Promise.resolve({ ok: false, reason: "unsupported" });

  return new Promise((resolve) => {
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let settled = false;
    const finish = (result: ListenResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };
    const timer = window.setTimeout(() => {
      recognition.abort();
      finish({ ok: false, reason: "no-speech" });
    }, timeoutMs);

    recognition.onresult = (event) => {
      const text = Array.from(event.results).map((r) => r[0].transcript).join(" ").trim();
      finish(text ? { ok: true, text } : { ok: false, reason: "no-speech" });
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") finish({ ok: false, reason: "denied" });
      else if (event.error === "no-speech" || event.error === "aborted") finish({ ok: false, reason: "no-speech" });
      else finish({ ok: false, reason: "error" });
    };
    recognition.onend = () => finish({ ok: false, reason: "no-speech" });

    try {
      recognition.start();
    } catch {
      finish({ ok: false, reason: "error" });
    }
  });
}

let audio: AudioContext | null = null;

// ios starts audio contexts muted and only allows a few, so one context is unlocked from a tap and reused
export function unlockAudio() {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  audio ??= new Context();
  void audio.resume().catch(() => {});
}

export function beep(frequency = 880, ms = 150, volume = 0.15) {
  if (!audio) unlockAudio();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.value = volume;
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + ms / 1000);
}
