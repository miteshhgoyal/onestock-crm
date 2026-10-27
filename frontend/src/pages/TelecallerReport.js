import { useEffect, useState } from "react";
import { ArrowLeft, PhoneCall, TrendingUp, Users } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import HorizontalScrollArea from "@/components/HorizontalScrollArea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const formatStatus = (status) => status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const periods = ["today", "week", "month", "custom"];

export default function TelecallerReport() {
  const { telecallerId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const period = periods.includes(params.get("period")) ? params.get("period") : "month";
  const [range, setRange] = useState({ from: params.get("from_date") || "", to: params.get("to_date") || "" });
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState("");
  const [interestedLeads, setInterestedLeads] = useState([]);
  const [interestedLeadTotal, setInterestedLeadTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const reportParams = { period };
    if (period === "custom" && range.from) reportParams.from_date = range.from;
    if (period === "custom" && range.to) reportParams.to_date = range.to;
    setReport(null);
    setReportError("");
    setReportLoading(true);
    api.get(`/reports/telecallers/${telecallerId}`, { params: reportParams })
      .then(({ data }) => { if (!cancelled) setReport(data); })
      .catch((error) => { if (!cancelled) setReportError(errMsg(error)); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    api.get("/leads", { params: { status: "interested", assigned_to: telecallerId, page: 1, limit: 50 } })
      .then(({ data }) => {
        if (cancelled) return;
        setInterestedLeads(data.items || []);
        setInterestedLeadTotal(data.total || 0);
      })
      .catch((error) => { if (!cancelled) toast.error(errMsg(error)); });
    return () => { cancelled = true; };
  }, [telecallerId, period, range]);

  if (reportLoading) return <div className="p-8 text-sm text-muted-foreground" role="status">Loading report…</div>;
  if (reportError || !report) return (
    <section className="crm-card m-6 max-w-2xl p-6" role="alert" data-testid="telecaller-report-error">
      <div className="overline">Telecaller report unavailable</div>
      <h1 className="mt-2 text-xl font-bold">This report could not be opened</h1>
      <p className="mt-2 text-sm text-muted-foreground">{reportError || "The requested telecaller report was not returned."}</p>
      <Button type="button" variant="outline" onClick={() => navigate("/reports")} className="mt-5 rounded-none"><ArrowLeft size={14} className="mr-2" /> Back to reports</Button>
    </section>
  );
  const stats = report.totals;

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="telecaller-report-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <button onClick={() => navigate("/reports")} className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Back to reports</button>
          <div className="overline">Telecaller report</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tight">{report.member.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{report.member.email} · {period === "custom" ? "selected range" : `${period} activity`} in IST</p>
        </div>
        <div className="flex gap-1 border border-border/70 p-1" data-testid="report-period-filter">
          {periods.map((value) => <button key={value} onClick={() => setParams({ period: value })} className={`px-4 py-2 text-xs font-semibold capitalize ${period === value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{value === "custom" ? "Range" : value}</button>)}
        </div>
      </div>

      {period === "custom" && <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="telecaller-report-range">
        <Input type="date" aria-label="Report start date" data-testid="telecaller-report-date-from" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="h-9 w-40 rounded-none" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" aria-label="Report end date" data-testid="telecaller-report-date-to" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="h-9 w-40 rounded-none" />
      </div>}

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[["Calls", stats.calls, PhoneCall], ["Total actions", stats.total_actions, Users], ["Status changes", stats.status_changes, Users], ["Converted actions", stats.converted_actions, TrendingUp], ["Leads", stats.leads, Users], ["Converted leads", stats.converted_period, TrendingUp], ["Notes", stats.notes, Users], ["Approved revenue", money(stats.approved_revenue), TrendingUp]].map(([label, value, Icon]) => <div key={label} className="crm-card p-5"><div className="flex items-center justify-between"><div className="overline">{label}</div><Icon size={16} className="text-brand" /></div><div className="mt-3 text-2xl font-black">{value}</div></div>)}
      </div>

      <section className="crm-card mt-6 overflow-hidden" data-testid="telecaller-interested-leads">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-5"><div><div className="overline">Interested leads</div><p className="mt-1 text-xs text-muted-foreground">Currently assigned · {interestedLeadTotal} lead{interestedLeadTotal === 1 ? "" : "s"}</p></div><Button variant="outline" onClick={() => navigate(`/leads?status=interested&assigned_to=${telecallerId}`)} className="h-9 rounded-none">View all</Button></div>
        <div className="divide-y divide-border/60">{interestedLeads.map((lead) => <div key={lead.id} className="grid gap-1 px-5 py-3 sm:grid-cols-[1.2fr_1fr_1fr] sm:items-center"><div className="font-semibold">{lead.name}</div><div className="mono text-xs text-muted-foreground">{lead.phone || "No phone"}</div><div className="text-xs text-muted-foreground">Updated {lead.updated_at ? new Date(lead.updated_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</div></div>)}</div>
        {!interestedLeads.length && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No interested leads currently assigned.</div>}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="crm-card p-5"><div className="overline mb-4">Lead status</div>{Object.entries(report.by_status).map(([status, count]) => <div key={status} className="flex justify-between border-b border-border/60 py-2 text-sm capitalize"><span>{status.replaceAll("_", " ")}</span><strong>{count}</strong></div>)}</section>
        <section className="crm-card overflow-hidden"><div className="border-b border-border/60 p-5"><div className="overline">Calls in selected period</div><p className="mt-1 text-xs text-muted-foreground">Each row shows the result and lead status for that call.</p></div><HorizontalScrollArea className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border/60 text-left">{["Lead", "Call", "Connection", "Lead status", "Time"].map((heading) => <th key={heading} className="overline px-4 py-3">{heading}</th>)}</tr></thead><tbody>{report.calls.map((call) => <tr key={call.id} className="border-b border-border/60"><td className="px-4 py-3 font-medium">{call.contact_name || call.subject || "Unknown lead"}</td><td className="px-4 py-3">{call.call_number ? `Call ${call.call_number}` : "Call"}</td><td className="px-4 py-3 capitalize">{String(call.call_outcome || call.status_code || "Not recorded").replaceAll("_", " ")}</td><td className="px-4 py-3"><span className={call.post_call_status ? "font-semibold text-brand" : "text-muted-foreground"}>{call.post_call_status ? formatStatus(call.post_call_status) : "Not recorded"}</span></td><td className="px-4 py-3 text-xs text-muted-foreground">{call.created_at ? new Date(call.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td></tr>)}</tbody></table></HorizontalScrollArea>{!report.calls.length && <div className="p-5 text-sm text-muted-foreground">No calls recorded in this period.</div>}</section>
      </div>

      <section className="crm-card mt-6 grid gap-6 p-5 lg:grid-cols-2" data-testid="telecaller-action-breakdown">
        <div><div className="overline mb-4">Status actions</div>{Object.entries(report.status_actions || {}).map(([status, count]) => <div key={status} className="flex justify-between border-b border-border/60 py-2 text-sm capitalize"><span>{status.replaceAll("_", " ")}</span><strong>{count}</strong></div>)}{!Object.keys(report.status_actions || {}).length && <div className="text-sm text-muted-foreground">No status changes in this period.</div>}</div>
        <div>
          <div className="overline mb-4">Calls by attempt</div>
          {([1, 2, 3, 4]
            .map((number) => ({ number, attempt: report.call_attempts?.[String(number)] || {} }))
            .filter(({ attempt }) => (attempt.dialed || 0) > 0 || (attempt.connected || 0) > 0 || (attempt.not_connected || 0) > 0)
            .map(({ number, attempt }) => (
              <div key={number} className="grid grid-cols-4 border-b border-border/60 py-2 text-sm">
                <span className="font-medium">Call {number}</span>
                <span>{attempt.dialed || 0} dialed</span>
                <span className="text-emerald-400">{attempt.connected || 0} connected</span>
                <span className="text-amber-400">{attempt.not_connected || 0} not connected</span>
              </div>
            )))}
          {!([1, 2, 3, 4].some((number) => (report.call_attempts?.[String(number)]?.dialed || 0) > 0 || (report.call_attempts?.[String(number)]?.connected || 0) > 0 || (report.call_attempts?.[String(number)]?.not_connected || 0) > 0)) && (
            <div className="text-sm text-muted-foreground">No dial attempts recorded in this period.</div>
          )}
        </div>
      </section>

      <section className="crm-card mt-6 p-5"><div className="overline mb-4">Recent activity</div>{report.activities.map((item) => <div key={item.id} className="border-b border-border/60 py-3 text-sm"><div className="font-semibold">{item.action?.replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{item.detail || "—"} · {item.created_at ? new Date(item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</div></div>)}{!report.activities.length && <div className="text-sm text-muted-foreground">No activity recorded in this period.</div>}</section>
    </div>
  );
}
