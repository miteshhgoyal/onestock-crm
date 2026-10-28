import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, Download, FileSpreadsheet, Phone, RefreshCw, Search, Upload, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const formatDate = (value) => value
  ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  : "—";
const formatSourceDate = (value) => value ? String(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || String(value) : "—";
const getExpiryDate = (record) => formatSourceDate(
  record.club?.expires_at || record.member_profile?.expires_at || record.club_expires_at,
);
const isExpired = (record) => {
  const expiry = getExpiryDate(record);
  if (expiry === "—") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${expiry}T00:00:00`) < today;
};

const formatAmount = (amount, currency) => {
  if (amount == null) return "—";
  const value = Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `${currency ? `${currency} ` : ""}${value}`;
};
const csvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const hasDetailValue = (value) => value !== null && value !== undefined && value !== "" && value !== "—";

function DragScrollArea({ children, className = "" }) {
  const dragState = useRef(null);
  const suppressClick = useRef(false);

  const handlePointerDown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0
      || event.target.closest("button, input, select, textarea, a, [role='checkbox']")) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  };

  const handlePointerMove = (event) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const distance = event.clientX - state.startX;
    if (!state.moved && Math.abs(distance) > 5) {
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.style.userSelect = "none";
    }
    if (state.moved) {
      event.currentTarget.scrollLeft = state.scrollLeft - distance;
      event.preventDefault();
    }
  };

  const handlePointerUp = (event) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    suppressClick.current = dragState.current.moved;
    dragState.current = null;
    event.currentTarget.style.userSelect = "";
  };

  const handleClickCapture = (event) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className={`overflow-x-auto cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      {children}
    </div>
  );
}

function ClubRecordsSection({ records, total, error, loading, page, pageCount, selectedIds, bulkBusy, onToggleRecord, onTogglePage, onPageChange, onOpenPurchase }) {
  const selectableRecords = records;
  const allSelected = selectableRecords.length > 0 && selectableRecords.every((record) => selectedIds.includes(record.id));
  const someSelected = selectableRecords.some((record) => selectedIds.includes(record.id));

  return (
    <section className="mt-5 border border-border/60" data-testid="club-records">
      <div className="flex items-center justify-between border-b border-border/60 bg-[#0c0c0f] px-5 py-4">
        <div className="overline">Club client records</div>
        <div className="mono text-xs text-muted-foreground">{total.toLocaleString("en-IN")} records</div>
      </div>
      {error && <div className="border-b border-amber-500/40 bg-amber-500/10 px-5 py-3 text-sm" role="status">{error}</div>}
      <DragScrollArea>
        <table className="w-full min-w-[1100px] text-sm">
          <thead><tr className="border-b border-border/60 text-left"><th className="w-10 px-4 py-3"><Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} disabled={!selectableRecords.length || bulkBusy} onCheckedChange={(checked) => onTogglePage(selectableRecords.map((record) => record.id), checked === true)} aria-label="Select purchases for RM assignment" data-testid="club-select-page" /></th>{["Member", "Assigned RM", "Club status", "Phone", "Offering", "Market", "Broker", "Broker ID", "Joined", "Expires", "Seller / Ref", "Amount", "Paid", "Calls", "Last dialed"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                <td className="px-4 py-3"><Checkbox checked={selectedIds.includes(record.id)} disabled={bulkBusy} onCheckedChange={(checked) => onToggleRecord(record.id, checked === true)} aria-label={`Select ${record.user?.name || "purchase"}`} data-testid={`club-select-${record.id}`} /></td>
                <td className="px-4 py-3"><button type="button" onClick={() => onOpenPurchase(record)} className="text-left font-semibold text-foreground hover:text-brand hover:underline underline-offset-4">{record.user?.name || "Name not provided"}</button><div className="text-xs text-muted-foreground">{record.admin_uploaded ? "Admin uploaded · not payment-verified" : record.user?.email || "No email"}</div></td>
                <td className="px-4 py-3">{record.assigned_to_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                <td className="px-4 py-3 capitalize">{String(record.club_status || "unassigned").replaceAll("_", " ")}</td>
                <td className="mono px-4 py-3">{record.user?.phone || "—"}</td>
                <td className="px-4 py-3">{record.club?.offering || record.payment?.product || "—"}</td>
                <td className="px-4 py-3">{record.club?.claimed_market || "—"}</td>
                <td className="px-4 py-3">{record.member_profile?.broker_name || record.club?.broker_name || "—"}</td>
                <td className="mono px-4 py-3">{record.member_profile?.broker_unique_id || record.club?.broker_unique_id || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(record.club?.joined_at)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(record.club?.expires_at)}</td>
                <td className="px-4 py-3">{record.member_profile?.club_seller_type === "direct" ? "Direct" : record.member_profile?.club_seller_name || "Direct"}</td>
                <td className="mono px-4 py-3">{formatAmount(record.payment?.amount, record.payment?.currency)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{record.admin_uploaded ? `Uploaded ${formatDate(record.admin_uploaded_at)}` : formatDate(record.payment?.paid_at || record.received_at)}</td>
                <td className="mono px-4 py-3">{record.call_count || 0}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs" title={record.last_dialed_by || undefined}>{formatDate(record.last_dialed_at)}</td>
              </tr>
            ))}
            {!records.length && <tr><td colSpan={16} className="px-5 py-12 text-center text-sm text-muted-foreground">{loading ? "Loading Club records…" : "No Club records match these filters."}</td></tr>}
          </tbody>
        </table>
      </DragScrollArea>
      {pageCount > 1 && <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
        <span className="mono text-xs text-muted-foreground">Page {page} of {pageCount}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Next</Button>
        </div>
      </div>}
    </section>
  );
}

export default function FiftyCrClub({ initialTab = "purchases", reportOnly = false }) {
  const [purchases, setPurchases] = useState([]);
  const [clubLeads, setClubLeads] = useState([]);
  const [activeTab, setActiveTab] = useState(reportOnly ? initialTab : "purchases");
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [teams, setTeams] = useState([]);
  const [telecallers, setTelecallers] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [brokerDraft, setBrokerDraft] = useState("");
  const [sourceConfigured, setSourceConfigured] = useState(false);
  const [sourceErrors, setSourceErrors] = useState({});
  const sourceError = sourceErrors.purchases || sourceErrors.memberships || sourceErrors.provider || sourceErrors.configuration;
  const [query, setQuery] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [callFilter, setCallFilter] = useState("all");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [rmFilter, setRmFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [expiryFrom, setExpiryFrom] = useState("");
  const [expiryTo, setExpiryTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectionQuantity, setSelectionQuantity] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [teamId, setTeamId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [uploadTeamId, setUploadTeamId] = useState("");
  const [uploadAssigneeId, setUploadAssigneeId] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchResult, setMatchResult] = useState(null);
  const [dateExportFile, setDateExportFile] = useState(null);
  const [dateExportBusy, setDateExportBusy] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [callHistory, setCallHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveTab(reportOnly ? initialTab : "purchases");
  }, [initialTab, reportOnly]);

  const load = useCallback(async ({ silent = false, recentOnly = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const sourceParams = {
        ...(recentOnly ? { recent_only: true } : {}),
        ...(reportOnly ? { report_only: true } : {}),
      };
      const [{ data }, { data: teamData }, { data: telecallerData }, { data: brokerData }] = await Promise.all([
        api.get("/payments/50-cr-club/source-data", { params: Object.keys(sourceParams).length ? sourceParams : undefined }),
        api.get("/teams"),
        api.get("/users", { params: { role: "telecaller" } }),
        api.get("/payments/50-cr-club/brokers"),
      ]);
      setSourceConfigured(Boolean(data.configured));
      setSourceErrors(data.errors || {});
      setPurchases(data.purchases || []);
      setClubLeads(data.club_leads || []);
      setVerifiedCount(data.verified_count ?? data.purchases?.length ?? 0);
      setTeams(teamData || []);
      setTelecallers((telecallerData || []).filter((telecaller) => !telecaller.removed));
      setBrokers(brokerData.brokers || []);
      setSelectedIds((current) => current.filter((id) => (data.purchases || []).some((purchase) => purchase.id === id)));
      setSelectedPurchase((current) => current ? (data.purchases || []).find((purchase) => purchase.id === current.id) || current : null);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportOnly]);

  useEffect(() => {
    load();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") load({ silent: true, recentOnly: true });
    }, 60000);
    return () => window.clearInterval(intervalId);
  }, [load]);

  const loadCallHistory = useCallback(async (purchaseId, silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      const { data } = await api.get(`/payments/50-cr-club/purchases/${purchaseId}/calls`);
      setCallHistory(data || []);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPurchase?.id) return undefined;
    const purchaseId = selectedPurchase.id;
    setCallHistory([]);
    loadCallHistory(purchaseId);
    const intervalId = window.setInterval(() => loadCallHistory(purchaseId, true), 15000);
    return () => window.clearInterval(intervalId);
  }, [selectedPurchase?.id, loadCallHistory]);

  const markets = [...new Set(purchases.map((purchase) => purchase.club?.claimed_market).filter(Boolean))].sort();
  const assignedRms = telecallers;
  const sellerNames = [...new Set([
    ...purchases.map((purchase) => purchase.member_profile?.club_seller_type === "direct" ? null : purchase.member_profile?.club_seller_name),
    ...clubLeads.map((lead) => lead.club_seller_type === "direct" ? null : lead.club_seller_name),
  ].map((name) => String(name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const matchesSellerFilter = (profile = {}) => {
    const sellerName = String(profile.club_seller_name || "").trim();
    if (sellerFilter === "all") return true;
    if (sellerFilter === "no-seller") return !sellerName || profile.club_seller_type === "direct";
    if (sellerFilter === "named-sellers") return Boolean(sellerName) && profile.club_seller_type !== "direct";
    if (sellerFilter.startsWith("seller:")) return sellerName === sellerFilter.slice("seller:".length) && profile.club_seller_type !== "direct";
    return true;
  };
  const matchesExpiryRange = (record) => {
    if (!expiryFrom && !expiryTo) return true;
    const expiresAt = getExpiryDate(record);
    if (expiresAt === "—") return false;
    return (!expiryFrom || expiresAt >= expiryFrom) && (!expiryTo || expiresAt <= expiryTo);
  };
  const matchingRecords = purchases.filter((record) => {
    if (marketFilter !== "all" && record.club?.claimed_market !== marketFilter) return false;
    if (callFilter === "called" && !record.call_count) return false;
    if (callFilter === "not-called" && record.call_count) return false;
    if (!matchesSellerFilter(record.member_profile)) return false;
    if (!matchesExpiryRange(record)) return false;
    const brokerName = record.member_profile?.broker_name || record.club?.broker_name || "";
    if (brokerFilter !== "all" && brokerName !== brokerFilter) return false;
    if (rmFilter === "unassigned" && record.assigned_to_id) return false;
    if (rmFilter !== "all" && rmFilter !== "unassigned" && record.assigned_to_id !== rmFilter) return false;
    const haystack = [record.user?.name, record.user?.email, record.user?.phone, record.crm_lead?.name,
      record.assigned_to_name, record.member_profile?.broker_name, record.member_profile?.club_seller_name, record.member_profile?.club_seller_type, record.member_profile?.follow_up_routine,
      record.member_profile?.broker_unique_id, record.club?.broker_name, record.club?.broker_unique_id,
      record.club?.joined_at, record.club?.expires_at, record.club?.offering, record.club?.event, record.club?.claimed_market, record.club?.transaction_id]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const pageCount = Math.max(1, Math.ceil(matchingRecords.length / 50));
  const pageRecords = matchingRecords.slice((page - 1) * 50, page * 50);
  const linkedLeadIds = new Set(purchases.map((record) => record.lead_id).filter(Boolean));
  const legacyClubLeads = clubLeads.filter((lead) => !linkedLeadIds.has(lead.id));
  const convertedClubMembers = [
    ...purchases.filter((record) => record.verified === true).map((record) => ({
      ...record,
      member_profile: record.member_profile || {},
      call_count: record.call_count || 0,
    })),
    ...legacyClubLeads.map((lead) => ({
    ...lead,
    lead_id: lead.id,
    assigned_to_id: lead.assigned_to_id,
    assigned_to_name: lead.assigned_to_name,
    crm_lead: lead,
    user: { name: lead.name, email: lead.email, phone: lead.phone },
    member_profile: {
      club_seller_type: lead.club_seller_type,
      club_seller_name: lead.club_seller_name,
      broker_name: lead.broker_name,
      broker_unique_id: lead.broker_unique_id,
      new_broker_name: lead.new_broker_name,
      current_broker_name: lead.current_broker_name,
      broker_account_status: lead.broker_account_status,
      deposit_made: lead.deposit_made,
      deposit_amount: lead.deposit_amount,
      trading_mode: lead.trading_mode,
      expected_group_profit: lead.expected_group_profit,
      product_in_use: lead.product_in_use,
      membership_enabled: lead.membership_enabled,
      follow_up_routine: lead.follow_up_routine,
      next_follow_up_at: lead.club_next_follow_up_at,
      joined_at: lead.club_joined_at,
      expires_at: lead.club_expires_at,
    },
    club: { offering: "50 Cr Club" },
    call_count: lead.club_call_count || 0,
    })),
  ];
  const reportRecords = convertedClubMembers.filter((record) => {
    if (rmFilter === "unassigned" && record.assigned_to_id) return false;
    if (rmFilter !== "all" && rmFilter !== "unassigned" && record.assigned_to_id !== rmFilter) return false;
    if (callFilter === "called" && !record.call_count) return false;
    if (callFilter === "not-called" && record.call_count) return false;
    if (!matchesSellerFilter(record.member_profile)) return false;
    const brokerName = record.member_profile?.broker_name || record.broker_name || "";
    if (brokerFilter !== "all" && brokerName !== brokerFilter) return false;
    const markets = [...(record.markets_traded || []), ...(record.markets_interested || []), record.club?.claimed_market].filter(Boolean);
    if (marketFilter !== "all" && !markets.includes(marketFilter)) return false;
    if (!matchesExpiryRange(record)) return false;
    const haystack = [record.name, record.email, record.phone, record.assigned_to_name,
      record.broker_name, record.broker_unique_id, record.club_joined_at, record.club_expires_at,
      record.member_profile?.broker_unique_id, record.member_profile?.joined_at, record.member_profile?.expires_at,
      record.member_profile?.club_seller_name, record.member_profile?.club_seller_type, record.follow_up_routine].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const reportExportRecords = rmFilter === "all"
    ? reportRecords
    : convertedClubMembers.filter((record) => rmFilter === "unassigned"
      ? !record.assigned_to_id
      : record.assigned_to_id === rmFilter);
  const downloadMemberReport = () => {
    const headers = [
      "Member", "Assigned RM", "Phone", "Email", "Seller / Ref", "Broker", "Broker ID",
      "Joined", "Expires", "Account status", "Deposit made", "Deposit amount",
      "Trading mode", "Expected group profit", "Using product", "Membership enabled",
      "Follow-up routine", "Next follow-up", "Club status", "Payment ID",
    ];
    const rows = reportExportRecords.map((record) => {
      const profile = record.member_profile || {};
      const contact = record.crm_lead || record.user || {};
      return [
        contact.name || "Name not provided",
        record.assigned_to_name || "Unassigned",
        contact.phone,
        contact.email,
        profile.club_seller_name || record.club?.seller_name || (profile.club_seller_type === "direct" ? "Direct" : ""),
        profile.broker_name || record.club?.broker_name,
        profile.broker_unique_id || record.club?.broker_unique_id,
        profile.joined_at || record.club?.joined_at || record.club_joined_at,
        profile.expires_at || record.club?.expires_at || record.club_expires_at,
        profile.broker_account_status,
        profile.deposit_made,
        profile.deposit_amount,
        profile.trading_mode,
        profile.expected_group_profit,
        profile.product_in_use,
        profile.membership_enabled,
        profile.follow_up_routine,
        profile.next_follow_up_at,
        record.club_status,
        record.payment?.payment_id,
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
    const blobUrl = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = blobUrl;
    const selectedRm = telecallers.find((telecaller) => telecaller.id === rmFilter);
    const scope = rmFilter === "all" ? "club-member-report" : rmFilter === "unassigned"
      ? "unassigned-club-members"
      : (selectedRm?.name || "rm-club-members").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    link.download = `50-cr-${scope}.csv`;
    link.click();
    URL.revokeObjectURL(blobUrl);
    toast.success(`${reportExportRecords.length.toLocaleString("en-IN")} member rows downloaded`);
  };
  const reportPageCount = Math.max(1, Math.ceil(reportRecords.length / 50));
  const reportPageRecords = reportRecords.slice((page - 1) * 50, page * 50);
  const activeRms = (teams.find((team) => team.id === teamId)?.members || [])
    .filter((member) => member.active && member.role === "telecaller" && member.is_50_cr_club_rm);
  const uploadRms = (teams.find((team) => team.id === uploadTeamId)?.members || [])
    .filter((member) => member.active && member.role === "telecaller" && member.is_50_cr_club_rm);
  const activeMembers = convertedClubMembers.filter((record) => record.member_profile?.membership_enabled === true);
  const usingProduct = convertedClubMembers.filter((record) => record.member_profile?.product_in_use === true);
  const brokerAccountsOpened = convertedClubMembers.filter((record) => record.member_profile?.broker_account_status === "opened");
  const expectedGroupProfit = convertedClubMembers.reduce((total, record) => total + (Number(record.member_profile?.expected_group_profit) || 0), 0);
  const followUpsDue = convertedClubMembers.filter((record) => record.member_profile?.next_follow_up_at
    && new Date(record.member_profile.next_follow_up_at).getTime() <= Date.now());
  const buildTelecallerReportRow = (telecaller) => {
    const records = convertedClubMembers.filter((record) => record.assigned_to_id === telecaller.id);
    return {
      ...telecaller,
      assigned_members: records.length,
      active_memberships: records.filter((record) => record.member_profile?.membership_enabled === true).length,
      using_product: records.filter((record) => record.member_profile?.product_in_use === true).length,
      broker_accounts_opened: records.filter((record) => record.member_profile?.broker_account_status === "opened").length,
      expected_group_profit: records.reduce((total, record) => total + (Number(record.member_profile?.expected_group_profit) || 0), 0),
      follow_ups_due: records.filter((record) => record.member_profile?.next_follow_up_at
        && new Date(record.member_profile.next_follow_up_at).getTime() <= Date.now()).length,
      calls_initiated: records.reduce((total, record) => total + (record.call_count || 0), 0),
    };
  };
  const rmReportRows = telecallers.filter((telecaller) => telecaller.is_50_cr_club_rm).map(buildTelecallerReportRow);
  const telecallerReportRows = telecallers.map(buildTelecallerReportRow);

  const togglePurchase = (purchaseId, checked) => {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => id !== purchaseId);
      if (current.includes(purchaseId)) return current;
      if (current.length >= 200) {
        toast.error("Select up to 200 purchases per assignment");
        return current;
      }
      return [...current, purchaseId];
    });
  };

  const togglePage = (purchaseIds, checked) => {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => !purchaseIds.includes(id));
      const additions = purchaseIds.filter((id) => !current.includes(id));
      if (current.length + additions.length > 200) {
        toast.error("Select up to 200 purchases per assignment");
        return current;
      }
      return [...current, ...additions];
    });
  };

  const selectPurchaseQuantity = () => {
    const quantity = Number(selectionQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) {
      toast.error("Choose a quantity between 1 and 200");
      return;
    }
    const eligibleIds = matchingRecords.map((record) => record.id);
    if (!eligibleIds.length) {
      toast.error("No purchases match the current filters");
      return;
    }
    const selected = eligibleIds.slice(0, quantity);
    setSelectedIds(selected);
    if (selected.length < quantity) toast.message(`Selected all ${selected.length} matching purchases`);
  };

  const assignPurchases = async () => {
    if (!selectedIds.length || !teamId || !assigneeId) return;
    setBulkBusy(true);
    try {
      const { data } = await api.post("/payments/50-cr-club/purchases/assign", {
        event_ids: selectedIds,
        team_id: teamId,
        assignee_id: assigneeId,
      });
      toast.success(`${data.assigned} Club purchases assigned to ${telecallers.find((rm) => rm.id === assigneeId)?.name || "RM"}`);
      setSelectedIds([]);
      await load({ silent: true, recentOnly: true });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadUploadTemplate = () => {
    const csv = "Name,Phone,Email\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "50-cr-club-upload-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const matchClubSheet = async () => {
    if (!uploadFile) return;
    setMatchBusy(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    try {
      const { data } = await api.post("/payments/50-cr-club/purchases/match-sheet", formData);
      setMatchResult(data);
      toast.success(`${data.matched} matched · ${data.unmatched} not matched${data.skipped ? ` · ${data.skipped} invalid or duplicate rows` : ""}`);
      if (data.row_errors?.length) toast.message(data.row_errors.slice(0, 3).join(" · "));
    } catch (error) {
      setMatchResult(null);
      toast.error(errMsg(error));
    } finally {
      setMatchBusy(false);
    }
  };

  const assignMatchedSheet = async () => {
    if (!matchResult?.matched_event_ids?.length) {
      toast.error("Run Match first to find verified purchases");
      return;
    }
    if (!uploadTeamId || !uploadAssigneeId) {
      toast.error("Select a team and 50 Cr Club RM");
      return;
    }
    setUploadBusy(true);
    try {
      const { data } = await api.post("/payments/50-cr-club/purchases/assign", {
        event_ids: matchResult.matched_event_ids,
        team_id: uploadTeamId,
        assignee_id: uploadAssigneeId,
      });
      const targetName = telecallers.find((rm) => rm.id === uploadAssigneeId)?.name || "selected RM";
      toast.success(`${data.assigned} verified Club records assigned to ${targetName}`);
      setUploadFile(null);
      setMatchResult(null);
      await load({ silent: true, recentOnly: true });
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setUploadBusy(false);
    }
  };

  const exportMembershipDates = async () => {
    if (!dateExportFile) return;
    setDateExportBusy(true);
    const formData = new FormData();
    formData.append("file", dateExportFile);
    try {
      const { data } = await api.post("/payments/50-cr-club/purchases/export-membership-dates", formData, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "50-cr-club-membership-dates.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Membership date CSV downloaded");
      setDateExportFile(null);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setDateExportBusy(false);
    }
  };

  const persistBrokers = async (nextBrokers) => {
    try {
      const { data } = await api.put("/payments/50-cr-club/brokers", { brokers: nextBrokers });
      setBrokers(data.brokers || []);
      toast.success("Broker list saved");
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const addBroker = async () => {
    const broker = brokerDraft.trim();
    if (!broker || brokers.some((value) => value.toLowerCase() === broker.toLowerCase())) return;
    await persistBrokers([...brokers, broker]);
    setBrokerDraft("");
  };

  const callPurchase = async () => {
    if (!selectedPurchase?.user?.phone) return;
    setCalling(true);
    try {
      await api.post("/calls/click-to-call", {
        destination_number: selectedPurchase.user.phone,
        payment_club_event_id: selectedPurchase.id,
      });
      toast.success("Call initiated");
      setSelectedPurchase((current) => current ? { ...current, call_count: (current.call_count || 0) + 1 } : current);
      setPurchases((records) => records.map((record) => record.id === selectedPurchase.id
        ? { ...record, call_count: (record.call_count || 0) + 1 }
        : record));
      await loadCallHistory(selectedPurchase.id, true);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="px-5 py-6 lg:px-8" data-testid={reportOnly ? "fifty-cr-club-reports-page" : "fifty-cr-club-page"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">{reportOnly ? "50 Cr Club · admin reports" : "Verified VIP Market payments"}</div>
          <h1 className="display mt-2 text-3xl font-black">{reportOnly ? "50 Cr Club Reports" : "50 Cr Club"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{reportOnly ? "Converted and enrolled Club members by RM and telecaller." : "Provider-verified purchases and Club call activity."}</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="rounded-none border-border/70">
          <RefreshCw size={14} className="mr-2" /> Refresh
        </Button>
      </div>

      {!reportOnly && <section className="mt-6 grid gap-px border border-border/60 bg-border/60 sm:grid-cols-3" data-testid="club-summary">
        {[["Verified purchases", verifiedCount], ["Loaded records", purchases.length], ["Calls initiated", purchases.reduce((count, purchase) => count + (purchase.call_count || 0), 0)]].map(([label, count]) => (
          <div key={label} className="bg-background px-5 py-4"><div className="overline">{label}</div><div className="mono mt-2 text-2xl font-bold">{count}</div></div>
        ))}
      </section>}
        {!reportOnly && <section className="mt-5 border border-border/60 px-4 py-4" data-testid="club-sheet-upload">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="overline flex items-center gap-2"><FileSpreadsheet size={14} /> Match CSV to verified Club purchases</div><p className="mt-1 text-xs text-muted-foreground">This assigns existing verified records only; it does not add or edit purchase data.</p></div>
            <Button type="button" variant="outline" onClick={downloadUploadTemplate} className="h-8 rounded-none"><Download size={13} className="mr-2" />CSV template</Button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm"><span className="overline">RM team</span><Select value={uploadTeamId || "none"} onValueChange={(value) => { setUploadTeamId(value === "none" ? "" : value); setUploadAssigneeId(""); }}><SelectTrigger className="h-9 rounded-none" aria-label="Upload RM team"><SelectValue placeholder="Select team" /></SelectTrigger><SelectContent><SelectItem value="none">Select team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></label>
            <label className="space-y-1.5 text-sm"><span className="overline">50 Cr Club RM</span><Select value={uploadAssigneeId || "none"} onValueChange={(value) => setUploadAssigneeId(value === "none" ? "" : value)} disabled={!uploadTeamId}><SelectTrigger className="h-9 rounded-none" aria-label="Upload assigned 50 Cr Club RM"><SelectValue placeholder="Select RM" /></SelectTrigger><SelectContent><SelectItem value="none">Select RM</SelectItem>{uploadRms.map((rm) => <SelectItem key={rm.id} value={rm.id}>{rm.name}</SelectItem>)}</SelectContent></Select></label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input key={uploadFile ? uploadFile.name : "no-file"} type="file" accept=".csv,text/csv" onChange={(event) => { setUploadFile(event.target.files?.[0] || null); setMatchResult(null); }} className="h-9 max-w-md rounded-none file:mr-3 file:border-0 file:bg-transparent file:text-xs file:font-semibold" aria-label="Choose Club CSV file" />
            <Button type="button" variant="outline" onClick={matchClubSheet} disabled={!uploadFile || matchBusy || uploadBusy} className="h-9 rounded-none" data-testid="club-match-sheet-button"><FileSpreadsheet size={14} className="mr-2" />{matchBusy ? "Matching…" : "Match"}</Button>
            <Button type="button" onClick={assignMatchedSheet} disabled={!matchResult?.matched_event_ids?.length || uploadBusy || matchBusy || !uploadTeamId || !uploadAssigneeId} className="h-9 rounded-none" data-testid="club-assign-sheet-button"><Upload size={14} className="mr-2" />{uploadBusy ? "Assigning…" : `Assign${matchResult?.matched_event_ids?.length ? ` ${matchResult.matched_event_ids.length}` : ""}`}</Button>
            <span className="text-xs text-muted-foreground">CSV only · phone or email required · up to 5,000 rows</span>
          </div>
          {matchResult && (
            <p className="mt-2 text-xs" data-testid="club-match-summary">
              <span className="font-semibold text-emerald-500">{matchResult.matched} matched</span>
              <span className="text-muted-foreground"> · {matchResult.unmatched} not matched{matchResult.skipped ? ` · ${matchResult.skipped} skipped` : ""}. Select a team and RM, then click Assign.</span>
            </p>
          )}
        </section>}
        {!reportOnly && <section className="mt-5 border border-border/60 px-4 py-4" data-testid="club-membership-date-export">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="overline flex items-center gap-2"><Download size={14} /> Export membership dates</div><p className="mt-1 text-xs text-muted-foreground">Upload contacts to look up verified Club dates. Your input rows are preserved; joining and expiry dates are appended.</p></div>
            <Button type="button" variant="outline" onClick={() => {
              const csv = "Name,Phone,Email\n";
              const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "50-cr-club-date-lookup-template.csv";
              link.click();
              URL.revokeObjectURL(url);
            }} className="h-8 rounded-none"><Download size={13} className="mr-2" />CSV template</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Input key={dateExportFile ? dateExportFile.name : "no-date-export-file"} type="file" accept=".csv,text/csv" onChange={(event) => setDateExportFile(event.target.files?.[0] || null)} className="h-9 max-w-md rounded-none file:mr-3 file:border-0 file:bg-transparent file:text-xs file:font-semibold" aria-label="Choose membership date lookup CSV" />
            <Button type="button" onClick={exportMembershipDates} disabled={!dateExportFile || dateExportBusy} className="h-9 rounded-none" data-testid="club-membership-date-export-button"><Download size={14} className="mr-2" />{dateExportBusy ? "Fetching dates…" : "Fetch dates & download"}</Button>
            <span className="text-xs text-muted-foreground">Match by phone/email, or unique name · up to 5,000 rows</span>
          </div>
        </section>}
        {!reportOnly && <section className="mt-5 border border-border/60 px-4 py-4" data-testid="club-broker-settings">
          <div className="overline">Broker choices</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input value={brokerDraft} onChange={(event) => setBrokerDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addBroker()} placeholder="Add broker name" maxLength={120} className="h-9 w-full rounded-none sm:w-64" aria-label="New broker name" />
            <Button type="button" onClick={addBroker} disabled={!brokerDraft.trim()} className="h-9 rounded-none">Add broker</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {brokers.map((broker) => <div key={broker} className="flex items-center gap-2 border border-border/60 px-2 py-1 text-sm"><span>{broker}</span><button type="button" onClick={() => persistBrokers(brokers.filter((value) => value !== broker))} aria-label={`Remove ${broker}`} className="text-muted-foreground hover:text-foreground">×</button></div>)}
            {!brokers.length && <span className="text-xs text-muted-foreground">No brokers configured.</span>}
          </div>
        </section>}

      <div className="mt-7 flex gap-1 border-b border-border/60" role="tablist" aria-label="50 Cr Club views">
        {(reportOnly ? [["report", "Converted members"], ["rm-report", "RM report"], ["telecaller-report", "Telecaller report"]] : [["purchases", "Purchases"]]).map(([tab, label]) => (
          <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => { setPage(1); setActiveTab(tab); }} className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${activeTab === tab ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} data-testid={`club-tab-${tab}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-4" data-testid={reportOnly ? "club-report-filters" : "club-purchase-filters"}>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto">
          <div className="relative w-full sm:w-64"><Search size={14} className="absolute left-3 top-3 text-muted-foreground" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={reportOnly ? "Search converted members" : "Search name, phone, email"} aria-label={reportOnly ? "Search converted Club members" : "Search verified purchases"} className="h-9 w-full rounded-none pl-9" /></div>
          <Select value={marketFilter} onValueChange={(value) => { setMarketFilter(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-44" aria-label="Filter by market"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All markets</SelectItem>{markets.map((market) => <SelectItem key={market} value={market}>{market}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={callFilter} onValueChange={(value) => { setCallFilter(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-44" aria-label="Filter by call activity"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All call activity</SelectItem><SelectItem value="called">Calls initiated</SelectItem><SelectItem value="not-called">No calls yet</SelectItem></SelectContent>
          </Select>
          <Select value={sellerFilter} onValueChange={(value) => { setSellerFilter(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-40" aria-label="Filter by seller source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sellers</SelectItem>
              <SelectItem value="no-seller">No seller (Direct)</SelectItem>
              <SelectItem value="named-sellers">All named sellers</SelectItem>
              {sellerNames.map((name) => <SelectItem key={name} value={`seller:${name}`}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={rmFilter} onValueChange={(value) => { setRmFilter(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-48" aria-label="Filter by assigned RM"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All RM assignments</SelectItem><SelectItem value="unassigned">No assigned RM</SelectItem>{assignedRms.map((rm) => <SelectItem key={rm.id} value={rm.id}>{rm.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={brokerFilter} onValueChange={(value) => { setBrokerFilter(value); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-48" aria-label="Filter by broker"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All brokers</SelectItem>{brokers.map((broker) => <SelectItem key={broker} value={broker}>{broker}</SelectItem>)}</SelectContent>
          </Select>
          <label className="space-y-1 text-sm"><span className="overline block">Expiry from</span><Input type="date" value={expiryFrom} onChange={(event) => { setExpiryFrom(event.target.value); setPage(1); }} className="h-9 w-full rounded-none sm:w-40" aria-label="Expiry date from" /></label>
          <label className="space-y-1 text-sm"><span className="overline block">Expiry to</span><Input type="date" value={expiryTo} onChange={(event) => { setExpiryTo(event.target.value); setPage(1); }} className="h-9 w-full rounded-none sm:w-40" aria-label="Expiry date to" /></label>
        </div>
      </div>

      {activeTab === "report" && <section className="mt-5" data-testid="club-member-report">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><div className="overline">50 Cr Club · verified and enrolled</div><h2 className="display mt-1 text-2xl font-bold">Club member report</h2></div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="mono text-xs text-muted-foreground">{reportRecords.length.toLocaleString("en-IN")} matching members</div>
            <Button type="button" variant="outline" onClick={downloadMemberReport} disabled={!reportExportRecords.length} className="h-9 rounded-none" aria-label={rmFilter === "all" ? "Download Club member report CSV" : "Download all members for selected RM as CSV"}>
              <Download size={14} className="mr-2" />{rmFilter === "all" ? "Download report CSV" : "Download RM members CSV"}
            </Button>
          </div>
        </div>
        <div className="grid gap-px border border-border/60 bg-border/60 sm:grid-cols-2 xl:grid-cols-5" data-testid="club-report-stats">
          {[
            ["Active memberships", activeMembers.length],
            ["Still using product", usingProduct.length],
            ["Broker accounts opened", brokerAccountsOpened.length],
            ["Expected group profit", formatAmount(expectedGroupProfit, "INR")],
            ["Follow-ups due", followUpsDue.length],
          ].map(([label, value]) => <div key={label} className="bg-background px-4 py-4"><div className="overline">{label}</div><div className="mono mt-2 text-xl font-bold">{value}</div></div>)}
        </div>
        <DragScrollArea className="mt-5 border border-border/60">
          <table className="w-full min-w-[1240px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Member", "Assigned RM", "Phone", "Broker", "Broker ID", "Joined", "Expires", "Account", "Expected profit", "Using product", "Membership", "Follow-up routine", "Next follow-up"].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {reportPageRecords.map((record) => {
                const profile = record.member_profile || {};
                const expired = isExpired({ ...record, member_profile: profile });
                return <tr key={record.id} className={`border-b border-border/50 align-top hover:bg-white/[0.03] ${expired ? "bg-red-500/10 animate-pulse" : ""}`}>
                  <td className="px-4 py-3"><div className="font-semibold">{record.crm_lead?.name || record.user?.name || "Name not provided"}</div><div className="mt-1 text-xs text-muted-foreground">{record.club?.offering || record.payment?.product || "50 Cr Club"}</div></td>
                  <td className="px-4 py-3">{record.assigned_to_name || "Unassigned"}</td>
                  <td className="mono px-4 py-3">{record.crm_lead?.phone || record.user?.phone || "—"}</td>
                  <td className="px-4 py-3">{profile.broker_name || "—"}</td>
                  <td className="mono px-4 py-3">{profile.broker_unique_id || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatSourceDate(profile.joined_at || record.club_joined_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{expired ? <span className="font-semibold text-red-600">{formatSourceDate(profile.expires_at || record.club_expires_at)}</span> : formatSourceDate(profile.expires_at || record.club_expires_at)}</td>
                  <td className="px-4 py-3">{profile.broker_account_status?.replace(/_/g, " ") || "Not recorded"}</td>
                  <td className="mono px-4 py-3">{profile.expected_group_profit == null ? "—" : formatAmount(profile.expected_group_profit, "INR")}</td>
                  <td className="px-4 py-3">{profile.product_in_use == null ? "Not checked" : profile.product_in_use ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{profile.membership_enabled == null ? "Not checked" : profile.membership_enabled ? <span className="text-emerald-700">Enabled</span> : <span className="text-red-600">Disabled</span>}</td>
                  <td className="max-w-[260px] whitespace-normal px-4 py-3 text-xs">{profile.follow_up_routine || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{formatDate(profile.next_follow_up_at)}</td>
                </tr>;
              })}
              {!reportPageRecords.length && <tr><td colSpan={13} className="px-5 py-12 text-center text-sm text-muted-foreground">{loading ? "Loading Club member report…" : "No verified Club members match these filters."}</td></tr>}
            </tbody>
          </table>
        </DragScrollArea>
        {reportPageCount > 1 && <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
          <span className="mono text-xs text-muted-foreground">Page {page} of {reportPageCount}</span>
          <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page >= reportPageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
        </div>}
        <p className="mt-3 text-xs text-muted-foreground">Membership and expiry dates come from the verified Club source records. RM assignment is tracked separately from CRM leads.</p>
      </section>}

      {activeTab === "rm-report" && <section className="mt-5" data-testid="club-telecaller-report">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><div className="overline">50 Cr Club · designated relationship managers</div><h2 className="display mt-1 text-2xl font-bold">RM report</h2></div>
          <div className="mono text-xs text-muted-foreground">{rmReportRows.length} designated RMs</div>
        </div>
        <DragScrollArea className="border border-border/60">
          <table className="w-full min-w-[1180px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Telecaller / RM", "Assigned members", "Active memberships", "Using product", "Broker accounts", "Expected group profit", "Follow-ups due", "Calls", ""].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {rmReportRows.map((telecaller) => <tr key={telecaller.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                <td className="px-4 py-3"><div className="font-semibold">{telecaller.name}</div><div className="mt-1 text-xs text-muted-foreground">{telecaller.active ? "Active" : "Disabled"}</div></td>
                <td className="mono px-4 py-3">{telecaller.assigned_members}</td>
                <td className="mono px-4 py-3">{telecaller.active_memberships}</td>
                <td className="mono px-4 py-3">{telecaller.using_product}</td>
                <td className="mono px-4 py-3">{telecaller.broker_accounts_opened}</td>
                <td className="mono px-4 py-3">{formatAmount(telecaller.expected_group_profit, "INR")}</td>
                <td className="mono px-4 py-3">{telecaller.follow_ups_due}</td>
                <td className="mono px-4 py-3">{telecaller.calls_initiated}</td>
                <td className="px-4 py-3"><Button type="button" size="sm" variant="outline" onClick={() => { setRmFilter(telecaller.id); setPage(1); setActiveTab("report"); }}>View members</Button></td>
              </tr>)}
              {!rmReportRows.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No telecaller accounts found.</td></tr>}
            </tbody>
          </table>
        </DragScrollArea>
        <p className="mt-3 text-xs text-muted-foreground">Counts include verified Club purchases assigned directly to each RM, regardless of CRM lead linkage.</p>
      </section>}

      {activeTab === "telecaller-report" && <section className="mt-5" data-testid="club-telecaller-detail-report">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><div className="overline">50 Cr Club · telecaller conversions</div><h2 className="display mt-1 text-2xl font-bold">Telecaller report</h2></div>
          <div className="mono text-xs text-muted-foreground">{telecallerReportRows.length} telecallers · converted Club members only</div>
        </div>
        <DragScrollArea className="border border-border/60">
          <table className="w-full min-w-[1180px] text-sm">
            <thead><tr className="border-b border-border/60 text-left">{["Telecaller", "Converted Club members", "Active memberships", "Using product", "Broker accounts", "Expected group profit", "Follow-ups due", "Calls", ""].map((heading) => <th key={heading} className="overline whitespace-nowrap px-4 py-3">{heading}</th>)}</tr></thead>
            <tbody>
              {telecallerReportRows.map((telecaller) => <tr key={telecaller.id} className="border-b border-border/50 hover:bg-white/[0.03]">
                <td className="px-4 py-3"><div className="font-semibold">{telecaller.name}</div><div className="mt-1 text-xs text-muted-foreground">{telecaller.active ? "Active" : "Disabled"}</div></td>
                <td className="mono px-4 py-3">{telecaller.assigned_members}</td>
                <td className="mono px-4 py-3">{telecaller.active_memberships}</td>
                <td className="mono px-4 py-3">{telecaller.using_product}</td>
                <td className="mono px-4 py-3">{telecaller.broker_accounts_opened}</td>
                <td className="mono px-4 py-3">{formatAmount(telecaller.expected_group_profit, "INR")}</td>
                <td className="mono px-4 py-3">{telecaller.follow_ups_due}</td>
                <td className="mono px-4 py-3">{telecaller.calls_initiated}</td>
                <td className="px-4 py-3"><Button type="button" size="sm" variant="outline" onClick={() => { setRmFilter(telecaller.id); setPage(1); setActiveTab("report"); }}>View members</Button></td>
              </tr>)}
              {!telecallerReportRows.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No telecaller accounts found.</td></tr>}
            </tbody>
          </table>
        </DragScrollArea>
      </section>}

      {!reportOnly && !loading && (!sourceConfigured || Object.values(sourceErrors).some(Boolean)) && <section className="mt-6 border border-amber-500/50 bg-amber-50 px-5 py-4" role="status" data-testid="club-source-error">
        <h2 className="font-semibold">{sourceError?.includes("401") ? "VIP Market rejected the admin credential" : "Live VIP Market sync is unavailable"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{sourceError || "The provider could not be reached."}</p>
        <p className="mt-1 text-xs text-muted-foreground">Stored records remain available while VIP Market refresh runs in the background. Check the backend admin credential and provider availability if the latest records are missing.</p>
      </section>}

      {activeTab === "purchases" && <div className="mt-4 flex flex-wrap items-end gap-2 border border-border/60 px-3 py-2" data-testid="club-select-quantity">
        <div>
          <label htmlFor="club-selection-quantity" className="overline mb-1 block">Select quantity</label>
          <Input id="club-selection-quantity" type="number" min="1" max="200" step="1" value={selectionQuantity} onChange={(event) => setSelectionQuantity(event.target.value)} onKeyDown={(event) => event.key === "Enter" && selectPurchaseQuantity()} placeholder="1–200" className="h-9 w-28 rounded-none" data-testid="club-selection-quantity-input" />
        </div>
        <Button type="button" variant="outline" onClick={selectPurchaseQuantity} disabled={bulkBusy || loading} className="h-9 rounded-none" data-testid="club-select-quantity-button">Select purchases</Button>
        <span className="pb-2 text-xs text-muted-foreground">Selects purchases matching the current filters for RM assignment.</span>
      </div>}

      {activeTab === "purchases" && selectedIds.length > 0 && <section className="mt-4 flex flex-wrap items-end justify-between gap-3 border border-border/60 px-4 py-3" data-testid="club-bulk-assign">
        <div><div className="overline">Assign Club purchases</div><div className="mono mt-1 text-xs text-muted-foreground">{selectedIds.length} selected · maximum 200</div></div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Select value={teamId || "none"} onValueChange={(value) => { setTeamId(value === "none" ? "" : value); setAssigneeId(""); }}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-48" aria-label="Assign Club purchases to team"><SelectValue placeholder="Select team" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Select team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={assigneeId || "none"} onValueChange={(value) => setAssigneeId(value === "none" ? "" : value)} disabled={!teamId}>
            <SelectTrigger className="h-9 w-full rounded-none sm:w-52" aria-label="Assign Club purchases to RM"><SelectValue placeholder="Select RM" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Select RM</SelectItem>{activeRms.map((rm) => <SelectItem key={rm.id} value={rm.id}>{rm.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" onClick={assignPurchases} disabled={bulkBusy || !teamId || !assigneeId} className="h-9 rounded-none" data-testid="club-bulk-assign-button"><UsersRound size={14} className="mr-2" />{bulkBusy ? "Assigning…" : `Assign ${selectedIds.length} to RM`}</Button>
          <Button type="button" variant="outline" onClick={() => setSelectedIds([])} disabled={bulkBusy} className="h-9 rounded-none">Clear selection</Button>
        </div>
      </section>}

      {activeTab === "purchases" && <ClubRecordsSection
        records={pageRecords}
        total={matchingRecords.length}
        error={Object.values(sourceErrors).filter(Boolean).join(" · ")}
        loading={loading}
        selectedIds={selectedIds}
        bulkBusy={bulkBusy}
        onToggleRecord={togglePurchase}
        onTogglePage={togglePage}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        onOpenPurchase={(record) => setSelectedPurchase(record)}
      />}

      <Sheet open={Boolean(selectedPurchase)} onOpenChange={(open) => !open && setSelectedPurchase(null)}>
        <SheetContent className="w-full overflow-y-auto border-l border-border/60 bg-background p-0 sm:max-w-2xl" data-testid="club-purchase-profile">
          {selectedPurchase && <>
            <SheetHeader className="border-b border-border/60 px-6 py-6 pr-14 text-left">
              <div className={`overline flex items-center gap-2 ${selectedPurchase.admin_uploaded ? "text-amber-700" : "text-emerald-700"}`}>{selectedPurchase.admin_uploaded ? <FileSpreadsheet size={14} /> : <CheckCircle2 size={14} />}{selectedPurchase.admin_uploaded ? "Admin uploaded · not payment-verified" : "Provider-verified purchase"}</div>
              <SheetTitle className="display mt-1 text-2xl">{selectedPurchase.user?.name || "Club member"}</SheetTitle>
              <SheetDescription>{selectedPurchase.user?.email || "No email"} · {selectedPurchase.user?.phone || "No phone"}</SheetDescription>
              <Button type="button" onClick={callPurchase} disabled={calling || !selectedPurchase.user?.phone} className="mt-3 w-fit rounded-none" data-testid="club-profile-call-button">
                <Phone size={14} className="mr-2" />{calling ? "Calling…" : `Call ${selectedPurchase.user?.phone || ""}`}
              </Button>
            </SheetHeader>

            <div className="space-y-7 px-6 py-6">
              <section>
                <div className="overline mb-3">Club purchase</div>
                <p className="mb-3 text-xs text-muted-foreground">{selectedPurchase.admin_uploaded ? "Uploaded" : "Paid"} {formatDate(selectedPurchase.admin_uploaded ? selectedPurchase.admin_uploaded_at : selectedPurchase.payment?.paid_at || selectedPurchase.received_at)}</p>
                <dl className="grid gap-px border border-border/60 bg-border/60 sm:grid-cols-2">
                  {[ ["Assigned RM", selectedPurchase.assigned_to_name], ["Relationship owner", selectedPurchase.member_profile?.club_seller_type === "direct" ? "Direct client" : selectedPurchase.member_profile?.club_seller_name || selectedPurchase.club?.seller_name || "Not recorded"], ["Offering", selectedPurchase.club?.offering || selectedPurchase.payment?.product], ["Event", selectedPurchase.club?.event], ["Claimed market", selectedPurchase.club?.claimed_market], ["Broker", selectedPurchase.member_profile?.broker_name || selectedPurchase.club?.broker_name], ["Broker unique ID", selectedPurchase.member_profile?.broker_unique_id || selectedPurchase.club?.broker_unique_id], ["Seller source", selectedPurchase.club?.seller_type], ["Seller / Ref", selectedPurchase.club?.seller_name], ["Amount", formatAmount(selectedPurchase.payment?.amount, selectedPurchase.payment?.currency)], ["Payment status", selectedPurchase.payment?.status], ["Transaction", selectedPurchase.club?.transaction_id || selectedPurchase.payment?.payment_id], ["Verification reason", selectedPurchase.club?.verification_reason], ["Joined", formatSourceDate(selectedPurchase.club?.joined_at)], ["Expires", formatSourceDate(selectedPurchase.club?.expires_at)], ["Used", formatDate(selectedPurchase.club?.used_at)], ["Affiliate", selectedPurchase.club?.affiliate]].filter(([, value]) => hasDetailValue(value)).map(([label, value]) => (
                    <div key={label} className="bg-background p-3"><dt className="overline">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>
                  ))}
                </dl>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div className="overline flex items-center gap-2"><Clock3 size={14} /> Call history</div>
                  <span className="mono text-xs text-muted-foreground">{callHistory.length} initiated</span>
                </div>
                {historyLoading && !callHistory.length ? <p className="text-sm text-muted-foreground">Loading call history…</p> : null}
                {!historyLoading && !callHistory.length ? <p className="border border-border/60 px-4 py-6 text-sm text-muted-foreground">No calls have been initiated for this purchase.</p> : null}
                <ol className="space-y-2" data-testid="club-call-history">
                  {callHistory.map((call) => {
                    const status = call.error || (call.status_code >= 400)
                      ? "Failed"
                      : call.connected === true ? "Connected" : call.connected === false ? "Not connected" : "Initiated";
                    return <li key={call.id} className="grid grid-cols-[1fr_auto] gap-3 border border-border/60 px-4 py-3">
                      <div><div className="text-sm font-medium">{status}</div><div className="mt-1 text-xs text-muted-foreground">{call.error || call.disposition || `${call.call_mode || "Smartflo"} call`}</div></div>
                      <div className="text-right"><div className="mono text-xs">{formatDate(call.created_at)}</div>{call.duration != null && <div className="mono mt-1 text-xs text-muted-foreground">{call.duration}s</div>}</div>
                    </li>;
                  })}
                </ol>
              </section>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
