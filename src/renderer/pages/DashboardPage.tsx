import { Link } from "react-router-dom";
import { useVaaniUi } from "@/context/vaani-ui";
import { PageLayout } from "./components/PageLayout";
import type { CSSProperties } from "react";

const label: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: 0,
};

const bigNum: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 41,
  fontWeight: 900,
  letterSpacing: "-0.03em",
  color: "var(--text)",
  margin: "4px 0 0",
};

export default function DashboardPage() {
  const { stats, historyItems, settings } = useVaaniUi();
  const latest = historyItems[0];
  const primaryParts = (settings.primaryHotkey || "Ctrl+Option+D").split("+").filter(Boolean);

  const statCells = [
    { label: "Sessions",      value: String(stats.totalSessions).padStart(2, "0") },
    { label: "Words Dictated", value: stats.totalWords.toLocaleString() },
    { label: "Today",         value: String(stats.sessionsToday).padStart(2, "0") },
    { label: "Streak",        value: `${stats.streak}d` },
  ];

  const actions = [
    { to: "/4/settings",   num: "A", label: "Settings",   sub: "Configure hotkeys & API key" },
    { to: "/4/history",    num: "B", label: "History",    sub: "Browse past transcriptions" },
    { to: "/4/dictionary", num: "C", label: "Dictionary", sub: "Manage word corrections" },
  ];

  return (
    <PageLayout title="Voice" accentLine="" breadcrumb="Vaani / Dashboard">

      {/* ── Stat strip ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: "1px solid var(--border-light)",
        }}
      >
        {statCells.map(({ label: l, value }, i) => (
          <div
            key={l}
            style={{
              padding: "20px 32px",
              borderRight: i < 3 ? "1px solid var(--border-light)" : "none",
            }}
          >
            <p style={label}>{l}</p>
            <p style={bigNum}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Main grid: latest + quick actions ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderBottom: "1px solid var(--border-light)",
        }}
      >
        {/* Latest dictation */}
        <div
          style={{
            padding: "40px 48px",
            borderRight: "1px solid var(--border-light)",
          }}
        >
          <p style={label}>Latest Dictation</p>
          {latest ? (
            <>
              <p
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 11,
                  fontWeight: 400,
                  color: "var(--text)",
                  lineHeight: 1.6,
                  marginTop: 16,
                  marginBottom: 12,
                }}
              >
                {latest.text}
              </p>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                }}
              >
                {latest.app} &nbsp;·&nbsp; {latest.time} &nbsp;·&nbsp; {latest.wordCount} words
              </p>
            </>
          ) : (
            <div style={{ marginTop: 20 }}>
              <p
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 16,
                  color: "var(--text-muted)",
                  marginBottom: 16,
                }}
              >
                No dictations yet. Press your hotkey to start.
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 16,
                  color: "var(--text-muted)",
                  flexWrap: "wrap",
                }}
              >
                <span>Press</span>
                {primaryParts.map((k, i) => (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <kbd
                      style={{
                        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                   fontSize: 11,
                   fontWeight: 700,
                   letterSpacing: "0.06em",
                   padding: "3px 8px",
                        border: "2px solid var(--border)",
                        background: "var(--bg-2)",
                        color: "var(--text)",
                        borderRadius: 0,
                      }}
                    >
                      {k}
                    </kbd>
                    {i < primaryParts.length - 1 && <span>+</span>}
                  </span>
                ))}
                <span>to dictate</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div style={{ padding: "32px 0" }}>
          <div style={{ padding: "0 32px 14px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <p style={label}>Quick Access</p>
          </div>
          {actions.map(({ to, num, label: l, sub }) => (
            <Link
              key={to}
              to={to}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 32px",
                borderTop: "1px solid var(--border-light)",
                textDecoration: "none",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span
                style={{
                   fontSize: 11,
                   fontWeight: 700,
                   letterSpacing: "0.08em",
                   color: "var(--accent)",
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  minWidth: 16,
                }}
              >
                {num}
              </span>
              <div>
                <p
                  style={{
                    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "var(--text)",
                    margin: 0,
                  }}
                >
                  {l}
                </p>
                <p
                  style={{
                   fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                   fontSize: 11,
                   color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {sub}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Recent list ── */}
      <div>
        <div
          style={{
            padding: "14px 48px",
            borderBottom: "1px solid var(--border-light)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <p style={label}>Recent Dictations</p>
          <Link
            to="/4/history"
            style={{
               fontSize: 11,
               fontWeight: 700,
               letterSpacing: "0.10em",
               textTransform: "uppercase",
               color: "var(--accent)",
              textDecoration: "none",
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
            }}
          >
            View All →
          </Link>
        </div>

        {historyItems.slice(0, 4).map((item, i) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              gap: 16,
              padding: "16px 48px",
              borderBottom: "1px solid var(--border-light)",
              alignItems: "flex-start",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <span
              style={{
                 fontSize: 11,
                 fontWeight: 700,
                 color: "var(--accent)",
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                letterSpacing: "0.06em",
                minWidth: 20,
                paddingTop: 2,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                  fontSize: 16,
                  fontWeight: 400,
                  color: "var(--text)",
                  margin: 0,
                  lineHeight: 1.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.text}
              </p>
              <p
                style={{
                   fontSize: 11,
                   color: "var(--text-muted)",
                  margin: "4px 0 0",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontWeight: 500,
                  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                }}
              >
                {item.time} &nbsp;·&nbsp; {item.wordCount} words
              </p>
            </div>
          </div>
        ))}

        {historyItems.length === 0 && (
          <p
            style={{
              padding: "40px 48px",
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: 16,
              color: "var(--text-muted)",
            }}
          >
            No recordings yet. Start speaking to build your history.
          </p>
        )}
      </div>

    </PageLayout>
  );
}
