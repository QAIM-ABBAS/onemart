import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";

import { ClockIcon } from "./Icon";

function remaining(endsAt: string, now: number): number {
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now);
}

function parts(ms: number) {
  const total = Math.floor(ms / 1000);
  return {
    hours: String(Math.floor(total / 3600)).padStart(2, "0"),
    minutes: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    seconds: String(total % 60).padStart(2, "0"),
  };
}

export function CountdownPill({
  endsAt,
  onExpire,
  className,
}: {
  endsAt: string;
  onExpire?: () => void;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const left = remaining(endsAt, now);
  const { hours, minutes, seconds } = parts(left);

  useEffect(() => {
    if (left === 0) onExpire?.();
  }, [left, onExpire]);

  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 bg-sale px-3 text-paper",
        className,
      )}
      aria-live="off"
      title="Offer ends soon"
    >
      <ClockIcon width={14} height={14} />
      <span className="text-[0.6875rem] tracking-[0.06em]">
        {left > 0 ? "Expires in" : "Expired"}
      </span>
      <span className="num text-[0.8125rem] font-semibold tracking-[0.08em]">
        {hours} : {minutes} : {seconds}
      </span>
    </span>
  );
}
