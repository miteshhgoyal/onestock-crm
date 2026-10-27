import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "next-themes";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AppShell from "@/components/AppShell";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Workspace from "@/pages/Workspace";
import FollowUp from "@/pages/FollowUp";
import Users from "@/pages/Users";
import Teams from "@/pages/Teams";
import Reports from "@/pages/Reports";
import FiftyCrClub from "@/pages/FiftyCrClub";
import MyFiftyCrClub from "@/pages/MyFiftyCrClub";
import ClubLeads from "@/pages/ClubLeads";
import TelecallerReport from "@/pages/TelecallerReport";
import TelecallerPerformance from "@/pages/TelecallerPerformance";
import TelecallerEfficiencyReport from "@/pages/TelecallerEfficiencyReport";
import LiveStatusBoard from "@/pages/LiveStatusBoard";
import ActivityLog from "@/pages/ActivityLog";
import Activities from "@/pages/Activities";
import Documents from "@/pages/Documents";
import TeamChat from "@/pages/TeamChat";
import Dialer from "@/pages/Dialer";
import "@/App.css";

const Guard = ({ roles, clubRmOnly = false, children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to={user.role === "telecaller" ? "/workspace" : "/dashboard"} replace />;
  if (clubRmOnly && !user.is_50_cr_club_rm) return <Navigate to="/dashboard" replace />;
  return <AppShell>{children}</AppShell>;
};

const Landing = () => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
};

const MANAGERS = ["admin", "subadmin", "team_leader"];

const AppToaster = () => {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme === "dark" ? "dark" : "light"} position="bottom-right" />;
};

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="onestock-theme">
      <AuthProvider>
        <BrowserRouter>
          <AppToaster />
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Guard roles={[...MANAGERS, "telecaller"]}><Dashboard /></Guard>} />
          <Route path="/leads" element={<Guard roles={[...MANAGERS, "telecaller"]}><Leads /></Guard>} />
          <Route path="/activities" element={<Guard roles={[...MANAGERS, "telecaller"]}><Activities /></Guard>} />
          <Route path="/documents" element={<Guard roles={[...MANAGERS, "telecaller"]}><Documents /></Guard>} />
          <Route path="/team-chat" element={<Guard roles={[...MANAGERS, "telecaller"]}><TeamChat /></Guard>} />
          <Route path="/dialer" element={<Guard roles={[...MANAGERS, "telecaller"]}><Dialer /></Guard>} />
          <Route path="/workspace" element={<Guard roles={["telecaller"]}><Workspace /></Guard>} />
          <Route path="/follow-up" element={<Guard roles={["telecaller"]}><FollowUp /></Guard>} />
          <Route path="/reports" element={<Guard roles={[...MANAGERS, "telecaller"]}><Reports /></Guard>} />
          <Route path="/50-cr-club/reports" element={<Guard roles={["admin"]}><FiftyCrClub key="club-reports" reportOnly initialTab="rm-report" /></Guard>} />
          <Route path="/50-cr-club" element={<Guard roles={["admin"]}><FiftyCrClub /></Guard>} />
          <Route path="/50-cr-club/leads" element={<Guard roles={[...MANAGERS, "telecaller"]}><ClubLeads /></Guard>} />
          <Route path="/my-50-cr-club" element={<Guard roles={["telecaller"]} clubRmOnly><MyFiftyCrClub /></Guard>} />
          <Route path="/performance" element={<Guard roles={MANAGERS}><TelecallerPerformance /></Guard>} />
          <Route path="/efficiency-report" element={<Guard roles={["admin"]}><TelecallerEfficiencyReport /></Guard>} />
          <Route path="/live-status" element={<Guard roles={MANAGERS}><LiveStatusBoard /></Guard>} />
          <Route path="/reports/telecallers/:telecallerId" element={<Guard roles={[...MANAGERS, "telecaller"]}><TelecallerReport /></Guard>} />
          <Route path="/users" element={<Guard roles={["admin", "subadmin"]}><Users /></Guard>} />
          <Route path="/teams" element={<Guard roles={MANAGERS}><Teams /></Guard>} />
          <Route path="/activity" element={<Guard roles={MANAGERS}><ActivityLog /></Guard>} />
          <Route path="*" element={<Landing />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
