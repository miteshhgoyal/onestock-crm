export const STATUS_META = {
  new_lead: { label: "New Lead", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30", hex: "#3b82f6" },
  assigned: { label: "Assigned", cls: "bg-violet-500/10 text-violet-400 border-violet-500/30", hex: "#8b5cf6" },
  contacted: { label: "Connected", cls: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30", hex: "#6366f1" },
  not_connected: { label: "Not connected", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30", hex: "#f59e0b" },
  not_picked_up: { label: "Not picked up", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30", hex: "#f97316" },
  follow_up: { label: "Follow-up", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", hex: "#eab308" },
  interested: { label: "Interested", cls: "bg-orange-500/10 text-orange-400 border-orange-500/30", hex: "#f97316" },
  not_interested: { label: "Not Interested", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30", hex: "#71717a" },
  converted: { label: "Converted", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", hex: "#10b981" },
  lost: { label: "Lost", cls: "bg-red-500/10 text-red-400 border-red-500/30", hex: "#ef4444" },
};

export const STATUSES = Object.keys(STATUS_META);

export const UNWORKED_STATUSES = ["new_lead", "assigned"];

export const isLeadWorked = (lead) => {
  if (!lead) return false;
  if (!UNWORKED_STATUSES.includes(lead.status)) return true;
  if (lead.last_call_outcome) return true;
  if (lead.calls && lead.calls.some((c) => Boolean(c.call_outcome || c.manual_call_outcome))) return true;
  return false;
};

export const isLeadUnworked = (lead) => !isLeadWorked(lead);

export const SOURCE_LABEL = {
  manual: "Manual",
  csv: "CSV Import",
  website_form: "Website Form",
  facebook_ads: "Facebook Ads",
  google_ads: "Google Ads",
  whatsapp: "WhatsApp",
  payment_webhook: "Payment webhook",
  other: "Other",
};

export const SOURCES = Object.keys(SOURCE_LABEL);

export const ROLE_LABEL = {
  admin: "Admin",
  subadmin: "Sub-admin",
  team_leader: "Team Leader",
  telecaller: "Telecaller",
};

export const TEAM_TIMEZONE = "Asia/Kolkata";

export function formatTeamDate(value, options = {}) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TEAM_TIMEZONE, ...options }).format(new Date(value));
}

export function formatTeamDateTime(value) {
  return formatTeamDate(value, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
}

export function toTeamIso(value) {
  if (!value) return null;
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30)).toISOString();
}

export function teamDateTimeInputValue(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: TEAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function teamCurrentHour() {
  return teamDateTimeInputValue().slice(11, 16);
}

export function fmtDate(value) {
  return formatTeamDate(value, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

export function relative(value) {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (Math.abs(mins) < 60) return mins >= 0 ? `${mins}m ago` : `in ${-mins}m`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return hrs >= 0 ? `${hrs}h ago` : `in ${-hrs}h`;
  const days = Math.round(hrs / 24);
  return days >= 0 ? `${days}d ago` : `in ${-days}d`;
}

export const isManager = (role) => ["admin", "subadmin", "team_leader"].includes(role);
