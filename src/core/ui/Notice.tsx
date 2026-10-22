import type { ReactNode } from "react";

const tones = {
  info: "border-primary bg-card",
  warn: "border-warn-fg bg-warn-bg text-warn-fg",
  error: "border-danger bg-card",
};

export function Notice({ tone = "info", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <div className={`rounded-xl border-l-8 p-4 text-lg ${tones[tone]}`} role={tone === "error" ? "alert" : undefined}>
      {children}
    </div>
  );
}
