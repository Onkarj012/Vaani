import type { ReactNode, CSSProperties } from "react";

interface PageLayoutProps {
  title: string;
  breadcrumb?: string;
  accentLine?: string;   // second line of headline in accent color
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  noPad?: boolean;       // skip default padding for full-bleed pages
}

const crumbStyle: CSSProperties = {
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-sub)",
  margin: 0,
};

export function PageLayout({
  title,
  breadcrumb,
  accentLine,
  subtitle,
  action,
  children,
  noPad,
}: PageLayoutProps) {
  return (
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Page header — fixed 120px to match sidebar wordmark block */}
      <div style={{ borderBottom: "2px solid var(--border)", padding: "0 48px", minHeight: 120, display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          {breadcrumb && <p style={crumbStyle}>{breadcrumb}</p>}
          <h1
            style={{
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: 38,
              fontWeight: 900,
              letterSpacing: "-0.03em",
              color: "var(--text)",
              margin: breadcrumb ? "6px 0 0" : 0,
              lineHeight: 1.05,
            }}
          >
            {title}
            {accentLine && (
              <>
                <br />
                <span style={{ color: "var(--accent)" }}>{accentLine}</span>
              </>
            )}
          </h1>
          {subtitle && (
            <p
              style={{
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
                fontSize: 11,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
                marginTop: 8,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </div>

      {/* Page content */}
      <div style={{ flex: 1, ...(noPad ? {} : { padding: "0" }) }}>
        {children}
      </div>

      {/* 4px accent bottom bar — Swiss grid rule */}
      <div style={{ height: 4, background: "var(--accent)" }} />
    </div>
  );
}
