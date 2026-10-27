import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, ListRestart, Pencil, PhoneCall, Save, Search } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtDate, relative } from "@/lib/constants";
import StatusBadge from "@/components/StatusBadge";
import LeadPanel from "@/components/LeadPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const CLUB_STATUS_LABEL = {
  unworked: "Unworked",
  contacted: "Contacted",
  follow_up: "Follow-up",
  enrolled: "Enrolled",
  not_interested: "Not interested",
  lost: "Closed",
};

const sourceDate = (value) => value ? String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value) : "—";

const TABS = [
  ["untouched", "Unworked"],
  ["today", "Due today"],
  ["overdue", "Overdue"],
  ["", "All assigned leads"],
];

const CLUB_TABS = [
  ["unworked", "Unworked"],
  ["contacted", "Contacted"],
  ["follow_up", "Follow-up"],
  ["enrolled", "Enrolled"],
  ["not_interested", "Not interested"],
  ["lost", "Closed"],
  ["", "All Club clients"],
];

export default function Workspace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const crmBucket = user?.role === "telecaller" ? "" : "today";
  const [mode, setMode] = useState(user?.is_50_cr_club_rm ? "club" : "crm");
  const [bucket, setBucket] = useState(crmBucket);
  const [clubBucket, setClubBucket] = useState("unworked");
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState("");
  const [courses, setCourses] = useState([]);
  const [callingClubId, setCallingClubId] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const activeBucket = mode === "club" ? clubBucket : bucket;

  const load = useCallback(async (requestedPage = page) => {
    setLoadingMore(requestedPage > 1);
    try {
      const result = await queryClient.fetchQuery({
        queryKey: ["workspace-queue", user?.id, mode, activeBucket, requestedPage],
        queryFn: async () => {
          if (mode === "club") {
            const { data } = await api.get("/payments/50-cr-club/my-leads", {
              params: { ...(clubBucket ? { club_status: clubBucket } : {}), page: requestedPage, limit: 100 },
            });
            return {
              ...data,
              items: (data.items || []).map((item) => ({
                ...item,
                name: item.crm_lead?.name || item.user?.name || "Club client",
                phone: item.crm_lead?.phone || item.user?.phone || "",
                email: item.crm_lead?.email || item.user?.email || "",
                status: item.club_status || "unworked",
                isClubRecord: true,
              })),
            };
          }
          const { data } = await api.get("/leads", {
            params: { bucket: bucket || undefined, exclude_club: true, limit: 100, page: requestedPage },
          });
          return data;
        },
        staleTime: 30_000,
      });
      const pageItems = result.items || [];
      setItems((current) => requestedPage === 1
        ? pageItems
        : [...current, ...pageItems.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTotalCount(result.total || 0);
      setHasMore(requestedPage * 100 < (result.total || 0));
      setPage(requestedPage);
      setActive((prev) => requestedPage > 1
        ? prev || pageItems[0]?.id || null
        : pageItems.some((lead) => lead.id === prev) ? prev : pageItems[0]?.id || null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoadingMore(false);
    }
  }, [activeBucket, bucket, clubBucket, mode, page, queryClient, user?.id]);

  useEffect(() => {
    load(page);
  }, [load, page]);

  useEffect(() => {
    api.get("/courses").then(({ data }) => setCourses(data)).catch(() => {});
  }, []);

  const queueItems = useMemo(() => mode === "club" && activeBucket
    ? items.filter((lead) => lead.status === activeBucket)
    : items, [items, mode, activeBucket]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return queueItems;
    return queueItems.filter((lead) => [lead.name, lead.phone, lead.email].some((value) => value?.toLowerCase().includes(needle)));
  }, [queueItems, query]);

  const nextCall = () => {
    const currentIndex = filteredItems.findIndex((lead) => lead.id === active);
    setActive(filteredItems[(currentIndex + 1) % filteredItems.length]?.id || null);
  };

  const activeLead = items.find((lead) => lead.id === active);
  const activePosition = filteredItems.findIndex((lead) => lead.id === active) + 1;
  const workspaceTabs = mode === "club" ? CLUB_TABS : TABS;
  const summaryMetrics = mode === "club"
    ? [
      ["Unworked", items.filter((lead) => lead.status === "unworked").length],
      ["Follow-up", items.filter((lead) => lead.status === "follow_up").length],
      ["Enrolled", items.filter((lead) => lead.status === "enrolled").length],
    ]
    : [
      ["Due", items.filter((lead) => lead.next_follow_up_at && new Date(lead.next_follow_up_at) <= new Date()).length],
      ["Open", items.filter((lead) => !["converted", "lost", "not_interested"].includes(lead.status)).length],
      ["Done", items.filter((lead) => ["converted", "lost", "not_interested"].includes(lead.status)).length],
    ];

  const callClubClient = async (item) => {
    if (!item.phone) return;
    setCallingClubId(item.id);
    try {
      await api.post("/calls/click-to-call", {
        destination_number: item.phone,
        payment_club_event_id: item.id,
      });
      setItems((current) => current.map((record) => record.id === item.id
        ? { ...record, call_count: (record.call_count || 0) + 1, last_dialed_at: new Date().toISOString() }
        : record));
      queryClient.invalidateQueries({ queryKey: ["workspace-queue", user?.id] });
      toast.success("Club call initiated");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setCallingClubId(null);
    }
  };

  const updateClubStatus = async (item, status) => {
    try {
      await api.patch(`/payments/50-cr-club/purchases/${item.id}/status`, { status });
      setItems((current) => current
        .map((record) => record.id === item.id ? { ...record, status } : record)
        .filter((record) => (clubBucket ? record.status === clubBucket : true)));
      queryClient.invalidateQueries({ queryKey: ["workspace-queue", user?.id] });
      setActive(null);
      toast.success("Club status updated");
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const openMemberProfile = (item) => {
    const profile = item.member_profile || {};
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
    setProfileOpen(true);
  };

  const saveMemberProfile = async (event) => {
    event.preventDefault();
    if (!activeLead) return;
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
      const { data } = await api.patch(`/payments/50-cr-club/purchases/${activeLead.id}/member-profile`, payload);
      setItems((current) => current.map((item) => item.id === data.id ? { ...item, ...data } : item));
      queryClient.invalidateQueries({ queryKey: ["workspace-queue", user?.id] });
      setProfileOpen(false);
      toast.success("Club member details saved");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="relative grid min-h-screen grid-cols-1 overflow-hidden lg:grid-cols-[360px_1fr]" data-testid="workspace-page">
      <div className="surface-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="workspace-sidebar relative border-r border-border/60">
        <div className="border-b border-border/60 px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="overline text-brand/80">{mode === "club" ? "50 Cr Club desk" : "CRM call desk"}</div>
              <div className="mono mt-1 text-[11px] text-muted-foreground">{items.length} loaded of {totalCount} records</div>
            </div>
            <button onClick={() => { queryClient.invalidateQueries({ queryKey: ["workspace-queue", user?.id] }); setItems([]); setPage(1); load(1); }} aria-label="Refresh queue" title="Refresh queue" className="border border-border/70 p-2 text-muted-foreground transition-colors hover:border-brand/50 hover:text-brand">
              <ListRestart size={15} />
            </button>
          </div>
          <h1 className="display mt-5 text-3xl font-bold tracking-tight">Hi, {user?.name?.split(" ")[0]}</h1>
          <p className="mt-2 max-w-[260px] text-sm leading-5 text-muted-foreground">
            {mode === "club" ? "Work assigned Club clients and track each Club-specific outcome." : "Work assigned CRM leads, record each call result, and keep every conversation moving."}
          </p>
          {user?.is_50_cr_club_rm && (
            <div className="mt-4 grid grid-cols-2 border border-border/70 p-1" role="group" aria-label="Work queue">
              {[["crm", "CRM leads"], ["club", "50 Cr Club"]].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`workspace-mode-${value}`}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setPage(1);
                    setItems([]);
                    if (value === "club") {
                      setClubBucket("unworked");
                    } else {
                      setBucket(crmBucket);
                    }
                    setItems([]);
                    setActive(null);
                    setQuery("");
                  }}
                  className={`px-3 py-2 text-xs font-semibold transition-colors ${mode === value ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {summaryMetrics.map(([label, count]) => (
              <div key={label} className={`metric-tile border border-border/60 px-2 py-3 ${label === "Due" && count ? "border-yellow-500/30" : ""}`}>
                <div className="mono text-xl font-semibold">{count}</div>
                <div className="overline mt-1 text-[10px]">{label}</div>
              </div>
            ))}
          </div>
          <div className="relative mt-4">
            <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "club" ? "Find a Club client or number" : "Find a CRM lead or number"} className="h-9 rounded-none border-border/70 bg-[#0c0c0f] pl-9 text-xs" />
          </div>
          <div className="mt-4 flex flex-wrap gap-1">
            {workspaceTabs.map(([value, label]) => (
              <button
                key={value || "all"}
                data-testid={`workspace-tab-${value || "all"}`}
                onClick={() => {
                  if (mode === "club") {
                    setClubBucket(value);
                  } else {
                    setBucket(value);
                  }
                  setPage(1);
                  setItems([]);
                  setActive(null);
                }}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  activeBucket === value ? "bg-brand text-brand-foreground" : "border border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={nextCall} disabled={!filteredItems.length} className="mt-3 flex w-full items-center justify-between border border-brand/50 bg-brand/10 px-3 py-2.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/15 disabled:opacity-40">
            <span className="flex items-center gap-2"><PhoneCall size={13} /> Next call</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="relative max-h-[calc(100vh-310px)] overflow-y-auto" data-testid="workspace-queue">
          {filteredItems.map((lead) => (
            <button
              key={lead.id}
              data-testid={`queue-item-${lead.id}`}
              onClick={() => setActive(lead.id)}
              className={`row-enter block w-full border-b border-border/40 px-5 py-4 text-left transition-colors duration-150 sm:px-6 ${
                active === lead.id ? "border-l-2 border-l-brand bg-brand/[0.09]" : "hover:bg-white/[0.035]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{lead.name}</span>
                {lead.isClubRecord
                  ? <span className="border border-brand/40 px-2 py-0.5 text-[10px] text-brand" data-testid={`queue-status-${lead.id}`}>{CLUB_STATUS_LABEL[lead.status] || "Unworked"}</span>
                  : <StatusBadge status={lead.status} testId={`queue-status-${lead.id}`} />}
              </div>
              <div className="mono mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{lead.phone}</span>
                <span className={lead.next_follow_up_at && new Date(lead.next_follow_up_at) < new Date() ? "text-red-400" : ""}>
                  {lead.next_follow_up_at ? relative(lead.next_follow_up_at) : relative(lead.last_action_at)}
                </span>
              </div>
            </button>
          ))}
          {!filteredItems.length && (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground" data-testid="workspace-empty">
              {query ? "No records match your search." : mode === "club" ? "No Club clients in this status." : "Nothing in this queue. Nice work."}
            </div>
          )}
          {hasMore && <div className="px-5 py-3 sm:px-6"><Button type="button" variant="outline" onClick={() => setPage((current) => current + 1)} disabled={loadingMore} className="w-full rounded-none">{loadingMore ? "Loading…" : `Load more (${Math.max(0, totalCount - items.length)} remaining)`}</Button></div>}
        </div>
      </div>

      <div className="min-w-0 bg-background/50">
        {active ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-[#0c0c0f]/90 px-5 py-3 backdrop-blur sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-2 w-2 shrink-0 bg-brand shadow-[0_0_12px_hsl(var(--brand)/0.7)]" />
                <div className="min-w-0">
                  <div className="overline">{activeLead?.isClubRecord ? "Club client" : "Active call"}</div>
                  <div className="truncate text-sm font-semibold">{activeLead?.name || "Selected lead"}</div>
                </div>
                {activeLead?.next_follow_up_at && (
                  <span className="hidden border-l border-border/70 pl-3 text-xs text-muted-foreground sm:inline">
                    Follow-up {fmtDate(activeLead.next_follow_up_at)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="mono text-[11px] text-muted-foreground">{activePosition} / {filteredItems.length}</span>
                <button
                  onClick={nextCall}
                  disabled={filteredItems.length < 2}
                  className="border border-border/70 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/60 hover:text-brand disabled:opacity-40"
                >
                  Next call <span aria-hidden="true">-&gt;</span>
                </button>
              </div>
            </div>
            {activeLead?.isClubRecord ? <section className="space-y-5 px-5 py-6 sm:px-8" data-testid="club-workspace-panel">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-5">
                <div>
                <div className="overline">Assigned 50 Cr Club purchase</div>
                <h2 className="display mt-2 text-2xl font-bold">{activeLead.user?.name || activeLead.crm_lead?.name || "Club client"}</h2>
                <div className="mono mt-1 text-sm text-muted-foreground">{activeLead.phone || "No phone"} · {activeLead.user?.email || activeLead.crm_lead?.email || "No email"}</div>
                </div>
                <Button type="button" variant="outline" onClick={() => openMemberProfile(activeLead)} className="rounded-none"><Pencil size={14} className="mr-2" />Fill member details</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-border/60 p-4"><div className="overline">Assigned RM</div><div className="mt-2 text-sm">{activeLead.assigned_to_name || "Unassigned"}</div></div>
                <div className="border border-border/60 p-4"><div className="overline">Relationship owner</div><div className="mt-2 text-sm">{activeLead.member_profile?.club_seller_type === "direct" ? "Direct client" : activeLead.member_profile?.club_seller_name || activeLead.club?.seller_name || "Not recorded"}</div></div>
                <div className="border border-border/60 p-4"><div className="overline">Joined</div><div className="mono mt-2 text-sm">{sourceDate(activeLead.club?.joined_at || activeLead.member_profile?.joined_at)}</div></div>
                <div className="border border-border/60 p-4"><div className="overline">Expires</div><div className="mono mt-2 text-sm">{sourceDate(activeLead.club?.expires_at || activeLead.member_profile?.expires_at)}</div></div>
                <div className="border border-border/60 p-4"><div className="overline">Offering</div><div className="mt-2 text-sm">{activeLead.club?.offering || activeLead.payment?.product || "50 Cr Club"}</div></div>
                <div className="border border-border/60 p-4"><div className="overline">Broker</div><div className="mt-2 text-sm">{activeLead.member_profile?.broker_name || activeLead.club?.broker_name || "Not recorded"}</div></div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-y border-border/60 py-4">
                <Button type="button" onClick={() => callClubClient(activeLead)} disabled={callingClubId === activeLead.id || !activeLead.phone} className="rounded-none"><PhoneCall size={14} className="mr-2" />{callingClubId === activeLead.id ? "Calling…" : "Dial client"}</Button>
                <Select value={activeLead.status} onValueChange={(status) => updateClubStatus(activeLead, status)}>
                  <SelectTrigger className="h-9 w-44 rounded-none" aria-label="Change Club work status"><SelectValue /></SelectTrigger>
                  <SelectContent>{[["unworked", "Unworked"], ["contacted", "Contacted"], ["follow_up", "Follow-up"], ["enrolled", "Enrolled"], ["not_interested", "Not interested"], ["lost", "Closed"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="text-sm"><div className="overline">RM dial activity</div><div className="mono mt-2">{activeLead.call_count || 0} calls · Last dialed {activeLead.last_dialed_at ? fmtDate(activeLead.last_dialed_at) : "never"}</div></div>
            </section> : <LeadPanel leadId={active} courses={courses} onChanged={load} />}
          </>
        ) : (
          <div className="flex h-full min-h-[420px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
            <div>
              <div className="mx-auto mb-4 h-10 w-10 border border-brand/40 bg-brand/10" />
              <div className="font-medium text-foreground">Select a {mode === "club" ? "Club client" : "CRM lead"} from your queue</div>
              <div className="mt-1 text-xs">Your call workspace will appear here.</div>
            </div>
          </div>
        )}
      </div>

      <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
        <SheetContent className="w-full overflow-y-auto border-l border-border/60 bg-background p-0 sm:max-w-xl" data-testid="workspace-club-profile-editor">
          <SheetHeader className="border-b border-border/60 px-6 py-6 pr-14 text-left">
            <div className="overline">50 Cr Club profile</div>
            <SheetTitle className="display mt-1 text-2xl">{activeLead?.name || "Club member"}</SheetTitle>
            <SheetDescription>Record the relationship owner and client details. Assigned RM remains a separate work assignment.</SheetDescription>
          </SheetHeader>
          <form onSubmit={saveMemberProfile} className="space-y-5 px-6 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm"><span className="overline">Relationship owner type</span><select value={profileDraft.club_seller_type || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, club_seller_type: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="direct">Direct client</option><option value="seller">Seller</option></select></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Seller / relationship owner</span><Input value={profileDraft.club_seller_name || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, club_seller_name: e.target.value }))} placeholder="Name" maxLength={120} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Broker</span><Input value={profileDraft.broker_name || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, broker_name: e.target.value }))} placeholder="Broker name" maxLength={120} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Broker unique ID</span><Input value={profileDraft.broker_unique_id || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, broker_unique_id: e.target.value }))} placeholder="Client or account ID" maxLength={160} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">New broker</span><Input value={profileDraft.new_broker_name || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, new_broker_name: e.target.value }))} maxLength={120} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Current broker</span><Input value={profileDraft.current_broker_name || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, current_broker_name: e.target.value }))} maxLength={120} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Broker account status</span><select value={profileDraft.broker_account_status || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, broker_account_status: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="opened">Opened</option><option value="in_progress">In progress</option><option value="not_opened">Not opened</option><option value="not_required">Not required</option></select></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Deposit made?</span><select value={profileDraft.deposit_made || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, deposit_made: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Deposit amount (INR)</span><Input type="number" min="0" step="0.01" value={profileDraft.deposit_amount ?? ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, deposit_amount: e.target.value }))} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Trading mode</span><select value={profileDraft.trading_mode || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, trading_mode: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="self">Self</option><option value="group">Group</option><option value="both">Both</option></select></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Expected group profit (INR)</span><Input type="number" min="0" step="0.01" value={profileDraft.expected_group_profit ?? ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, expected_group_profit: e.target.value }))} /></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Product in use?</span><select value={profileDraft.product_in_use || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, product_in_use: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label>
              <label className="space-y-1.5 text-sm"><span className="overline">Membership enabled?</span><select value={profileDraft.membership_enabled || "not_recorded"} onChange={(e) => setProfileDraft((draft) => ({ ...draft, membership_enabled: e.target.value }))} className="h-10 w-full border border-input bg-background px-3 text-sm"><option value="not_recorded">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            </div>
            <label className="block space-y-1.5 text-sm"><span className="overline">Follow-up routine</span><textarea value={profileDraft.follow_up_routine || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, follow_up_routine: e.target.value }))} rows={3} maxLength={1000} className="w-full resize-y border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
            <label className="block space-y-1.5 text-sm"><span className="overline">Next follow-up</span><Input type="datetime-local" value={profileDraft.next_follow_up_at || ""} onChange={(e) => setProfileDraft((draft) => ({ ...draft, next_follow_up_at: e.target.value }))} /></label>
            <div className="flex justify-end border-t border-border/60 pt-4"><Button type="submit" disabled={savingProfile} className="rounded-none"><Save size={14} className="mr-2" />{savingProfile ? "Saving…" : "Save member details"}</Button></div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
