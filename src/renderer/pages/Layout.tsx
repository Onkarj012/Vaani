import { Outlet } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { useTheme } from "next-themes";

function DarkAmbient() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        background:
          "radial-gradient(ellipse 80% 60% at 10% 20%, rgba(139,92,246,0.035) 0%, transparent 60%), " +
          "radial-gradient(ellipse 70% 50% at 90% 80%, rgba(168,85,247,0.025) 0%, transparent 55%)",
      }}
    />
  );
}

export default function Layout() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "var(--bg)",
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {isDark && <DarkAmbient />}
      <div style={{ position: "relative", zIndex: 1, display: "flex", width: "100%", height: "100%" }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: "auto", background: "var(--bg)" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
