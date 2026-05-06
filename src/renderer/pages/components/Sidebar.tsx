import { useLocation, NavLink } from "react-router-dom";
import { useTheme } from "next-themes";
import { useVaaniUi } from "@/context/vaani-ui";

const nav = [
  { to: "/4/dashboard",  label: "Dashboard",  num: "01" },
  { to: "/4/history",    label: "History",     num: "02" },
  { to: "/4/dictionary", label: "Dictionary",  num: "03" },
  { to: "/4/snippets",   label: "Snippets",    num: "04" },
  { to: "/4/settings",   label: "Settings",    num: "05" },
];

export function Sidebar() {
  const { settings } = useVaaniUi();
  const { resolvedTheme, setTheme } = useTheme();
  const location = useLocation();
  const isDark = resolvedTheme === "dark";

  const toggleDark = () => {
    const next = isDark ? "light" : "dark";
    setTheme(next);
    void settings; // settings.colorMode update happens in SettingsPage
  };

  return (
    <aside
      style={{
        width: "var(--sidebar-w, 220px)",
        height: "100vh",
        background: "var(--bg)",
        borderRight: "2px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Wordmark — same fixed height as page header */}
      <div
        style={{
          padding: "0 24px",
          borderBottom: "2px solid var(--border)",
          minHeight: 120,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              color: "var(--text)",
            }}
          >
            VAANI
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--accent)",
            }}
          >
            ™
          </span>
        </div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginTop: 4,
          }}
        >
          Voice Dictation
        </p>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "12px 0", overflowY: "auto" }}>
        {nav.map(({ to, label, num }) => {
          const active = location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 24px",
                textDecoration: "none",
                borderLeft: active ? "4px solid var(--accent)" : "4px solid transparent",
                background: active ? "var(--bg-2)" : "transparent",
                transition: "all 0.1s",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  minWidth: 16,
                }}
              >
                {num}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: active ? 700 : 400,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: active ? "var(--text)" : "var(--text-sub)",
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                }}
              >
                {label}
              </span>
              {active && (
                <span
                  style={{
                    marginLeft: "auto",
                    width: 5,
                    height: 5,
                    background: "var(--accent)",
                  }}
                />
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Dark/Light toggle */}
      <div
        style={{
          padding: "14px 24px",
          borderTop: "1px solid var(--border-light)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          }}
        >
          {isDark ? "Dark" : "Light"}
        </span>
        <button
          onClick={toggleDark}
          style={{
            width: 44,
            height: 22,
            border: `2px solid ${isDark ? "var(--text)" : "var(--border)"}`,
            background: isDark ? "var(--text)" : "transparent",
            cursor: "pointer",
            position: "relative",
            transition: "all 0.15s",
            padding: 0,
            borderRadius: 0,
            outline: "none",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: isDark ? 25 : 3,
              width: 14,
              height: 14,
              background: isDark ? "var(--bg)" : "var(--text-muted)",
              transition: "left 0.15s, background 0.15s",
            }}
          />
        </button>
      </div>

      {/* Accent rule bar */}
      <div style={{ height: 4, background: "var(--accent)" }} />
    </aside>
  );
}
