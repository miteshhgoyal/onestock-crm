import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PhoneCall, RefreshCw } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { formatTeamDateTime } from "@/lib/constants";

const STATUS = {
  on_call: { label: "On Call", ring: "border-blue-500/50", dot: "bg-blue-400 animate-pulse", text: "text-blue-400" },
  online: { label: "Online", ring: "border-emerald-500/50", dot: "bg-emerald-400", text: "text-emerald-400" },
  idle: { label: "Idle", ring: "border-amber-500/50", dot: "bg-amber-400", text: "text-amber-400" },
  offline: { label: "Offline", ring: "border-border/60", dot: "bg-zinc-500", text: "text-muted-foreground" },
};
const ORDER = ["on_call", "online", "idle", "offline"];

const fmtDur = (s) => {
  if (s === null || s === undefined) return "—";
  const sec = Number(s);
  if (Number.isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
};

export default function LiveStatusBoard() {
  const [rows, setRows] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/reports/live-status");
      setRows(data.telecallers || []);
      setUpdatedAt(data.server_time);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  const counts = ORDER.reduce((acc, s) => ({ ...acc, [s]: rows.filter((r) => r.status === s).length }), {});

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="live-status-board-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">Real-time · auto-refresh 15s</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tighter">Live Status Board</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Who's online, on a call or idle right now. Last updated {updatedAt ? formatTeamDateTime(updatedAt) : "—"}.
          </p>
        </div>
        <button data-testid="refresh-live-board" onClick={load} className="flex items-center gap-2 border border-border/70 px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <RefreshCw size={14} /> Refresh now
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-px bg-border/40 lg:grid-cols-4">
        {ORDER.map((s) => (
          <div key={s} className="metric-tile border border-border/60 p-5" data-testid={`live-count-${s}`}>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              <div className="overline">{STATUS[s].label}</div>
            </div>
            <div className="display mt-3 text-3xl font-black tracking-tighter">{counts[s] || 0}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="live-cards">
        {rows.map((r) => {
          const st = STATUS[r.status] || STATUS.offline;
          return (
            <div key={r.id} data-testid={`live-card-${r.id}`} className={`crm-card border-l-4 p-5 ${st.ring}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${st.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {st.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-2xl font-bold">{r.calls_today}</div>
                  <div className="overline text-[10px]">calls today</div>
                </div>
              </div>
              <div className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Connected today</span>
                  <span className="mono text-emerald-400">{r.connected_today}</span>
                </div>
                {r.online_since && (
                  <div className="mt-1 flex items-center justify-between">
                    <span>Online since</span>
                    <span className="mono">{formatTeamDateTime(r.online_since)}</span>
                  </div>
                )}
                {r.last_call && (
                  <div className="mt-2 flex items-start gap-1.5">
                    <PhoneCall size={12} className="mt-0.5 shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{r.last_call.contact_name}</span>
                      <span>{fmtDur(r.last_call.duration)} · {r.last_call.time ? formatTeamDateTime(r.last_call.time) : "—"}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className="col-span-full py-14 text-center text-sm text-muted-foreground" data-testid="live-empty">
            No telecallers to show.
          </div>
        )}
      </div>
    </div>
  );
}
