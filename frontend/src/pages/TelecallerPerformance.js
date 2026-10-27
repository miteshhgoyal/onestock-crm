import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Clock3,
  Download,
  PhoneCall,
  PhoneForwarded,
  RefreshCw,
  Settings2,
  Target,
  Timer,
  Trophy,
  Users,
  X,
} from "lucide-react";
import HorizontalScrollArea from "@/components/HorizontalScrollArea";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { formatTeamDateTime } from "@/lib/constants";
import { useAuth } from "@/context/AuthContext";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "Custom" },
];

const STATUS_TONE = {
  online: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  on_call: "bg-blue-500/15 text-blue-400 border-blue-500/40",
  idle: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  offline: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40",
};
const STATUS_LABEL = { online: "Online", on_call: "On Call", idle: "Idle", offline: "Offline" };
const STATUS_DOT = {
  online: "bg-emerald-400",
  on_call: "bg-blue-400 animate-pulse",
  idle: "bg-amber-400",
  offline: "bg-zinc-500",
};
const SCORE_COLORS = ["#247e9d", "#ef8d5c", "#19a974", "#d9a441", "#6b8e80", "#c75c5c", "#5b8fc5", "#8b9d48"];
const EFFICIENCY_FACTORS = [
  ["login_punctuality", "Login punctuality"], ["total_login_hours", "Total login hours"],
  ["logout_compliance", "Logout compliance"], ["calls_dialed", "Calls dialed"],
  ["connected_calls", "Connected calls"], ["connection_rate", "Call connection rate"],
  ["lead_conversion_rate", "Lead conversion rate"], ["interested_leads", "Interested leads"],
  ["follow_up_completion", "Follow-up completion"], ["lead_handling_efficiency", "Lead handling efficiency"],
  ["average_call_duration", "Average call duration"], ["break_compliance", "Break time compliance"],
  ["target_achievement", "Target achievement"], ["crm_data_accuracy", "CRM data accuracy"],
  ["productive_time", "Productive time"],
];

const money = (v) => Number(v || 0).toLocaleString("en-IN");
const fmtTime = (v) => (v ? formatTeamDateTime(v) : "—");
const fmtDuration = (s) => {
  if (s === null || s === undefined) return "—";
  const sec = Number(s);
  if (Number.isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const rem = sec % 60;
  return m ? `${m}m ${rem}s` : `${rem}s`;
};

const StatusBadge = ({ status }) => (
  <span
    data-testid={`status-badge-${status}`}
    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] || STATUS_TONE.offline}`}
  >
    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] || STATUS_DOT.offline}`} />
    {STATUS_LABEL[status] || "Offline"}
  </span>
);

const ChartCard = ({ title, dataKey, color, data }) => (
  <div className="crm-card bg-white p-5 text-black" data-testid={`chart-${dataKey}`}>
    <div className="overline mb-4">{title}</div>
    <div className="h-[220px] w-full bg-white">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} interval={0} angle={-20} dy={10} height={46} />
          <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} contentStyle={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }} />
          <Bar dataKey={dataKey} radius={[3, 3, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default function TelecallerPerformance({ efficiencyReport = false }) {
  const { user } = useAuth();
  const [period, setPeriod] = useState("today");
  const [range, setRange] = useState({ from: "", to: "" });
  const [telecallerId, setTelecallerId] = useState("");
  const [callers, setCallers] = useState([]);
  const [rows, setRows] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [draftSettings, setDraftSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const params = useMemo(() => {
    const p = { period };
    if (period === "custom") {
      if (range.from) p.from_date = range.from;
      if (range.to) p.to_date = range.to;
    }
    if (telecallerId) p.telecaller_id = telecallerId;
    return p;
  }, [period, range, telecallerId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [perf, tr] = await Promise.all([
        api.get("/reports/telecaller-performance", { params }),
        api.get("/reports/telecaller-performance/trend", { params }),
      ]);
      setRows(perf.data.telecallers || []);
      setTrend(tr.data.series || []);
      setSettings(perf.data.settings || null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    api.get("/users", { params: { role: "telecaller" } })
      .then(({ data }) => setCallers(data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const openTimeline = async (row) => {
    try {
      const { data } = await api.get(`/reports/telecaller-performance/${row.id}/timeline`, { params });
      setTimeline(data);
      setTimelineOpen(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const downloadCsv = async (url, filename) => {
    try {
      const { data } = await api.get(url, { params, responseType: "blob" });
      const href = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const chartData = rows.map((r) => ({
    name: (r.name || "").split(" ")[0] || r.name,
    calls_dialed: r.calls_dialed,
    connected_calls: r.connected_calls,
    not_connected_calls: r.not_connected_calls,
    total_actions: r.total_actions,
    conversions: r.conversions,
    logged_in_hours: r.logged_in_hours,
  }));
  const rankedRows = [...rows].sort((a, b) => {
    if (a.efficiency_score === null || a.efficiency_score === undefined) return 1;
    if (b.efficiency_score === null || b.efficiency_score === undefined) return -1;
    return b.efficiency_score - a.efficiency_score;
  });
  const scorableRows = rankedRows.filter((row) => row.efficiency_score !== null && row.efficiency_score !== undefined);
  const averageEfficiency = scorableRows.length
    ? scorableRows.reduce((sum, row) => sum + row.efficiency_score, 0) / scorableRows.length
    : null;
  const scoreTone = (score) => {
    if (score === null || score === undefined) return "border-zinc-400/30 text-zinc-400";
    if (score >= Number(settings?.thresholds?.green ?? 85)) return "border-emerald-500/40 text-emerald-400";
    if (score >= Number(settings?.thresholds?.yellow ?? 70)) return "border-amber-500/40 text-amber-400";
    return "border-red-500/40 text-red-400";
  };
  const factorList = rows[0]?.efficiency_factors || [];
  const factorChartData = factorList.map((factor) => {
    const point = { name: factor.label.replace(" rate", "").replace(" efficiency", "") };
    rows.forEach((row) => {
      const result = row.efficiency_factors?.find((item) => item.key === factor.key);
      point[row.id] = result?.achievement;
    });
    return point;
  });

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const { data } = await api.put("/reports/telecaller-performance/settings", draftSettings);
      setSettings(data);
      setDraftSettings(data);
      setSettingsOpen(false);
      toast.success("Efficiency settings saved");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const totals = rows.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls_dialed,
      connected: acc.connected + r.connected_calls,
      notConnected: acc.notConnected + r.not_connected_calls,
      actions: acc.actions + r.total_actions,
      conversions: acc.conversions + r.conversions,
      hours: acc.hours + r.logged_in_hours,
    }),
    { calls: 0, connected: 0, notConnected: 0, actions: 0, conversions: 0, hours: 0 },
  );

  return (
    <div className="px-6 py-8 lg:px-12" data-testid={efficiencyReport ? "telecaller-efficiency-page" : "telecaller-performance-page"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">{efficiencyReport ? "Admin analytics · IST" : "Team performance · IST"}</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tighter">{efficiencyReport ? "CRM Efficiency Report" : "Telecaller Performance"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{efficiencyReport ? "Weighted caller scores, factor targets, and team ranking from recorded CRM activity." : "Live status, calls, connections and conversions from real CRM activity."}</p>
        </div>
        <div className="flex gap-2">
          {user?.role === "admin" && (
            <Button variant="outline" data-testid="efficiency-settings-button" disabled={!settings} onClick={() => { setDraftSettings(settings); setSettingsOpen(true); }} className="rounded-none border-border/70">
              <Settings2 size={14} className="mr-2" /> Scoring settings
            </Button>
          )}
          <Button variant="outline" data-testid="export-performance-button" onClick={() => downloadCsv("/reports/telecaller-performance/export", "telecaller-performance.csv")} className="rounded-none border-border/70">
            <Download size={14} className="mr-2" /> Export CSV
          </Button>
          <Button variant="outline" data-testid="refresh-performance-button" onClick={load} disabled={loading} className="rounded-none border-border/70">
            <RefreshCw size={14} className={`mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-3" data-testid="performance-filters">
        <div className="flex border border-border/70 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              data-testid={`period-${p.value}`}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 text-xs font-semibold ${period === p.value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" data-testid="custom-from" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-9 w-40 rounded-none" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" data-testid="custom-to" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-9 w-40 rounded-none" />
          </div>
        )}
        <select
          data-testid="telecaller-filter"
          value={telecallerId}
          onChange={(e) => setTelecallerId(e.target.value)}
          className="h-9 border border-border/70 bg-background px-3 text-xs"
        >
          <option value="">All telecallers</option>
          {callers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <section className="mt-6 border border-border/60" data-testid="efficiency-overview">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div>
            <div className="overline">Weighted team efficiency</div>
            <div className="mt-1 text-xs text-muted-foreground">Only measurable factors contribute; unavailable CRM data is excluded and shown as N/A.</div>
          </div>
          <div className="flex items-end gap-7">
            <div className="text-right">
              <div className="overline">Team average</div>
              <div className={`display mt-1 text-3xl font-black ${scoreTone(averageEfficiency)}`} data-testid="team-average-efficiency">
                {averageEfficiency === null ? "N/A" : `${averageEfficiency.toFixed(1)}%`}
              </div>
            </div>
            <div className="text-right">
              <div className="overline">Ranked callers</div>
              <div className="mono mt-1 text-2xl font-bold">{scorableRows.length}<span className="text-muted-foreground"> / {rows.length}</span></div>
            </div>
          </div>
        </div>
        <div className="grid gap-px bg-border/40 sm:grid-cols-2 xl:grid-cols-3">
          {rankedRows.map((row, index) => (
            <article key={row.id} className="bg-background p-5" data-testid={`efficiency-card-${row.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-border/60 text-brand">
                    {index === 0 && row.efficiency_score !== null && row.efficiency_score !== undefined ? <Trophy size={16} /> : <span className="mono text-xs font-bold">{row.efficiency_score === null || row.efficiency_score === undefined ? "--" : String(index + 1).padStart(2, "0")}</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{row.name}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{row.efficiency_valid_weight}% of factor weight measured</div>
                  </div>
                </div>
                <div className={`display whitespace-nowrap text-2xl font-black ${scoreTone(row.efficiency_score)}`} data-testid={`efficiency-score-${row.id}`}>
                  {row.efficiency_score === null || row.efficiency_score === undefined ? "N/A" : `${row.efficiency_score.toFixed(1)}%`}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-xs">
                <div><span className="block text-muted-foreground">Calls</span><strong className="mono">{row.calls_dialed}</strong></div>
                <div><span className="block text-muted-foreground">Connected</span><strong className="mono">{row.connected_calls}</strong></div>
                <div><span className="block text-muted-foreground">Conversions</span><strong className="mono">{row.conversions}</strong></div>
                <div><span className="block text-muted-foreground">Interested</span><strong className="mono">{row.interested_leads_period}</strong></div>
                <div><span className="block text-muted-foreground">Follow-ups pending</span><strong className="mono">{row.follow_ups_pending}</strong></div>
              </div>
              <details className="mt-3 border-t border-border/50 pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">Factor targets and results</summary>
                <div className="mt-3 space-y-2">
                  {row.efficiency_factors?.map((factor) => (
                    <div key={factor.key} className="grid grid-cols-[1fr_auto] gap-3 text-xs" data-testid={`factor-${row.id}-${factor.key}`}>
                      <span className="text-muted-foreground">{factor.label} <span className="opacity-60">· {factor.weight}%</span></span>
                      <span className="mono text-right">
                        {factor.achievement === null ? <span className="text-zinc-500">N/A</span> : <><strong>{factor.achievement}%</strong><span className="block text-[10px] text-muted-foreground">{factor.actual} / {factor.target} {factor.unit}</span></>}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
          {!scorableRows.length && (
            <div className="col-span-full px-5 py-10 text-center text-sm text-muted-foreground" data-testid="efficiency-no-data">
              {loading ? "Loading efficiency scores…" : "No measurable performance data for this period."}
            </div>
          )}
        </div>
      </section>

      {/* Summary KPIs */}
      {!efficiencyReport && <div className="mt-6 grid grid-cols-2 gap-px bg-border/40 lg:grid-cols-6">
        {[
          { label: "Calls dialed", value: totals.calls, icon: PhoneCall, tone: "text-brand" },
          { label: "Connected", value: totals.connected, icon: PhoneForwarded, tone: "text-emerald-500" },
          { label: "Not connected", value: totals.notConnected, icon: PhoneCall, tone: "text-amber-400" },
          { label: "Total actions", value: totals.actions, icon: Users, tone: "text-[#71d9ee]" },
          { label: "Conversions", value: totals.conversions, icon: Target, tone: "text-emerald-400" },
          { label: "Logged-in hours", value: totals.hours.toFixed(1), icon: Timer, tone: "text-[#71d9ee]" },
        ].map((k) => (
          <div key={k.label} className={`metric-tile border border-border/60 p-5 ${k.label === "Calls dialed" ? "bg-white text-black" : ""}`} data-testid={`summary-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="flex items-start justify-between">
              <div className="overline">{k.label}</div>
              <k.icon size={15} className={k.tone} />
            </div>
            <div className="display mt-3 text-3xl font-black tracking-tighter">{k.value}</div>
          </div>
        ))}
      </div>}

      {/* Target vs achieved */}
      {!efficiencyReport && rows.some((r) => r.target_calls || r.target_conversions) && (
        <div className="crm-card mt-6 p-5" data-testid="target-vs-achieved">
          <div className="overline mb-4">Target vs achieved <span className="text-muted-foreground">· for the selected period</span></div>
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            {rows.filter((r) => r.target_calls || r.target_conversions).map((r) => (
              <div key={r.id} data-testid={`target-row-${r.id}`}>
                <div className="mb-2 text-sm font-semibold">{r.name}</div>
                {[
                  { label: "Calls", done: r.calls_dialed, target: r.target_calls, color: "#247e9d" },
                  { label: "Conversions", done: r.conversions, target: r.target_conversions, color: "#ef8d5c" },
                ].map((m) => {
                  const pct = m.target ? Math.min(100, Math.round((m.done / m.target) * 100)) : 0;
                  return (
                    <div key={m.label} className="mb-2">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-muted-foreground">{m.label}</span>
                        <span className="mono">{m.done}<span className="text-muted-foreground"> / {m.target || "—"}</span>{m.target ? <span className={`ml-2 font-semibold ${pct >= 100 ? "text-emerald-400" : "text-amber-400"}`}>{pct}%</span> : null}</span>
                      </div>
                      <div className="h-2 bg-white/10">
                        <div className="h-full transition-all" style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="crm-card mt-6 bg-white p-5 text-black" data-testid="efficiency-factor-chart">
        <div className="overline mb-1">Efficiency factor comparison</div>
        <p className="mb-4 text-xs text-zinc-500">Target achievement by factor · N/A measurements are omitted</p>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={factorChartData} margin={{ top: 4, right: 12, left: -12, bottom: 46 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
              <XAxis dataKey="name" stroke="#52525b" fontSize={9} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" height={68} />
              <YAxis domain={[0, settings?.allow_overachievement ? "auto" : 100]} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }} formatter={(value) => value === undefined ? "N/A" : `${value}%`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {rows.map((row, index) => (
                <Bar key={row.id} dataKey={row.id} name={row.name} fill={SCORE_COLORS[index % SCORE_COLORS.length]} maxBarSize={24} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Comparison bar charts */}
      {!efficiencyReport && <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calls dialed" dataKey="calls_dialed" color="#247e9d" data={chartData} />
        <ChartCard title="Connected calls" dataKey="connected_calls" color="#10b981" data={chartData} />
        <ChartCard title="Conversions" dataKey="conversions" color="#ef8d5c" data={chartData} />
        <ChartCard title="Logged-in hours" dataKey="logged_in_hours" color="#71d9ee" data={chartData} />
      </div>}

      {/* Trend chart */}
      {!efficiencyReport && <div className="crm-card mt-6 bg-white p-5 text-black" data-testid="performance-trend-chart">
        <div className="overline mb-4">Daily activity monitoring {telecallerId ? "· selected telecaller" : "· team"}</div>
        <div className="h-[280px] w-full bg-white">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={trend} margin={{ top: 4, right: 12, left: -18, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="calls" name="Calls" stroke="#247e9d" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="connected" name="Connected" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="not_connected" name="Not connected" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversions" name="Conversions" stroke="#ef8d5c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="status_changes" name="Status changes" stroke="#a3a3a3" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="logged_in_hours" name="Hours" stroke="#71d9ee" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>}

      <div className="crm-card mt-6 bg-white p-5 text-black" data-testid="efficiency-trend-chart">
        <div className="overline mb-1">Daily efficiency trend {telecallerId ? "· selected telecaller" : "· team"}</div>
        <p className="mb-4 text-xs text-zinc-500">Weighted score from factors measured each day; hover to see weight coverage</p>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={trend} margin={{ top: 4, right: 12, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
              <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: 12 }} formatter={(value, _, item) => [`${value}% · ${item.payload.efficiency_valid_weight}% measured`, "Efficiency"]} />
              <Line type="monotone" dataKey="efficiency_score" name="Efficiency" stroke="#19a974" strokeWidth={3} connectNulls={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {!trend.some((point) => point.efficiency_score !== null && point.efficiency_score !== undefined) && (
          <div className="-mt-32 relative pb-14 text-center text-xs text-zinc-500" data-testid="efficiency-trend-no-data">No measurable daily data in this range.</div>
        )}
      </div>

      {/* Detailed table */}
      {efficiencyReport && <HorizontalScrollArea className="mt-6 overflow-x-auto border border-border/60" data-testid="efficiency-detail-table">
        <div className="border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="overline">Attendance and caller activity</div>
          <p className="mt-1 text-xs text-muted-foreground">Select a caller to open their period timeline.</p>
        </div>
        <table className="w-full min-w-[1050px] text-sm">
          <thead><tr className="border-b border-border/60 text-left">
            {["Telecaller", "Login", "Logout", "Hours", "Calls", "Connected", "Last dialed call", "Interested", "Conversions", "Pending follow-ups"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium"><button type="button" onClick={() => openTimeline(row)} className="text-left text-brand hover:underline" data-testid={`open-efficiency-timeline-${row.id}`}>{row.name}</button><span className="block text-[10px] text-muted-foreground">{row.efficiency_score === null ? "N/A" : `${row.efficiency_score}% efficiency`}</span></td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(row.login_time)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(row.logout_time)}</td>
                <td className="mono px-4 py-3">{row.session_count ? row.logged_in_hours : "N/A"}</td>
                <td className="mono px-4 py-3 text-brand">{row.calls_dialed}</td>
                <td className="mono px-4 py-3 text-emerald-500">{row.connected_calls}</td>
                <td className="px-4 py-3 text-xs">{row.last_call ? <><span className="font-medium">{row.last_call.contact_name}</span><span className="block text-muted-foreground">{row.last_call.status} · {fmtDuration(row.last_call.duration)} · {fmtTime(row.last_call.time)}</span></> : <span className="text-muted-foreground">No calls</span>}</td>
                <td className="mono px-4 py-3">{row.interested_leads_period}</td>
                <td className="mono px-4 py-3">{row.conversions}</td>
                <td className="mono px-4 py-3">{row.follow_ups_pending}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-muted-foreground">No telecallers found.</td></tr>}
          </tbody>
        </table>
      </HorizontalScrollArea>}

      {!efficiencyReport && <HorizontalScrollArea className="mt-6 overflow-x-auto border border-border/60">
        <div className="border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="overline">Telecaller detail</div>
        </div>
        <table className="w-full min-w-[1750px] text-sm" data-testid="performance-table">
          <thead className="bg-[#0c0c0f]">
            <tr className="border-b border-border/60 text-left">
              {["Telecaller", "Status", "Login", "Logout", "Hours", "Talk", "Dialed", "Connected", "Not connected", "Last call", "Actions", "Status actions", "Call 1", "Call 2", "Call 3", "Call 4", "Conn %", "Conversions", "Conv %", "Contacted", "Follow-ups (done/pending)"].map((h) => (
                <th key={h} className="overline whitespace-nowrap px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`perf-row-${r.id}`} className="cursor-pointer border-b border-border/40 hover:bg-white/[0.03]" onClick={() => openTimeline(r)}>
                <td className="px-4 py-3 font-medium text-brand hover:underline" data-testid={`open-timeline-${r.id}`}>{r.name}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(r.login_time)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtTime(r.logout_time)}</td>
                <td className="mono px-4 py-3">{r.logged_in_hours}</td>
                <td className="mono px-4 py-3">{fmtDuration(r.total_talk_time)}</td>
                <td className="mono px-4 py-3 text-[#247e9d]">{r.calls_dialed}</td>
                <td className="mono px-4 py-3 text-emerald-400">{r.connected_calls}</td>
                <td className="mono px-4 py-3 text-amber-400">{r.not_connected_calls}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">
                  {r.last_call ? (
                    <span>
                      <span className="font-medium">{r.last_call.contact_name}</span>
                      <span className="block text-muted-foreground">{r.last_call.status} · {fmtDuration(r.last_call.duration)} · {fmtTime(r.last_call.time)}</span>
                    </span>
                  ) : <span className="text-muted-foreground">No calls</span>}
                </td>
                <td className="mono px-4 py-3">{r.total_actions}</td>
                <td className="mono px-4 py-3" title={Object.entries(r.status_actions || {}).map(([status, count]) => `${status}: ${count}`).join(", ")}>{r.status_changes}<span className="block text-[10px] text-muted-foreground">{r.converted_actions} converted</span></td>
                {[1, 2, 3, 4].map((number) => {
                  const attempt = r.call_attempts?.[String(number)] || {};
                  return <td key={number} className="mono px-4 py-3" title={`${attempt.connected || 0} connected, ${attempt.not_connected || 0} not connected`}>{attempt.dialed || 0}<span className="block text-[10px] text-muted-foreground">{attempt.connected || 0} / {attempt.not_connected || 0}</span></td>;
                })}
                <td className="mono px-4 py-3">{r.connection_rate}%</td>
                <td className="mono px-4 py-3 text-emerald-400">{r.conversions}</td>
                <td className="mono px-4 py-3 font-semibold">{r.conversion_rate}%</td>
                <td className="mono px-4 py-3">{r.leads_contacted}</td>
                <td className="mono px-4 py-3">{r.follow_ups_completed}<span className="text-muted-foreground"> / </span><span className={r.overdue_follow_ups ? "text-amber-400" : ""}>{r.follow_ups_pending}</span></td>
                
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={21} className="px-4 py-14 text-center text-sm text-muted-foreground" data-testid="performance-empty">
                  {loading ? "Loading…" : "No telecaller activity in this period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </HorizontalScrollArea>}

      {/* Timeline drawer */}
      <Sheet open={timelineOpen} onOpenChange={setTimelineOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-border/60 bg-background sm:max-w-[460px]" data-testid="timeline-drawer">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="display text-2xl font-bold">{timeline?.member?.name}</SheetTitle>
              <p className="mt-1 text-xs text-muted-foreground">Activity timeline · {timeline?.period}</p>
            </div>
            <div className="flex items-center gap-2">
              {timeline?.member?.id && (
                <button data-testid="export-timeline-button" onClick={() => downloadCsv(`/reports/telecaller-performance/${timeline.member.id}/timeline/export`, `timeline-${timeline.member.name}.csv`)} className="flex items-center gap-1.5 border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <Download size={13} /> CSV
                </button>
              )}
              <button onClick={() => setTimelineOpen(false)} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
          </div>
          <div className="mt-6 space-y-1">
            {(timeline?.events || []).map((ev, i) => (
              <div key={i} className="flex gap-3 border-b border-border/50 py-3" data-testid="timeline-event">
                <div className="mt-1 text-brand">
                  {ev.type === "call" ? <PhoneCall size={14} /> : ev.type === "login" || ev.type === "logout" ? <Clock3 size={14} /> : <Users size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold capitalize">{ev.title}</div>
                  {ev.detail && <div className="truncate text-xs text-muted-foreground">{ev.detail}</div>}
                  <div className="text-[11px] text-muted-foreground">{fmtTime(ev.time)}</div>
                </div>
              </div>
            ))}
            {timeline && !timeline.events?.length && <div className="py-10 text-center text-sm text-muted-foreground">No activity in this period.</div>}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-border/60 bg-background sm:max-w-[620px]" data-testid="efficiency-settings-drawer">
          <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
            <div>
              <SheetTitle className="display text-2xl font-bold">Efficiency scoring</SheetTitle>
              <p className="mt-1 text-xs text-muted-foreground">Weights total 100%. Missing measurements are excluded from each score.</p>
            </div>
            <Button onClick={saveSettings} disabled={!draftSettings || savingSettings || Math.abs(Object.values(draftSettings?.weights || {}).reduce((sum, weight) => sum + Number(weight || 0), 0) - 100) > 0.01} className="rounded-none" data-testid="save-efficiency-settings">
              {savingSettings ? "Saving…" : "Save settings"}
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-[minmax(0,1fr)_94px_94px] gap-2 border-b border-border/50 pb-2 text-[10px] font-bold uppercase text-muted-foreground">
            <span>Performance factor</span><span>Target</span><span>Weight %</span>
          </div>
          <div className="divide-y divide-border/40">
            {EFFICIENCY_FACTORS.map(([key, label]) => (
              <div key={key} className="grid grid-cols-[minmax(0,1fr)_94px_94px] items-center gap-2 py-2.5">
                <label htmlFor={`efficiency-target-${key}`} className="text-xs font-medium">{label}</label>
                <Input id={`efficiency-target-${key}`} type="number" min="0.01" step="any" value={draftSettings?.targets?.[key] ?? ""} onChange={(event) => setDraftSettings((current) => ({ ...current, targets: { ...current.targets, [key]: Number(event.target.value) } }))} className="h-8 rounded-none px-2 text-xs" />
                <Input aria-label={`${label} weight`} type="number" min="0" step="any" value={draftSettings?.weights?.[key] ?? ""} onChange={(event) => setDraftSettings((current) => ({ ...current, weights: { ...current.weights, [key]: Number(event.target.value) } }))} className="h-8 rounded-none px-2 text-xs" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-border/60 pt-3 text-xs">
            <span className="text-muted-foreground">Total weight</span>
            <strong className={Math.abs(Object.values(draftSettings?.weights || {}).reduce((sum, weight) => sum + Number(weight || 0), 0) - 100) <= 0.01 ? "text-emerald-500" : "text-red-400"}>
              {Object.values(draftSettings?.weights || {}).reduce((sum, weight) => sum + Number(weight || 0), 0).toFixed(1)}%
            </strong>
          </div>

          <div className="mt-6 border-t border-border/60 pt-5">
            <div className="overline mb-3">Shift and scoring rules</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">Scheduled start
                <Input type="time" value={draftSettings?.shift_start_time || "09:00"} onChange={(event) => setDraftSettings((current) => ({ ...current, shift_start_time: event.target.value }))} className="mt-1 h-9 rounded-none" />
              </label>
              <label className="text-xs text-muted-foreground">Shift hours
                <Input type="number" min="0.25" step="0.25" value={draftSettings?.shift_hours ?? 8} onChange={(event) => setDraftSettings((current) => ({ ...current, shift_hours: Number(event.target.value) }))} className="mt-1 h-9 rounded-none" />
              </label>
              <label className="text-xs text-muted-foreground">Allowed break minutes
                <Input type="number" min="0" step="5" value={draftSettings?.break_limit_minutes ?? 60} onChange={(event) => setDraftSettings((current) => ({ ...current, break_limit_minutes: Number(event.target.value) }))} className="mt-1 h-9 rounded-none" />
              </label>
              <label className="text-xs text-muted-foreground">Daily conversion target
                <Input type="number" min="0" step="1" value={draftSettings?.daily_conversion_target ?? 3} onChange={(event) => setDraftSettings((current) => ({ ...current, daily_conversion_target: Number(event.target.value) }))} className="mt-1 h-9 rounded-none" />
              </label>
              <label className="text-xs text-muted-foreground">Green threshold %
                <Input type="number" min="1" max="100" value={draftSettings?.thresholds?.green ?? 85} onChange={(event) => setDraftSettings((current) => ({ ...current, thresholds: { ...current.thresholds, green: Number(event.target.value) } }))} className="mt-1 h-9 rounded-none" />
              </label>
              <label className="text-xs text-muted-foreground">Yellow threshold %
                <Input type="number" min="0" max="99" value={draftSettings?.thresholds?.yellow ?? 70} onChange={(event) => setDraftSettings((current) => ({ ...current, thresholds: { ...current.thresholds, yellow: Number(event.target.value) } }))} className="mt-1 h-9 rounded-none" />
              </label>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" checked={Boolean(draftSettings?.allow_overachievement)} onChange={(event) => setDraftSettings((current) => ({ ...current, allow_overachievement: event.target.checked }))} />
              Allow factor achievements above 100%
            </label>
            <p className="mt-3 text-[11px] text-muted-foreground">Break, CRM accuracy, follow-up completion, and productive time remain N/A until the CRM records those events as structured data.</p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
