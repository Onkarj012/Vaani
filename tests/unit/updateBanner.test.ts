import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UpdateBanner from "@renderer/components/UpdateBanner";
import type { UpdateNotificationPayload } from "@shared/types";

// Renders the banner to HTML so tests can check its accessibility attributes.
function render(notification: UpdateNotificationPayload): string {
  return renderToStaticMarkup(createElement(UpdateBanner, { notification, onDismiss: () => {} }));
}

describe("UpdateBanner accessibility", () => {
  it("announces progress politely as a status region", () => {
    const html = render({ status: "checking", message: "Checking for updates…" });
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("announces failures as an alert", () => {
    const html = render({ status: "error", message: "Update check failed: net::ERR_INTERNET_DISCONNECTED" });
    expect(html).toContain('role="alert"');
  });

  it("keeps the full message in a tooltip when the text is truncated", () => {
    const message = "Update check failed: net::ERR_INTERNET_DISCONNECTED";
    const html = render({ status: "error", message });
    expect(html).toContain(`title="${message}"`);
  });

  it("names what the dismiss button closes", () => {
    const html = render({ status: "no-update", message: "You're on the latest version." });
    expect(html).toContain('aria-label="Dismiss update message"');
  });
});
