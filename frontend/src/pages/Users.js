import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserX } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { name: "", email: "", password: "", role: "telecaller", team_id: "", agent_number: "", agent_extension: "", call_mode: "desktop", daily_call_target: "", daily_conversion_target: "", is_50_cr_club_rm: false };

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [courses, setCourses] = useState([]);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseForm, setCourseForm] = useState({ name: "", active: true });
  const [editingCourse, setEditingCourse] = useState(null);

  const load = useCallback(async () => {
    try {
      const [usersResponse, teamsResponse, coursesResponse] = await Promise.all([api.get("/users"), api.get("/teams"), api.get("/courses", { params: { include_inactive: true } })]);
      setUsers(usersResponse.data.filter((target) => !target.removed));
      setTeams(teamsResponse.data);
      setCourses(coursesResponse.data);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post("/users", { ...form, team_id: form.team_id || null, daily_call_target: Number(form.daily_call_target) || 0, daily_conversion_target: Number(form.daily_conversion_target) || 0 });
      toast.success("User created");
      setForm(EMPTY);
      setOpen(false);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusy(false);
    }
  };

  const disable = async (target) => {
    try {
      await api.patch(`/users/${target.id}`, { active: !target.active });
      toast.success(target.active ? "User disabled" : "User enabled");
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const remove = async (target) => {
    if (!window.confirm(`Remove ${target.name}? They will no longer be able to sign in.`)) return;
    try {
      await api.delete(`/users/${target.id}`);
      toast.success("User removed");
      setUsers((currentUsers) => currentUsers.filter((member) => member.id !== target.id));
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const updateUser = async (target, payload, message) => {
    try {
      await api.patch(`/users/${target.id}`, payload);
      toast.success(message);
      load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const roleOptions = user?.role === "admin" ? ["subadmin", "team_leader", "telecaller"] : ["team_leader", "telecaller"];
  const editRoleOptions = user?.role === "admin" ? ["admin", "subadmin", "team_leader", "telecaller"] : ["team_leader", "telecaller"];

  const edit = (target) => setEditing({
    id: target.id, name: target.name || "", email: target.email || "", password: "",
    role: target.role, team_id: target.team_id || "", active: target.active,
    agent_number: target.agent_number || "", agent_extension: target.agent_extension || "",
    call_mode: target.call_mode || "phone",
    daily_call_target: target.daily_call_target ?? 0, daily_conversion_target: target.daily_conversion_target ?? 0,
    is_50_cr_club_rm: Boolean(target.is_50_cr_club_rm),
  });

  const saveEdit = async () => {
    setBusy(true);
    try {
      const { id, password, team_id, ...values } = editing;
      await api.patch(`/users/${id}`, { ...values, daily_call_target: Number(editing.daily_call_target) || 0, daily_conversion_target: Number(editing.daily_conversion_target) || 0, ...(password ? { password } : {}), team_id: team_id || "" });
      toast.success("User details updated");
      setEditing(null);
      load();
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBusy(false); }
  };

  const saveCourse = async () => {
    if (!courseForm.name.trim()) return toast.error("Course name is required");
    setBusy(true);
    try {
      if (editingCourse) {
        await api.patch(`/courses/${editingCourse.id}`, courseForm);
        toast.success("Course updated");
      } else {
        await api.post("/courses", { name: courseForm.name });
        toast.success("Course added");
      }
      setCourseOpen(false);
      setEditingCourse(null);
      setCourseForm({ name: "", active: true });
      load();
    } catch (error) { toast.error(errMsg(error)); }
    finally { setBusy(false); }
  };

  const editCourse = (course) => {
    setEditingCourse(course);
    setCourseForm({ name: course.name, active: course.active });
    setCourseOpen(true);
  };

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="users-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="overline">Access control</div><h1 className="display mt-2 text-4xl font-black tracking-tighter">Users</h1></div>
        <Button data-testid="add-user-button" onClick={() => setOpen(true)} className="rounded-none bg-brand text-brand-foreground hover:bg-brand/90"><Plus size={14} className="mr-2" /> Add user</Button>
      </div>

      <div className="mt-8 overflow-x-auto border border-border/60">
        <table className="w-full text-sm" data-testid="users-table">
          <thead className="bg-[#0c0c0f]"><tr className="border-b border-border/60 text-left">{["Name", "Email", "Role", "Team", "50 Cr Club RM", "Rings on", "Extension", "Agent #", "Status", ""].map((heading) => <th key={heading} className="overline px-4 py-3">{heading}</th>)}</tr></thead>
          <tbody>
            {users.map((target) => (
              <tr key={target.id} data-testid={`user-row-${target.id}`} className="border-b border-border/40 hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-medium">{target.name}</td>
                <td className="mono px-4 py-3 text-muted-foreground">{target.email}</td>
                <td className="px-4 py-3"><span className="border border-border/60 px-2 py-0.5 text-xs">{ROLE_LABEL[target.role]}</span></td>
                <td className="px-4 py-3"><Select value={target.team_id || "none"} onValueChange={(value) => updateUser(target, { team_id: value === "none" ? "" : value }, "Team updated")}><SelectTrigger data-testid={`user-team-select-${target.id}`} className="h-8 w-[150px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></td>
                <td className="px-4 py-3"><Checkbox checked={Boolean(target.is_50_cr_club_rm)} disabled={user?.role !== "admin" || target.role !== "telecaller"} onCheckedChange={(checked) => updateUser(target, { is_50_cr_club_rm: checked === true }, checked ? "50 Cr Club RM assigned" : "50 Cr Club RM access removed")} aria-label={`Assign ${target.name} as 50 Cr Club RM`} data-testid={`user-club-rm-${target.id}`} /></td>
                <td className="px-4 py-3"><Select value={target.call_mode || "phone"} onValueChange={(value) => updateUser(target, { call_mode: value }, value === "desktop" ? "Calls ring on their computer" : "Calls ring their phone")}><SelectTrigger data-testid={`user-call-mode-${target.id}`} className="h-8 w-[130px] rounded-none border-border/70 bg-[#0c0c0f]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="desktop">Computer</SelectItem><SelectItem value="phone">Phone</SelectItem></SelectContent></Select></td>
                <td className="px-4 py-3"><Input data-testid={`user-agent-extension-${target.id}`} defaultValue={target.agent_extension || ""} placeholder="Not set" onBlur={(event) => { if (event.target.value !== (target.agent_extension || "")) updateUser(target, { agent_extension: event.target.value }, "Extension updated"); }} className="h-8 w-[90px] rounded-none border-border/70 bg-[#0c0c0f] text-xs" /></td>
                <td className="px-4 py-3"><Input data-testid={`user-agent-number-${target.id}`} defaultValue={target.agent_number || ""} placeholder="Not set" onBlur={(event) => { if (event.target.value !== (target.agent_number || "")) updateUser(target, { agent_number: event.target.value }, "Agent number updated"); }} className="h-8 w-[130px] rounded-none border-border/70 bg-[#0c0c0f] text-xs" /></td>
                <td className="px-4 py-3"><span className={`mono text-xs ${target.active ? "text-emerald-400" : "text-red-400"}`}>{target.active ? "ACTIVE" : "DISABLED"}</span></td>
                <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-3">{user?.role === "admin" && <button data-testid={`edit-user-${target.id}`} onClick={() => edit(target)} className="mono flex items-center gap-1.5 text-xs text-brand transition-colors hover:text-white"><Pencil size={13} /> Edit</button>}{target.role !== "admin" && <button data-testid={`toggle-user-${target.id}`} onClick={() => disable(target)} className="mono flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-red-400"><UserX size={13} /> {target.active ? "Disable" : "Enable"}</button>}{user?.role === "admin" && target.role !== "admin" && <button data-testid={`remove-user-${target.id}`} onClick={() => remove(target)} className="mono flex items-center gap-1.5 text-xs text-red-600 transition-colors duration-150 hover:text-red-800"><Trash2 size={13} /> Remove</button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 border border-border/60" data-testid="courses-section">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div><div className="overline">Lead options</div><h2 className="mt-1 text-lg font-semibold">Interested courses</h2></div>
          <Button data-testid="add-course-button" onClick={() => { setEditingCourse(null); setCourseForm({ name: "", active: true }); setCourseOpen(true); }} className="rounded-none bg-brand text-brand-foreground hover:bg-brand/90"><Plus size={14} className="mr-2" /> Add course</Button>
        </div>
        <div className="divide-y divide-border/40">
          {courses.map((course) => (
            <div key={course.id} className="flex items-center justify-between px-4 py-3 text-sm" data-testid={`course-row-${course.id}`}>
              <span>{course.name}</span>
              <div className="flex items-center gap-4">
                <span className={`mono text-xs ${course.active ? "text-emerald-400" : "text-red-400"}`}>{course.active ? "ACTIVE" : "DISABLED"}</span>
                <button type="button" data-testid={`edit-course-${course.id}`} onClick={() => editCourse(course)} className="mono flex items-center gap-1.5 text-xs text-brand hover:text-white"><Pencil size={13} /> Edit</button>
              </div>
            </div>
          ))}
          {!courses.length && <div className="px-4 py-8 text-sm text-muted-foreground">No courses added yet.</div>}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none border-border/70 bg-[#0c0c0f]" data-testid="add-user-dialog">
          <DialogHeader><DialogTitle className="display text-xl">Add user</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[['name', 'Full name'], ['email', 'Email'], ['password', 'Password (min 6)']].map(([key, label]) => <div key={key}><div className="overline mb-1.5">{label}</div><Input data-testid={`new-user-${key}`} type={key === "password" ? "password" : "text"} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="rounded-none border-border/70 bg-background" /></div>)}
            <div><div className="overline mb-1.5">Role</div><Select value={form.role} onValueChange={(value) => setForm({ ...form, role: value, is_50_cr_club_rm: value === "telecaller" && form.is_50_cr_club_rm })}><SelectTrigger data-testid="new-user-role" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent>{roleOptions.map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
            {user?.role === "admin" && <label className="flex items-center gap-3 border border-border/60 px-3 py-3 text-sm"><Checkbox checked={form.is_50_cr_club_rm} disabled={form.role !== "telecaller"} onCheckedChange={(checked) => setForm({ ...form, is_50_cr_club_rm: checked === true })} data-testid="new-user-club-rm" />Assign as 50 Cr Club RM</label>}
            <div><div className="overline mb-1.5">Smartflo agent number</div><Input data-testid="new-user-agent-number" value={form.agent_number} onChange={(event) => setForm({ ...form, agent_number: event.target.value })} placeholder="e.g. 9876543210, 9876543211" className="rounded-none border-border/70 bg-background" /><p className="mt-1.5 text-xs text-muted-foreground">Use one number or a comma-separated list for multiple DIDs. The system rotates through them to avoid frequent reuse.</p></div>
            <div><div className="overline mb-1.5">Smartflo extension (desktop calling)</div><Input data-testid="new-user-agent-extension" value={form.agent_extension} onChange={(event) => setForm({ ...form, agent_extension: event.target.value })} placeholder="e.g. 1024" className="rounded-none border-border/70 bg-background" /><p className="mt-1.5 text-xs text-muted-foreground">Set this to let the user take calls on their computer headset via the Smartflo Softphone extension.</p></div>
            <div className="grid grid-cols-2 gap-3"><div><div className="overline mb-1.5">Daily call target</div><Input data-testid="new-user-call-target" type="number" min="0" value={form.daily_call_target} onChange={(event) => setForm({ ...form, daily_call_target: event.target.value })} placeholder="e.g. 80" className="rounded-none border-border/70 bg-background" /></div><div><div className="overline mb-1.5">Daily conversion target</div><Input data-testid="new-user-conversion-target" type="number" min="0" value={form.daily_conversion_target} onChange={(event) => setForm({ ...form, daily_conversion_target: event.target.value })} placeholder="e.g. 3" className="rounded-none border-border/70 bg-background" /></div></div>
            <div><div className="overline mb-1.5">Team</div><Select value={form.team_id || "none"} onValueChange={(value) => setForm({ ...form, team_id: value === "none" ? "" : value })}><SelectTrigger data-testid="new-user-team" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></div>
            <Button data-testid="new-user-submit" onClick={create} disabled={busy} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">{busy ? "Creating…" : "Create user"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none border-border/70 bg-[#0c0c0f]" data-testid="edit-user-dialog">
          <DialogHeader><DialogTitle className="display text-xl">Edit user</DialogTitle></DialogHeader>
          {editing && <div className="space-y-3">
            {[["name", "Full name"], ["email", "Email"], ["password", "New password (optional)"]].map(([key, label]) => <div key={key}><div className="overline mb-1.5">{label}</div><Input data-testid={`edit-user-${key}`} type={key === "password" ? "password" : "text"} value={editing[key]} onChange={(event) => setEditing({ ...editing, [key]: event.target.value })} className="rounded-none border-border/70 bg-background" /></div>)}
            <div><div className="overline mb-1.5">Role</div><Select value={editing.role} onValueChange={(value) => setEditing({ ...editing, role: value, is_50_cr_club_rm: value === "telecaller" && editing.is_50_cr_club_rm })}><SelectTrigger data-testid="edit-user-role" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent>{editRoleOptions.map((role) => <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>)}</SelectContent></Select></div>
            {user?.role === "admin" && <label className="flex items-center gap-3 border border-border/60 px-3 py-3 text-sm"><Checkbox checked={Boolean(editing.is_50_cr_club_rm)} disabled={editing.role !== "telecaller"} onCheckedChange={(checked) => setEditing({ ...editing, is_50_cr_club_rm: checked === true })} data-testid="edit-user-club-rm" />Assign as 50 Cr Club RM</label>}
            <div><div className="overline mb-1.5">Team</div><Select value={editing.team_id || "none"} onValueChange={(value) => setEditing({ ...editing, team_id: value === "none" ? "" : value })}><SelectTrigger data-testid="edit-user-team" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No team</SelectItem>{teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><div className="overline mb-1.5">Call mode</div><Select value={editing.call_mode} onValueChange={(value) => setEditing({ ...editing, call_mode: value })}><SelectTrigger data-testid="edit-user-call-mode" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="phone">Phone</SelectItem><SelectItem value="desktop">Computer</SelectItem></SelectContent></Select></div><div><div className="overline mb-1.5">Status</div><Select value={editing.active ? "active" : "disabled"} onValueChange={(value) => setEditing({ ...editing, active: value === "active" })}><SelectTrigger data-testid="edit-user-status" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></div></div>
            <div><div className="overline mb-1.5">Smartflo agent number</div><Input data-testid="edit-user-agent-number" value={editing.agent_number} onChange={(event) => setEditing({ ...editing, agent_number: event.target.value })} className="rounded-none border-border/70 bg-background" /><p className="mt-1.5 text-xs text-muted-foreground">Optional: enter multiple DIDs as a comma-separated list to rotate calls and reduce spam risk.</p></div>
            <div><div className="overline mb-1.5">Smartflo extension</div><Input data-testid="edit-user-agent-extension" value={editing.agent_extension} onChange={(event) => setEditing({ ...editing, agent_extension: event.target.value })} className="rounded-none border-border/70 bg-background" /></div>
            <div className="grid grid-cols-2 gap-3"><div><div className="overline mb-1.5">Daily call target</div><Input data-testid="edit-user-call-target" type="number" min="0" value={editing.daily_call_target} onChange={(event) => setEditing({ ...editing, daily_call_target: event.target.value })} className="rounded-none border-border/70 bg-background" /></div><div><div className="overline mb-1.5">Daily conversion target</div><Input data-testid="edit-user-conversion-target" type="number" min="0" value={editing.daily_conversion_target} onChange={(event) => setEditing({ ...editing, daily_conversion_target: event.target.value })} className="rounded-none border-border/70 bg-background" /></div></div>
            <Button data-testid="edit-user-submit" onClick={saveEdit} disabled={busy} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">{busy ? "Saving…" : "Save changes"}</Button>
          </div>}
        </DialogContent>
      </Dialog>

      <Dialog open={courseOpen} onOpenChange={setCourseOpen}>
        <DialogContent className="rounded-none border-border/70 bg-[#0c0c0f]" data-testid="course-dialog">
          <DialogHeader><DialogTitle className="display text-xl">{editingCourse ? "Edit course" : "Add course"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><div className="overline mb-1.5">Course name</div><Input data-testid="course-name-input" value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} className="rounded-none border-border/70 bg-background" /></div>
            {editingCourse && <div><div className="overline mb-1.5">Status</div><Select value={courseForm.active ? "active" : "disabled"} onValueChange={(value) => setCourseForm({ ...courseForm, active: value === "active" })}><SelectTrigger data-testid="course-status-select" className="rounded-none border-border/70 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></div>}
            <Button data-testid="course-submit" onClick={saveCourse} disabled={busy} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">{busy ? "Saving…" : editingCourse ? "Save course" : "Add course"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
