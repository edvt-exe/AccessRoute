"use client";

import { useRef, useState } from "react";
import type { Spot } from "@/core/map";
import { beep, canListen, listenOnce, speak, stopSpeaking, unlockAudio } from "@/core/speech/speech";
import { LiveRegion } from "@/core/ui";
import { readGuestName, saveGuestName, saveStepProfile, stepFactor, stepLengthFromHeight, useStepProfile } from "@/core/device/store";
import { requestMotionPermission } from "@/core/sensors/heading";
import { watchSteps } from "@/core/sensors/steps";
import { matchPlace } from "../lib/match";

type TutorialProps = {
  places: Spot[];
  onDone: () => void;
};

type Step = "welcome" | "naming" | "confirm" | "top" | "bottom" | "trip" | "stop" | "practice" | "listening" | "calibrate" | "height" | "counting" | "done";

const huge = "flex w-full min-h-0 items-center justify-center rounded-3xl border-4 p-4 text-center font-black leading-tight";

const intro =
  "Hello! I am your AI guide. I will help you find your way around your company's building, one step at a time, and tell you what is around you. Before the tutorial, let's get to know each other.";

const lines = {
  welcome: "Welcome to AccessRoute. This short tutorial shows you the buttons. Tap anywhere on the screen to begin.",
  top:
    "The main screen has two big buttons. The top half of the screen is for starting a trip: it asks where you want to go. Tap the top half now.",
  bottom:
    "The bottom half of the screen asks your colleagues to record a map of a room that has no map yet. Tap the bottom half now.",
  trip:
    "During a trip the screen changes. Tapping the top half tells you where you are. The bottom half has two buttons side by side: Repeat on the left and Stop on the right. Tap Repeat now.",
  stop: "Now tap Stop, at the bottom right.",
  practice: "Let's practise. Tap the top half. After the tone, say the name of a place.",
  calibrate:
    "One more thing: let's measure your steps, so that distances fit you. Do this only with about five metres of free space in front of you. To measure, tap the top half. To skip, tap the bottom half; you can do it later by saying help.",
  done:
    "That is all. After the tone you can also ask things like: where can I get coffee, what is in front of me, or start my tour. To hear this tutorial again, say help. Tap anywhere to start using AccessRoute.",
};

// the same buttons in the same places as the real screens, so the hands learn where they are
export function Tutorial({ places, onDone }: TutorialProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [status, setStatus] = useState(lines.welcome);
  const last = useRef(lines.welcome);
  const run = useRef(0);
  const tries = useRef(0);
  const profile = useStepProfile();
  const counted = useRef(0);
  const pending = useRef(profile.length);
  const stopCounting = useRef<(() => void) | null>(null);
  const [heardName, setHeardName] = useState("");
  const nameTries = useRef(0);

  async function say(text: string) {
    const id = ++run.current;
    setStatus(text);
    last.current = text;
    await speak(text);
    return id === run.current;
  }

  async function go(next: Step, praise = "") {
    setStep(next);
    await say([praise, lines[next as keyof typeof lines]].filter(Boolean).join(" "));
  }

  // first who the guide is, then the person's name, then the buttons
  async function begin() {
    unlockAudio();
    setStep("naming");
    const known = readGuestName();
    if (known) {
      if (!(await say(`${intro.replace(" Before the tutorial, let's get to know each other.", "")} Welcome back, ${known}.`))) return;
      await go("top");
      return;
    }
    if (!(await say(intro))) return;
    await askName();
  }

  async function askName() {
    if (!canListen()) {
      await go("top", "Voice input is not available in this browser, so let's go straight to the tutorial.");
      return;
    }
    setStep("naming");
    if (!(await say("After the tone, please say your name."))) return;
    beep();
    const heard = await listenOnce();
    const name = heard.ok ? nameFrom(heard.text) : "";
    if (!name) {
      if ((!heard.ok && heard.reason === "denied") || ++nameTries.current >= 3) {
        await go("top", "No problem, let's continue with the tutorial.");
        return;
      }
      await askName();
      return;
    }
    setHeardName(name);
    setStep("confirm");
    await say(`Is your name ${name}? If yes, tap the top half of the screen. If not, tap the bottom half and say it again.`);
  }

  function confirmName() {
    saveGuestName(heardName);
    void go("top", `Nice to meet you, ${heardName}.`);
  }

  async function practise() {
    if (!canListen()) {
      await go("calibrate", "Voice input is not available in this browser, you can type the place instead.");
      return;
    }
    setStep("listening");
    if (!(await say("After the tone, say the name of a place."))) return;
    beep();
    const heard = await listenOnce();
    if (!heard.ok) {
      // there is no skip button, so the practice never blocks the end of the tutorial
      if (heard.reason === "denied" || ++tries.current >= 2) {
        await go("calibrate", heard.reason === "denied" ? "I cannot use the microphone, allow it for this site later." : "No problem, we will practise on a real trip.");
        return;
      }
      setStep("practice");
      await say("I did not hear anything. Tap the top half and try again.");
      return;
    }
    const match = matchPlace(heard.text, places);
    const answer = match
      ? `I heard ${match.place.name}. On a real trip I would now guide you there, one instruction at a time. Well done.`
      : `I heard "${heard.text}". That place is not on the map yet, but you did it right. Well done.`;
    await go("calibrate", answer);
  }

  // the height gives the length of a step, ten steps tell how well this phone counts them
  async function measure() {
    void requestMotionPermission();
    let length = profile.length;
    if (canListen()) {
      setStep("height");
      if (!(await say("After the tone, say your height in centimetres, for example one hundred and seventy."))) return;
      beep();
      const heard = await listenOnce();
      const cm = heard.ok ? heightFrom(heard.text) : null;
      if (cm) length = stepLengthFromHeight(cm);
      if (!(await say(cm ? `${cm} centimetres, thank you.` : "I did not get the height, I will use an average step."))) return;
    }
    counted.current = 0;
    stopCounting.current?.();
    stopCounting.current = watchSteps(() => counted.current++);
    pending.current = length;
    setStep("counting");
    await say("Now walk ten normal steps straight ahead, holding the phone upright. Then stop and tap the top half.");
  }

  async function measured() {
    stopCounting.current?.();
    stopCounting.current = null;
    const factor = stepFactor(10, counted.current);
    if (factor === null) {
      await go("done", "I could not count your steps. Hold the phone upright at chest height next time. An average step is used for now.");
      return;
    }
    saveStepProfile({ length: pending.current, factor, calibrated: true });
    await go("done", "Thank you, your steps are measured.");
  }

  function finish() {
    run.current++;
    stopCounting.current?.();
    stopSpeaking();
    onDone();
  }

  function hint(text: string) {
    void say(text);
  }

  // laid out exactly like the real screens: top half, bottom half, nothing else to find
  return (
    <div
      className="fixed inset-0 z-10 flex touch-manipulation flex-col gap-3 overscroll-none bg-bg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
      data-tutorial={step}
    >
      <LiveRegion message={status} />

      {step === "naming" && (
        <button type="button" onClick={() => void speak(last.current)} className={`${huge} flex-1 border-primary bg-primary text-4xl text-primary-fg`}>
          Say your name after the tone
        </button>
      )}

      {step === "confirm" && (
        <>
          <button type="button" onClick={confirmName} className={`${huge} flex-1 border-primary bg-primary text-4xl text-primary-fg`}>
            Yes, my name is {heardName}
          </button>
          <button type="button" onClick={() => void askName()} className={`${huge} flex-1 border-fg bg-bg text-3xl`}>
            No, say it again
          </button>
        </>
      )}

      {(step === "welcome" || step === "done") && (
        <button type="button" onClick={step === "welcome" ? () => void begin() : finish} className={`${huge} flex-1 border-primary bg-primary text-4xl text-primary-fg`}>
          {step === "welcome" ? "Tap anywhere to begin" : "Start using AccessRoute"}
        </button>
      )}

      {(step === "calibrate" || step === "height" || step === "counting") && (
        <>
          <button
            type="button"
            onClick={step === "calibrate" ? () => void measure() : step === "counting" ? () => void measured() : undefined}
            className={`${huge} flex-1 border-primary bg-primary text-4xl text-primary-fg`}
          >
            {step === "counting" ? "Tap when you have walked 10 steps" : "Measure my steps"}
          </button>
          <button
            type="button"
            onClick={() => {
              stopCounting.current?.();
              void go("done", "Skipped.");
            }}
            className={`${huge} flex-1 border-fg bg-bg text-3xl`}
          >
            Skip
          </button>
        </>
      )}

      {(step === "top" || step === "bottom" || step === "practice" || step === "listening") && (
        <>
          <button
            type="button"
            onClick={
              step === "top"
                ? () => void go("bottom", "Well done. That is the button for starting a trip.")
                : step === "practice"
                  ? () => void practise()
                  : step === "bottom"
                    ? () => hint("That was the top half. Tap the bottom half.")
                    : undefined
            }
            className={`${huge} flex-1 border-primary bg-primary text-4xl text-primary-fg`}
          >
            Where do you want to go?
          </button>
          <button
            type="button"
            onClick={
              step === "bottom"
                ? () => void go("trip", "Well done. That is the button for asking for a new map.")
                : step === "top"
                  ? () => hint("That was the bottom half. Tap the top half.")
                  : step === "practice"
                    ? () => hint("For the practice, tap the top half.")
                    : undefined
            }
            className={`${huge} flex-1 border-fg bg-bg text-3xl`}
          >
            Ask for a map to be recorded
          </button>
        </>
      )}

      {(step === "trip" || step === "stop") && (
        <>
          <div className="flex min-h-0 flex-1">
            <button
              type="button"
              onClick={() => hint("That is the top half. On a trip, tapping it tells you where you are. Now try the bottom half.")}
              className={`${huge} flex-1 border-primary text-3xl`}
            >
              Tap to check where you are
            </button>
          </div>
          <div className="flex min-h-0 flex-1 gap-3">
            <button
              type="button"
              onClick={step === "trip" ? () => void go("stop", "Well done. Repeat says the last instruction again.") : () => void speak(last.current)}
              className={`${huge} flex-1 border-fg text-3xl`}
            >
              Repeat
            </button>
            <button
              type="button"
              onClick={
                step === "stop" ? () => void go("practice", "Well done. Stop ends the trip at any moment.") : () => hint("That was Stop, on the right. Repeat is on the left. Tap Repeat.")
              }
              className={`${huge} flex-1 border-danger bg-danger text-3xl text-danger-fg`}
            >
              Stop
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// "172", "1.72 metres", "one hundred seventy two" are all heard as digits by the browsers that listen
export function heightFrom(text: string) {
  const number = /(\d+(?:[.,]\d+)?)/.exec(text.replace(/\s+(?=\d)/g, ""));
  if (!number) return null;
  const value = Number(number[1].replace(",", "."));
  const cm = value < 3 ? Math.round(value * 100) : Math.round(value);
  return cm >= 120 && cm <= 220 ? cm : null;
}

// "my name is ana maria" becomes "Ana Maria"
export function nameFrom(text: string) {
  const name = text
    .trim()
    .replace(/[.!?,]+$/g, "")
    .replace(/^(hi|hello|hey)[,\s]+/i, "")
    .replace(/^(my name is|my name's|i am|i'm|it is|it's|this is|call me|name is)\s+/i, "")
    .split(/\s+/)
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return name.length >= 2 && name.length <= 40 ? name : "";
}
