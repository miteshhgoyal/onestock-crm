import { useCallback, useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LeadDrawer from "@/components/LeadDrawer";
import StatusBadge from "@/components/StatusBadge";
import HorizontalScrollArea from "@/components/HorizontalScrollArea";
import { useAuth } from "@/context/AuthContext";
import MyFiftyCrClub from "@/pages/MyFiftyCrClub";

const formatProfit = (value) => value == null ? "—" : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const formatSourceDate = (value) => value ? String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value) : "—";

export default function ClubLeads() {
    const { user } = useAuth();
    if (!user) return null;
    if (user.role === "telecaller" && user.is_50_cr_club_rm) return <MyFiftyCrClub />;
    return <ManagedClubLeads canExport={user.role === "admin"} />;
  }

  function ManagedClubLeads({ canExport }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [assigneeStats, setAssigneeStats] = useState([]);
  const [telecallers, setTelecallers] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [assignedTo, setAssignedTo] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [sellerRefQuery, setSellerRefQuery] = useState("");
  const [clubExpiryStatus, setClubExpiryStatus] = useState("all");
  const [clubJoinedFrom, setClubJoinedFrom] = useState("");
  const [clubJoinedTo, setClubJoinedTo] = useState("");
  const [clubExpiresFrom, setClubExpiresFrom] = useState("");
  const [clubExpiresTo, setClubExpiresTo] = useState("");
  const [depositStatus, setDepositStatus] = useState("all");
  const [depositMin, setDepositMin] = useState("");
  const [depositMax, setDepositMax] = useState("");
  const [brokerAccountStatus, setBrokerAccountStatus] = useState("all");
  const [tradingMode, setTradingMode] = useState("all");
  const [newBrokerName, setNewBrokerName] = useState("");
  const [currentBrokerName, setCurrentBrokerName] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [brokers, setBrokers] = useState([]);
  const [brokerUniqueId, setBrokerUniqueId] = useState("");
  const [page, setPage] = useState(1);
  const [openLeadId, setOpenLeadId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/leads", {
        params: {
          tags: "50-cr-club",
          status: status === "all" ? undefined : status,
          assigned_to: assignedTo === "all" ? undefined : assignedTo,
          q: query.trim() || undefined,
          club_seller_type: sellerFilter === "all" ? undefined : sellerFilter,
          club_seller_name: sellerRefQuery.trim() || undefined,
          club_expiry_status: clubExpiryStatus === "all" ? undefined : clubExpiryStatus,
          club_joined_from: clubJoinedFrom || undefined,
          club_joined_to: clubJoinedTo || undefined,
          club_expires_from: clubExpiresFrom || undefined,
          club_expires_to: clubExpiresTo || undefined,
          deposit_status: depositStatus === "all" ? undefined : depositStatus,
          deposit_min: depositMin === "" ? undefined : Number(depositMin),
          deposit_max: depositMax === "" ? undefined : Number(depositMax),
          broker_account_status: brokerAccountStatus === "all" ? undefined : brokerAccountStatus,
          trading_mode: tradingMode === "all" ? undefined : tradingMode,
          new_broker_name: newBrokerName.trim() || undefined,
          current_broker_name: currentBrokerName.trim() || undefined,
          broker_name: brokerFilter === "all" ? undefined : brokerFilter,
          broker_unique_id: brokerUniqueId.trim() || undefined,
          page,
          limit: 50,
        },
      });
      setItems(data.items || []);
      setTotal(data.total || 0);
      setAssigneeStats(data.assignee_stats || []);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  }, [page, query, status, assignedTo, sellerFilter, sellerRefQuery, clubExpiryStatus, clubJoinedFrom, clubJoinedTo,
    clubExpiresFrom, clubExpiresTo, depositStatus, depositMin, depositMax,
    brokerAccountStatus, tradingMode, newBrokerName, currentBrokerName, brokerFilter, brokerUniqueId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/payments/50-cr-club/brokers").then(({ data }) => setBrokers(data.brokers || [])).catch(() => {});
  }, []);
  useEffect(() => {
    api.get("/users", { params: { role: "telecaller" } })
      .then(({ data }) => setTelecallers(data || []))
      .catch(() => {});
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const accountOpenedCount = assigneeStats.reduce((sum, assignee) => sum + assignee.account_opened, 0);
  const depositMadeCount = assigneeStats.reduce((sum, assignee) => sum + assignee.deposit_made, 0);
  const assigneeStatsById = new Map(assigneeStats.map((assignee) => [assignee.id || "unassigned", assignee]));
  const assigneeRows = [
    ...telecallers.map((telecaller) => ({
      id: telecaller.id,
      name: telecaller.name,
      role: telecaller.is_50_cr_club_rm ? "50 Cr Club RM" : "Telecaller",
      total: assigneeStatsById.get(telecaller.id)?.total || 0,
    })),
    ...assigneeStats.filter((assignee) => assignee.id && !telecallers.some((telecaller) => telecaller.id === assignee.id))
      .map((assignee) => ({ id: assignee.id, name: assignee.name, role: "Former telecaller", total: assignee.total })),
    ...(assigneeStatsById.has("unassigned") ? [{ id: "unassigned", name: "Unassigned", role: "No assignee", total: assigneeStatsById.get("unassigned").total }] : []),
  ];
  const hasActiveFilters = [
    query,
    status !== "all",
    assignedTo !== "all",
    sellerFilter !== "all",
    sellerRefQuery,
    clubExpiryStatus !== "all",
    clubJoinedFrom,
    clubJoinedTo,
    clubExpiresFrom,
    clubExpiresTo,
    depositStatus !== "all",
    depositMin,
    depositMax,
    brokerAccountStatus !== "all",
    tradingMode !== "all",
    newBrokerName,
    currentBrokerName,
    brokerFilter !== "all",
    brokerUniqueId,
  ].some(Boolean);
  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };
  const clearAllFilters = () => {
    setQuery("");
    setStatus("all");
    setAssignedTo("all");
    setSellerFilter("all");
    setSellerRefQuery("");
    setClubExpiryStatus("all");
    setClubJoinedFrom("");
    setClubJoinedTo("");
    setClubExpiresFrom("");
    setClubExpiresTo("");
    setDepositStatus("all");
    setDepositMin("");
    setDepositMax("");
    setBrokerAccountStatus("all");
    setTradingMode("all");
    setNewBrokerName("");
    setCurrentBrokerName("");
    setBrokerFilter("all");
    setBrokerUniqueId("");
    setPage(1);
  };
  const exportLeads = async () => {
    setExporting(true);
    try {
      const { data } = await api.get("/leads/50-cr-club/export", {
        params: { assigned_to: assignedTo === "all" ? undefined : assignedTo },
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `50-cr-club-leads-${assignedTo === "all" ? "all-rms" : assignedTo === "none" ? "unassigned" : assignedTo}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Club leads CSV downloaded");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setExporting(false);
    }
  };
  const isExpired = (lead) => {
    const expiry = formatSourceDate(lead.club_expires_at || lead.member_profile?.expires_at);
    if (!expiry || expiry === "—") return false;
    const expiryDate = new Date(`${expiry}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiryDate < today;
  };

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="club-leads-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">50 Cr Club · tagged leads</div>
          <h1 className="display mt-2 text-3xl font-black">50 Cr Club Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Converted and active pipeline records marked for the Club.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={clearAllFilters} disabled={!hasActiveFilters} className="rounded-none border-border/70" aria-label="Clear all Club filters">Clear all filters</Button>
          {canExport && <Button type="button" variant="outline" onClick={exportLeads} disabled={exporting} className="rounded-none border-border/70" aria-label="Download 50 Cr Club leads CSV"><Download size={14} className="mr-2" />{exporting ? "Exporting…" : "Download CSV"}</Button>}
          <div className="mono text-sm text-muted-foreground">{total.toLocaleString("en-IN")} leads</div>
        </div>
      </div>

      <section className="mt-6 grid gap-px border border-border/60 bg-border/60 sm:grid-cols-3" data-testid="club-lead-summary">
        {[["Total leads", total], ["Account opened", accountOpenedCount], ["Deposit made", depositMadeCount]].map(([label, value]) => (
          <div key={label} className="bg-background px-5 py-4">
            <div className="overline">{label}</div>
            <div className="mono mt-2 text-2xl font-bold">{value.toLocaleString("en-IN")}</div>
          </div>
        ))}
      </section>

      <section className="mt-5 border border-border/60" data-testid="club-lead-assignee-summary">
        <div className="border-b border-border/60 px-5 py-3">
          <div className="overline">Leads by telecaller and RM</div>
        </div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-left"><tr className="border-b border-border/60">
              <th className="overline px-5 py-2">Telecaller / RM</th>
              <th className="overline px-5 py-2">Role</th>
              <th className="overline px-5 py-2 text-right">Total leads</th>
            </tr></thead>
            <tbody>{assigneeRows.map((assignee) => (
              <tr key={assignee.id} className="border-b border-border/40 last:border-0">
                <td className="px-5 py-2">{assignee.name}</td>
                <td className="px-5 py-2 text-muted-foreground">{assignee.role}</td>
                <td className="mono px-5 py-2 text-right">{assignee.total.toLocaleString("en-IN")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 grid gap-3 border-b border-border/60 pb-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="club-lead-filters">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
          <Input value={query} onChange={(event) => resetPage(setQuery)(event.target.value)} placeholder="Search Club leads" aria-label="Search 50 Cr Club leads" className="h-9 w-full rounded-none pl-9" />
        </div>
        <Select value={status} onValueChange={resetPage(setStatus)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter Club leads by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="follow_up">Follow-up</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
        <Select value={assignedTo} onValueChange={resetPage(setAssignedTo)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter by assigned telecaller or RM"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All telecallers and RMs</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {telecallers.map((telecaller) => <SelectItem key={telecaller.id} value={telecaller.id}>{telecaller.name}{telecaller.is_50_cr_club_rm ? " · RM" : " · Telecaller"}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sellerFilter} onValueChange={resetPage(setSellerFilter)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter Club leads by seller"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sellers</SelectItem>
            <SelectItem value="direct">Direct / no seller</SelectItem>
            <SelectItem value="seller">Named sellers</SelectItem>
          </SelectContent>
        </Select>
        <Input value={sellerRefQuery} onChange={(event) => resetPage(setSellerRefQuery)(event.target.value)} placeholder="Seller / Ref name" aria-label="Filter by Seller / Ref name" className="h-9 w-full rounded-none" />
        <Select value={clubExpiryStatus} onValueChange={resetPage(setClubExpiryStatus)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter Club leads by expiry status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All expiry status</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="expired_unpaid">Expired unpaid</SelectItem>
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <span className="overline block">Joining range</span>
          <div className="flex gap-2">
            <Input type="date" value={clubJoinedFrom} onChange={(event) => resetPage(setClubJoinedFrom)(event.target.value)} placeholder="From" aria-label="Joining range from date" className="h-9 w-full rounded-none" />
            <Input type="date" value={clubJoinedTo} onChange={(event) => resetPage(setClubJoinedTo)(event.target.value)} placeholder="To" aria-label="Joining range to date" className="h-9 w-full rounded-none" />
          </div>
        </div>
        <div className="space-y-1">
          <span className="overline block">Expiry range</span>
          <div className="flex gap-2">
            <Input type="date" value={clubExpiresFrom} onChange={(event) => resetPage(setClubExpiresFrom)(event.target.value)} placeholder="From" aria-label="Expiry range from date" className="h-9 w-full rounded-none" />
            <Input type="date" value={clubExpiresTo} onChange={(event) => resetPage(setClubExpiresTo)(event.target.value)} placeholder="To" aria-label="Expiry range to date" className="h-9 w-full rounded-none" />
          </div>
        </div>
        <Select value={depositStatus} onValueChange={resetPage(setDepositStatus)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter by deposit status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All deposit statuses</SelectItem>
            <SelectItem value="made">Deposit made</SelectItem>
            <SelectItem value="not_made">No deposit</SelectItem>
            <SelectItem value="not_recorded">Deposit not recorded</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" min="0" step="0.01" value={depositMin} onChange={(event) => resetPage(setDepositMin)(event.target.value)} placeholder="Min deposit" aria-label="Minimum deposit amount" className="h-9 w-full rounded-none" />
        <Input type="number" min="0" step="0.01" value={depositMax} onChange={(event) => resetPage(setDepositMax)(event.target.value)} placeholder="Max deposit" aria-label="Maximum deposit amount" className="h-9 w-full rounded-none" />
        <Select value={brokerAccountStatus} onValueChange={resetPage(setBrokerAccountStatus)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter by broker account status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All account statuses</SelectItem>
            <SelectItem value="opened">Account opened</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="not_opened">Not opened</SelectItem>
            <SelectItem value="not_required">Not required</SelectItem>
            <SelectItem value="not_recorded">Not recorded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tradingMode} onValueChange={resetPage(setTradingMode)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter by trading mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All trading modes</SelectItem>
            <SelectItem value="self">Self</SelectItem>
            <SelectItem value="group">Group</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
        <Input value={currentBrokerName} onChange={(event) => resetPage(setCurrentBrokerName)(event.target.value)} placeholder="Current broker" aria-label="Filter by current broker" className="h-9 w-full rounded-none" />
        <Input value={newBrokerName} onChange={(event) => resetPage(setNewBrokerName)(event.target.value)} placeholder="New broker" aria-label="Filter by new broker" className="h-9 w-full rounded-none" />
        <Select value={brokerFilter} onValueChange={resetPage(setBrokerFilter)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter by broker"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All brokers</SelectItem>{brokers.map((broker) => <SelectItem key={broker} value={broker}>{broker}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={brokerUniqueId} onChange={(event) => resetPage(setBrokerUniqueId)(event.target.value)} placeholder="Broker unique ID" aria-label="Filter by broker unique ID" className="h-9 w-full rounded-none" />
      </section>

      <section className="mt-5 border border-border/60" data-testid="club-leads-table">
        <div className="flex items-center justify-between border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="overline">Club client records</div>
          <div className="mono text-xs text-muted-foreground">{items.length} of {total} shown</div>
        </div>
        <HorizontalScrollArea className="overflow-x-auto" aria-label="Scroll 50 Cr Club leads table">
          <table className="w-full min-w-[1700px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Client", "Phone", "Joined", "Expires", "Seller / Ref", "Assigned to", "Broker", "Broker ID", "Current broker", "New broker", "Account", "Deposit", "Trading", "Expected group profit", "Membership", "Status"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {items.map((lead) => {
                const expired = isExpired(lead);
                return (
                  <tr key={lead.id} className={`border-b border-border/50 hover:bg-white/[0.03] ${expired ? "bg-red-500/10 animate-pulse" : ""}`}>
                    <td className="px-4 py-3"><button type="button" onClick={() => setOpenLeadId(lead.id)} className="cursor-pointer text-left font-semibold hover:text-brand hover:underline underline-offset-4">{lead.name}</button><div className="mt-1 text-xs text-muted-foreground">{lead.email || lead.company || "50 Cr Club"}</div></td>
                    <td className="mono px-4 py-3">{lead.phone || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(lead.club_joined_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{expired ? <span className="font-semibold text-red-600">{formatSourceDate(lead.club_expires_at)}</span> : formatSourceDate(lead.club_expires_at)}</td>
                    <td className="px-4 py-3">{lead.club_seller_type === "seller" && lead.club_seller_name ? lead.club_seller_name : "Direct"}</td>
                    <td className="px-4 py-3">{lead.assigned_to_name || "Unassigned"}</td>
                    <td className="px-4 py-3">{lead.broker_name || "—"}</td>
                    <td className="mono px-4 py-3">{lead.broker_unique_id || "—"}</td>
                    <td className="px-4 py-3">{lead.current_broker_name || lead.broker_name || "—"}</td>
                    <td className="px-4 py-3">{lead.new_broker_name || "—"}</td>
                    <td className="px-4 py-3 capitalize">{lead.broker_account_status?.replaceAll("_", " ") || "Not recorded"}</td>
                    <td className="px-4 py-3">{lead.deposit_made == null ? "Not recorded" : lead.deposit_made ? "Yes" : "No"}{lead.deposit_amount != null && <span className="mono mt-1 block text-xs text-muted-foreground">{formatProfit(lead.deposit_amount)}</span>}</td>
                    <td className="px-4 py-3 capitalize">{lead.trading_mode || "Not recorded"}</td>
                    <td className="mono px-4 py-3">{formatProfit(lead.expected_group_profit)}</td>
                    <td className="px-4 py-3">{lead.membership_enabled == null ? "Not checked" : lead.membership_enabled ? "Enabled" : "Disabled"}</td>
                    <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  </tr>
                );
              })}
              {!items.length && <tr><td colSpan={16} className="px-5 py-12 text-center text-sm text-muted-foreground">{loading ? "Loading Club leads…" : "No leads match these Club filters."}</td></tr>}
            </tbody>
          </table>
        </HorizontalScrollArea>
        {pageCount > 1 && <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span className="mono text-xs text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
        </div>}
      </section>

      <LeadDrawer leadId={openLeadId} open={Boolean(openLeadId)} onOpenChange={(open) => !open && setOpenLeadId(null)} onChanged={load} />
    </div>
  );
}
