"use client";

import { useEffect, useRef, useState } from "react";
import { saveStepProfile, stepFactor, stepLengthFromHeight, useStepProfile } from "@/core/device/store";
import { requestMotionPermission } from "@/core/sensors/heading";
import { watchSteps } from "@/core/sensors/steps";
import { Button } from "./Button";

const field = "min-h-12 rounded-lg border-2 border-fg bg-bg px-3 text-lg";

// height gives the length of a step; walking ten steps tells how well this phone counts them
export function StepCalibration() {
  const profile = useStepProfile();
  const [height, setHeight] = useState("");
  const [counting, setCounting] = useState(false);
  const [counted, setCounted] = useState(0);
  const [message, setMessage] = useState("");
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  function saveHeight() {
    const cm = Number(height);
    if (!(cm >= 120 && cm <= 220)) {
      setMessage("Type your height in centimetres, for example 172.");
      return;
    }
    saveStepProfile({ ...profile, length: stepLengthFromHeight(cm), calibrated: true });
    setMessage(`Your step is about ${stepLengthFromHeight(cm).toFixed(2)} m.`);
  }

  async function start() {
    await requestMotionPermission();
    setCounted(0);
    setCounting(true);
    setMessage("Walk exactly 10 normal steps straight ahead, holding the phone upright. Then press Done.");
    stop.current = watchSteps(() => setCounted((n) => n + 1));
  }

  function done() {
    stop.current?.();
    stop.current = null;
    setCounting(false);
    const factor = stepFactor(10, counted);
    if (factor === null) {
      setMessage("No steps were counted. Hold the phone upright at chest height and try again.");
      return;
    }
    saveStepProfile({ ...profile, factor, calibrated: true });
    setMessage(counted === 10 ? "The phone counted exactly 10 steps." : `The phone counted ${counted} for 10 steps, this is corrected from now on.`);
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-border p-4">
      <legend className="px-1 text-lg font-bold">Your steps</legend>
      <p className="text-muted">
        {profile.calibrated ? `Step ${profile.length.toFixed(2)} m, counting ×${profile.factor.toFixed(2)}.` : "Not calibrated yet: a step of 0.70 m is assumed."}
      </p>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-semibold">Height (cm)</span>
          <input value={height} inputMode="numeric" onChange={(e) => setHeight(e.target.value)} className={field} />
        </label>
        <Button variant="secondary" onClick={saveHeight} className="self-end">
          Save
        </Button>
      </div>
      {counting ? (
        <Button onClick={done} className="min-h-16 text-xl">
          Done, I walked 10 steps ({counted} counted)
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => void start()}>
          Count 10 steps
        </Button>
      )}
      {message && (
        <p role="status" className="text-lg">
          {message}
        </p>
      )}
    </fieldset>
  );
}
