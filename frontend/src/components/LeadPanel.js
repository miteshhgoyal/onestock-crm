import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, CheckSquare, Mail, MessageCircle, Phone, Save, Tag, Trash2, UserCog, Video, X } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { formatTeamDate, STATUSES, STATUS_META, SOURCE_LABEL, fmtDate, relative, teamCurrentHour, toTeamIso } from "@/lib/constants";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useAuth } from "@/context/AuthContext";
import FollowUpTimer from "@/components/FollowUpTimer";
import LeadProfileFields from "@/components/LeadProfileFields";
import { profileFromLead, profilePayload } from "@/lib/leadProfile";

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

export const LeadPanel = ({ leadId, assignees = [], courses = [], canAssign = false, canDelete = false, onChanged, onDeleted }) => {
  const { user } = useAuth();
  const [lead, setLead] = useState(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [selectedCallNumber, setSelectedCallNumber] = useState(1);
  const [postCallStatus, setPostCallStatus] = useState("none");
  const [date, setDate] = useState(null);
  const [hour, setHour] = useState(teamCurrentHour());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [relatedActivities, setRelatedActivities] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [profile, setProfile] = useState(profileFromLead());
  const [contact, setContact] = useState({ name: "", email: "", company: "", city: "" });
  const [ticketSize, setTicketSize] = useState("");
  const [courseId, setCourseId] = useState("");
  const [followUpCleared, setFollowUpCleared] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/leads/${leadId}`);
      setLead(data);
      setStatus(data.status);
      setCallOutcome(data.calls?.find((call) => Number(call.call_number) === selectedCallNumber)?.call_outcome || "");
      setPostCallStatus("none");
      setDate(data.next_follow_up_at ? new Date(data.next_follow_up_at) : null);
      setFollowUpCleared(false);
      setTags(data.tags || []);
      setCourseId(data.course_id || "");
      setTicketSize(data.ticket_size ? String(data.ticket_size) : "");
      setProfile(profileFromLead(data));
        setContact({ name: data.name || "", email: data.email || "", company: data.company || "", city: data.city || "" });
      const { data: activities } = await api.get("/crm-activities", { params: { lead_id: leadId } });
      setRelatedActivities(activities || []);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  useEffect(() => {
    if (leadId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const followUpIso = useMemo(() => {
    if (!date) return null;
    const [h, m] = hour.split(":").map(Number);
    const localValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return toTeamIso(localValue);
  }, [date, hour]);

  const saveLeadChanges = async () => {
    const currentCall = lead.calls?.find((call) => Number(call.call_number) === selectedCallNumber);
    const callOutcomeChanged = Boolean(callOutcome && callOutcome !== currentCall?.call_outcome);
    const profileData = { ...profilePayload(profile), ...contact };
    if (profile.trader_type === "non_trader") {
      profileData.trading_experience = null;
      profileData.trading_capital = null;
      profileData.trading_capital_range = null;
      profileData.markets_traded = [];
    }
    const originalProfile = profileFromLead(lead);
    const originalProfileData = { ...profilePayload(originalProfile), name: lead.name || "", email: lead.email || "", company: lead.company || "", city: lead.city || "" };
    if (originalProfile.trader_type === "non_trader") {
      originalProfileData.trading_experience = null;
      originalProfileData.trading_capital = null;
      originalProfileData.trading_capital_range = null;
      originalProfileData.markets_traded = [];
    }
    const profileChanged = JSON.stringify(profileData) !== JSON.stringify(originalProfileData);
    const tagsChanged = JSON.stringify(tags) !== JSON.stringify(lead.tags || []);
    const courseChanged = courseId !== (lead.course_id || "");
    const statusChanged = status !== lead.status;
    const hasLeadChanges = note.trim() || statusChanged || date || followUpCleared || tagsChanged || courseChanged;
    if (!profileChanged && !hasLeadChanges && !callOutcomeChanged) {
      toast.error("Make a change before saving");
      return;
    }
    if (callOutcomeChanged && callOutcome === "connected" && user?.role === "telecaller" && postCallStatus === "none") {
      toast.error("Choose a lead status for connected calls");
      return;
    }
    setSaving(true);
    try {
      if (profileChanged) await api.patch(`/leads/${leadId}`, profileData);
      if (callOutcomeChanged) {
        const payload = { call_outcome: callOutcome };
        if (postCallStatus !== "none") payload.status = postCallStatus;
        if (postCallStatus === "follow_up" && date) payload.next_follow_up_at = followUpIso;
        await api.post(`/leads/${leadId}/calls/manual`, { ...payload, call_number: selectedCallNumber });
      }
      if (hasLeadChanges && note.trim()) {
        await api.post(`/leads/${leadId}/notes`, {
          text: note.trim(),
          status: statusChanged ? status : null,
          next_follow_up_at: followUpIso,
        });
        if (tagsChanged || courseChanged || followUpCleared) await api.patch(`/leads/${leadId}`, { tags: tagsChanged ? tags : null, course_id: courseChanged ? courseId || null : null, ...(followUpCleared ? { next_follow_up_at: null } : {}) });
      } else if (hasLeadChanges) {
        await api.patch(`/leads/${leadId}`, {
          status: statusChanged ? status : null,
          next_follow_up_at: followUpCleared ? null : followUpIso,
          tags: tagsChanged ? tags : null,
          course_id: courseChanged ? courseId || null : null,
        });
      }
      setNote("");
      toast.success("Lead updated");
      setPostCallStatus("none");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const reassign = async (assigneeId) => {
    try {
      await api.post("/leads/assign", { lead_ids: [leadId], assignee_id: assigneeId });
      toast.success("Lead reassigned");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const removeLead = async () => {
    if (!window.confirm(`Remove ${lead.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/leads/${leadId}`);
      toast.success("Lead removed");
      onDeleted?.();
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeleting(false);
    }
  };

  const directCall = () => {
    if (!lead?.phone || dialing) return;
    setDialing(true);
    api.post("/calls/click-to-call", { destination_number: lead.phone, lead_id: leadId })
      .then(async () => {
        toast.success("Call connecting — check your Smartflo softphone or phone");
        await load();
        onChanged?.();
      })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setDialing(false));
  };

  const openWhatsApp = () => {
    const phone = (lead.phone || "").replace(/\D/g, "");
    if (!phone) return;
    window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer");
    toast("Opening WhatsApp", {
      description: "If the app is not installed, download WhatsApp to message this lead.",
      action: {
        label: "Download",
        onClick: () => window.open("https://www.whatsapp.com/download/", "_blank", "noopener,noreferrer"),
      },
    });
  };

  const addTag = (event) => {
    event?.preventDefault();
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput("");
  };

  const approveConversion = async () => {
    const amount = Number(ticketSize);
    if (!amount || amount <= 0) return toast.error("Enter a valid ticket size");
    try {
      await api.post(`/leads/${leadId}/conversion/approve`, { ticket_size: amount });
      toast.success("Conversion approved");
      await load();
      onChanged?.();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const emailHref = lead?.email
    ? `mailto:${lead.email}?subject=${encodeURIComponent(`Following up with ${lead.name}`)}&body=${encodeURIComponent(`Hi ${lead.name},\n\nI am following up regarding your enquiry.\n\nRegards`)}`
    : undefined;

  const statusFlow = (() => {
    const steps = [];
    (lead?.activities || [])
      .filter((activity) => activity.action === "status_changed")
      .slice()
      .reverse()
      .forEach((activity) => {
        const [from, to] = (activity.detail || "").split(" -> ");
        if (from && !steps.includes(from)) steps.push(from);
        if (to && !steps.includes(to)) steps.push(to);
      });
    if (!steps.length && lead?.status) steps.push(lead.status);
    else if (lead?.status && steps[steps.length - 1] !== lead.status) steps.push(lead.status);
    return steps;
  })();

  if (!lead) return <div className="p-8 text-sm text-muted-foreground">Loading lead…</div>;

  return (
    <div className="flex h-full flex-col" data-testid="lead-panel">
      <div className="border-b border-border/60 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
          <h2 className="display text-2xl font-bold" data-testid="lead-panel-name">
            {lead.name}
          </h2>
          <StatusBadge status={lead.status} testId="lead-panel-status" />
          {lead.escalated && (
            <span
              data-testid="lead-panel-escalated"
              className="rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-400"
            >
              Escalated
            </span>
          )}
          </div>
          {canDelete && (
            <Button
              variant="outline"
              data-testid="delete-lead-button"
              onClick={removeLead}
              disabled={deleting}
              className="rounded-none border-red-500/40 text-red-400 hover:border-red-500 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 size={14} className="mr-2" /> {deleting ? "Removing…" : "Remove lead"}
            </Button>
          )}
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <button onClick={directCall} disabled={!lead.phone || dialing} className="flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5 text-foreground hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50" data-testid="lead-direct-call-button">
            <Phone size={14} /> {dialing ? "Connecting…" : `Call ${lead.phone}`}
          </button>
          <button onClick={openWhatsApp} disabled={!lead.phone} className="flex items-center gap-2 rounded-md border border-[#b8dfc8] px-2.5 py-1.5 text-[#167744] hover:bg-[#eefaf2] disabled:cursor-not-allowed disabled:opacity-40" data-testid="lead-whatsapp-button">
            <MessageCircle size={14} /> WhatsApp
          </button>
          <a href={emailHref || "#"} aria-disabled={!lead.email} onClick={(event) => !lead.email && event.preventDefault()} className="flex items-center gap-2 rounded-md border border-[#b9d4eb] px-2.5 py-1.5 text-[#24618b] hover:bg-[#eff7ff] aria-disabled:cursor-not-allowed aria-disabled:opacity-40" data-testid="lead-email-button">
            <Mail size={14} /> Email
          </a>
          <span>{SOURCE_LABEL[lead.source] || lead.source}</span>
          <span>{lead.course_name || "Course not specified"}</span>
        </div>
      </div>

      <div className="border-b border-border/60 bg-[#0c0c0f] px-6 py-4" data-testid="lead-status-flow">
        <div className="overline mb-3">Status flow</div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {statusFlow.map((statusValue, index) => {
            const meta = STATUS_META[statusValue] || STATUS_META.new_lead;
            const isCurrent = statusValue === lead.status;
            return (
              <div key={`${statusValue}-${index}`} className="flex shrink-0 items-center gap-2">
                <div
                  className={`flex items-center gap-2 border px-3 py-2 text-xs font-semibold ${isCurrent ? "ring-2 ring-offset-1 ring-offset-[#0c0c0f]" : "opacity-75"}`}
                  style={{ borderColor: meta.hex, color: meta.hex, backgroundColor: `${meta.hex}18`, ...(isCurrent ? { ringColor: meta.hex } : {}) }}
                  data-testid={`lead-status-flow-${statusValue}-${index}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.hex }} />
                  {meta.label}
                </div>
                {index < statusFlow.length - 1 && <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border/60 bg-border/40 sm:grid-cols-4">
        {[
          ["Assigned to", lead.assigned_to_name || "Unassigned"],
          ["Last saved", lead.updated_at ? `${fmtDate(lead.updated_at)} IST` : "—"],
          ["Next follow-up", lead.next_follow_up_at ? `${fmtDate(lead.next_follow_up_at)} IST` : "Not set"],
          ["Reassigned", `${lead.reassign_count || 0}x`],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#0c0c0f] px-5 py-4">
            <div className="overline">{label}</div>
            <div className="mt-1 truncate text-sm font-medium">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mb-6 border border-border/60 p-5" data-testid="lead-profile-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="overline">Lead profile</div>
              <p className="mt-1 text-xs text-muted-foreground">Job profile, income and trading background</p>
            </div>
            <div className="flex items-center gap-3">
              {lead.status === "follow_up" && lead.next_follow_up_at && (
                <FollowUpTimer value={lead.next_follow_up_at} testId="lead-panel-followup-timer" />
              )}
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              {[["name", "Name"], ["email", "Email"], ["company", "Company"], ["city", "City"]].map(([field, label]) => (
                <label key={field} className="block">
                  <span className="overline mb-1.5 block">{label}</span>
                  <Input
                    data-testid={`lead-contact-${field}`}
                    type={field === "email" ? "email" : "text"}
                    value={contact[field]}
                    onChange={(event) => setContact((current) => ({ ...current, [field]: event.target.value }))}
                    className="rounded-none border-border/70 bg-[#0c0c0f]"
                  />
                </label>
              ))}
            </div>
            <LeadProfileFields profile={{ ...profile, tags }} onChange={setProfile} idPrefix="lead-profile" />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="border border-border/60 p-4" data-testid="call-result-workflow">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="overline mb-2">Call number</div>
                  <Select
                    value={String(selectedCallNumber)}
                    onValueChange={(value) => {
                      const number = Number(value);
                      setSelectedCallNumber(number);
                      setCallOutcome(lead.calls?.find((call) => Number(call.call_number) === number)?.call_outcome || "");
                      setPostCallStatus("none");
                    }}
                  >
                    <SelectTrigger data-testid="call-number-select" className="rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((number) => <SelectItem key={number} value={String(number)}>Call {number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="overline mb-2">Call outcome</div>
                  <Select value={callOutcome} onValueChange={setCallOutcome}>
                    <SelectTrigger data-testid="call-outcome-select" className="rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Select result" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="connected">Connected</SelectItem>
                      <SelectItem value="not_connected">Not connected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="overline mb-2">Lead status after call</div>
                  <Select value={postCallStatus} onValueChange={(value) => { setPostCallStatus(value); if (value !== "none") setStatus(value); }}>
                    <SelectTrigger data-testid="post-call-status-select" className="rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Keep current status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Keep current status</SelectItem>
                      {["interested", "not_interested", "follow_up", "converted", "lost"].map((value) => (
                        <SelectItem key={value} value={value}>{STATUS_META[value].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Call result and lead changes are saved together; placing a call is not required.</p>
            </div>
            <div className="overline">Log the call</div>
            <Textarea
              data-testid="lead-note-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened on this call?"
              className="min-h-[110px] rounded-none border-border/70 bg-[#0c0c0f]"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="overline mb-2">Status</div>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="lead-status-select" className="rounded-none border-border/70 bg-[#0c0c0f]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s} data-testid={`status-option-${s}`}>
                        {STATUS_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="overline mb-2">Follow-up</div>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        data-testid="followup-date-button"
                        className="flex-1 justify-start rounded-none border-border/70 bg-[#0c0c0f] font-normal"
                      >
                        <CalendarClock size={14} className="mr-2" />
                        {date ? formatTeamDate(date, { day: "2-digit", month: "short", year: "numeric" }) : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={date} onSelect={(selectedDate) => { setDate(selectedDate); setFollowUpCleared(false); }} disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <Select value={hour} onValueChange={setHour}>
                    <SelectTrigger data-testid="followup-hour-select" className="w-[92px] rounded-none border-border/70 bg-[#0c0c0f]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {date && <Button type="button" variant="outline" data-testid="clear-followup-button" onClick={() => { setDate(null); setFollowUpCleared(true); }} className="h-9 rounded-none border-border/70 px-2 text-xs" aria-label="Clear follow-up">Clear</Button>}
                </div>
              </div>
            </div>
            <Button
              data-testid="lead-save-button"
              onClick={saveLeadChanges}
              disabled={saving}
              className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90"
            >
              <Save size={14} className="mr-2" /> {saving ? "Saving…" : "Save lead"}
            </Button>

            <div>
              <div className="overline mb-2">Interested course</div>
              <Select value={courseId || "none"} onValueChange={(value) => setCourseId(value === "none" ? "" : value)}>
                <SelectTrigger data-testid="lead-course-select" className="rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {canAssign && assignees.length > 0 && (
              <div className="border border-border/60 p-4">
                <div className="overline mb-2 flex items-center gap-2">
                  <UserCog size={13} /> Reassign lead
                </div>
                <Select onValueChange={reassign}>
                  <SelectTrigger data-testid="reassign-select" className="rounded-none border-border/70 bg-[#0c0c0f]">
                    <SelectValue placeholder="Choose telecaller" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignees.map((a) => (
                      <SelectItem key={a.id} value={a.id} data-testid={`reassign-option-${a.id}`}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div>
              <div className="overline mb-3 flex items-center gap-2"><Tag size={13} /> Tags</div>
              <div className="mb-3 max-w-xs">
                <div className="overline mb-1.5">Enrolled in</div>
                <Select value={tags.includes("50-cr-club") ? "50-cr-club" : "none"} onValueChange={(value) => setTags((current) => value === "50-cr-club"
                  ? [...new Set([...current.filter((tag) => tag !== "50-cr-club"), "50-cr-club"])]
                  : current.filter((tag) => tag !== "50-cr-club"))}>
                  <SelectTrigger data-testid="lead-enrolled-in" className="rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Not enrolled</SelectItem><SelectItem value="50-cr-club">50 Cr Club</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="lead-tags">
                {tags.map((tag) => <span key={tag} className="flex items-center gap-1 border border-brand/40 bg-brand/10 px-2 py-1 text-xs text-brand">{tag}<button type="button" onClick={() => setTags(tags.filter((item) => item !== tag))} aria-label={`Remove ${tag} tag`}><X size={12} /></button></span>)}
              </div>
              <form onSubmit={addTag} className="mt-2 flex gap-2">
                <input value={tagInput} onChange={(event) => setTagInput(event.target.value)} placeholder="Add a tag" className="h-9 min-w-0 flex-1 border border-border/70 bg-[#0c0c0f] px-3 text-xs outline-none focus:border-brand" />
                <Button type="submit" variant="outline" className="h-9 rounded-none px-3 text-xs">Add</Button>
              </form>
            </div>
            <div>
              <div className="overline mb-3">Call notes ({lead.notes?.length || 0})</div>
              <div className="space-y-2" data-testid="lead-notes-list">
                {(lead.notes || []).slice().reverse().map((n, i) => (
                  <div key={i} className="border-l-2 border-white/20 bg-[#0c0c0f] px-4 py-3">
                    <div className="text-sm">{n.text}</div>
                    <div className="mono mt-1 text-xs text-muted-foreground">
                      {n.author_name} · {fmtDate(n.created_at)}
                    </div>
                  </div>
                ))}
                {!lead.notes?.length && (
                  <div className="text-sm text-muted-foreground">No call notes yet.</div>
                )}
              </div>
            </div>
            {lead.status === "converted" && lead.conversion_status === "pending" && (
              <div className="border border-amber-500/40 bg-amber-500/10 p-4" data-testid="pending-conversion">
                <div className="text-sm font-semibold text-amber-200">Conversion awaiting team leader approval</div>
                {user && ["admin", "subadmin", "team_leader"].includes(user.role) ? (
                  <div className="mt-3 flex gap-2">
                    <Input value={ticketSize} onChange={(e) => setTicketSize(e.target.value)} type="number" min="0.01" step="0.01" placeholder="Ticket size" data-testid="conversion-ticket-size" className="h-9 rounded-none border-border/70 bg-[#0c0c0f]" />
                    <Button type="button" onClick={approveConversion} className="h-9 rounded-none bg-emerald-600 text-white hover:bg-emerald-700">Approve conversion</Button>
                  </div>
                ) : <div className="mt-1 text-xs text-amber-300">A team leader will review this conversion and add the ticket size.</div>}
              </div>
            )}
            {lead.conversion_source === "direct" && <div className="border border-border/50 px-3 py-2 text-xs font-semibold text-muted-foreground" data-testid="direct-conversion-label">Conversion type: Direct</div>}
            {lead.conversion_source === "50_cr_club" && <div className="border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs font-semibold text-emerald-400" data-testid="club-conversion-label">Verified 50 Cr Club payment · auto-approved</div>}
            {lead.conversion_status === "approved" && <div className="text-sm font-semibold text-emerald-400">Approved revenue: {Number(lead.ticket_size || 0).toLocaleString("en-IN")}</div>}
            <div>
              <div className="overline mb-3">Status history</div>
              <div className="space-y-1.5" data-testid="lead-activity-list">
                {!(lead.activities || []).some((activity) => activity.action === "status_changed") && (
                  <div className="text-sm text-muted-foreground">No status changes recorded yet.</div>
                )}
                {(lead.activities || []).filter((activity) => activity.action === "status_changed").map((activity) => {
                  const [from, to] = (activity.detail || "").split(" -> ");
                  const statusLabel = (value) => STATUS_META[value]?.label || value || "Unknown";
                  return (
                    <div key={activity.id} className="mono flex items-baseline justify-between gap-3 border-l-2 border-brand px-3 py-2 text-xs">
                      <span className="text-foreground/80">
                        {statusLabel(from)} <span className="text-brand">→</span> {statusLabel(to)}{activity.actor_name ? ` · ${activity.actor_name}` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{fmtDate(activity.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="overline mb-3">Activity</div>
              <div className="space-y-1.5" data-testid="lead-activity-list-all">
                {!lead.activities?.length && (
                  <div className="text-sm text-muted-foreground">No activity recorded yet.</div>
                )}
                {(lead.activities || []).map((activity) => (
                  <div key={activity.id} className="mono flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-foreground/80">{activity.action} {activity.detail ? `· ${activity.detail}` : ""}</span>
                    <span className="shrink-0 text-muted-foreground">{relative(activity.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="overline mb-3">Calls, meetings & tasks ({(lead.calls?.length || 0) + relatedActivities.length})</div>
              <div className="space-y-2" data-testid="lead-call-history">
                  {(lead.calls || []).map((call) => (
                  <div key={call.id} className="flex items-start justify-between gap-3 border-l-2 border-emerald-400 bg-[#f0faf5] px-3 py-2 text-xs">
                      <div><div className="font-semibold">Call {call.call_number || "—"} · {call.call_outcome?.replaceAll("_", " ") || call.call_status || "Pending result"}{call.duration ? ` · ${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : ""}</div><div className="text-muted-foreground">{call.owner_name || "—"} · {call.contact_name || lead.name}</div></div>
                    <span className="shrink-0 text-muted-foreground">{fmtDate(call.completed_at || call.created_at)}</span>
                  </div>
                ))}
                {relatedActivities.map((activity) => {
                  const ActivityIcon = activity.kind === "meeting" ? Video : activity.kind === "task" ? CheckSquare : Phone;
                  return (
                    <div key={activity.id} className="flex items-start justify-between gap-3 border-l-2 border-brand bg-brand/5 px-3 py-2 text-xs">
                      <div className="flex gap-2"><ActivityIcon size={14} className="mt-0.5 shrink-0 text-brand" /><div><div className="font-semibold capitalize">{activity.kind} · {activity.subject}</div><div className="text-muted-foreground">{activity.status || "open"}{activity.owner_name ? ` · ${activity.owner_name}` : ""}</div></div></div>
                      <span className="shrink-0 text-muted-foreground">{fmtDate(activity.completed_at || activity.due_at || activity.created_at)}</span>
                    </div>
                  );
                })}
                {!lead.calls?.length && !relatedActivities.length && <div className="text-sm text-muted-foreground">No calls, meetings, or tasks yet.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeadPanel;