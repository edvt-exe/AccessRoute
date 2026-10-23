import { z } from "zod";

// what the person did while the sensors were recorded. standing still must give no steps at all
export const traceScenarios = {
  still: { label: "Standing still, phone in the hand", walking: false },
  typing: { label: "Standing, typing on the phone", walking: false },
  turning: { label: "Turning on the spot", walking: false },
  looking: { label: "Standing, pointing the phone around the room", walking: false },
  "slow-walk": { label: "Walking slowly and carefully", walking: true },
  walk: { label: "Walking normally", walking: true },
  other: { label: "Something else", walking: true },
} as const;

export type TraceScenario = keyof typeof traceScenarios;

export const maxTraceSamples = 20_000; // about 3 minutes at 100 Hz

const reading = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);

export const traceSchema = z.object({
  version: z.literal(1),
  scenario: z.enum(Object.keys(traceScenarios) as [TraceScenario, ...TraceScenario[]]),
  note: z.string().trim().max(120),
  expectedSteps: z.number().int().min(0).max(2000),
  device: z.string().max(300),
  recordedAt: z.string().max(40),
  samples: z.array(reading).min(10).max(maxTraceSamples), // RawMotion, time from the start of the recording
});

export type SensorTrace = z.infer<typeof traceSchema>;
