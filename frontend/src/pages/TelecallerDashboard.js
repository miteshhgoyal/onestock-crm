import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Inbox, PhoneCall, RefreshCw, Timer, TrendingUp } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { STATUS_META } from "@/lib/constants";
import PanelSurface from "@/components/PanelSurface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConvertedClubLeads from "@/components/ConvertedClubLeads";

const Kpi = ({ label, value, icon: Icon, tone = "", onClick, testId }) => (
  <button
    data-testid={testId}
    onClick={onClick}
    className="metric-tile group flex h-full min-h-[132px] w-full flex-col border border-border/60 p-5 text-left"
  >
    <div className="flex min-h-10 w-full items-start justify-between gap-3">
      <div className="overline flex-1">{label}</div>
      <Icon size={15} className={`shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground ${tone}`} />
    </div>
    <div className="display mt-auto pt-3 text-4xl font-black tracking-tighter">{value}</div>
  </button>
);

export default function TelecallerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [work, setWork] = useState(null);
  const [period, setPeriod] = useState("today");
  const [range, setRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    try {
      const params = { period };
      if (period === "custom") {
        if (range.from) params.from_date = range.from;
        if (range.to) params.to_date = range.to;
      }
      const [dashboard, myPerf] = await Promise.all([
        api.get("/reports/dashboard"),
        api.get("/reports/my-performance", { params }),
      ]);
      setData(dashboard.data);
      setWork(myPerf.data);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [period, range]);

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const totals = data?.totals || {};
  const stages = (data?.by_status || []).sort((a, b) => b.count - a.count);
  const periodLabel = period === "custom" ? "selected range" : period;

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="telecaller-dashboard-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">Call desk</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tighter sm:text-5xl">Your day, {user?.name?.split(" ")[0]}</h1>
          <p className="mt-3 text-sm text-muted-foreground">Keep every assigned call moving to its next action.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" data-testid="refresh-telecaller-dashboard-button" onClick={load} className="rounded-none border-border/70">
            <RefreshCw size={14} className="mr-2" /> Refresh
          </Button>
          <Button data-testid="open-call-workspace-button" onClick={() => navigate("/workspace")} className="rounded-none bg-brand text-brand-foreground hover:bg-brand/90">
            <PhoneCall size={14} className="mr-2" /> Open call desk
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3" data-testid="dashboard-date-filter">
        <div className="flex border border-border/70 p-1">
          {[['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['custom', 'Range']].map(([value, label]) => (
            <button key={value} type="button" data-testid={`dashboard-period-${value}`} onClick={() => setPeriod(value)} className={`px-4 py-2 text-xs font-semibold ${period === value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        {period === "custom" && <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Dashboard start date" data-testid="dashboard-date-from" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="h-9 w-40 rounded-none" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="Dashboard end date" data-testid="dashboard-date-to" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="h-9 w-40 rounded-none" />
        </div>}
      </div>

      <section className="mt-7" aria-labelledby="telecaller-worklog-heading">
        <div className="mb-3 flex items-end justify-between"><div><div className="overline">Activity</div><h2 id="telecaller-worklog-heading" className="mt-1 text-lg font-bold">Call work summary</h2></div><span className="text-xs text-muted-foreground">{periodLabel}</span></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="telecaller-worklog">
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">First login ({periodLabel})</div><Clock3 size={14} className="text-[#71d9ee]" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-login-time">{work?.login_time ? new Date(work.login_time).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—"}</div></PanelSurface>
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">Logged-in hours</div><Timer size={14} className="text-[#71d9ee]" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-hours">{work?.logged_in_hours ?? 0}h</div></PanelSurface>
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">Calls dialed</div><PhoneCall size={14} className="text-brand" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-calls">{work?.calls_dialed ?? 0}</div></PanelSurface>
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">Connected</div><CheckCircle2 size={14} className="text-emerald-500" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-connected">{work?.connected_calls ?? 0}</div></PanelSurface>
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">Not connected</div><PhoneCall size={14} className="text-orange-400" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-not-connected">{work?.not_connected_calls ?? 0}</div></PanelSurface>
        <PanelSurface className="metric-tile border border-border/60 p-5"><div className="flex items-center justify-between"><div className="overline">Talk time ({periodLabel})</div><Clock3 size={14} className="text-emerald-400" /></div><div className="mono mt-3 text-lg font-bold" data-testid="worklog-talk">{`${Math.floor((work?.total_talk_time || 0) / 3600)}h ${Math.floor(((work?.total_talk_time || 0) % 3600) / 60)}m`}</div></PanelSurface>
      </div>
      </section>

      <section className="mt-7" aria-labelledby="telecaller-queue-heading">
        <div className="mb-3 flex items-end justify-between"><div><div className="overline">Overview</div><h2 id="telecaller-queue-heading" className="mt-1 text-lg font-bold">My lead queue</h2></div><span className="text-xs text-muted-foreground">Current assignments</span></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <PanelSurface className="h-full"><Kpi label="My assigned calls" value={totals.total ?? "—"} icon={Inbox} testId="telecaller-kpi-total" onClick={() => navigate("/workspace")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Due today" value={totals.due_today ?? "—"} icon={CalendarClock} testId="telecaller-kpi-due-today" onClick={() => navigate("/workspace")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Overdue" value={totals.overdue ?? "—"} icon={AlertTriangle} tone="text-yellow-500" testId="telecaller-kpi-overdue" onClick={() => navigate("/workspace")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Converted" value={totals.converted ?? "—"} icon={CheckCircle2} tone="text-emerald-500" testId="telecaller-kpi-converted" onClick={() => navigate("/workspace")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Calls dialed (${periodLabel})`} value={work?.calls_dialed ?? "—"} icon={PhoneCall} tone="text-brand" testId="telecaller-kpi-calls-period" onClick={() => navigate("/activities?type=call")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Revenue (${periodLabel})`} value={`₹${Number(work?.approved_revenue || 0).toLocaleString("en-IN")}`} icon={TrendingUp} tone="text-emerald-500" testId="telecaller-kpi-revenue-period" /></PanelSurface>
      </div>
      </section>

      <section className="mt-7" aria-labelledby="telecaller-club-heading">
        <div className="mb-3 flex items-end justify-between"><div><div className="overline">50 Cr Club</div><h2 id="telecaller-club-heading" className="mt-1 text-lg font-bold">Converted clients</h2></div></div>
        <ConvertedClubLeads title="My converted clients" />
      </section>

      <section className="mt-7" aria-labelledby="telecaller-pipeline-heading">
        <div className="mb-3 flex items-end justify-between"><div><div className="overline">Performance</div><h2 id="telecaller-pipeline-heading" className="mt-1 text-lg font-bold">Conversion and pipeline</h2></div></div>
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <PanelSurface className="crm-card p-5" data-testid="telecaller-conversion-rate">
          <div className="overline">Conversion rate</div>
          <div className="mt-3 flex items-end gap-3">
            <div className="display text-5xl font-black tracking-tighter">{totals.conversion_rate ?? 0}%</div>
            <TrendingUp size={18} className="mb-2 text-brand" />
          </div>
          <div className="mt-6 h-1.5 bg-white/10">
            <div className="h-full bg-brand" style={{ width: `${Math.min(Number(totals.conversion_rate || 0), 100)}%` }} />
          </div>
          <button onClick={() => navigate("/workspace")} className="mt-6 text-xs text-muted-foreground hover:text-foreground">
            Continue calling <span aria-hidden="true">-&gt;</span>
          </button>
        </PanelSurface>

        <PanelSurface className="crm-card p-5" data-testid="telecaller-stage-summary">
          <div className="overline">Lead stages</div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stages.map((stage) => (
              <button key={stage.status} onClick={() => navigate("/workspace")} className="min-h-[92px] border border-border/60 p-3 text-left hover:border-brand/60 hover:bg-secondary/50">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-1 h-2 w-2 shrink-0" style={{ background: STATUS_META[stage.status]?.hex || "#71717a" }} />
                  <span>{STATUS_META[stage.status]?.label || stage.status}</span>
                </div>
                <div className="mono mt-1 text-xl font-semibold">{stage.count}</div>
              </button>
            ))}
            {!stages.length && <div className="col-span-full py-6 text-center text-sm text-muted-foreground">No leads assigned yet.</div>}
          </div>
        </PanelSurface>
        </div>
      </section>
    </div>
  );
}