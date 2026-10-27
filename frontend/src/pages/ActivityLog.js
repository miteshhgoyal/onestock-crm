import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { fmtDate } from "@/lib/constants";

const TONE = {
  lead_escalated: "text-red-400",
  lead_auto_assigned: "text-violet-400",
  lead_assigned: "text-violet-400",
  lead_reassigned: "text-yellow-400",
  status_changed: "text-blue-400",
  lead_created: "text-emerald-400",
  lead_captured: "text-emerald-400",
};

export default function ActivityLog() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api
      .get("/activities", { params: { limit: 150 } })
      .then(({ data }) => setItems(data))
      .catch((e) => toast.error(errMsg(e)));
  }, []);

  return (
    <div className="px-6 py-8 lg:px-12" data-testid="activity-page">
      <div className="overline">Audit trail</div>
      <h1 className="display mt-2 text-4xl font-black tracking-tighter">Activity log</h1>

      <div className="mt-9 border border-border/60" data-testid="activity-list">
        {items.map((a) => (
          <div key={a.id} className="row-enter flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border/40 px-5 py-3.5 text-sm">
            <span className={`mono text-xs font-semibold uppercase ${TONE[a.action] || "text-muted-foreground"}`}>
              {a.action.replace(/_/g, " ")}
            </span>
            <span className="font-medium">{a.lead_name || "—"}</span>
            <span className="text-muted-foreground">{a.detail}</span>
            <span className="mono ml-auto text-xs text-muted-foreground">
              {a.actor_name} · {fmtDate(a.created_at)}
            </span>
          </div>
        ))}
        {!items.length && (
          <div className="px-5 py-16 text-center text-sm text-muted-foreground" data-testid="activity-empty">
            No activity recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
