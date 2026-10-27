import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Activity, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock3, FileText, Inbox, ListPlus, PhoneCall, RefreshCw, Settings2, TrendingUp, Users2, UsersRound, ContactRound } from "lucide-react";
import { BarChart, Bar, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatTeamDate, SOURCE_LABEL, STATUS_META } from "@/lib/constants";
import StatusBadge from "@/components/StatusBadge";
import PanelSurface from "@/components/PanelSurface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TelecallerDashboard from "@/pages/TelecallerDashboard";
import ConvertedClubLeads from "@/components/ConvertedClubLeads";

const Kpi = ({ label, value, icon: Icon, tone = "", testId, onClick }) => (
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

function ManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [dueLeads, setDueLeads] = useState([]);
  const [activity, setActivity] = useState([]);
  const [period, setPeriod] = useState("today");
  const [range, setRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    try {
      const params = { period };
      if (period === "custom") {
        if (range.from) params.from_date = range.from;
        if (range.to) params.to_date = range.to;
      }
      const [dashboardRes, leadsRes, activityRes] = await Promise.all([
        api.get("/reports/dashboard", { params }),
        api.get("/leads", { params: { bucket: "today", limit: 5, page: 1 } }),
        api.get("/activities", { params: { limit: 5 } }),
      ]);
      setData(dashboardRes.data);
      setDueLeads(leadsRes.data.items || []);
      setActivity(activityRes.data || []);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [period, range]);

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const t = data?.totals || {};
  const statusData = (data?.by_status || []).map((s) => ({
    name: STATUS_META[s.status]?.label || s.status,
    count: s.count,
    fill: STATUS_META[s.status]?.hex || "#de1e1e",
  }));
  const sourceData = (data?.by_source || []).map((s, i) => ({
    name: SOURCE_LABEL[s.source] || s.source,
    value: s.count,
    fill: ["#3b82f6", "#10b981", "#eab308", "#f97316", "#8b5cf6", "#6366f1", "#71717a"][i % 7],
  }));
  const periodLabel = period === "custom" ? "selected range" : period;

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="dashboard-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">{formatTeamDate(new Date(), { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · IST</div>
          <h1 className="display mt-1 text-3xl font-black tracking-tight">Welcome back, {user?.name?.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here is what is happening across your sales workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            data-testid="refresh-dashboard-button"
            onClick={load}
            className="border-border/70 bg-[#111f35] text-foreground hover:bg-[#172943]"
          >
            <RefreshCw size={14} className="mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3" data-testid="manager-dashboard-date-filter">
        <div className="flex border border-border/70 p-1">
          {[["today", "Today"], ["week", "Week"], ["month", "Month"], ["custom", "Range"]].map(([value, label]) => (
            <button key={value} type="button" data-testid={`manager-dashboard-period-${value}`} onClick={() => setPeriod(value)} className={`px-4 py-2 text-xs font-semibold ${period === value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        {period === "custom" && <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Dashboard start date" data-testid="manager-dashboard-date-from" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="h-9 w-40 rounded-none" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="Dashboard end date" data-testid="manager-dashboard-date-to" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="h-9 w-40 rounded-none" />
        </div>}
      </div>

      <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PanelSurface className="h-full"><Kpi label="Total leads" value={t.total ?? "—"} icon={Inbox} testId="kpi-total" onClick={() => navigate("/leads")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Due today" value={t.due_today ?? "—"} icon={CalendarClock} testId="kpi-due-today" onClick={() => navigate("/leads?bucket=today")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Missed follow-ups" value={t.overdue ?? "—"} icon={AlertTriangle} tone="text-yellow-500" testId="kpi-overdue" onClick={() => navigate("/leads?bucket=overdue")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Total actions today" value={t.total_actions_today ?? "—"} icon={Activity} tone="text-[#247e9d]" testId="kpi-actions-today" onClick={() => navigate("/reports")} /></PanelSurface>
        {(["admin", "subadmin"].includes(user?.role)) && (
          <PanelSurface className="h-full"><Kpi label="Actionless 24h" value={t.actionless_24h ?? "—"} icon={Clock3} tone="text-amber-500" testId="kpi-actionless" onClick={() => navigate("/leads?bucket=actionless")} /></PanelSurface>
        )}
        <PanelSurface className="h-full"><Kpi label="Unassigned" value={t.unassigned ?? "—"} icon={Inbox} testId="kpi-unassigned" onClick={() => navigate("/leads?bucket=unassigned")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Converted" value={t.converted ?? "—"} icon={CheckCircle2} tone="text-emerald-500" testId="kpi-converted" onClick={() => navigate("/leads?status=converted")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Conversion rate" value={`${t.conversion_rate ?? 0}%`} icon={TrendingUp} testId="kpi-conversion" onClick={() => navigate("/reports")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`New leads (${periodLabel})`} value={t.new_leads_period ?? "—"} icon={Inbox} testId="kpi-new-leads-period" onClick={() => navigate("/leads")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Calls dialed (${periodLabel})`} value={t.calls_period ?? "—"} icon={PhoneCall} tone="text-[#247e9d]" testId="kpi-calls-period" onClick={() => navigate("/activities?type=call")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Connected (${periodLabel})`} value={t.connected_period ?? "—"} icon={CheckCircle2} tone="text-emerald-500" testId="kpi-connected-period" onClick={() => navigate("/activities?type=call")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Not connected (${periodLabel})`} value={t.not_connected_period ?? "—"} icon={PhoneCall} tone="text-orange-400" testId="kpi-not-connected-period" onClick={() => navigate("/activities?type=call")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label={`Revenue (${periodLabel})`} value={`₹${Number(t.revenue_period || 0).toLocaleString("en-IN")}`} icon={TrendingUp} tone="text-emerald-500" testId="kpi-revenue-period" onClick={() => navigate("/reports")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Revenue this week" value={`₹${Number(t.revenue_week || 0).toLocaleString("en-IN")}`} icon={TrendingUp} tone="text-emerald-500" testId="kpi-revenue-week" onClick={() => navigate("/reports")} /></PanelSurface>
        <PanelSurface className="h-full"><Kpi label="Revenue this month" value={`₹${Number(t.revenue_month || 0).toLocaleString("en-IN")}`} icon={TrendingUp} tone="text-emerald-500" testId="kpi-revenue-month" onClick={() => navigate("/reports")} /></PanelSurface>
      </div>

      {user?.role === "subadmin" && <div className="mt-6"><ConvertedClubLeads /></div>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <PanelSurface className="crm-card depth-hover p-6" data-testid="chart-by-status">
          <div className="overline">Leads by stage</div>
          <div className="mt-6 h-[280px] w-full">
            <ResponsiveContainer width="100%" height={280} minWidth={0} minHeight={240}>
              <BarChart data={statusData}>
                <XAxis dataKey="name" stroke="#1111b6" fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-18} dy={10} height={50} />
                <YAxis stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#c9c9d8", border: "1px solid #27272a", borderRadius: 0 }} />
                <Bar dataKey="count" radius={[0, 0, 0, 0]}>
                  {statusData.map((d, i) => (
                    <Cell key={i} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </PanelSurface>
        <PanelSurface className="crm-card depth-hover p-6" data-testid="chart-by-source">
          <div className="overline">Leads by source</div>
          <div className="mt-6 h-[280px] w-full">
            <ResponsiveContainer width="100%" height={280} minWidth={0} minHeight={240}>
              <PieChart>
                <Pie data={sourceData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
                  {sourceData.map((d, i) => (
                    <Cell key={i} fill={d.fill} stroke="#1c1cb9" />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#9b9bab", border: "1px solid #27272a", borderRadius: 0 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-1.5">
            {sourceData.map((s) => (
              <div key={s.name} className="mono flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2" style={{ background: s.fill }} />
                {s.name} · {s.value}
              </div>
            ))}
          </div>
        </PanelSurface>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_0.8fr_0.8fr]">
        <PanelSurface className="crm-card depth-hover overflow-hidden" data-testid="dashboard-due-leads">
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
            <div><h2 className="font-bold">Today's leads</h2><p className="mt-1 text-xs text-muted-foreground">Follow-ups that need attention today</p></div>
            <button onClick={() => navigate("/leads?bucket=today")} className="flex items-center gap-1 text-xs font-semibold text-[#247e9d] hover:text-[#15556b]">View all <ArrowRight size={13} /></button>
          </div>
          <div className="divide-y divide-border/60">
            {dueLeads.map((lead) => <button key={lead.id} onClick={() => navigate("/leads?bucket=today")} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{lead.name}</span><span className="block truncate text-xs text-muted-foreground">{lead.company || lead.phone}</span></span><StatusBadge status={lead.status} /></button>)}
            {!dueLeads.length && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No follow-ups due today.</div>}
          </div>
        </PanelSurface>

        <PanelSurface className="crm-card depth-hover" data-testid="dashboard-quick-actions">
          <div className="border-b border-border/70 px-5 py-4"><h2 className="font-bold">Quick actions</h2><p className="mt-1 text-xs text-muted-foreground">Keep the pipeline moving</p></div>
          <div className="grid grid-cols-2 gap-2 p-4">
            {user?.role !== "team_leader" && <button onClick={() => navigate("/leads?new=1")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><ListPlus size={17} className="text-[#247e9d]" />New lead</button>}
            <button onClick={() => navigate("/activities?type=call")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><PhoneCall size={17} className="text-[#247e9d]" />Call desk</button>
            <button onClick={() => navigate("/dialer")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><ContactRound size={17} className="text-[#247e9d]" />Dialer</button>
            <button onClick={() => navigate("/activities?type=task")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><Settings2 size={17} className="text-[#247e9d]" />Tasks</button>
            <button onClick={() => navigate("/documents")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><FileText size={17} className="text-[#247e9d]" />Documents</button>
            <button onClick={() => navigate("/teams")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><UsersRound size={17} className="text-[#247e9d]" />Team view</button>
            <button onClick={() => navigate("/reports")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><TrendingUp size={17} className="text-[#247e9d]" />Reports</button>
            {user?.role !== "team_leader" && <button onClick={() => navigate("/users")} className="flex flex-col items-start gap-2 rounded-md border border-border/70 p-3 text-left text-xs font-semibold hover:border-[#35a7c2] hover:bg-slate-50"><Users2 size={17} className="text-[#247e9d]" />Users</button>}
          </div>
        </PanelSurface>

        <PanelSurface className="crm-card depth-hover" data-testid="dashboard-activity">
          <div className="border-b border-border/70 px-5 py-4"><h2 className="font-bold">Recent activity</h2><p className="mt-1 text-xs text-muted-foreground">Latest workspace updates</p></div>
          <div className="divide-y divide-border/60">
            {activity.map((item) => <div key={item.id} className="flex gap-3 px-5 py-3"><div className="mt-1 rounded-full bg-[#e2f3f6] p-1.5 text-[#247e9d]"><Clock3 size={12} /></div><div className="min-w-0"><div className="truncate text-xs font-semibold">{item.actor_name || "System"}</div><div className="truncate text-xs text-muted-foreground">{item.action?.replaceAll("_", " ")}</div></div></div>)}
            {!activity.length && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No activity yet.</div>}
          </div>
        </PanelSurface>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return user?.role === "telecaller" ? <TelecallerDashboard /> : <ManagerDashboard />;
}
