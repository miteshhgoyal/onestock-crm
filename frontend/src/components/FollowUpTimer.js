import { useEffect, useState } from "react";

const pad = (n) => String(n).padStart(2, "0");

/** Live countdown to the next follow-up; counts up in red once it is overdue. */
export const FollowUpTimer = ({ value, testId }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!value) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [value]);

  if (!value) return <span className="text-muted-foreground">—</span>;

  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return <span className="text-muted-foreground">—</span>;

  const diff = target - now;
  const overdue = diff < 0;
  const total = Math.floor(Math.abs(diff) / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const clock = days > 0
    ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  const urgent = !overdue && diff < 60 * 60 * 1000;
  const tone = overdue ? "text-red-400" : urgent ? "text-amber-400" : "text-emerald-400";

  return (
    <span className="mono inline-flex items-center gap-1.5 whitespace-nowrap" data-testid={testId}>
      <span className={`h-1.5 w-1.5 rounded-full ${overdue ? "bg-red-400 animate-pulse" : urgent ? "bg-amber-400" : "bg-emerald-400"}`} />
      <span className={tone}>{overdue ? `${clock} late` : clock}</span>
    </span>
  );
};

export default FollowUpTimer;
