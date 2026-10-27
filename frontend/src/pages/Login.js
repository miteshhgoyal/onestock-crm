import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import LogoMark from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.from?.pathname ? location.state.from.pathname + (location.state.from.search || "") : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      const target = redirectTo || (user.role === "telecaller" ? "/workspace" : "/dashboard");
      navigate(target, { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#0a0a0c] lg:block grain">
        <img
          src="https://images.unsplash.com/photo-1709626011485-6fe000ea2dbc?crop=entropy&cs=srgb&fm=jpg&q=85&w=1400"
          alt="abstract"
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-14">
          <div className="flex items-center gap-3">
            <LogoMark size={42} />
            <span className="display text-xl font-extrabold tracking-tighter text-white">ONESTOCK ACADEMY</span>
          </div>
          <div>
            <h1 className="display text-4xl font-black leading-[1.05] tracking-tighter sm:text-5xl">
              Every lead
              <br />
              answered on time.
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground">
              Capture, assign and close leads with a calling floor that never loses track of a
              follow-up.
            </p>
          </div>
          <div className="mono text-xs text-muted-foreground">
            Round-robin assignment · 12h escalation · Live team reports
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-8 py-16">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <div className="overline">Sign in</div>
          <h2 className="display mt-2 text-3xl font-bold">Welcome back</h2>
          <div className="mt-9 space-y-4">
            <div>
              <div className="overline mb-1.5">Work email</div>
              <Input
                data-testid="login-email-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="h-11 rounded-none border-border/70 bg-[#0c0c0f]"
              />
            </div>
            <div>
              <div className="overline mb-1.5">Password</div>
              <Input
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 rounded-none border-border/70 bg-[#0c0c0f]"
              />
            </div>
            {error && (
              <div
                data-testid="login-error"
                className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"
              >
                {error}
              </div>
            )}
            <Button
              data-testid="login-submit-button"
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-none bg-brand text-brand-foreground transition-colors duration-150 hover:bg-brand/90"
            >
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={15} className="ml-2" />
            </Button>
          </div>

        </form>
      </div>
    </div>
  );
}
