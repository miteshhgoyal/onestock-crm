import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, CircleDollarSign } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import PanelSurface from "@/components/PanelSurface";
import { Button } from "@/components/ui/button";

export default function ConvertedClubLeads({ title = "Converted clients" }) {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/leads", { params: { status: "converted", limit: 100, page: 1 } });
      setLeads(data.items || []);
    } catch (error) {
      toast.error(errMsg(error));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markClub = async (lead) => {
    setBusyId(lead.id);
    try {
      const tags = [...new Set([...(lead.tags || []), "50-cr-club"] )];
      const { data } = await api.patch(`/leads/${lead.id}`, { tags });
      setLeads((current) => current.map((item) => item.id === data.id ? data : item));
      toast.success(`${lead.name} added to 50 Cr Club`);
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PanelSurface className="crm-card depth-hover overflow-hidden" data-testid="converted-club-leads">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <div><h2 className="font-bold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">Converted leads in your scope · mark Club clients</p></div>
        <button type="button" onClick={() => navigate("/leads?status=converted")} className="flex items-center gap-1 text-xs font-semibold text-[#247e9d] hover:text-[#15556b]">All converted <ArrowRight size={13} /></button>
      </div>
      <div className="divide-y divide-border/60">
        {leads.map((lead) => {
          const isClub = (lead.tags || []).includes("50-cr-club");
          return <div key={lead.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0"><div className="truncate text-sm font-semibold">{lead.name}</div><div className="truncate text-xs text-muted-foreground">{lead.company || lead.phone}</div></div>
            {isClub
              ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CircleDollarSign size={14} /> 50 Cr Club</span>
              : <Button type="button" size="sm" variant="outline" onClick={() => markClub(lead)} disabled={busyId === lead.id} className="h-8 rounded-none">{busyId === lead.id ? "Saving…" : "Add to 50 Cr Club"}</Button>}
          </div>;
        })}
        {!leads.length && <div className="px-5 py-8 text-center text-sm text-muted-foreground">No converted clients in your scope yet.</div>}
      </div>
    </PanelSurface>
  );
}