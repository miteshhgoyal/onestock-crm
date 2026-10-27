import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Teams() {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/teams");
      setTeams(data);
      const users = await api.get("/users");
      const eligible = users.data.filter((member) => member.active && ["team_leader", "telecaller"].includes(member.role));
      setLeaders(eligible.filter((member) => member.role === "team_leader"));
      setMembers(eligible);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return toast.error("Team name is required");
    try {
      await api.post("/teams", { name: name.trim(), leader_id: leaderId || null, member_ids: [] });
      toast.success("Team created");
      setName("");
      setLeaderId("");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const editTeam = (team) => {
    setEditing(team);
    setName(team.name);
    setLeaderId(team.leader_id || "");
    setSelectedMemberIds((team.members || []).map((member) => member.id));
  };

  const [selectedMemberIds, setSelectedMemberIds] = useState([]);

  const saveEdit = async () => {
    if (!name.trim()) return toast.error("Team name is required");
    try {
      await api.patch(`/teams/${editing.id}`, {
        name: name.trim(),
        leader_id: leaderId || null,
        member_ids: selectedMemberIds,
      });
      toast.success("Team updated");
      setEditing(null);
      setName("");
      setLeaderId("");
      setSelectedMemberIds([]);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggleMember = (memberId) => {
    setSelectedMemberIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  };

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="teams-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="overline">Hierarchy</div>
          <h1 className="display mt-2 text-4xl font-black tracking-tighter">Teams</h1>
        </div>
        {["admin", "subadmin"].includes(user?.role) && (
          <Button data-testid="add-team-button" onClick={() => setOpen(true)} className="rounded-none bg-brand text-brand-foreground hover:bg-brand/90">
            <Plus size={14} className="mr-2" /> New team
          </Button>
        )}
      </div>

      <div className="mt-8 grid gap-px bg-border/40 md:grid-cols-2 xl:grid-cols-3" data-testid="teams-grid">
        {teams.map((t) => (
          <div key={t.id} data-testid={`team-card-${t.id}`} className="bg-[#0c0c0f] p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="display text-xl font-bold">{t.name}</div>
              { ["admin", "subadmin"].includes(user?.role) && <button type="button" data-testid={`edit-team-${t.id}`} onClick={() => editTeam(t)} className="mono flex items-center gap-1.5 text-xs text-brand hover:text-white"><Pencil size={13} /> Edit</button> }
            </div>
            <div className="overline mt-1">{t.members?.length || 0} members</div>
            <div className="mt-5 space-y-2">
              {(t.members || []).map((m) => (
                <div key={m.id} className="flex items-center justify-between border-b border-border/40 pb-2 text-sm">
                  <span>{m.name}</span>
                  <span className="mono text-xs text-muted-foreground">{ROLE_LABEL[m.role]}</span>
                </div>
              ))}
              {!t.members?.length && <div className="text-sm text-muted-foreground">No members assigned yet.</div>}
            </div>
          </div>
        ))}
        {!teams.length && (
          <div className="bg-[#0c0c0f] p-10 text-sm text-muted-foreground" data-testid="teams-empty">
            No teams yet. Create one and assign a team leader.
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-none border-border/70 bg-[#0c0c0f]" data-testid="add-team-dialog">
          <DialogHeader>
            <DialogTitle className="display text-xl">New team</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="overline mb-1.5">Team name</div>
              <Input data-testid="new-team-name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-none border-border/70 bg-background" />
            </div>
            <div>
              <div className="overline mb-1.5">Team leader</div>
              <Select value={leaderId || "none"} onValueChange={(v) => setLeaderId(v === "none" ? "" : v)}>
                <SelectTrigger data-testid="new-team-leader" className="rounded-none border-border/70 bg-background">
                  <SelectValue placeholder="Choose leader" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No leader</SelectItem>
                  {leaders.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="new-team-submit" onClick={create} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">
              Create team
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(nextOpen) => !nextOpen && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-none border-border/70 bg-[#0c0c0f]" data-testid="edit-team-dialog">
          <DialogHeader><DialogTitle className="display text-xl">Edit team</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="overline mb-1.5">Team name</div>
              <Input data-testid="edit-team-name" value={name} onChange={(event) => setName(event.target.value)} className="rounded-none border-border/70 bg-background" />
            </div>
            <div>
              <div className="overline mb-1.5">Team leader</div>
              <Select value={leaderId || "none"} onValueChange={(value) => setLeaderId(value === "none" ? "" : value)}>
                <SelectTrigger data-testid="edit-team-leader" className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Choose leader" /></SelectTrigger>
                <SelectContent><SelectItem value="none">No leader</SelectItem>{leaders.map((leader) => <SelectItem key={leader.id} value={leader.id}>{leader.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <div className="overline mb-2">Team members</div>
              <div className="max-h-64 space-y-2 overflow-y-auto border border-border/60 p-3">
                {members.map((member) => (
                  <label key={member.id} className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span>{member.name} <span className="mono text-xs text-muted-foreground">{ROLE_LABEL[member.role]}</span></span>
                    <input type="checkbox" data-testid={`edit-team-member-${member.id}`} checked={selectedMemberIds.includes(member.id)} onChange={() => toggleMember(member.id)} className="h-4 w-4 accent-[var(--brand)]" />
                  </label>
                ))}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">The selected leader is included automatically.</div>
            </div>
            <Button data-testid="edit-team-submit" onClick={saveEdit} className="w-full rounded-none bg-brand text-brand-foreground hover:bg-brand/90">Save changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
