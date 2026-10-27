import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  Activity,
  BarChart3,
  Gauge,
  Radio,
  CalendarDays,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  ContactRound,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  ListFilter,
  LogOut,
  MessageCircle,
  PhoneCall,
  Search,
  Settings,
  Sun,
  Moon,
  Users2,
  UsersRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/context/AuthContext";
import { ROLE_LABEL } from "@/lib/constants";
import LogoMark from "@/components/LogoMark";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/leads", label: "Leads", icon: ListFilter, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/50-cr-club/leads", label: "50 Cr Club Leads", icon: CircleDollarSign, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/activities", label: "All activities", icon: Activity, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/documents", label: "Documents", icon: FileText, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/team-chat", label: "Team chat", icon: MessageCircle, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/dialer", label: "Dialer", icon: ContactRound, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/workspace", label: "My Workspace", icon: PhoneCall, roles: ["telecaller"] },
  { to: "/follow-up", label: "Follow up", icon: CalendarClock, roles: ["telecaller"] },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin", "subadmin", "team_leader", "telecaller"] },
  { to: "/50-cr-club/reports", label: "50 Cr Club Reports", icon: BarChart3, roles: ["admin"] },
  { to: "/50-cr-club", label: "50 Cr Club", icon: CircleDollarSign, roles: ["admin"], end: true },
  { to: "/my-50-cr-club", label: "My 50 Cr Club", icon: CircleDollarSign, roles: ["telecaller"], clubRmOnly: true },
  { to: "/performance", label: "Performance", icon: Gauge, roles: ["admin", "subadmin", "team_leader"] },
  { to: "/efficiency-report", label: "Efficiency Report", icon: BarChart3, roles: ["admin"] },
  { to: "/live-status", label: "Live Board", icon: Radio, roles: ["admin", "subadmin", "team_leader"] },
  { to: "/users", label: "Users", icon: Users2, roles: ["admin", "subadmin"] },
  { to: "/teams", label: "Teams", icon: UsersRound, roles: ["admin", "subadmin", "team_leader"] },
  { to: "/activity", label: "Audit Log", icon: Activity, roles: ["admin", "subadmin", "team_leader"] },
];

// Sliding day/night switch with a frosted-glass track. Colors come from the
// app's own theme tokens (brand / foreground / muted) so it follows light and dark.
const ThemeSwitch = ({ isDark, onToggle }) => {
  const label = `Switch to ${isDark ? "light" : "dark"} theme`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-testid="theme-toggle"
      className="group relative flex h-9 w-[76px] shrink-0 items-center overflow-hidden rounded-full border border-white/60 bg-foreground/[0.04] p-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.7),inset_0_-1px_2px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-md transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-white/15 dark:bg-white/10 dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15),inset_0_-1px_2px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.3)]"
    >
      {/* glass sheen across the top half of the track */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/50 to-transparent dark:from-white/10" />
      {/* dim track icons (the active one is hidden under the thumb) */}
      <Sun
        size={14}
        aria-hidden="true"
        className={`absolute left-[12px] text-muted-foreground transition-opacity duration-300 ${isDark ? "opacity-70" : "opacity-0"}`}
      />
      <Moon
        size={14}
        aria-hidden="true"
        className={`absolute right-[12px] text-muted-foreground transition-opacity duration-300 ${isDark ? "opacity-0" : "opacity-70"}`}
      />
      {/* sliding glass thumb in the brand color */}
      <span
        className={`relative z-10 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/40 bg-brand text-brand-foreground shadow-lg shadow-brand/40 transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group-active:scale-95 ${
          isDark ? "translate-x-[38px]" : "translate-x-0"
        }`}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/40 via-white/5 to-transparent" />
        {isDark ? (
          <Moon size={15} fill="currentColor" strokeWidth={1.75} className="relative" />
        ) : (
          <Sun size={15} strokeWidth={2.25} className="relative" />
        )}
      </span>
    </button>
  );
};

export const AppShell = ({ children }) => {
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(user?.role) && (!n.clubRmOnly || user?.is_50_cr_club_rm));
  const activityLinks = [
    { to: "/activities?type=task", label: "Tasks", icon: ClipboardCheck },
    { to: "/activities?type=meeting", label: "Meetings", icon: CalendarDays },
    { to: "/activities?type=call", label: "Calls", icon: PhoneCall },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="workspace-sidebar hidden w-[248px] shrink-0 flex-col text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="flex items-center gap-3">
            <LogoMark size={34} />
            <div className="display text-base font-extrabold leading-[1.1] tracking-tight text-white">
              ONESTOCK ACADEMY
              <span className="mt-1 block font-sans text-[10px] font-semibold uppercase tracking-[0.2em] text-[#71d9ee]">CRM workspace</span>
            </div>
          </div>
          <button className="mt-6 flex w-full items-center justify-between rounded-md bg-white/10 px-3 py-2 text-left text-xs text-white/80">
            <span><span className="block font-semibold text-white">CRM Teamspace</span><span className="text-white/50">Sales workspace</span></span>
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="px-4 pt-5"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-white/40" /><input placeholder="Search" className="h-9 w-full rounded-md border border-white/10 bg-white/5 pl-9 text-xs text-white outline-none placeholder:text-white/40" /></div></div>
        <nav className="flex-1 px-3 py-5" data-testid="sidebar-nav">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Workspace</div>
          {items.map(({ to, label, icon: Icon, end }) => (
            label === "All activities" ? (
              <button
                key={to}
                type="button"
                onClick={() => setActivitiesOpen(true)}
                data-testid="nav-all-activities"
                className="mb-0.5 flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white/65 transition-colors duration-150 hover:bg-white/10 hover:text-white"
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </button>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-3 px-3 py-2.5 text-sm transition-colors duration-150 ${
                    isActive
                      ? "bg-[#355487] font-semibold text-white shadow-sm"
                      : "text-white/65 hover:bg-white/10 hover:text-white"
                  }`
                }
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </NavLink>
            )
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="mb-3">
            <div className="text-sm font-medium" data-testid="current-user-name">
              {user?.name}
            </div>
            <div className="text-[11px] text-white/45" data-testid="current-user-role">
              {ROLE_LABEL[user?.role]}
            </div>
          </div>
          <button
            data-testid="logout-button"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-2 border border-white/15 px-3 py-2 text-xs text-white/60 transition-colors duration-150 hover:border-red-300/50 hover:text-red-200"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="app-header flex h-16 items-center justify-between border-b border-border/70 px-6 lg:px-8">
          <div className="text-sm font-semibold">{items.find((item) => window.location.pathname === item.to)?.label || "Home"}</div>
          <div className="flex items-center gap-4">
            <ThemeSwitch
              isDark={resolvedTheme === "dark"}
              onToggle={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            />
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">{user?.name?.slice(0, 1).toUpperCase()}</div>
          </div>
        </header>
        {children}
      </main>
      <Sheet open={activitiesOpen} onOpenChange={setActivitiesOpen}>
        <SheetContent side="right" className="w-full border-l border-border/60 bg-background sm:max-w-[380px]">
          <SheetTitle className="display text-2xl font-bold">All activities</SheetTitle>
          <div className="mt-6 space-y-2">
            {activityLinks.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setActivitiesOpen(false)}
                data-testid={`activity-drawer-${label.toLowerCase()}`}
                className="flex items-center gap-3 border border-border/70 px-4 py-4 text-sm font-semibold hover:border-brand hover:bg-brand/5"
              >
                <Icon size={18} className="text-brand" />
                {label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default AppShell;