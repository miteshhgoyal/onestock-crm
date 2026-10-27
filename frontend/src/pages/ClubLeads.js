import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LeadDrawer from "@/components/LeadDrawer";
import StatusBadge from "@/components/StatusBadge";

const formatProfit = (value) => value == null ? "—" : `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const formatSourceDate = (value) => value ? String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value) : "—";

export default function ClubLeads() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [sellerRefQuery, setSellerRefQuery] = useState("");
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/leads", {
        params: {
          tags: "50-cr-club",
          status: status === "all" ? undefined : status,
          q: query.trim() || undefined,
          club_seller_type: sellerFilter === "all" ? undefined : sellerFilter,
          club_seller_name: sellerRefQuery.trim() || undefined,
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
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setLoading(false);
    }
  }, [page, query, status, sellerFilter, sellerRefQuery, depositStatus, depositMin, depositMax,
    brokerAccountStatus, tradingMode, newBrokerName, currentBrokerName, brokerFilter, brokerUniqueId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/payments/50-cr-club/brokers").then(({ data }) => setBrokers(data.brokers || [])).catch(() => {});
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const resetPage = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="club-leads-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">50 Cr Club · tagged leads</div>
          <h1 className="display mt-2 text-3xl font-black">50 Cr Club Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Converted and active pipeline records marked for the Club.</p>
        </div>
        <div className="mono text-sm text-muted-foreground">{total.toLocaleString("en-IN")} leads</div>
      </div>

      <section className="mt-6 grid gap-3 border-b border-border/60 pb-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="club-lead-filters">
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
        <Select value={sellerFilter} onValueChange={resetPage(setSellerFilter)}>
          <SelectTrigger className="h-9 w-full rounded-none" aria-label="Filter Club leads by seller"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sellers</SelectItem>
            <SelectItem value="direct">Direct / no seller</SelectItem>
            <SelectItem value="seller">Named sellers</SelectItem>
          </SelectContent>
        </Select>
        <Input value={sellerRefQuery} onChange={(event) => resetPage(setSellerRefQuery)(event.target.value)} placeholder="Seller / Ref name" aria-label="Filter by Seller / Ref name" className="h-9 w-full rounded-none" />
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1700px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Client", "Phone", "Joined", "Expires", "Seller / Ref", "Broker", "Broker ID", "Current broker", "New broker", "Account", "Deposit", "Trading", "Expected group profit", "Membership", "Status", "Assigned to"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {items.map((lead) => (
                <tr key={lead.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                  <td className="px-4 py-3"><button type="button" onClick={() => setOpenLeadId(lead.id)} className="text-left font-semibold hover:text-brand hover:underline underline-offset-4">{lead.name}</button><div className="mt-1 text-xs text-muted-foreground">{lead.email || lead.company || "50 Cr Club"}</div></td>
                  <td className="mono px-4 py-3">{lead.phone || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(lead.club_joined_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(lead.club_expires_at)}</td>
                  <td className="px-4 py-3">{lead.club_seller_type === "seller" && lead.club_seller_name ? lead.club_seller_name : "Direct"}</td>
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
                  <td className="px-4 py-3">{lead.assigned_to_name || "Unassigned"}</td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={16} className="px-5 py-12 text-center text-sm text-muted-foreground">{loading ? "Loading Club leads…" : "No leads match these Club filters."}</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span className="mono text-xs text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
        </div>}
      </section>

      <LeadDrawer leadId={openLeadId} open={Boolean(openLeadId)} onOpenChange={(open) => !open && setOpenLeadId(null)} onChanged={load} />
    </div>
  );
}
