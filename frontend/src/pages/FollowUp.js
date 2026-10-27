import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Search } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtDate, relative } from "@/lib/constants";
import LeadPanel from "@/components/LeadPanel";
import { Input } from "@/components/ui/input";

export default function FollowUp() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/leads", { params: { limit: 200 } });
      const followUps = (data.items || [])
        .filter((lead) => lead.next_follow_up_at && (lead.assigned_to === user?.id || lead.assigned_to_name === user?.name))
        .sort((a, b) => new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at));
      setItems(followUps);
      setActive((prev) => prev || followUps[0]?.id || null);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [user?.id, user?.name]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((lead) => [lead.name, lead.phone, lead.email].some((value) => value?.toLowerCase().includes(needle)));
  }, [items, query]);

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[340px_1fr]" data-testid="followup-page">
      <div className="border-r border-border/60 bg-[#0a0a0c]">
        <div className="border-b border-border/60 px-6 py-6">
          <div className="overline">Follow up</div>
          <h1 className="display mt-2 text-2xl font-bold">Scheduled callbacks</h1>
          <div className="mt-4 flex items-center gap-2 border border-border/60 bg-[#0c0c0f] px-3 py-2 text-sm text-muted-foreground">
            <CalendarClock size={14} />
            {items.length} follow-up{items.length === 1 ? "" : "s"}
          </div>
          <div className="relative mt-4">
            <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search follow-up" className="h-9 rounded-none border-border/70 bg-[#0c0c0f] pl-9 text-xs" />
          </div>
        </div>

        <div className="max-h-[calc(100vh-160px)] overflow-y-auto p-3" data-testid="followup-list">
          {filteredItems.map((lead) => (
            <button
              key={lead.id}
              type="button"
              onClick={() => setActive(lead.id)}
              className={`mb-2 block w-full border px-3 py-3 text-left transition-colors ${
                active === lead.id ? "border-brand bg-brand/10" : "border-border/60 bg-[#0c0c0f] hover:border-brand/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{lead.name}</span>
                <span className="mono text-[10px] text-muted-foreground">{relative(lead.next_follow_up_at)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="mono">{lead.phone}</span>
                <span className="mono">{fmtDate(lead.next_follow_up_at)}</span>
              </div>
            </button>
          ))}
          {!filteredItems.length && (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">No follow-up scheduled yet.</div>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {active ? (
          <LeadPanel leadId={active} onChanged={load} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a follow-up lead.</div>
        )}
      </div>
    </div>
  );
}
