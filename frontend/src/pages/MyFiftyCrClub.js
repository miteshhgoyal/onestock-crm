import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, History, Pencil, Phone, RefreshCw, Search, Save } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LeadDrawer from "@/components/LeadDrawer";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const formatDate = (value) => value
  ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  : "—";
const formatSourceDate = (value) => value ? String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value) : "—";

const formatAmount = (amount, currency) => amount == null
  ? "—"
  : `${currency ? `${currency} ` : ""}${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function MyFiftyCrClub() {
  const [items, setItems] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [openLeadId, setOpenLeadId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [profileDraft, setProfileDraft] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [callingId, setCallingId] = useState(null);
  const [historyItem, setHistoryItem] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [{ data }, { data: brokerData }] = await Promise.all([
        api.get("/payments/50-cr-club/my-leads"),
        api.get("/payments/50-cr-club/brokers"),
      ]);
      setItems(data.items || []);
      setBrokers(brokerData.brokers || []);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const filteredItems = items.filter((item) => {
    if (statusFilter !== "all" && item.club_status !== statusFilter) return false;
    const haystack = [item.crm_lead?.name, item.user?.name, item.user?.phone, item.user?.email,
      item.club?.offering, item.club?.claimed_market, item.payment?.status,
      item.member_profile?.broker_name, item.member_profile?.broker_unique_id,
      item.club?.joined_at, item.club?.expires_at]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 50));
  const pageItems = filteredItems.slice((page - 1) * 50, page * 50);

  const openProfile = (item) => {
    const profile = item.member_profile || {};
    setSelectedItem(item);
    setProfileDraft({
      club_seller_type: profile.club_seller_type || "not_recorded",
      club_seller_name: profile.club_seller_name || "",
      broker_name: profile.broker_name || "",
      broker_unique_id: profile.broker_unique_id || "",
      new_broker_name: profile.new_broker_name || "",
      current_broker_name: profile.current_broker_name || "",
      broker_account_status: profile.broker_account_status || "not_recorded",
      deposit_made: profile.deposit_made === true ? "yes" : profile.deposit_made === false ? "no" : "not_recorded",
      deposit_amount: profile.deposit_amount ?? "",
      trading_mode: profile.trading_mode || "not_recorded",
      expected_group_profit: profile.expected_group_profit ?? "",
      product_in_use: profile.product_in_use === true ? "yes" : profile.product_in_use === false ? "no" : "not_recorded",
      membership_enabled: profile.membership_enabled === true ? "yes" : profile.membership_enabled === false ? "no" : "not_recorded",
      follow_up_routine: profile.follow_up_routine || "",
      next_follow_up_at: profile.next_follow_up_at ? new Date(profile.next_follow_up_at).toISOString().slice(0, 16) : "",
    });
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!selectedItem) return;
    setSavingProfile(true);
    const payload = {
      club_seller_type: profileDraft.club_seller_type === "not_recorded" ? null : profileDraft.club_seller_type,
      club_seller_name: profileDraft.club_seller_name.trim() || null,
      broker_name: profileDraft.broker_name.trim() || null,
      broker_unique_id: profileDraft.broker_unique_id.trim() || null,
      new_broker_name: profileDraft.new_broker_name.trim() || null,
      current_broker_name: profileDraft.current_broker_name.trim() || null,
      broker_account_status: profileDraft.broker_account_status === "not_recorded" ? null : profileDraft.broker_account_status,
      deposit_made: profileDraft.deposit_made === "not_recorded" ? null : profileDraft.deposit_made === "yes",
      deposit_amount: profileDraft.deposit_amount === "" ? null : Number(profileDraft.deposit_amount),
      trading_mode: profileDraft.trading_mode === "not_recorded" ? null : profileDraft.trading_mode,
      expected_group_profit: profileDraft.expected_group_profit === "" ? null : Number(profileDraft.expected_group_profit),
      product_in_use: profileDraft.product_in_use === "not_recorded" ? null : profileDraft.product_in_use === "yes",
      membership_enabled: profileDraft.membership_enabled === "not_recorded" ? null : profileDraft.membership_enabled === "yes",
      follow_up_routine: profileDraft.follow_up_routine.trim() || null,
      next_follow_up_at: profileDraft.next_follow_up_at ? new Date(profileDraft.next_follow_up_at).toISOString() : null,
    };
    try {
      const { data } = await api.patch(`/payments/50-cr-club/purchases/${selectedItem.id}/member-profile`, payload);
      setItems((current) => current.map((item) => item.id === data.id ? { ...item, ...data } : item));
      setSelectedItem((current) => current ? { ...current, ...data } : null);
      toast.success("50 Cr member profile saved");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingProfile(false);
    }
  };

  const updateClubStatus = async (item, status) => {
    try {
      const { data } = await api.patch(`/payments/50-cr-club/purchases/${item.id}/status`, { status });
      setItems((current) => current.map((record) => record.id === item.id
        ? { ...record, club_status: data.club_status }
        : record));
      toast.success("Club status updated");
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const callClient = async (item) => {
    const phone = item.crm_lead?.phone || item.user?.phone;
    if (!phone) return;
    setCallingId(item.id);
    try {
      await api.post("/calls/click-to-call", {
        destination_number: phone,
        payment_club_event_id: item.id,
      });
      toast.success("Call initiated");
      setItems((current) => current.map((record) => record.id === item.id
        ? { ...record, call_count: (record.call_count || 0) + 1, last_dialed_at: new Date().toISOString() }
        : record));
      if (historyItem?.id === item.id) loadCallHistory(item);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setCallingId(null);
    }
  };

  const loadCallHistory = async (item) => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/payments/50-cr-club/purchases/${item.id}/calls`);
      setCallHistory(data || []);
      setHistoryItem(item);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const brokerOptions = [...new Set([...brokers, ...(profileDraft.broker_name ? [profileDraft.broker_name] : [])])];

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="my-50-cr-club-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">Assigned to you · Verified purchases only</div>
          <h1 className="display mt-2 text-3xl font-black">My 50 Cr Club clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Club assignments are separate from your CRM lead queue.</p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading} className="rounded-none border-border/70" aria-label="Refresh my 50 Cr Club leads">
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      <section className="mt-6 grid gap-px border border-border/60 bg-border/60 sm:grid-cols-2" data-testid="my-club-summary">
        {[["Verified assigned leads", items.length], ["Calls initiated", items.reduce((total, item) => total + (item.call_count || 0), 0)]].map(([label, value]) => (
          <div key={label} className="bg-background px-5 py-4"><div className="overline">{label}</div><div className="mono mt-2 text-2xl font-bold">{value.toLocaleString("en-IN")}</div></div>
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search your Club leads" aria-label="Search my 50 Cr Club leads" className="h-9 w-full rounded-none pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
          <SelectTrigger className="h-9 w-full rounded-none sm:w-48" aria-label="Filter by Club status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Club statuses</SelectItem>
            <SelectItem value="unworked">Unworked</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="follow_up">Follow-up</SelectItem>
            <SelectItem value="enrolled">Enrolled</SelectItem>
            <SelectItem value="not_interested">Not interested</SelectItem>
            <SelectItem value="lost">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section className="mt-5 border border-border/60" data-testid="my-club-leads-table">
        <div className="flex items-center justify-between border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
          <div className="overline">Verified Club leads</div>
          <div className="mono text-xs text-muted-foreground">{filteredItems.length.toLocaleString("en-IN")} records</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1450px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Club client", "Assigned RM", "Relationship owner", "Phone", "Joined", "Expires", "Offering", "Market", "Payment", "Membership", "Next follow-up", "Calls", "Last dialed", "Club status", "Actions"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {pageItems.map((item) => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="font-semibold" data-testid={`my-club-purchase-${item.id}`}>{item.crm_lead?.name || item.user?.name || "Club client"}</div>
                    {item.crm_lead && <div className="mt-1 text-xs text-muted-foreground">CRM record linked separately</div>}
                  </td>
                  <td className="px-4 py-3 text-sm">{item.assigned_to_name || "Unassigned"}</td>
                  <td className="px-4 py-3 text-sm">{item.member_profile?.club_seller_type === "direct" ? "Direct client" : item.member_profile?.club_seller_name || item.club?.seller_name || "Not recorded"}</td>
                  <td className="mono px-4 py-3">{item.crm_lead?.phone || item.user?.phone || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(item.club?.joined_at || item.member_profile?.joined_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(item.club?.expires_at || item.member_profile?.expires_at)}</td>
                  <td className="px-4 py-3">{item.club?.offering || item.payment?.product || "—"}</td>
                  <td className="px-4 py-3">{item.club?.claimed_market || "—"}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} /> Verified</span><div className="mono mt-1 text-xs text-muted-foreground">{formatAmount(item.payment?.amount, item.payment?.currency)}</div></td>
                  <td className="px-4 py-3 text-xs">{item.member_profile?.membership_enabled === true ? <span className="text-emerald-700">Enabled</span> : item.member_profile?.membership_enabled === false ? <span className="text-red-600">Disabled</span> : <span className="text-muted-foreground">Not checked</span>}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDate(item.member_profile?.next_follow_up_at)}</td>
                  <td className="mono px-4 py-3">{item.call_count || 0}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatDate(item.last_dialed_at)}</td>
                  <td className="px-4 py-3"><Select value={item.club_status || "unworked"} onValueChange={(status) => updateClubStatus(item, status)}><SelectTrigger aria-label={`Change ${item.user?.name || item.crm_lead?.name || "client"} Club status`} className="h-8 w-36 rounded-none"><SelectValue /></SelectTrigger><SelectContent>{[["unworked", "Unworked"], ["contacted", "Contacted"], ["follow_up", "Follow-up"], ["enrolled", "Enrolled"], ["not_interested", "Not interested"], ["lost", "Closed"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5"><Button type="button" size="sm" variant="outline" onClick={() => callClient(item)} disabled={callingId === item.id || !(item.crm_lead?.phone || item.user?.phone)} className="h-8 rounded-none"><Phone size={14} className="mr-1.5" />{callingId === item.id ? "Calling" : "Call"}</Button><Button type="button" size="sm" variant="outline" onClick={() => loadCallHistory(item)} className="h-8 rounded-none" aria-label={`View ${item.call_count || 0} calls for ${item.user?.name || item.crm_lead?.name}`}><History size={14} className="mr-1.5" />Calls ({item.call_count || 0})</Button><Button type="button" size="sm" variant="outline" onClick={() => openProfile(item)} className="h-8 rounded-none" aria-label="Edit Club profile"><Pencil size={14} /></Button>{item.crm_lead && <Button type="button" size="sm" variant="outline" onClick={() => setOpenLeadId(item.crm_lead.id)} className="h-8 rounded-none" aria-label="Open linked CRM lead"><ExternalLink size={14} /></Button>}</div></td>
                </tr>
              ))}
              {!pageItems.length && <tr><td colSpan={13} className="px-5 py-12 text-center text-sm text-muted-foreground">{loading ? "Loading your assigned Club purchases…" : "No Club purchases match these filters."}</td></tr>}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span className="mono text-xs text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
        </div>}
      </section>

      <Sheet open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <SheetContent className="w-full overflow-y-auto border-l border-border/60 bg-background p-0 sm:max-w-xl" data-testid="club-member-profile-editor">
          {selectedItem && <>
            <SheetHeader className="border-b border-border/60 px-6 py-6 pr-14 text-left">
              <div className="overline">Telecaller member check-in</div>
              <SheetTitle className="display mt-1 text-2xl">{selectedItem.crm_lead?.name || selectedItem.user?.name || "Club member"}</SheetTitle>
              <SheetDescription>{selectedItem.crm_lead?.phone || selectedItem.user?.phone || "No phone"} · {selectedItem.club?.offering || selectedItem.payment?.product || "50 Cr Club"}</SheetDescription>
            </SheetHeader>
            <form onSubmit={saveProfile} className="space-y-5 px-6 py-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 text-sm sm:col-span-2 border border-border/60 bg-[#0c0c0f]/50 px-3 py-2">
                  <div className="overline">Work owner vs relationship owner</div>
                  <div className="text-sm text-foreground">Assigned RM: <span className="font-medium">{selectedItem.assigned_to_name || "Unassigned"}</span></div>
                </div>
                <label className="space-y-1.5 text-sm"><span className="overline">Relationship owner source</span><select value={profileDraft.club_seller_type || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, club_seller_type: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="direct">Direct</option><option value="seller">Seller</option></select></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Seller / relationship owner</span><Input value={profileDraft.club_seller_name || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, club_seller_name: event.target.value }))} placeholder="Seller name" maxLength={120} /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Broker used</span><Select value={profileDraft.broker_name || "not_recorded"} onValueChange={(value) => setProfileDraft((draft) => ({ ...draft, broker_name: value === "not_recorded" ? "" : value }))}><SelectTrigger className="rounded-none"><SelectValue placeholder="Select broker" /></SelectTrigger><SelectContent><SelectItem value="not_recorded">Not recorded</SelectItem>{brokerOptions.length ? brokerOptions.map((broker) => <SelectItem key={broker} value={broker}>{broker}</SelectItem>) : <SelectItem value="__none" disabled>No brokers configured</SelectItem>}</SelectContent></Select></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Broker unique ID</span><Input value={profileDraft.broker_unique_id || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, broker_unique_id: event.target.value }))} placeholder="Client or account ID" maxLength={160} /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">New broker name</span><Input value={profileDraft.new_broker_name || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, new_broker_name: event.target.value }))} placeholder="New broker" maxLength={120} /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Current broker name</span><Input value={profileDraft.current_broker_name || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, current_broker_name: event.target.value }))} placeholder="Current broker" maxLength={120} /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Broker account opening</span><select value={profileDraft.broker_account_status || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, broker_account_status: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="opened">Account opened</option><option value="in_progress">In progress</option><option value="not_opened">Not opened</option><option value="not_required">Not required</option></select></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Deposit made?</span><select value={profileDraft.deposit_made || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, deposit_made: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Deposit amount (INR)</span><Input type="number" min="0" step="0.01" value={profileDraft.deposit_amount ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, deposit_amount: event.target.value }))} placeholder="Amount" /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">How do they trade?</span><select value={profileDraft.trading_mode || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, trading_mode: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="self">Self</option><option value="group">Group</option><option value="both">Both</option></select></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Expected group profit (INR)</span><Input type="number" min="0" step="0.01" value={profileDraft.expected_group_profit ?? ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, expected_group_profit: event.target.value }))} placeholder="Amount" /></label>
                <label className="space-y-1.5 text-sm"><span className="overline">Still using the product?</span><select value={profileDraft.product_in_use || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, product_in_use: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not checked</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                <label className="space-y-1.5 text-sm sm:col-span-2"><span className="overline">Membership enabled?</span><select value={profileDraft.membership_enabled || "not_recorded"} onChange={(event) => setProfileDraft((draft) => ({ ...draft, membership_enabled: event.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not checked</option><option value="yes">Enabled</option><option value="no">Disabled</option></select></label>
              </div>
              <label className="block space-y-1.5 text-sm"><span className="overline">Routine follow-up notes</span><textarea value={profileDraft.follow_up_routine || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, follow_up_routine: event.target.value }))} rows={4} maxLength={1000} placeholder="Preferred day/time, follow-up cadence, or agreed next steps" className="w-full resize-y border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
              <label className="block space-y-1.5 text-sm"><span className="overline">Next follow-up</span><Input type="datetime-local" value={profileDraft.next_follow_up_at || ""} onChange={(event) => setProfileDraft((draft) => ({ ...draft, next_follow_up_at: event.target.value }))} /></label>
              <div className="flex justify-end border-t border-border/60 pt-4"><Button type="submit" disabled={savingProfile} className="rounded-none"><Save size={14} className="mr-2" />{savingProfile ? "Saving…" : "Save member details"}</Button></div>
            </form>
          </>}
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(historyItem)} onOpenChange={(open) => !open && setHistoryItem(null)}>
        <SheetContent className="w-full overflow-y-auto border-l border-border/60 bg-background p-0 sm:max-w-xl">
          {historyItem && <>
            <SheetHeader className="border-b border-border/60 px-6 py-6 pr-14 text-left"><div className="overline">RM dial history</div><SheetTitle className="display mt-1 text-2xl">{historyItem.crm_lead?.name || historyItem.user?.name || "Club client"}</SheetTitle><SheetDescription>{historyItem.crm_lead?.phone || historyItem.user?.phone || "No phone"} · {callHistory.length} call attempts</SheetDescription></SheetHeader>
            <div className="space-y-2 px-6 py-6">
              {historyLoading && !callHistory.length && <p className="text-sm text-muted-foreground">Loading call history…</p>}
              {!historyLoading && !callHistory.length && <p className="border border-border/60 px-4 py-6 text-sm text-muted-foreground">No calls recorded for this client.</p>}
              {callHistory.map((call) => <div key={call.id} className="flex items-start justify-between gap-3 border border-border/60 px-4 py-3"><div><div className="text-sm font-medium">{call.error || call.status_code >= 400 ? "Failed" : call.connected === true ? "Connected" : call.connected === false ? "Not connected" : "Dialed"}</div><div className="mt-1 text-xs text-muted-foreground">{call.user_name || "RM"} · {call.error || call.disposition || `${call.call_mode || "Phone"} call`}</div></div><div className="text-right"><div className="mono text-xs">{formatDate(call.created_at)}</div>{call.duration != null && <div className="mono mt-1 text-xs text-muted-foreground">{call.duration}s</div>}</div></div>)}
            </div>
          </>}
        </SheetContent>
      </Sheet>

      <LeadDrawer leadId={openLeadId} open={Boolean(openLeadId)} onOpenChange={(open) => !open && setOpenLeadId(null)} onChanged={() => load(true)} />
    </div>
  );
}