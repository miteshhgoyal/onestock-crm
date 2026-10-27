import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import HorizontalScrollArea from "@/components/HorizontalScrollArea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Reports() {
  const { user } = useAuth();
  const [data, setData] = useState({ telecallers: [], teams: [] });
  const [interestedLeads, setInterestedLeads] = useState([]);
  const [interestedLeadTotal, setInterestedLeadTotal] = useState(0);
  const [pending, setPending] = useState([]);
  const [ticketSizes, setTicketSizes] = useState({});
  const [memberReport, setMemberReport] = useState(null);
  const [metric, setMetric] = useState("leads");
  const [attemptFilter, setAttemptFilter] = useState("all");
  const [period, setPeriod] = useState("today");
  const [range, setRange] = useState({ from: "", to: "" });
  const navigate = useNavigate();
  const periodLabel = period === "today" ? "Today" : period === "custom" ? "Selected range" : `This ${period}`;

  const load = useCallback(async () => {
    const params = { period };
    if (period === "custom") {
      if (range.from) params.from_date = range.from;
      if (range.to) params.to_date = range.to;
    }
    try {
      const requests = [
        api.get("/reports/performance", { params }),
        api.get("/leads", { params: { status: "interested", page: 1, limit: 8 } }),
      ];
      if (user?.role !== "telecaller") requests.push(api.get("/reports/conversions", { params: { status: "pending" } }));
      const [performanceResponse, interestedResponse, conversionResponse] = await Promise.all(requests);
      setData(performanceResponse.data);
      setInterestedLeads(interestedResponse.data.items || []);
      setInterestedLeadTotal(interestedResponse.data.total || 0);
      setPending(conversionResponse?.data || []);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [period, range, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const metricFields = { leads: "leads_acted", calls: "calls_period", converted: "converted_period", revenue: "revenue_period" };
  const sortedTelecallers = [...data.telecallers].sort((a, b) => Number(b[metricFields[metric]] || 0) - Number(a[metricFields[metric]] || 0));
  const totals = data.telecallers.reduce((summary, caller) => ({
    leadsActed: summary.leadsActed + Number(caller.leads_acted || 0),
    calls: summary.calls + Number(caller.calls_period || 0),
    connected: summary.connected + Number(caller.connected || 0),
    notConnected: summary.notConnected + Number(caller.not_connected || 0),
  }), { leadsActed: 0, calls: 0, connected: 0, notConnected: 0 });
  const callNumbers = [1, 2, 3, 4];
  const visibleCallNumbers = attemptFilter === "all" ? callNumbers : [Number(attemptFilter)];
  const totalInterested = data.telecallers.reduce((sum, caller) => sum + callNumbers.reduce(
    (callerTotal, number) => callerTotal + Number(caller.call_attempts?.[String(number)]?.statuses?.interested || 0), 0,
  ), 0);
  const callAttemptTotals = callNumbers.map((number) => data.telecallers.reduce((sum, caller) => {
    const attempt = caller.call_attempts?.[String(number)] || {};
    return {
      dialed: sum.dialed + Number(attempt.dialed || 0),
      interested: sum.interested + Number(attempt.statuses?.interested || 0),
    };
  }, { dialed: 0, interested: 0 }));
  const selectedStatusTotals = visibleCallNumbers.reduce((totalsByStatus, number) => {
    data.telecallers.forEach((caller) => {
      const statuses = caller.call_attempts?.[String(number)]?.statuses || {};
      Object.entries(statuses).forEach(([status, count]) => {
        totalsByStatus[status] = (totalsByStatus[status] || 0) + Number(count || 0);
      });
    });
    return totalsByStatus;
  }, {});
  const formatStatus = (status) => status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  const approve = async (lead, withoutTicket = false) => {
    const ticketSize = Number(ticketSizes[lead.id]);
    if (!withoutTicket && (!ticketSize || ticketSize <= 0)) return toast.error("Enter a valid ticket size");
    try {
      await api.post(`/leads/${lead.id}/conversion/approve`, withoutTicket ? {} : { ticket_size: ticketSize });
      toast.success(withoutTicket ? "Conversion approved without ticket size" : "Conversion approved");
      setPending(pending.filter((item) => item.id !== lead.id));
    } catch (e) { toast.error(errMsg(e)); }
  };

  const openMemberReport = (member) => {
    const params = new URLSearchParams({ period });
    if (period === "custom" && range.from) params.set("from_date", range.from);
    if (period === "custom" && range.to) params.set("to_date", range.to);
    navigate(`/reports/telecallers/${member.id}?${params.toString()}`);
  };

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="reports-page">
      <div className="overline">Performance</div>
      <h1 className="display mt-2 text-4xl font-black tracking-tighter">Reports</h1>

      <div className="mt-8 flex flex-wrap items-center gap-3" data-testid="reports-date-filter">
        <div className="flex border border-border/70 p-1">
          {[['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['custom', 'Range']].map(([value, label]) => (
            <button key={value} type="button" data-testid={`reports-period-${value}`} onClick={() => setPeriod(value)} className={`px-4 py-2 text-xs font-semibold ${period === value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
          ))}
        </div>
        {period === "custom" && <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Report start date" data-testid="reports-date-from" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="h-9 w-40 rounded-none" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" aria-label="Report end date" data-testid="reports-date-to" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="h-9 w-40 rounded-none" />
        </div>}
      </div>

      <section className="mt-6 grid gap-px border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-4" data-testid="reports-summary">
          {[["Leads acted on", totals.leadsActed], ["Calls dialed", totals.calls], ["Connected", totals.connected], ["Not connected", totals.notConnected]].map(([label, value]) => <div key={label} className="bg-background px-5 py-4"><div className="overline">{label}</div><div className="mono mt-2 text-2xl font-bold">{value}</div></div>)}
      </section>

      <HorizontalScrollArea className="mt-10 overflow-x-auto border border-border/60">
        <div className="border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="overline">Telecaller performance</div><p className="mt-1 text-xs text-muted-foreground">{periodLabel} · Unique leads acted on; calls include attempts with unknown outcomes.</p></div><select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Sort telecallers" data-testid="report-metric-filter" className="h-9 border border-border/70 bg-background px-3 text-xs"><option value="leads">Sort by leads acted on</option><option value="calls">Sort by calls</option><option value="converted">Sort by converted</option><option value="revenue">Sort by revenue</option></select></div>
        </div>
        <table className="w-full min-w-[920px] text-sm" data-testid="telecaller-report-table">
          <thead className="bg-[#0c0c0f]">
            <tr className="border-b border-border/60 text-left">
              {['Telecaller', 'Leads acted on', 'Calls dialed', 'Connected', 'Not connected', 'Leads assigned', 'Call conversions', 'Conversion rate', 'Revenue'].map((h) => (
                <th key={h} className="overline whitespace-nowrap px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTelecallers.map((t) => (
              <tr key={t.id} data-testid={`report-row-${t.id}`} className="border-b border-border/40 hover:bg-white/[0.03]">
                <td className="px-4 py-3"><button type="button" onClick={() => openMemberReport(t)} className="text-left font-medium text-brand hover:underline" data-testid={`open-report-${t.id}`}>{t.name}</button><span className={`mt-1 block text-[10px] font-semibold ${t.active ? "text-emerald-500" : "text-muted-foreground"}`}>{t.active ? "Active" : "Inactive"}</span></td>
                <td className="mono px-4 py-3 font-semibold" title={`${t.total_actions || 0} activity events`}>{t.leads_acted || 0}<span className="block text-[10px] font-normal text-muted-foreground">{t.total_actions || 0} actions</span></td>
                <td className="mono px-4 py-3 text-[#247e9d]">{t.calls_period}</td>
                <td className="mono px-4 py-3 text-emerald-400">{t.connected}</td>
                <td className="mono px-4 py-3 text-orange-400">{t.not_connected}</td>
                <td className="mono px-4 py-3">{t.leads_period}</td>
                <td className="mono px-4 py-3 text-emerald-400">{t.converted_period}</td>
                <td className="mono px-4 py-3 font-semibold">{t.conversion_rate_period}%</td>
                <td className="mono whitespace-nowrap px-4 py-3 text-emerald-400">₹{Number(t.revenue_period || 0).toLocaleString("en-IN")}</td>
              </tr>
            ))}
            {!data.telecallers.length && (
              <tr>
                <td colSpan={9} className="px-4 py-14 text-center text-sm text-muted-foreground" data-testid="reports-empty">
                  No assigned leads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </HorizontalScrollArea>

      <section className="mt-8 border border-border/60" data-testid="call-attempt-report">
        <div className="border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="overline">Call-by-call activity</div>
              <p className="mt-1 text-xs text-muted-foreground">Dialed attempts, interested outcomes, and status changes by call number · {periodLabel.toLowerCase()}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Filter call</span>
                <select value={attemptFilter} onChange={(event) => setAttemptFilter(event.target.value)} aria-label="Filter by call number" data-testid="call-attempt-filter" className="h-9 border border-border/70 bg-background px-3 text-foreground">
                  <option value="all">All calls</option>
                  {callNumbers.map((number) => <option key={number} value={number}>Call {number}</option>)}
                </select>
              </label>
              <div className="text-xs"><span className="text-muted-foreground">Interested · all calls</span><strong className="mono ml-2 text-base text-emerald-400" data-testid="report-total-interested">{totalInterested}</strong></div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-3 text-xs" data-testid="call-status-totals">
            <span className="text-muted-foreground">Status changes{attemptFilter === "all" ? " · all calls" : ` · call ${attemptFilter}`}:</span>
            {Object.entries(selectedStatusTotals).map(([status, count]) => <span key={status}>{formatStatus(status)} <strong className="mono">{count}</strong></span>)}
            {!Object.keys(selectedStatusTotals).length && <span className="text-muted-foreground">None recorded</span>}
          </div>
        </div>
        <HorizontalScrollArea className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm" data-testid="call-attempt-table">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="overline px-4 py-3">Telecaller</th>
                {visibleCallNumbers.map((number) => <th key={number} className="overline min-w-40 px-4 py-3">Call {number}</th>)}
                <th className="overline whitespace-nowrap px-4 py-3">Interested · all calls</th>
              </tr>
            </thead>
            <tbody>
              {sortedTelecallers.map((caller) => (
                <tr key={caller.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-medium">{caller.name}</td>
                  {visibleCallNumbers.map((number) => {
                    const attempt = caller.call_attempts?.[String(number)] || {};
                    const statuses = Object.entries(attempt.statuses || {}).map(([status, count]) => `${formatStatus(status)} ${count}`).join(" · ");
                    return <td key={number} className="px-4 py-3" data-testid={`report-call-${number}-${caller.id}`}>
                      <div className="mono whitespace-nowrap"><span>{attempt.dialed || 0} dialed</span><span className="mx-2 text-muted-foreground">·</span><span className="text-emerald-400" data-testid={`report-interested-call-${number}-${caller.id}`}>{attempt.statuses?.interested || 0} interested</span></div>
                      <div className="mt-1 text-[10px] text-muted-foreground">{attempt.connected || 0} connected · {attempt.not_connected || 0} not connected</div>
                      {statuses && <div className="mt-1 max-w-64 text-[10px] text-brand">{statuses}</div>}
                    </td>;
                  })}
                  <td className="mono px-4 py-3 font-semibold text-emerald-400" data-testid={`report-total-interested-${caller.id}`}>
                    {callNumbers.reduce((sum, number) => sum + Number(caller.call_attempts?.[String(number)]?.statuses?.interested || 0), 0)}
                  </td>
                </tr>
              ))}
              {!sortedTelecallers.length && <tr><td colSpan={visibleCallNumbers.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground">No call attempts in this period.</td></tr>}
            </tbody>
            {!!sortedTelecallers.length && <tfoot className="border-t border-border/60 bg-white/[0.02]">
              <tr>
                <th className="px-4 py-3 text-left text-xs">Total</th>
                {visibleCallNumbers.map((number) => {
                  const attemptTotal = callAttemptTotals[number - 1];
                  return <td key={number} className="mono px-4 py-3"><span>{attemptTotal.dialed} dialed</span><span className="mt-1 block text-emerald-400">{attemptTotal.interested} interested</span></td>;
                })}
                <td className="mono px-4 py-3 font-bold text-emerald-400">{totalInterested}</td>
              </tr>
            </tfoot>}
          </table>
        </HorizontalScrollArea>
      </section>

      <section className="mt-8 border border-border/60" data-testid="interested-leads-report">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-[#0c0c0f] px-5 py-4"><div><div className="overline">Interested leads</div><p className="mt-1 text-xs text-muted-foreground">Current pipeline · {interestedLeadTotal} lead{interestedLeadTotal === 1 ? "" : "s"}</p></div><Button variant="outline" onClick={() => navigate("/leads?status=interested")} className="h-9 rounded-none">View all</Button></div>
        <HorizontalScrollArea className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border/60 text-left">{["Lead", "Phone", "Telecaller", "Last updated"].map((heading) => <th key={heading} className="overline px-4 py-3">{heading}</th>)}</tr></thead><tbody>{interestedLeads.map((lead) => <tr key={lead.id} className="border-b border-border/50"><td className="px-4 py-3 font-medium">{lead.name}</td><td className="mono px-4 py-3">{lead.phone || "—"}</td><td className="px-4 py-3">{lead.assigned_to_name || "Unassigned"}</td><td className="px-4 py-3 text-xs text-muted-foreground">{lead.updated_at ? new Date(lead.updated_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td></tr>)}</tbody></table></HorizontalScrollArea>
        {!interestedLeads.length && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No interested leads in the current pipeline.</div>}
      </section>

      {memberReport && <section className="mt-10 border border-brand/40 bg-[#0c0c0f]" data-testid="member-report-detail">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4"><div><div className="overline">Telecaller report</div><h2 className="display mt-1 text-2xl font-bold">{memberReport.member.name}</h2></div><Button variant="outline" onClick={() => setMemberReport(null)} className="rounded-none">Close report</Button></div>
        <div className="grid gap-px bg-border/40 sm:grid-cols-2 lg:grid-cols-5">
          {[['Leads', memberReport.totals.leads], ['Notes', memberReport.totals.notes], ['Converted', memberReport.totals.converted], ['Approved revenue', `₹${Number(memberReport.totals.approved_revenue || 0).toLocaleString("en-IN")}`], ['Calls today', memberReport.periods.today.calls]].map(([label, value]) => <div key={label} className="bg-[#0c0c0f] p-4"><div className="overline">{label}</div><div className="mt-2 text-xl font-bold">{value}</div></div>)}
        </div>
        <div className="grid gap-5 p-5 lg:grid-cols-4"><div><div className="overline mb-3">Revenue by period</div>{[['Today', memberReport.periods.today], ['This week', memberReport.periods.week], ['This month', memberReport.periods.month]].map(([label, period]) => <div key={label} className="flex justify-between border-b border-border/60 py-2 text-sm"><span>{label} · {period.calls} calls</span><strong>₹{Number(period.revenue || 0).toLocaleString("en-IN")}</strong></div>)}</div><div><div className="overline mb-3">Lead status</div>{Object.entries(memberReport.by_status).map(([status, count]) => <div key={status} className="flex justify-between border-b border-border/60 py-2 text-sm capitalize"><span>{status.replaceAll("_", " ")}</span><span>{count}</span></div>)}</div><div><div className="overline mb-3">Recent calls</div>{memberReport.calls.slice(0, 8).map((call) => <div key={call.id} className="border-b border-border/60 py-2 text-xs"><div className="font-semibold">{call.subject}</div><div className="text-muted-foreground">{call.status_code} · {call.created_at ? new Date(call.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</div></div>)}{!memberReport.calls.length && <div className="text-sm text-muted-foreground">No calls recorded.</div>}</div><div><div className="overline mb-3">Recent activity</div>{memberReport.activities.slice(0, 8).map((item) => <div key={item.id} className="border-b border-border/60 py-2 text-xs"><div className="font-semibold">{item.action?.replaceAll("_", " ")}</div><div className="text-muted-foreground">{item.detail || "—"} · {item.created_at ? new Date(item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</div></div>)}{!memberReport.activities.length && <div className="text-sm text-muted-foreground">No activity recorded.</div>}</div></div>
      </section>}

      <div className="mt-10 border border-amber-500/40" data-testid="pending-conversions">
        <div className="border-b border-amber-500/40 bg-amber-500/10 px-5 py-4"><div className="overline">Pending conversion approvals</div></div>
        {pending.map((lead) => <div key={lead.id} className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-4"><div className="min-w-[220px] flex-1"><div className="font-semibold">{lead.name}{lead.conversion_source === "direct" && <span className="ml-2 text-xs font-medium text-muted-foreground">Direct</span>}</div><div className="text-xs text-muted-foreground">{lead.assigned_to_name || "Unassigned"} · {lead.phone}</div></div><Input type="number" min="0.01" step="0.01" aria-label={`Ticket size for ${lead.name}`} placeholder="Ticket size" value={ticketSizes[lead.id] || ""} onChange={(e) => setTicketSizes({ ...ticketSizes, [lead.id]: e.target.value })} className="h-9 w-36 rounded-none" /><Button onClick={() => approve(lead)} className="h-9 rounded-none bg-emerald-600 text-white hover:bg-emerald-700">Approve with ticket</Button><Button variant="outline" onClick={() => approve(lead, true)} className="h-9 rounded-none">Approve without ticket</Button></div>)}
        {!pending.length && <div className="px-5 py-8 text-sm text-muted-foreground">No pending conversions.</div>}
      </div>

      <div className="mt-10 border border-border/60">
        <div className="border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="overline">Team comparison</div>
        </div>
        <table className="w-full text-sm" data-testid="team-report-table">
          <thead className="bg-[#0c0c0f]">
            <tr className="border-b border-border/60 text-left">
              {["Team", "Leads", "Call conversions", "Conv. rate"].map((h) => (
                <th key={h} className="overline px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => (
              <tr key={t.id} data-testid={`team-report-row-${t.id}`} className="border-b border-border/40 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="mono px-4 py-3">{t.total}</td>
                <td className="mono px-4 py-3 text-emerald-400">{t.connected_conversions}</td>
                <td className="mono px-4 py-3 font-semibold">{t.conversion_rate}%</td>
              </tr>
            ))}
            {!data.teams.length && (
              <tr>
                <td colSpan={4} className="px-4 py-14 text-center text-sm text-muted-foreground">
                  No team data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
