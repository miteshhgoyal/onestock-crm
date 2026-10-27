import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Headphones, Monitor, Smartphone } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const CallSettingsCard = ({ onSaved }) => {
  const { user } = useAuth();
  const canEditExtension = ["admin", "subadmin"].includes(user?.role);
  const [diag, setDiag] = useState(null);
  const [mode, setMode] = useState("phone");
  const [extension, setExtension] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/calls/diagnostics");
      setDiag(data);
      setMode(data.call_mode || "phone");
      setExtension(data.agent_extension || "");
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (nextMode) => {
    setSaving(true);
    try {
      const payload = { call_mode: nextMode ?? mode };
      if (canEditExtension) payload.agent_extension = extension;
      await api.patch("/calls/preferences", payload);
      toast.success(
        (nextMode ?? mode) === "desktop"
          ? "Calls will now ring on this computer"
          : "Calls will now ring your phone first",
      );
      await load();
      onSaved?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (!diag) return null;

  const options = [
    { value: "desktop", label: "This computer", hint: "Headset, no phone", icon: Monitor },
    { value: "phone", label: "My phone first", hint: "Mobile rings, then the lead", icon: Smartphone },
  ];

  return (
    <section className="crm-card border border-border/60 p-6" data-testid="call-settings-card">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-brand/10 p-3 text-brand">
          <Headphones size={22} />
        </div>
        <div>
          <h2 className="font-bold">Where calls ring</h2>
          <p className="text-xs text-muted-foreground">
            {diag.rings_on ? `Currently: ${diag.rings_on}` : "Not configured yet"}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {options.map(({ value, label, hint, icon: Icon }) => (
          <button
            key={value}
            data-testid={`call-mode-${value}`}
            onClick={() => {
              setMode(value);
              save(value);
            }}
            disabled={saving}
            className={`flex items-start gap-3 border p-4 text-left transition-colors duration-150 ${
              mode === value
                ? "border-brand bg-brand/10"
                : "border-border/60 hover:border-white/30"
            }`}
          >
            <Icon size={17} className={mode === value ? "text-brand" : "text-muted-foreground"} />
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {mode === "desktop" && (
        <div className="mt-5 space-y-3">
          <div>
            <div className="overline mb-1.5">Smartflo extension</div>
            <div className="flex gap-2">
              <Input
                data-testid="call-settings-extension"
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                readOnly={!canEditExtension}
                placeholder="e.g. 1024"
                className="h-10 rounded-none border-border/70 bg-[#0c0c0f]"
              />
              {canEditExtension && <Button
                data-testid="call-settings-save"
                onClick={() => save()}
                disabled={saving}
                className="h-10 rounded-none bg-brand text-brand-foreground hover:bg-brand/90"
              >
                Save
              </Button>}
            </div>
            {!canEditExtension && <p className="mt-1.5 text-xs text-muted-foreground">Only an admin or sub-admin can change this extension.</p>}
          </div>
          <ol className="space-y-1.5 border border-border/60 p-4 text-xs text-muted-foreground">
            <li>
              1. Install the free{" "}
              <a
                href={diag.softphone_extension_url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="softphone-extension-link"
                className="text-brand underline"
              >
                Smartflo Softphone
              </a>{" "}
              Chrome extension (one time, per computer).
            </li>
            <li>2. Sign in to it with your Smartflo user ID and password.</li>
            <li>3. Allow microphone access and keep the extension open while you work.</li>
            <li>4. Hit Call in the CRM — it connects on your headset, no phone needed.</li>
          </ol>
        </div>
      )}

      {!diag.ready && diag.problems?.length > 0 && (
        <ul className="mt-4 space-y-1 border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300"
            data-testid="call-settings-problems">
          {diag.problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default CallSettingsCard;
