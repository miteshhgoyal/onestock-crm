import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { SOURCES, SOURCE_LABEL, STATUSES, STATUS_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LeadProfileFields from "@/components/LeadProfileFields";
import { EMPTY_PROFILE, profilePayload } from "@/lib/leadProfile";

const EMPTY = { name: "", phone: "", email: "", company: "", city: "", source: "manual", status: "new_lead", course_id: "", tags: [], ...EMPTY_PROFILE };

export const NewLeadDialog = ({ open, onOpenChange, onCreated, courses = [], teams = [], initialLead, showStatus = false, showAssignment = false, onSubmit }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, ...EMPTY_PROFILE, ...initialLead });
      setTeamId("");
      setAssigneeId("");
    }
  }, [open, initialLead]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Name and phone are required");
      return;
    }
    if (showAssignment && (!teamId || !assigneeId)) {
      toast.error("Select a team and RM");
      return;
    }
    setBusy(true);
    let successMessage = "Lead created";
    try {
      const payload = {
        name: form.name,
        phone: form.phone,
        email: form.email,
        company: form.company,
        city: form.city,
        source: form.source,
        ...(showStatus ? { status: form.status } : {}),
        ...(showAssignment ? { team_id: teamId, assignee_id: assigneeId } : {}),
        course_id: form.course_id || null,
        tags: form.tags || [],
        ...profilePayload(form),
      };
      if (onSubmit) {
        const result = await onSubmit(payload);
        if (result?.linkedExisting) successMessage = "Existing lead linked";
      }
      else await api.post("/leads", payload);
      toast.success(successMessage);
      setForm({ ...EMPTY, ...EMPTY_PROFILE });
      setTeamId("");
      setAssigneeId("");
      onOpenChange(false);
      onCreated?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none border-border/70 bg-[#0c0c0f]" data-testid="new-lead-dialog">
        <DialogHeader>
          <DialogTitle className="display text-xl">New lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {[
            ["name", "Full name *"],
            ["phone", "Phone number *"],
            ["email", "Email"],
            ["company", "Company"],
            ["city", "City"],
          ].map(([key, label]) => (
            <div key={key}>
              <div className="overline mb-1.5">{label}</div>
              <Input
                data-testid={`new-lead-${key}`}
                value={form[key]}
                onChange={set(key)}
                className="rounded-none border-border/70 bg-background"
              />
            </div>
          ))}
          <div>
            <div className="overline mb-1.5">Source</div>            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger data-testid="new-lead-source" className="rounded-none border-border/70 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showStatus && <div>
            <div className="overline mb-1.5">Lead status</div>
            <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
              <SelectTrigger data-testid="new-lead-status" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((status) => <SelectItem key={status} value={status}>{STATUS_META[status].label}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          {showAssignment && <>
            <div>
              <div className="overline mb-1.5">Team *</div>
              <Select value={teamId || "none"} onValueChange={(value) => { setTeamId(value === "none" ? "" : value); setAssigneeId(""); }}>
                <SelectTrigger data-testid="new-lead-team" className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select team" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Select team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="overline mb-1.5">Relationship manager *</div>
              <Select value={assigneeId || "none"} onValueChange={(value) => setAssigneeId(value === "none" ? "" : value)} disabled={!teamId}>
                <SelectTrigger data-testid="new-lead-assignee" className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select RM" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Select RM</SelectItem>{(teams.find((team) => team.id === teamId)?.members || []).filter((member) => member.role === "telecaller" && member.active !== false).map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </>}
          <div>
            <div className="overline mb-1.5">Interested course</div>
            <Select value={form.course_id || "none"} onValueChange={(v) => setForm({ ...form, course_id: v === "none" ? "" : v })}>
              <SelectTrigger data-testid="new-lead-course" className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="overline mb-1.5">Enrolled in</div>
            <Select value={(form.tags || []).includes("50-cr-club") ? "50-cr-club" : "none"} onValueChange={(value) => setForm((current) => ({
              ...current,
              tags: value === "50-cr-club"
                ? [...new Set([...(current.tags || []).filter((tag) => tag !== "50-cr-club"), "50-cr-club"])]
                : (current.tags || []).filter((tag) => tag !== "50-cr-club"),
            }))}>
              <SelectTrigger data-testid="new-lead-enrolled-in" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Not enrolled</SelectItem><SelectItem value="50-cr-club">50 Cr Club</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="border-t border-border/60 pt-3">
            <LeadProfileFields profile={form} onChange={(next) => setForm({ ...form, ...next })} idPrefix="new-lead-profile" />
          </div>
          <Button
            data-testid="new-lead-submit"
            onClick={submit}
            disabled={busy}
            className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90"
          >
            {busy ? "Creating…" : "Create lead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NewLeadDialog;
