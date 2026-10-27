import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ClipboardCheck,
  Phone,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatTeamDateTime,
  teamDateTimeInputValue,
  toTeamIso,
} from "@/lib/constants";

const TYPES = [
  { key: "task", label: "Tasks", icon: ClipboardCheck },
  { key: "meeting", label: "Meetings", icon: CalendarDays },
  { key: "call", label: "Calls", icon: Phone },
];

const formatDue = (value) => {
  if (!value) return "No due date";
  return formatTeamDateTime(value);
};

const localDateValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export default function Activities({ defaultType = "task" }) {
  const [params] = useSearchParams();
  const [type, setType] = useState(params.get("type") || defaultType);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const initialDate = params.get("completed") === "today" ? localDateValue() : "";
  const [fromDate, setFromDate] = useState(initialDate);
  const [toDate, setToDate] = useState(initialDate);
  const [callStatus, setCallStatus] = useState("");
  const [callerId, setCallerId] = useState("");
  const [callers, setCallers] = useState([]);
  const [form, setForm] = useState({
    subject: "",
    description: "",
    contact_name: "",
    due_at: teamDateTimeInputValue(),
    priority: "normal",
    call_type: "outbound",
    call_status: "scheduled",
    outcome: "",
  });

  const load = useCallback(async () => {
    try {
      const [{ data }, summaryResponse] = await Promise.all([
        api.get("/crm-activities", { params: {
          kind: type,
          from_date: type === "call" ? fromDate || undefined : undefined,
          to_date: type === "call" ? toDate || undefined : undefined,
          call_status: type === "call" ? callStatus || undefined : undefined,
          user_id: type === "call" ? callerId || undefined : undefined,
        } }),
        api.get("/reports/dashboard"),
      ]);
      setItems(data);
      setSummary(summaryResponse.data?.totals || {});
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [type, fromDate, toDate, callStatus, callerId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (type !== "call") return;
    api.get("/users")
      .then(({ data }) => setCallers(data.filter((item) => item.active && ["team_leader", "telecaller"].includes(item.role))))
      .catch(() => {});
  }, [type]);

  const setDatePreset = (daysAgo) => {
    if (daysAgo === null) {
      setFromDate("");
      setToDate("");
      return;
    }
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const value = localDateValue(date);
    setFromDate(value);
    setToDate(value);
  };

  const create = async (event) => {
    event.preventDefault();
    if (!form.subject.trim()) return toast.error("Subject is required");
    try {
      await api.post("/crm-activities", {
        ...form,
        kind: type,
        due_at: toTeamIso(form.due_at),
      });
      toast.success(
        `${TYPES.find((item) => item.key === type)?.label.slice(0, -1)} created`,
      );
      setForm({
        subject: "",
        description: "",
        contact_name: "",
        due_at: teamDateTimeInputValue(),
        priority: "normal",
        call_type: "outbound",
        call_status: "scheduled",
        outcome: "",
      });
      setOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const updateStatus = async (item, status) => {
    try {
      await api.patch(`/crm-activities/${item.id}`, { status });
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (item) => {
    try {
      await api.delete(`/crm-activities/${item.id}`);
      toast.success("Activity deleted");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const activeType = TYPES.find((item) => item.key === type);
  const Icon = activeType.icon;

  if (selected)
    return (
      <CallDetail
        item={selected}
        onBack={() => setSelected(null)}
        onChanged={load}
      />
    );

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="activities-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Sales workspace</div>
          <h1 className="display mt-1 text-3xl font-black tracking-tight">
            Activities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan calls, organize follow-ups, and keep meetings moving.
          </p>
        </div>
        <Button
          data-testid="new-activity-button"
          onClick={() => setOpen(true)}
          className="bg-[#ef8d5c] text-white hover:bg-[#df7b4b]"
        >
          <Plus size={15} className="mr-2" />
          New {activeType.label.slice(0, -1)}
        </Button>
      </div>

      <div className="mt-7 flex gap-1 border-b border-border/70" role="tablist">
        {TYPES.map(({ key, label, icon: TabIcon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={type === key}
            data-testid={`activity-tab-${key}`}
            onClick={() => setType(key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${type === key ? "border-[#247e9d] text-[#247e9d]" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <TabIcon size={16} />
            {label}
          </button>
        ))}
      </div>

      {type === "call" && (
        <>
        <div className="mt-5 flex flex-wrap items-end gap-3 border border-border/60 bg-[#0c0c0f] p-4" data-testid="call-history-filters">
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">From</div>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} data-testid="calls-from-date" className="h-9 rounded-none border-border/70 bg-background" />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">To</div>
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} data-testid="calls-to-date" className="h-9 rounded-none border-border/70 bg-background" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[ [0, "Today"], [1, "Yesterday"], [2, "2 days ago"], [null, "All time"] ].map(([daysAgo, label]) => (
              <Button key={label} type="button" variant="outline" onClick={() => setDatePreset(daysAgo)} className="h-9 rounded-none border-border/70 px-2.5 text-xs">{label}</Button>
            ))}
          </div>
          <Select value={callStatus || "all"} onValueChange={(value) => setCallStatus(value === "all" ? "" : value)}>
            <SelectTrigger data-testid="calls-status-filter" className="h-9 w-[150px] rounded-none border-border/70 bg-background"><SelectValue placeholder="All outcomes" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All outcomes</SelectItem><SelectItem value="connected">Connected</SelectItem><SelectItem value="failed">Not connected</SelectItem></SelectContent>
          </Select>
          <Select value={callerId || "all"} onValueChange={(value) => setCallerId(value === "all" ? "" : value)}>
            <SelectTrigger data-testid="calls-caller-filter" className="h-9 w-[190px] rounded-none border-border/70 bg-background"><SelectValue placeholder="All callers" /></SelectTrigger>
            <SelectContent><SelectItem value="all">All callers</SelectItem>{callers.map((caller) => <SelectItem key={caller.id} value={caller.id}>{caller.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="crm-card p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Completed today
            </div>
            <div
              className="mt-2 text-3xl font-black text-[#247e9d]"
              data-testid="calls-completed-today"
            >
              {summary?.calls_today ?? "—"}
            </div>
          </div>
          <div className="crm-card p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Listed calls
            </div>
            <div className="mt-2 text-3xl font-black">{items.length}</div>
          </div>
          <div className="crm-card p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Completed in list
            </div>
            <div className="mt-2 text-3xl font-black">
              {items.filter((item) => item.status === "completed").length}
            </div>
          </div>
        </div>
        </>
      )}

      <div className="mt-5 grid gap-3" data-testid="activity-list">
        {items.map((item) => (
          <article
            key={item.id}
            onClick={() => type === "call" && setSelected(item)}
            className={`crm-card flex flex-wrap items-center gap-4 p-4 ${type === "call" ? "cursor-pointer hover:border-[#247e9d]" : ""}`}
          >
            <div className="rounded-lg bg-[#e5f4f6] p-2 text-[#247e9d]">
              <Icon size={18} />
            </div>
            <div className="min-w-[220px] flex-1">
              <h2
                className={`font-bold ${item.status === "completed" ? "line-through" : ""}`}
              >
                {item.subject}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.description || "No description"}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users size={14} />
              {item.contact_name || "No contact"}
            </div>
            <div className="min-w-[150px] text-xs text-muted-foreground">
              {formatDue(item.completed_at || item.due_at || item.created_at)}
              <span className="ml-2 capitalize text-foreground">{item.call_status || item.priority}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                title="Mark complete"
                aria-label="Mark complete"
                disabled={item.status === "completed"}
                onClick={() => updateStatus(item, "completed")}
                className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
              >
                <Check size={16} />
              </button>
              <button
                title="Delete activity"
                aria-label="Delete activity"
                onClick={() => remove(item)}
                className="rounded-md p-2 text-red-500 hover:bg-red-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
        {!items.length && (
          <div className="crm-card px-5 py-16 text-center text-sm text-muted-foreground">
            <Icon className="mx-auto mb-3 text-[#247e9d]" size={24} />
            No {activeType.label.toLowerCase()} yet. Create the first one.
          </div>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={create}
            className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="display text-xl font-bold">
                New {activeType.label.slice(0, -1)}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground"
              >
                Close
              </button>
            </div>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Subject
                </label>
                <Input
                  autoFocus
                  value={form.subject}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                  placeholder={`e.g. ${type === "meeting" ? "Product demo" : type === "call" ? "Follow up with lead" : "Send proposal"}`}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Contact / Lead
                </label>
                <Input
                  value={form.contact_name}
                  onChange={(e) =>
                    setForm({ ...form, contact_name: e.target.value })
                  }
                  placeholder="Contact or company name"
                />
              </div>
              {type === "call" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Call type
                    </label>
                    <select
                      value={form.call_type}
                      onChange={(e) =>
                        setForm({ ...form, call_type: e.target.value })
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="outbound">Outbound</option>
                      <option value="inbound">Inbound</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Call status
                    </label>
                    <select
                      value={form.call_status}
                      onChange={(e) =>
                        setForm({ ...form, call_status: e.target.value })
                      }
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="not_connected">Not connected</option>
                      <option value="not_picked_up">Not picked up</option>
                      <option value="overdue">Overdue</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Start time
                  </label>
                  <Input
                    type="datetime-local"
                    value={form.due_at}
                    onChange={(e) =>
                      setForm({ ...form, due_at: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value })
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Outcome / Notes
                </label>
                <Textarea
                  value={type === "call" ? form.outcome : form.description}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [type === "call" ? "outcome" : "description"]:
                        e.target.value,
                    })
                  }
                  placeholder="Add context for the next action"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-[#247e9d] text-white hover:bg-[#15556b]"
              >
                Create activity
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function CallDetail({ item, onBack, onChanged }) {
  const [tab, setTab] = useState("overview");
  const complete = async () => {
    try {
      await api.patch(`/crm-activities/${item.id}`, {
        status: "completed",
        call_status: "completed",
      });
      toast.success("Call marked as completed");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="min-h-full bg-background" data-testid="call-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-white px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-md p-2 hover:bg-slate-100"
            aria-label="Back"
          >
            <ArrowLeft size={19} />
          </button>
          <div>
            <div className="text-xs text-muted-foreground">Calls</div>
            <h1 className="display text-xl font-bold">
              <Phone size={17} className="mr-2 inline text-[#247e9d]" />
              {item.subject}{" "}
              <span className="font-normal text-muted-foreground">- Leads</span>
            </h1>
            <div className="text-xs text-muted-foreground">
              Add tags · Owner: {item.owner_name || "—"}
            </div>
          </div>
        </div>
        <Button
          onClick={complete}
          className="bg-[#247e9d] text-white hover:bg-[#15556b]"
        >
          Mark as Completed
        </Button>
      </div>
      <div className="border-b border-border/70 bg-[#eef3fb] px-5 py-3 lg:px-8">
        <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
          {["overview", "timeline"].map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-full px-5 py-1.5 text-sm capitalize ${tab === value ? "bg-[#e4eafb] font-semibold text-[#273b78]" : "text-muted-foreground"}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[1fr_280px] lg:p-8">
        {tab === "overview" ? (
          <div className="crm-card">
            <div className="grid gap-5 p-6 sm:grid-cols-2">
              <Detail
                label="Call For"
                value={`${item.contact_name || "—"} - Leads`}
              />
              <Detail label="Related To" value="—" />
              <Detail label="Call Type" value={item.call_type || "Outbound"} />
              <Detail
                label="Outgoing Call Status"
                value={item.call_status || item.status}
              />
              <Detail
                label="Call Start Time"
                value={formatDue(
                  item.completed_at || item.due_at || item.created_at,
                )}
              />
              <Detail label="Call Owner" value={item.owner_name || "—"} />
              <Detail label="Subject" value={item.subject} />
              <Detail
                label="Outcome"
                value={item.outcome || item.description || "—"}
              />
            </div>
          </div>
        ) : (
          <div className="crm-card p-6">
            <h2 className="font-bold">Timeline</h2>
            <div className="mt-5 border-l-2 border-[#b8dce2] pl-4 text-sm">
              <p className="font-semibold">Call created</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDue(item.created_at)} by {item.owner_name || "—"}
              </p>
            </div>
          </div>
        )}
        <aside className="crm-card h-fit p-5">
          <h2 className="font-bold">Info</h2>
          <div className="mt-4 space-y-3 text-sm">
            <Detail label="Contact" value={item.contact_name || "—"} />
            <Detail label="Owner" value={item.owner_name || "—"} />
            <Detail label="Status" value={item.call_status || item.status} />
          </div>
          <h3 className="mt-7 border-t border-border/70 pt-5 font-bold">
            Open Activities
          </h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between rounded-md bg-[#f0f2fb] px-3 py-2 font-semibold text-[#0f2344]">
              Tasks <span>0</span>
            </div>
            <div className="flex justify-between rounded-md bg-[#f0f2fb] px-3 py-2 font-semibold text-[#0f2344]">
              Meetings <span>0</span>
            </div>
            <div className="flex justify-between rounded-md bg-[#f0f2fb] px-3 py-2 font-semibold text-[#0f2344]">
              Calls <span>1</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium capitalize">{value}</div>
    </div>
  );
}
