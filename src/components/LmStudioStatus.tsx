import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface LmStudioStatusProps {
  refreshKey?: number;
}

export function LmStudioStatus({ refreshKey = 0 }: LmStudioStatusProps) {
  const [label, setLabel] = useState("Checking LM Studio...");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLabel("Checking LM Studio...");

    void api.getLmStudioHealth().then((health) => {
      if (cancelled) return;
      setOk(health.ok);
      if (health.ok) {
        const model = health.settings.chat_model || "no chat model selected";
        setLabel(`LM Studio online · ${model}`);
      } else {
        setLabel(health.error ?? "LM Studio offline");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
        ok
          ? "border-accent-500/30 bg-accent-500/10 text-accent-300"
          : "border-danger-500/30 bg-danger-500/10 text-danger-500"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${ok ? "bg-accent-500" : "bg-danger-500"}`}
      />
      {label}
    </div>
  );
}
