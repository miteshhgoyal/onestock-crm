import { useEffect, useState } from "react";
import { ContactRound, PhoneCall, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CallSettingsCard from "@/components/CallSettingsCard";
import LeadProfileFields from "@/components/LeadProfileFields";
import { EMPTY_PROFILE, profilePayload } from "@/lib/leadProfile";

const emptyForm = { name: "", phone: "", email: "", company: "", ...EMPTY_PROFILE };
const dayKey = (userId) => {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return `crm-call-time-${userId || "guest"}-${day}`;
};
const formatDuration = (seconds) => `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export default function Dialer() {
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [calling, setCalling] = useState(false);
  const [activeStartedAt, setActiveStartedAt] = useState(null);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [liveSeconds, setLiveSeconds] = useState(0);
  const canCreateLead = ["admin", "subadmin", "team_leader", "telecaller"].includes(user?.role);
  const cleanPhone = form.phone.replace(/\D/g, "");

  useEffect(() => {
    setTodaySeconds(Number(localStorage.getItem(dayKey(user?.id || user?.email)) || 0));
  }, [user?.id, user?.email]);

  useEffect(() => {
    if (!activeStartedAt) return undefined;
    const update = () => setLiveSeconds(Math.floor((Date.now() - activeStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeStartedAt]);

  const dial = async (destinationNumber, leadId) => {
    if (!destinationNumber) return toast.error("Enter a phone number first");
    setCalling(true);
    try {
      await api.post("/calls/click-to-call", { destination_number: destinationNumber, lead_id: leadId || null });
      setActiveStartedAt(Date.now());
      setLiveSeconds(0);
      toast.success("Call connecting — check your Smartflo softphone or phone");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCalling(false);
    }
  };

  const endCall = () => {
    if (!activeStartedAt) return;
    const duration = Math.max(0, Math.floor((Date.now() - activeStartedAt) / 1000));
    const nextTotal = todaySeconds + duration;
    localStorage.setItem(dayKey(user?.id || user?.email), String(nextTotal));
    setTodaySeconds(nextTotal);
    setActiveStartedAt(null);
    setLiveSeconds(0);
    toast.success(`Call ended · ${formatDuration(duration)}`);
  };

  const saveLead = async (shouldDial = false) => {
    if (!form.name.trim() || !cleanPhone) return toast.error("Name and phone are required");
    setBusy(true);
    try {
      const { data } = await api.post("/leads", {
        name: form.name.trim(),
        phone: cleanPhone,
        email: form.email,
        company: form.company,
        source: "manual",
        ...profilePayload(form),
      });
      if (shouldDial) {
        toast.success("Lead added. Initiating call…");
        await dial(cleanPhone, data?.id);
      } else {
        toast.success("Lead saved");
      }
      setForm(emptyForm);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-6 lg:px-8" data-testid="dialer-page">
      <div><div className="text-sm text-muted-foreground">Sales workspace</div><h1 className="display mt-1 text-3xl font-black tracking-tight">Dialer</h1><p className="mt-1 text-sm text-muted-foreground">Call a number directly or save it as a lead before dialing.</p></div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-5">
          <CallSettingsCard />
          <section className="crm-card p-6" data-testid="direct-dial-card"><div className="flex items-center gap-3"><div className="rounded-lg bg-[#123c51] p-3 text-[#4bd4f0]"><PhoneCall size={22} /></div><div><h2 className="font-bold">Smartflo dial</h2><p className="text-xs text-muted-foreground">Call via Tata Smartflo click-to-call</p></div></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="border border-border/60 p-3"><div className="overline">Call time today</div><div className="mono mt-1 text-xl font-semibold" data-testid="today-call-time">{formatDuration(todaySeconds + liveSeconds)}</div></div><div className="border border-border/60 p-3"><div className="overline">Current call</div><div className="mono mt-1 text-xl font-semibold">{activeStartedAt ? formatDuration(liveSeconds) : "Ready"}</div></div></div><div className="mt-6"><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Phone number</label><Input data-testid="dialer-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Enter phone number" inputMode="tel" className="h-12 border-border bg-[#101f35] text-lg" /></div><div className="mt-4 grid grid-cols-2 gap-2"><Button data-testid="direct-dial-button" onClick={() => dial(cleanPhone)} disabled={calling || !!activeStartedAt} className="h-11 bg-[#247e9d] text-white hover:bg-[#15556b]"><PhoneCall size={16} className="mr-2" />{calling ? "Connecting…" : "Dial now"}</Button><Button data-testid="end-call-button" variant="outline" onClick={endCall} disabled={!activeStartedAt} className="h-11 border-border/70">End call</Button></div></section>
        </div>
        <section className="crm-card p-6" data-testid="add-lead-dial-card"><div className="flex items-center gap-3"><div className="rounded-lg bg-[#123c51] p-3 text-[#4bd4f0]"><UserPlus size={22} /></div><div><h2 className="font-bold">Add lead and dial</h2><p className="text-xs text-muted-foreground">Save contact details before opening the call</p></div></div><form onSubmit={(event) => { event.preventDefault(); saveLead(true); }} className="mt-6 grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Full name *</label><Input data-testid="dialer-lead-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={!canCreateLead} placeholder="Lead name" /></div><div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Phone *</label><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} disabled={!canCreateLead} placeholder="Phone number" inputMode="tel" /></div><div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Email</label><Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} disabled={!canCreateLead} placeholder="Email address" /></div><div><label className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted-foreground">Company</label><Input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} disabled={!canCreateLead} placeholder="Company name" /></div><div className="sm:col-span-2 border-t border-border/60 pt-4"><LeadProfileFields profile={form} onChange={(next) => setForm({ ...form, ...next })} idPrefix="dialer-profile" /></div><div className="grid gap-2 sm:grid-cols-2 sm:col-span-2"><Button data-testid="save-lead-button" type="button" onClick={() => saveLead(false)} disabled={!canCreateLead || busy} className="h-11 bg-slate-700 text-white hover:bg-slate-600"><ContactRound size={16} className="mr-2" />{busy ? "Saving…" : "Save lead"}</Button><Button data-testid="save-lead-dial-button" type="submit" disabled={!canCreateLead || busy} className="h-11 bg-[#ef8d5c] text-white hover:bg-[#df7b4b]"><PhoneCall size={16} className="mr-2" />{busy ? "Saving…" : "Save & dial"}</Button></div></form>{!canCreateLead && <p className="mt-4 text-xs text-amber-300">Your role cannot create new leads.</p>}</section>
      </div>
    </div>
  );
}