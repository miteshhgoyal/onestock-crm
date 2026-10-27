import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Download, Plus, Search, Trash2, Upload, Zap } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { SOURCE_LABEL, SOURCES, STATUSES, STATUS_META, fmtDate, relative } from "@/lib/constants";
import { CAPITAL_RANGES, INCOME_BRACKETS, INCOME_LABEL, INDIAN_STATES_AND_UTS, MARKETS, MARKET_LABEL, OCCUPATIONS, OCCUPATION_LABEL, TRADER_LABEL, TRADER_TYPES } from "@/lib/leadProfile";
import FollowUpTimer from "@/components/FollowUpTimer";
import StatusBadge from "@/components/StatusBadge";
import LeadDrawer from "@/components/LeadDrawer";
import NewLeadDialog from "@/components/NewLeadDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BUCKETS = [
  ["", "All leads"],
  ["unassigned", "Unassigned"],
  ["today", "Due today"],
  ["overdue", "Missed follow-ups"],
  ["escalated", "Escalated"],
  ["inactive", "Inactive"],
];

export default function Leads() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState([]);
  const [callers, setCallers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [leadSources, setLeadSources] = useState(SOURCES.map((value) => ({ value, label: SOURCE_LABEL[value] })));
  const [uploadSource, setUploadSource] = useState("csv");
  const [importOpen, setImportOpen] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [openLead, setOpenLead] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [customSelectionSize, setCustomSelectionSize] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [duplicateSelected, setDuplicateSelected] = useState([]);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const fileRef = useRef(null);

  const bucket = params.get("bucket") || "";
  const status = params.get("status") || "";
  const source = params.get("source") || "";
  const state = params.get("state") || "";
  const assignee = params.get("assigned_to") || "";
  const tags = params.get("tags") || "";
  const enrolledIn = tags.split(",").some((tag) => tag.trim().toLowerCase() === "50-cr-club") ? "50-cr-club" : "none";
  const callOutcome = params.get("call_outcome") || "";
  const callNumber = params.get("call_number") || "";
  const courseId = params.get("course_id") || "";
  const occupation = params.get("occupation") || "";
  const incomeMax = params.get("income_max") || "";
  const traderType = params.get("trader_type") || "";
  const market = params.get("market") || "";
  const capitalRange = params.get("capital_range") || "";
  const selectedCapitalRange = CAPITAL_RANGES.find(([key]) => key === capitalRange);
  const capitalMin = selectedCapitalRange?.[2];
  const capitalMax = selectedCapitalRange?.[3];
  const canAssign = ["admin", "subadmin", "team_leader"].includes(user?.role);
  const canDelete = ["admin", "subadmin"].includes(user?.role);
  const buckets = [...BUCKETS, ...(["admin", "subadmin"].includes(user?.role) ? [["actionless", "Actionless 24h"]] : [])];

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const setEnrollmentFilter = (value) => {
    const otherTags = tags.split(",").map((tag) => tag.trim()).filter((tag) => tag && tag.toLowerCase() !== "50-cr-club");
    setParam("tags", [...otherTags, ...(value === "50-cr-club" ? [value] : [])].join(","));
  };

  useEffect(() => {
    if (params.get("new") !== "1") return;
    setNewOpen(true);
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(timeoutId);
  }, [q]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/leads", {
        params: { bucket: bucket || undefined, status: status || undefined, source: source || undefined, state: state || undefined, assigned_to: assignee || undefined, tags: tags || undefined, call_outcome: callOutcome || undefined, call_number: callNumber || undefined, course_id: courseId || undefined, occupation: occupation || undefined, income_max: incomeMax || undefined, trader_type: traderType || undefined, market: market || undefined, capital_min: capitalMin, capital_max: capitalMax, q: debouncedQ || undefined, page, limit: 50 },
      });
      setItems(data.items);
      setTotal(data.total);
      setSelected([]);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [bucket, status, source, state, assignee, tags, callOutcome, callNumber, courseId, occupation, incomeMax, traderType, market, capitalMin, capitalMax, debouncedQ, page]);

  useEffect(() => {
    setPage(1);
  }, [bucket, status, source, state, assignee, tags, callOutcome, callNumber, courseId, occupation, incomeMax, traderType, market, capitalRange, debouncedQ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const paramsForRole = user?.role === "team_leader" ? { role: "telecaller" } : undefined;
    api.get("/users", { params: paramsForRole })
      .then(({ data }) => {
        const list = data.filter((target) => target.active && ["team_leader", "telecaller"].includes(target.role));
        if (user?.role === "team_leader" && user?.id && !list.some((c) => c.id === user.id)) {
          list.unshift({ id: user.id, name: `${user.name} (me)`, role: "team_leader", active: true });
        }
        setCallers(list);
      })
      .catch(() => {});
  }, [user?.role]);

  useEffect(() => {
    api.get("/courses").then(({ data }) => setCourses(data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/lead-sources").then(({ data }) => setLeadSources(data)).catch(() => {});
  }, []);

  const bulkAssign = async (assigneeId) => {
    try {
      const { data } = await api.post("/leads/assign", { lead_ids: selected, assignee_id: assigneeId });
      toast.success(`${data.assigned} lead(s) assigned`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const bulkUnassign = async () => {
    if (!selected.length) return;
    try {
      const { data } = await api.post("/leads/unassign", { lead_ids: selected });
      toast.success(`${data.unassigned} lead(s) unassigned`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const autoAssign = async () => {
    try {
      const { data } = await api.post("/leads/auto-assign", selected.length ? { lead_ids: selected } : { limit: 50 });
      toast.success(`Round-robin assigned ${data.assigned} lead(s)`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const selectLeadBatch = async (requestedCount) => {
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1 || count > 5000) {
      toast.error("Choose a number between 1 and 5000");
      return;
    }
    try {
      const { data } = await api.get("/leads", {
        params: { bucket: bucket || undefined, status: status || undefined, source: source || undefined, state: state || undefined, assigned_to: assignee || undefined, tags: tags || undefined, call_outcome: callOutcome || undefined, call_number: callNumber || undefined, course_id: courseId || undefined, occupation: occupation || undefined, income_max: incomeMax || undefined, trader_type: traderType || undefined, market: market || undefined, capital_min: capitalMin, capital_max: capitalMax, q: q || undefined, page: 1, limit: count },
      });
      const ids = (data.items || []).map((lead) => lead.id);
      setSelected(ids);
      toast.success(`${ids.length} lead(s) selected`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteLeadBatch = async (requestedCount) => {
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1 || count > 5000) {
      toast.error("Choose a number between 1 and 5000");
      return;
    }
    try {
      const { data } = await api.get("/leads", {
        params: { bucket: bucket || undefined, status: status || undefined, source: source || undefined, state: state || undefined, assigned_to: assignee || undefined, tags: tags || undefined, call_outcome: callOutcome || undefined, course_id: courseId || undefined, occupation: occupation || undefined, income_max: incomeMax || undefined, trader_type: traderType || undefined, market: market || undefined, capital_min: capitalMin, capital_max: capitalMax, q: q || undefined, page: 1, limit: count },
      });
      const ids = (data.items || []).map((lead) => lead.id);
      if (!ids.length) {
        toast.error("No leads match the current filters");
        return;
      }
      if (!window.confirm(`Delete ${ids.length} lead(s)? This cannot be undone.`)) return;
      const result = await api.post("/leads/bulk-delete", { lead_ids: ids });
      toast.success(`${result.data.deleted} lead(s) deleted`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    body.append("source", uploadSource);
    try {
      const { data } = await api.post("/leads/import", body);
      toast.success(`Imported ${data.created} · ${data.duplicates} duplicates · ${data.invalid} invalid`);
      load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      e.target.value = "";
    }
  };

  const createSource = async () => {
    if (!sourceName.trim()) return;
    setSourceBusy(true);
    try {
      const { data } = await api.post("/lead-sources", { name: sourceName.trim() });
      setLeadSources((items) => [...items, data]);
      setUploadSource(data.value);
      setSourceName("");
      toast.success("Lead source created");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSourceBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const { data } = await api.get("/leads/export", {
        params: { bucket: bucket || undefined, status: status || undefined, source: source || undefined, state: state || undefined, assigned_to: assignee || undefined, tags: tags || undefined, call_outcome: callOutcome || undefined, call_number: callNumber || undefined, course_id: courseId || undefined, occupation: occupation || undefined, income_max: incomeMax || undefined, trader_type: traderType || undefined, market: market || undefined, capital_min: capitalMin, capital_max: capitalMax, q: q || undefined },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const loadDuplicates = async () => {
    setDuplicateBusy(true);
    try {
      const { data } = await api.get("/leads/duplicates");
      setDuplicateGroups(data.groups || []);
      setDuplicateSelected([]);
      setDuplicateOpen(true);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDuplicateBusy(false);
    }
  };

  const toggleDuplicate = (id) => {
    setDuplicateSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };

  const assignDuplicates = async (assigneeId) => {
    if (!duplicateSelected.length) return;
    try {
      const { data } = await api.post("/leads/assign", { lead_ids: duplicateSelected, assignee_id: assigneeId });
      toast.success(`${data.assigned} duplicate lead(s) assigned`);
      await loadDuplicates();
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const deleteDuplicates = async () => {
    if (!duplicateSelected.length) return;
    if (!window.confirm(`Delete ${duplicateSelected.length} selected duplicate lead(s)? This cannot be undone.`)) return;
    try {
      const { data } = await api.post("/leads/bulk-delete", { lead_ids: duplicateSelected });
      toast.success(`${data.deleted} duplicate lead(s) deleted`);
      await loadDuplicates();
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="leads-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">Pipeline</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tighter">
            Leads <span className="text-muted-foreground">{total}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" data-testid="export-csv-button" onClick={exportCsv} className="rounded-none border-border/70">
            <Download size={14} className="mr-2" /> Export CSV
          </Button>
          <Button variant="outline" data-testid="find-duplicates-button" onClick={loadDuplicates} disabled={duplicateBusy} className="rounded-none border-border/70">
            <Copy size={14} className="mr-2" /> {duplicateBusy ? "Checking…" : "Find duplicates"}
          </Button>
          {["admin", "subadmin"].includes(user?.role) && (
            <>
              <Button variant="outline" data-testid="csv-upload-button" onClick={() => setImportOpen(true)} className="rounded-none border-border/70">
                <Upload size={14} className="mr-2" /> Import CSV
              </Button>
              <Button variant="outline" data-testid="auto-assign-button" onClick={autoAssign} className="rounded-none border-border/70">
                <Zap size={14} className="mr-2" /> Auto assign
              </Button>
            </>
          )}
          {["admin", "subadmin", "telecaller"].includes(user?.role) && <Button data-testid="new-lead-button" onClick={() => setNewOpen(true)} className="rounded-none bg-brand text-brand-foreground hover:bg-brand/90"><Plus size={14} className="mr-2" /> New lead</Button>}
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2 border-b border-border/60 pb-4">
        {buckets.map(([value, label]) => (
          <button
            key={value || "all"}
            data-testid={`bucket-${value || "all"}`}
            onClick={() => setParam("bucket", value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
              bucket === value ? "bg-brand text-brand-foreground" : "border border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
          <Input
            data-testid="lead-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, phone, email"
            className="h-10 rounded-none border-border/70 bg-[#0c0c0f] pl-9"
          />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-status" className="h-10 w-[170px] rounded-none border-border/70 bg-[#0c0c0f]">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} data-testid={`filter-status-option-${s}`}>{STATUS_META[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={callNumber || "all"} onValueChange={(v) => setParam("call_number", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-call-number" className="h-10 w-[150px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Call attempt" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All call attempts</SelectItem>
            {[1, 2, 3, 4].map((number) => <SelectItem key={number} value={String(number)}>Call {number}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={callOutcome || "all"} onValueChange={(v) => setParam("call_outcome", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-call-outcome" className="h-10 w-[200px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Latest call outcome" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All call outcomes</SelectItem>
            <SelectItem value="connected">Connected</SelectItem>
            <SelectItem value="not_connected">Not connected</SelectItem>
          </SelectContent>
        </Select>
        <Input value={tags} onChange={(e) => setParam("tags", e.target.value)} placeholder="Tags: hot, demo" data-testid="filter-tags" className="h-10 w-[180px] rounded-none border-border/70 bg-[#0c0c0f]" />
        <Select value={enrolledIn} onValueChange={setEnrollmentFilter}>
          <SelectTrigger data-testid="filter-enrolled-in" className="h-10 w-[180px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Enrolled in" /></SelectTrigger>
          <SelectContent><SelectItem value="none">All enrollments</SelectItem><SelectItem value="50-cr-club">50 Cr Club</SelectItem></SelectContent>
        </Select>
        <Select value={source || "all"} onValueChange={(v) => setParam("source", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-source" className="h-10 w-[170px] rounded-none border-border/70 bg-[#0c0c0f]">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {leadSources.map(({ value, label }) => (
              <SelectItem key={value} value={value} data-testid={`filter-source-option-${value}`}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state || "all"} onValueChange={(v) => setParam("state", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-state" className="h-10 w-[210px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="State / UT" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states / UTs</SelectItem>
            {INDIAN_STATES_AND_UTS.map(([value, label]) => (
              <SelectItem key={value} value={value} data-testid={`filter-state-option-${value}`}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={courseId || "all"} onValueChange={(v) => setParam("course_id", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-course" className="h-10 w-[190px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Course" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={assignee || "all"} onValueChange={(v) => setParam("assigned_to", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-assignee" className="h-10 w-[180px] rounded-none border-border/70 bg-[#0c0c0f]">
            <SelectValue placeholder={user?.role === "team_leader" ? "Team telecaller" : "Assign to"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {callers.map((c) => (
              <SelectItem key={c.id} value={c.id} data-testid={`filter-assignee-option-${c.id}`}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={occupation || "all"} onValueChange={(v) => setParam("occupation", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-occupation" className="h-10 w-[170px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Job profile" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All job profiles</SelectItem>
            {OCCUPATIONS.map((o) => (
              <SelectItem key={o} value={o} data-testid={`filter-occupation-option-${o}`}>{OCCUPATION_LABEL[o]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={incomeMax || "all"} onValueChange={(v) => setParam("income_max", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-income-max" className="h-10 w-[190px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Income up to" /></SelectTrigger>
          <SelectContent>
              <SelectItem value="all">Any income</SelectItem>
            {INCOME_BRACKETS.map((i) => (
              <SelectItem key={i} value={i} data-testid={`filter-income-option-${i}`}>{i === "above_1cr" ? INCOME_LABEL[i] : `Up to ${INCOME_LABEL[i]}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={traderType || "all"} onValueChange={(v) => setParam("trader_type", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-trader-type" className="h-10 w-[190px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Trader" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Trader & non trader</SelectItem>
            {TRADER_TYPES.map((t) => (
              <SelectItem key={t} value={t} data-testid={`filter-trader-option-${t}`}>{TRADER_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={market || "all"} onValueChange={(v) => setParam("market", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-market" className="h-10 w-[180px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Market interest" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All markets</SelectItem>
            {MARKETS.map((m) => (
              <SelectItem key={m} value={m} data-testid={`filter-market-option-${m}`}>{MARKET_LABEL[m]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={capitalRange || "all"} onValueChange={(v) => setParam("capital_range", v === "all" ? "" : v)}>
          <SelectTrigger data-testid="filter-capital-range" className="h-10 w-[190px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Trading capital" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any capital</SelectItem>
            {CAPITAL_RANGES.map(([key, label]) => (
              <SelectItem key={key} value={key} data-testid={`filter-capital-option-${key}`}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canAssign && (
          <div className="flex items-center gap-2 border border-border/60 px-2 py-1.5">
            <span className="overline whitespace-nowrap">Select leads</span>
            <Button type="button" variant="outline" data-testid="select-100-leads" onClick={() => selectLeadBatch(100)} className="h-8 rounded-none border-border/70 px-2 text-xs">100</Button>
            <Button type="button" variant="outline" data-testid="select-500-leads" onClick={() => selectLeadBatch(500)} className="h-8 rounded-none border-border/70 px-2 text-xs">500</Button>
            <Input type="number" min="1" max="5000" value={customSelectionSize} onChange={(e) => setCustomSelectionSize(e.target.value)} placeholder="Custom" data-testid="custom-lead-count" className="h-8 w-[78px] rounded-none border-border/70 px-2 text-xs" />
            <Button type="button" variant="outline" data-testid="select-custom-leads" onClick={() => selectLeadBatch(customSelectionSize)} className="h-8 rounded-none border-border/70 px-2 text-xs">Select</Button>
            {canDelete && <Button type="button" variant="outline" data-testid="delete-custom-leads" onClick={() => deleteLeadBatch(customSelectionSize)} className="h-8 rounded-none border-red-500/50 px-2 text-xs text-red-400 hover:bg-red-500/10"><Trash2 size={13} className="mr-1" /> Delete quantity</Button>}
          </div>
        )}

        {canAssign && selected.length > 0 && (
          <div className="ml-auto flex items-center gap-3 border border-white/30 px-3 py-1.5">
            <span className="mono text-xs" data-testid="selected-count">{selected.length} selected</span>
            <Select onValueChange={bulkAssign}>
              <SelectTrigger data-testid="bulk-assign-select" className="h-8 w-[180px] rounded-none border-border/70 bg-[#0c0c0f]">
                <SelectValue placeholder={user?.role === "team_leader" ? "Assign to telecaller…" : "Assign to team leader…"} />
              </SelectTrigger>
              <SelectContent>
                {callers.map((c) => (
                  <SelectItem key={c.id} value={c.id} data-testid={`bulk-assign-option-${c.id}`}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" data-testid="bulk-unassign-button" onClick={bulkUnassign} className="h-8 rounded-none border-border/70 px-2 text-xs">Unassign</Button>
            <Button type="button" variant="ghost" data-testid="deselect-all-button" onClick={() => setSelected([])} className="h-8 rounded-none px-2 text-xs text-muted-foreground hover:text-foreground">Deselect all</Button>
          </div>
        )}
      </div>

      <div className="mt-6 border border-border/60">
        <table className="w-full text-sm" data-testid="leads-table">
          <thead className="bg-[#0c0c0f]">
            <tr className="border-b border-border/60 text-left">
              {canAssign && <th className="w-10 px-4 py-3" />}
              {["Lead", "Phone", "Stage", "Profile", "Course", "Source", "Assigned to", "Follow-up timer", "Last saved"].map((h) => (
                <th key={h} className="overline px-4 py-3 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((lead) => (
              <tr
                key={lead.id}
                data-testid={`lead-row-${lead.id}`}
                className="row-enter cursor-pointer border-b border-border/40 transition-colors duration-150 hover:bg-white/[0.03]"
                onClick={() => setOpenLead(lead.id)}
              >
                {canAssign && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      data-testid={`lead-select-${lead.id}`}
                      checked={selected.includes(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    {lead.name}
                    {lead.escalated && (
                      <span data-testid={`escalated-flag-${lead.id}`} className="mono border border-red-500/40 bg-red-500/10 px-1.5 text-[10px] text-red-400">
                        ESC
                      </span>
                    )}
                  </div>
                  <div className="mono text-xs text-muted-foreground">{lead.email || "—"}</div>
                </td>
                <td className="mono px-4 py-3">{lead.phone}</td>
                <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                <td className="px-4 py-3" data-testid={`lead-profile-${lead.id}`}>
                  <div className="flex flex-wrap items-center gap-1">
                    {lead.trader_type && (
                      <span className={`mono border px-1.5 text-[10px] ${lead.trader_type === "trader" ? "border-brand/40 bg-brand/10 text-brand" : "border-border/70 text-muted-foreground"}`}>
                        {lead.trader_type === "trader" ? "TRADER" : "NON-TRADER"}
                      </span>
                    )}
                    {lead.occupation && (
                      <span className="text-xs text-muted-foreground">{OCCUPATION_LABEL[lead.occupation]}</span>
                    )}
                    {!lead.trader_type && !lead.occupation && <span className="text-muted-foreground">—</span>}
                  </div>
                  {lead.annual_income && (
                    <div className="mono text-[10px] text-muted-foreground">{INCOME_LABEL[lead.annual_income]}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{lead.course_name || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{SOURCE_LABEL[lead.source] || lead.source}</td>
                <td className="px-4 py-3">{lead.assigned_to_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                <td className="px-4 py-3 text-xs">
                  {lead.status === "follow_up" && <FollowUpTimer value={lead.next_follow_up_at} testId={`followup-timer-${lead.id}`} />}
                  {lead.status === "follow_up" && lead.next_follow_up_at && (
                    <div className="mono mt-0.5 text-[10px] text-muted-foreground">{fmtDate(lead.next_follow_up_at)} IST</div>
                  )}
                </td>
                <td className="mono px-4 py-3 text-xs text-muted-foreground">{lead.updated_at ? `${fmtDate(lead.updated_at)} IST` : "—"}</td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={canAssign ? 11 : 10} className="px-4 py-16 text-center text-sm text-muted-foreground" data-testid="leads-empty">
                  No leads match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between" data-testid="leads-pagination">
        <span className="mono text-xs text-muted-foreground">
          Page {page} of {Math.max(1, Math.ceil(total / 50))} · {total} leads
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            data-testid="prev-page-button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-none border-border/70"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            data-testid="next-page-button"
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-none border-border/70"
          >
            Next
          </Button>
        </div>
      </div>

      <LeadDrawer
        leadId={openLead}
        open={!!openLead}
        onOpenChange={(v) => !v && setOpenLead(null)}
        assignees={callers}
        courses={courses}
        canAssign={canAssign}
        canDelete={canDelete}
        onChanged={load}
      />
      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} onCreated={load} courses={courses} />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="rounded-none border-border/70 bg-[#0c0c0f]" data-testid="csv-import-dialog">
          <DialogHeader>
            <DialogTitle className="display text-xl">Import leads</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="overline mb-1.5">Source for imported leads</div>
              <Select value={uploadSource} onValueChange={setUploadSource}>
                <SelectTrigger data-testid="csv-import-source" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {leadSources.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">A CSV with one phone-number column is enough. Use a Phone, Mobile, or Number header, or leave the file headerless.</p>
            {user?.role === "admin" && (
              <div className="border-t border-border/60 pt-4">
                <div className="overline mb-1.5">Create source</div>
                <div className="flex gap-2">
                  <Input data-testid="new-source-name" value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="e.g. College seminar" className="rounded-none border-border/70 bg-background" />
                  <Button type="button" onClick={createSource} disabled={sourceBusy || !sourceName.trim()} className="rounded-none">{sourceBusy ? "Adding…" : "Add"}</Button>
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".csv" onChange={(event) => { upload(event); setImportOpen(false); }} className="hidden" data-testid="csv-file-input" />
            <Button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">
              <Upload size={14} className="mr-2" /> Choose CSV file
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-none border-border/70 bg-[#0c0c0f]" data-testid="duplicate-dialog">
          <DialogHeader>
            <DialogTitle className="display text-xl">Duplicate leads</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>Select records to assign or remove. Duplicate groups are based on matching phone or email.</span>
            <span className="mono" data-testid="duplicate-selected-count">{duplicateSelected.length} selected</span>
          </div>
          {duplicateGroups.map((group) => (
            <div key={group.key} className="border border-border/60">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-xs">
                <span><span className="font-semibold">Same {group.reason.toLowerCase()}</span> · <span className="mono">{group.value}</span></span>
                <span className="text-muted-foreground">{group.leads.length} records</span>
              </div>
              <div className="divide-y divide-border/40">
                {group.leads.map((lead) => (
                  <label key={lead.id} className="flex cursor-pointer items-center gap-3 px-3 py-3 text-sm hover:bg-white/[0.03]">
                    <input type="checkbox" checked={duplicateSelected.includes(lead.id)} onChange={() => toggleDuplicate(lead.id)} data-testid={`duplicate-select-${lead.id}`} className="h-4 w-4 accent-[var(--brand)]" />
                    <span className="min-w-0 flex-1"><span className="font-medium">{lead.name}</span><span className="ml-2 text-xs text-muted-foreground">{lead.phone} · {lead.assigned_to_name || "Unassigned"}</span></span>
                    <span className="text-xs text-muted-foreground">{lead.status}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {!duplicateGroups.length && <div className="py-12 text-center text-sm text-muted-foreground" data-testid="duplicates-empty">No duplicate leads found.</div>}
          {duplicateSelected.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
              {canAssign && <Select onValueChange={assignDuplicates}><SelectTrigger data-testid="duplicate-assign-select" className="h-9 w-[200px] rounded-none border-border/70 bg-background"><SelectValue placeholder="Assign selected to…" /></SelectTrigger><SelectContent>{callers.map((caller) => <SelectItem key={caller.id} value={caller.id}>{caller.name}</SelectItem>)}</SelectContent></Select>}
              {canDelete && <Button type="button" variant="outline" data-testid="delete-duplicates-button" onClick={deleteDuplicates} className="h-9 rounded-none border-red-500/50 text-red-400 hover:bg-red-500/10"><Trash2 size={14} className="mr-2" /> Delete selected</Button>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
