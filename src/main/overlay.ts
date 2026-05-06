import { app, BrowserWindow } from "electron";
import { nativeBridge } from "./nativeBridge";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const CAPSULE_BOTTOM_MARGIN    = 24;
const CAPSULE_HEIGHT_EXPANDED  = 128;

export class OverlayController {
  private window: BrowserWindow | null = null;
  private loadReady = false;
  private pendingMode: "idle" | "recording" | "transcribing" | "done" | "error" | null = null;
  private pendingBars: number[] | null = null;
  private promptActive = false;
  private promptDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private colorMode: "light" | "dark" = "light";
  private accentColor  = "#7C3AED";
  private borderWidth  = 1;
  private barRadius    = 2;
  private cornerRadius = 20;
  private capsuleDesign: "dot" | "bar" | "rule" | "pill" = "pill";

  // ── Collapsed size per design ─────────────────────────────────────────────

  private getCollapsedSize(): { width: number; height: number } {
    switch (this.capsuleDesign) {
      case "dot":  return { width: 52,  height: 52  };
      case "rule": return { width: 260, height: 28  };
      case "pill": return { width: 260, height: 68  };
      default:     return { width: 260, height: 48  };
    }
  }

  // ── Public setters ────────────────────────────────────────────────────────

  setTheme(_theme: "aurora"): void {
    if (this.window && !this.window.isDestroyed()) {
      const html = this.buildCapsuleHtml();
      const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      this.loadReady = false;
      void this.window.loadURL(dataUri);
    }
  }

  setColorMode(colorMode: "light" | "dark"): void {
    if (this.colorMode === colorMode) return;
    this.colorMode = colorMode;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("capsule:set-color-mode", colorMode);
    }
  }

  setAccentColor(color: string): void {
    this.accentColor = color;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("capsule:set-accent", color);
    }
  }

  setCapsuleStyle(opts: { borderWidth?: number; barRadius?: number; cornerRadius?: number }): void {
    if (opts.borderWidth  !== undefined) this.borderWidth  = opts.borderWidth;
    if (opts.barRadius    !== undefined) this.barRadius    = opts.barRadius;
    if (opts.cornerRadius !== undefined) this.cornerRadius = opts.cornerRadius;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("capsule:set-style", {
        borderWidth:  this.borderWidth,
        barRadius:    this.barRadius,
        cornerRadius: this.cornerRadius,
      });
    }
  }

  setCapsuleDesign(design: "dot" | "bar" | "rule" | "pill"): void {
    this.capsuleDesign = design;
    if (this.window && !this.window.isDestroyed()) {
      const html = this.buildCapsuleHtml();
      const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      this.loadReady = false;
      void this.window.loadURL(dataUri).then(() => {
        void this.resizeWindow(false);
      });
    }
  }

  // ── Visibility / state ───────────────────────────────────────────────────

  show(): void {
    const frontmostBefore = nativeBridge.getFrontmostApplication?.();
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      void this.restoreFocusIfNeeded(frontmostBefore);
      return;
    }
    this.loadReady = false;
    void this.createWindow().then(() => {
      void this.restoreFocusIfNeeded(frontmostBefore);
    });
  }

  hide(): void {
    if (this.promptActive) return;
    if (this.window && !this.window.isDestroyed()) {
      this.tryUpdateMode("idle");
      this.window.hide();
    }
    this.pendingMode = null;
    this.pendingBars = null;
  }

  setRecording(): void {
    this.pendingMode = "recording";
    this.pendingBars = null;
    this.show();
    this.tryUpdateMode("recording");
  }

  setProcessing(): void {
    this.pendingMode = "transcribing";
    this.tryUpdateMode("transcribing");
  }

  setSuccess(): void {
    this.pendingMode = "done";
    this.tryUpdateMode("done");
  }

  setError(): void {
    this.pendingMode = "error";
    this.tryUpdateMode("error");
  }

  updateBars(bars: number[]): void {
    this.pendingBars = bars;
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:update-bars", bars);
  }

  // ── Prompts ──────────────────────────────────────────────────────────────

  showSnippetPrompt(trigger: string, onResponse: (accepted: boolean) => void): void {
    this.promptActive = true;
    this.clearPromptDismissTimer();
    this.show();

    const showUI = async () => {
      if (!this.window || this.window.isDestroyed()) return;
      await this.resizeWindow(true);
      this.window.webContents.send("capsule:show-snippet", { trigger });
      this.promptDismissTimer = setTimeout(() => {
        this.endPrompt();
        onResponse(false);
      }, 8000);
    };

    if (this.loadReady) {
      void showUI();
    } else {
      const check = setInterval(() => {
        if (this.loadReady) { clearInterval(check); void showUI(); }
      }, 50);
      setTimeout(() => clearInterval(check), 5000);
    }

    this.window?.webContents.once("ipc-message", (_e, channel, ...args) => {
      if (channel === "capsule:snippet-response") {
        this.clearPromptDismissTimer();
        this.endPrompt();
        const [response] = args as [{ accepted: boolean }];
        onResponse(response.accepted);
      }
    });
  }

  showDictionaryPrompt(word: string, correction: string, onResponse: (accepted: boolean) => void): void {
    this.promptActive = true;
    this.clearPromptDismissTimer();
    this.show();

    const showUI = async () => {
      if (!this.window || this.window.isDestroyed()) return;
      await this.resizeWindow(true);
      this.window.webContents.send("capsule:show-dictionary", { word, correction });
      this.promptDismissTimer = setTimeout(() => {
        this.endPrompt();
        onResponse(false);
      }, 8000);
    };

    if (this.loadReady) {
      void showUI();
    } else {
      const check = setInterval(() => {
        if (this.loadReady) { clearInterval(check); void showUI(); }
      }, 50);
      setTimeout(() => clearInterval(check), 5000);
    }

    this.window?.webContents.once("ipc-message", (_e, channel, ...args) => {
      if (channel === "capsule:dictionary-response") {
        this.clearPromptDismissTimer();
        this.endPrompt();
        const [response] = args as [{ accepted: boolean }];
        onResponse(response.accepted);
      }
    });
  }

  hideExpanded(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    void this.resizeWindow(false);
  }

  destroy(): void {
    this.clearPromptDismissTimer();
    this.promptActive = false;
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    this.loadReady = false;
    this.pendingMode = null;
    this.pendingBars = null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async restoreFocusIfNeeded(
    originalFrontmost: { bundleId?: string; name?: string } | null | undefined
  ): Promise<void> {
    if (!originalFrontmost) return;
    await new Promise<void>((r) => setTimeout(r, 50));
    const currentFrontmost = nativeBridge.getFrontmostApplication?.();
    const currentBundleId  = currentFrontmost?.bundleId?.toLowerCase() ?? "";
    const originalBundleId = originalFrontmost.bundleId?.toLowerCase() ?? "";
    const ourBundleIds = ["com.claudevaani.app", "com.github.electron"];
    const weAreFrontmost = ourBundleIds.some((id) => currentBundleId.includes(id.toLowerCase()));
    if (weAreFrontmost && originalBundleId && !ourBundleIds.some((id) => originalBundleId.includes(id.toLowerCase()))) {
      try {
        const escapedId = originalBundleId.replace(/"/g, '\\"');
        await exec("osascript", ["-e", `tell application id "${escapedId}" to activate`]);
      } catch { /* best effort */ }
    }
  }

  private async resizeWindow(expanded: boolean): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    const { screen } = await import("electron");
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    const { width: cw, height: ch } = this.getCollapsedSize();
    const targetW = expanded ? 260 : cw;
    const targetH = expanded ? CAPSULE_HEIGHT_EXPANDED : ch;
    const targetX = Math.round(x + width  / 2 - targetW / 2);
    const targetY = Math.round(y + height - targetH - CAPSULE_BOTTOM_MARGIN);
    this.window.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
  }

  private endPrompt(): void {
    this.promptActive = false;
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:hide-expanded");
    void this.resizeWindow(false);
    setTimeout(() => this.hide(), 400);
  }

  private clearPromptDismissTimer(): void {
    if (this.promptDismissTimer) {
      clearTimeout(this.promptDismissTimer);
      this.promptDismissTimer = null;
    }
  }

  private tryUpdateMode(mode: "idle" | "recording" | "transcribing" | "done" | "error"): void {
    if (!this.loadReady || !this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("capsule:set-mode", mode);
  }

  private async createWindow(): Promise<void> {
    const { screen } = await import("electron");
    const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
    const { width: cw, height: ch } = this.getCollapsedSize();
    const windowX = Math.round(x + width  / 2 - cw / 2);
    const windowY = Math.round(y + height - ch - CAPSULE_BOTTOM_MARGIN);

    this.window = new BrowserWindow({
      width:  cw,
      height: ch,
      x: windowX,
      y: windowY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      hasShadow: false,
      type: "panel",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });

    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setIgnoreMouseEvents(false);

    if (app.dock) {
      this.window.excludedFromShownWindowsMenu = true;
    }

    this.window.webContents.on("did-finish-load", () => {
      this.loadReady = true;
      if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
      if (this.pendingBars) this.updateBars(this.pendingBars);
    });

    this.window.webContents.on("ipc-message", (_e, channel) => {
      if (channel === "capsule:ready") {
        this.loadReady = true;
        if (this.pendingMode) this.tryUpdateMode(this.pendingMode);
        if (this.pendingBars) this.updateBars(this.pendingBars);
      }
    });

    const html    = this.buildCapsuleHtml();
    const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await this.window.loadURL(dataUri);
    this.window.showInactive();
  }

  // ── HTML builders ─────────────────────────────────────────────────────────

  private buildCapsuleHtml(): string {
    switch (this.capsuleDesign) {
      case "dot":  return this.buildDotHtml();
      case "rule": return this.buildRuleHtml();
      case "pill": return this.buildPillHtml();
      default:     return this.buildBarHtml();
    }
  }

  private buildPillHtml(): string {
    const acc = this.accentColor;
    const bars9 = Array.from({ length: 9 }, (_, i) => `<div class="bar" id="b${i}"></div>`).join("");
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:transparent; overflow:hidden; -webkit-font-smoothing:antialiased; }

:root {
  --accent: ${acc};
  --capsule-bg: rgba(252,251,255,0.92);
  --capsule-border: rgba(255,255,255,0.9);
  --capsule-shadow: rgba(80,60,160,0.12);
  --text-color: #1C1A24;
  --text-secondary: #555;
  --btn-skip-bg: rgba(0,0,0,0.06);
}

body.dark-mode {
  --accent: ${acc};
  --capsule-bg: rgba(30,28,38,0.92);
  --capsule-border: rgba(60,58,70,0.8);
  --capsule-shadow: rgba(0,0,0,0.35);
  --text-color: #F3F2F7;
  --text-secondary: #A8A8B0;
  --btn-skip-bg: rgba(255,255,255,0.1);
}

.capsule {
  position:fixed; bottom:12px; left:50%;
  min-width:100px; height:40px; border-radius:20px;
  border:1px solid var(--capsule-border);
  background:var(--capsule-bg);
  backdrop-filter:blur(28px) saturate(160%);
  box-shadow:0 4px 24px var(--capsule-shadow), 0 1px 3px rgba(0,0,0,0.05);
  display:flex; align-items:center; justify-content:center;
  padding:0 16px; gap:4px;
  opacity:0; transform:translateX(-50%) translateY(40px) scale(0.92);
  transition:opacity 280ms cubic-bezier(0.34, 1.56, 0.64, 1), transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), height 0.22s ease, border-radius 0.22s ease;
}
body.active .capsule { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
body.expanded .capsule { height:104px; border-radius:22px; flex-direction:column; gap:10px; padding:14px 16px; }

body.recording .capsule::before {
  content:"";
  position:absolute; inset:-4px; border-radius:24px;
  box-shadow:0 0 0 0 var(--accent);
  animation:pulse-ring 1.6s ease-out infinite;
  opacity:0.35; pointer-events:none;
}
@keyframes pulse-ring {
  0%   { box-shadow:0 0 0 0 rgba(124,92,255,0.35); }
  70%  { box-shadow:0 0 0 8px rgba(124,92,255,0); }
  100% { box-shadow:0 0 0 0 rgba(124,92,255,0); }
}

body.done .capsule, body.error .capsule {
  opacity:1; transform:translateX(-50%) translateY(0) scale(1);
}
body.done .capsule {
  animation:success-bounce 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes success-bounce {
  0%   { transform:translateX(-50%) translateY(0) scale(1); }
  50%  { transform:translateX(-50%) translateY(0) scale(1.05); }
  100% { transform:translateX(-50%) translateY(0) scale(1); }
}

.waveform { display:none; align-items:center; justify-content:center; gap:2.5px; height:24px; }
body.recording .waveform { display:flex; }
body.expanded .waveform { display:none; }

.bar {
  width:3px; height:20px; border-radius:2px;
  background:var(--accent);
  transform:scaleY(0.15); transform-origin:center;
  transition:transform 50ms ease-out;
}

.dots { display:none; align-items:center; gap:4px; }
body.transcribing .dots { display:flex; }
body.expanded .dots { display:none; }
.dot { width:5px; height:5px; border-radius:50%; background:var(--accent); animation:bounce 0.9s ease-in-out infinite; }
.dot:nth-child(2) { animation-delay:0.15s; }
.dot:nth-child(3) { animation-delay:0.3s; }
@keyframes bounce {
  0%,80%,100% { transform:translateY(0); opacity:0.4; }
  40%          { transform:translateY(-5px); opacity:1; }
}

.check { display:none; font-size:16px; color:var(--accent); }
body.done .check { display:block; }
body.expanded .check { display:none; }

.expanded-content { display:none; flex-direction:column; align-items:center; gap:10px; width:100%; }
body.expanded .expanded-content { display:flex; }
.expanded-text { font-size:11px; font-family:-apple-system,sans-serif; color:var(--text-color); text-align:center; max-width:220px; line-height:1.4; font-weight:500; }
.expanded-buttons { display:flex; gap:6px; }
.expanded-btn { padding:6px 16px; border-radius:999px; border:none; font-size:11px; font-weight:600; cursor:pointer; font-family:-apple-system,sans-serif; }
.expanded-btn.accept { background:var(--accent); color:#fff; }
.expanded-btn.skip   { background:var(--btn-skip-bg); color:var(--text-secondary); }
</style></head>
<body class="idle ${this.colorMode}-mode">
<div class="capsule">
  <div class="waveform">${bars9}</div>
  <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <span class="check">✓</span>
  <div class="expanded-content">
    <div class="expanded-text" id="expandedText"></div>
    <div class="expanded-buttons">
      <button class="expanded-btn accept" id="acceptBtn">Add</button>
      <button class="expanded-btn skip"   id="skipBtn">Skip</button>
    </div>
  </div>
</div>
<script>${this.buildPillScript()}</script>
</body></html>`;
  }

  private buildPillScript(): string {
    return `
try {
  const { ipcRenderer } = require('electron');
  let hideTimeout = null;
  let expandedMode = null;
  let expandedData = null;
  let currentColorMode = '${this.colorMode}';

  document.body.classList.add(currentColorMode + '-mode');

  ipcRenderer.on('capsule:set-color-mode', (_e, mode) => {
    document.body.classList.remove('light-mode', 'dark-mode');
    currentColorMode = mode;
    document.body.classList.add(mode + '-mode');
  });

  ipcRenderer.on('capsule:set-accent', (_e, color) => {
    document.documentElement.style.setProperty('--accent', color);
  });

  ipcRenderer.on('capsule:set-mode', (_e, mode) => {
    if (expandedMode && mode !== 'idle') return;
    const colorClass = currentColorMode + '-mode';
    document.body.className = mode + ' ' + colorClass;
    if (mode === 'recording' || mode === 'transcribing') {
      document.body.classList.add('active');
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    } else if (mode === 'done' || mode === 'error') {
      hideTimeout = setTimeout(() => { document.body.classList.remove('active'); }, 1500);
    } else if (mode === 'idle') {
      document.body.classList.remove('active');
      expandedMode = null; expandedData = null;
      document.body.classList.remove('expanded');
      const bars = document.querySelectorAll('.bar');
      bars.forEach((bar) => { bar.style.transform = 'scaleY(0.15)'; });
    }
  });

  ipcRenderer.on('capsule:update-bars', (_e, data) => {
    if (expandedMode) return;
    const bars = document.querySelectorAll('.bar');
    if (bars.length === 0) return;
    bars.forEach((bar, i) => {
      const raw = data[i] !== undefined ? data[i] : 0;
      const scale = Math.max(0.15, Math.min(1, raw));
      bar.style.transform = 'scaleY(' + scale + ')';
    });
  });

  ipcRenderer.on('capsule:show-snippet', (_e, data) => {
    const { trigger } = data || {};
    expandedMode = 'snippet'; expandedData = data;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn = document.getElementById('skipBtn');
    if (textEl) textEl.textContent = trigger ? \`Insert '\${trigger}'?\` : 'Insert snippet?';
    if (acceptBtn) acceptBtn.textContent = 'Insert';
    if (skipBtn) skipBtn.textContent = 'Skip';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:show-dictionary', (_e, data) => {
    const { word, correction } = data || {};
    expandedMode = 'dictionary'; expandedData = data;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn = document.getElementById('skipBtn');
    if (textEl) textEl.textContent = (word && correction) ? \`'\${word}' → '\${correction}'?\` : 'Add to dictionary?';
    if (acceptBtn) acceptBtn.textContent = 'Add';
    if (skipBtn) skipBtn.textContent = 'Skip';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:show-edit', () => {
    expandedMode = 'edit'; expandedData = null;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn = document.getElementById('skipBtn');
    if (textEl) textEl.textContent = 'Edit the latest dictation?';
    if (acceptBtn) acceptBtn.textContent = 'Edit';
    if (skipBtn) skipBtn.textContent = 'Close';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:hide-expanded', () => {
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded');
    hideTimeout = setTimeout(() => { document.body.classList.remove('active'); }, 300);
  });

  const acceptBtn = document.getElementById('acceptBtn');
  const skipBtn = document.getElementById('skipBtn');
  if (acceptBtn) acceptBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const ch = expandedMode === 'snippet'
      ? 'capsule:snippet-response'
      : expandedMode === 'edit'
      ? 'capsule:edit-last'
      : 'capsule:dictionary-response';
    ipcRenderer.send(ch, { accepted: true, data: expandedData });
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded', 'active');
  });
  if (skipBtn) skipBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const ch = expandedMode === 'snippet'
      ? 'capsule:snippet-response'
      : expandedMode === 'edit'
      ? 'capsule:edit-dismiss'
      : 'capsule:dictionary-response';
    ipcRenderer.send(ch, { accepted: false, data: expandedData });
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded', 'active');
  });

  ipcRenderer.send('capsule:ready');
} catch (e) { console.error('[capsule]', e); }`;
  }

  private buildBarHtml(): string {
    const acc = this.accentColor;
    const bars9 = Array.from({ length: 9 }, (_, i) => `<div class="bar" id="b${i}"></div>`).join("");
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:transparent; overflow:hidden; -webkit-font-smoothing:antialiased; }
:root { --accent: ${acc}; }
body {
  --bg: #FAF8FF; --text: #1A0F2E; --text2: #9B8DB5;
  --skip: rgba(26,15,46,0.08);
}
body.dark-mode {
  --bg: #0C0C0E; --text: #F0E8FF; --text2: #9B8DB5;
  --skip: rgba(240,232,255,0.08);
}

.capsule {
  position: fixed; bottom: 0; left: 50%;
  width: 256px; height: 44px;
  border: 2px solid var(--accent);
  background: var(--bg);
  display: flex; align-items: stretch;
  transform: translateX(-50%) translateY(48px);
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.4,0.64,1);
}
body.active .capsule {
  opacity: 1; transform: translateX(-50%) translateY(0);
}
body.expanded .capsule {
  height: 124px; align-items: flex-start;
}

.status-col {
  width: 50px; flex-shrink: 0;
  border-right: 2px solid var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.status-lbl {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--accent);
}
.wave-col {
  flex: 1; display: flex; align-items: center; justify-content: center;
  gap: 2.5px; padding: 0 10px;
  position: relative;
}

.bar {
  width: 3px; height: 20px;
  background: var(--accent);
  transform: scaleY(0.08);
  transform-origin: center;
  transition: transform 55ms ease-out;
  flex-shrink: 0;
}
body:not(.recording) .bar { transform: scaleY(0.08); }

.dots {
  position: absolute; display: none;
  align-items: center; gap: 4px;
}
body.transcribing .dots { display: flex; }
body.transcribing .bar { opacity: 0; }
.dot {
  width: 4px; height: 4px;
  background: var(--accent);
  animation: bdot 1s ease-in-out infinite;
}
.dot:nth-child(2) { animation-delay: 0.16s; }
.dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes bdot {
  0%,80%,100% { transform: scaleY(1); opacity: 0.3; }
  40% { transform: scaleY(2.2); opacity: 1; }
}

.check {
  position: absolute; display: none;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 13px; font-weight: 900; color: var(--accent);
}
body.done .check { display: block; }
body.done .bar, body.done .dots { display: none; opacity: 0; }
body.done .capsule { animation: flash 180ms ease; }
@keyframes flash {
  0%  { border-color: var(--accent); }
  50% { border-color: transparent; }
  100%{ border-color: var(--accent); }
}

.expanded-content {
  display: none; flex-direction: column; align-items: center;
  justify-content: center; gap: 10px; width: 100%;
  padding: 14px 16px;
}
body.expanded .expanded-content { display: flex; }
body.expanded .wave-col { display: none; }
body.expanded .status-col { border-right: none; width: 0; overflow: hidden; padding: 0; display: none; }

.prompt-text {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 12px; font-weight: 500; color: var(--text);
  text-align: center; line-height: 1.45; max-width: 220px;
}
.prompt-btns { display: flex; gap: 6px; }
.prompt-btn {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.10em;
  text-transform: uppercase; cursor: pointer;
  border: 2px solid var(--accent); padding: 5px 14px;
  transition: opacity 0.1s;
}
.prompt-btn:hover { opacity: 0.8; }
.prompt-btn.accept { background: var(--accent); color: #fff; }
.prompt-btn.skip { background: transparent; color: var(--accent); }
</style></head>
<body class="idle ${this.colorMode}-mode">
<div class="capsule">
  <div class="status-col"><span class="status-lbl" id="statusLbl"></span></div>
  <div class="wave-col">
    ${bars9}
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <span class="check">&#10003;</span>
  </div>
  <div class="expanded-content">
    <p class="prompt-text" id="expandedText"></p>
    <div class="prompt-btns">
      <button class="prompt-btn accept" id="acceptBtn">Add</button>
      <button class="prompt-btn skip" id="skipBtn">Skip</button>
    </div>
  </div>
</div>
<script>${this.buildScript()}</script>
</body></html>`;
  }

  private buildDotHtml(): string {
    const acc = this.accentColor;
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:transparent; overflow:hidden; -webkit-font-smoothing:antialiased; }
:root { --accent: ${acc}; }
body { --bg: #FAF8FF; --text: #1A0F2E; }
body.dark-mode { --bg: #0C0C0E; --text: #F0E8FF; }

.capsule {
  position: fixed; bottom: 0; left: 50%;
  width: 48px; height: 48px;
  border: 2px solid var(--accent);
  background: var(--bg);
  display: flex; align-items: center; justify-content: center;
  transform: translateX(-50%) translateY(60px);
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.4,0.64,1),
              width 280ms cubic-bezier(0.34,1.4,0.64,1), height 280ms cubic-bezier(0.34,1.4,0.64,1);
}
body.active .capsule {
  opacity: 1; transform: translateX(-50%) translateY(0);
}
body.expanded .capsule {
  width: 256px; height: 124px;
}

.dot-indicator {
  width: 14px; height: 14px;
  background: var(--accent);
  display: none;
}
body.recording .dot-indicator {
  display: block;
  animation: dotpulse 1.2s ease-in-out infinite;
}
@keyframes dotpulse {
  0%,100% { transform: scale(1); }
  50% { transform: scale(1.35); }
}

.dots { display: none; align-items: center; gap: 4px; }
body.transcribing .dots { display: flex; }
.dot { width: 4px; height: 4px; background: var(--accent);
  animation: bdot 1s ease-in-out infinite; }
.dot:nth-child(2) { animation-delay: 0.16s; }
.dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes bdot {
  0%,80%,100% { opacity: 0.3; transform: scaleY(1); }
  40% { opacity: 1; transform: scaleY(2); }
}

.check { display: none; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 13px; font-weight: 900; color: var(--accent); }
body.done .check { display: block; }

.expanded-content {
  display: none; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; width: 100%; padding: 14px 16px;
}
body.expanded .capsule { flex-direction: column; }
body.expanded .dot-indicator, body.expanded .dots, body.expanded .check { display: none !important; }
body.expanded .expanded-content { display: flex; }

.prompt-text {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 12px; font-weight: 500; color: var(--text);
  text-align: center; line-height: 1.45; max-width: 220px;
}
.prompt-btns { display: flex; gap: 6px; }
.prompt-btn {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.10em;
  text-transform: uppercase; cursor: pointer; border: 2px solid var(--accent);
  padding: 5px 14px; transition: opacity 0.1s;
}
.prompt-btn:hover { opacity: 0.8; }
.prompt-btn.accept { background: var(--accent); color: #fff; }
.prompt-btn.skip { background: transparent; color: var(--accent); }
</style></head>
<body class="idle ${this.colorMode}-mode">
<div class="capsule">
  <div class="dot-indicator"></div>
  <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
  <span class="check">&#10003;</span>
  <div class="expanded-content">
    <p class="prompt-text" id="expandedText"></p>
    <div class="prompt-btns">
      <button class="prompt-btn accept" id="acceptBtn">Add</button>
      <button class="prompt-btn skip" id="skipBtn">Skip</button>
    </div>
  </div>
</div>
<script>${this.buildScript()}</script>
</body></html>`;
  }

  private buildRuleHtml(): string {
    const acc = this.accentColor;
    const bars9 = Array.from({ length: 9 }, (_, i) => `<div class="bar" id="b${i}"></div>`).join("");
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { background:transparent; overflow:hidden; -webkit-font-smoothing:antialiased; }
:root { --accent: ${acc}; }
body { --bg: #FAF8FF; --text: #1A0F2E; --text2: #9B8DB5; }
body.dark-mode { --bg: #0C0C0E; --text: #F0E8FF; }

.capsule {
  position: fixed; bottom: 0; left: 50%;
  width: 256px; height: 24px;
  border: 2px solid var(--accent);
  background: transparent;
  display: flex; align-items: center; gap: 0;
  transform: translateX(-50%) translateY(32px);
  opacity: 0;
  transition: opacity 180ms ease, transform 200ms ease,
              background 200ms ease, height 280ms cubic-bezier(0.34,1.4,0.64,1);
}
body.active .capsule { opacity: 1; transform: translateX(-50%) translateY(0); }
body.recording .capsule { background: var(--accent); }
body.expanded .capsule { height: 124px; flex-direction: column; align-items: flex-start; background: var(--bg); }

.status-lbl {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.9);
  padding: 0 8px;
  flex-shrink: 0;
  opacity: 0;
}
.status-lbl.visible { opacity: 1; }
body.recording .status-lbl { color: rgba(255,255,255,0.9); }
body.transcribing .status-lbl { color: var(--accent); }
body.done .status-lbl { color: var(--accent); }

.wave-col {
  flex: 1; display: flex; align-items: center; justify-content: center;
  gap: 2px; height: 100%;
}
.bar {
  width: 2px; height: 14px;
  background: rgba(255,255,255,0.8);
  transform: scaleY(0.2);
  transform-origin: center;
  transition: transform 55ms ease-out;
}
body:not(.recording) .bar { opacity: 0; }
body.recording .bar { opacity: 1; }

.dots { display: none; align-items: center; gap: 3px; padding-right: 8px; }
body.transcribing .dots { display: flex; }
.dot { width: 3px; height: 3px; background: var(--accent);
  animation: bdot 1s ease-in-out infinite; }
.dot:nth-child(2) { animation-delay: 0.16s; }
.dot:nth-child(3) { animation-delay: 0.32s; }
@keyframes bdot {
  0%,80%,100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.check { display: none; font-size: 11px; font-weight: 900; color: var(--accent);
  padding-right: 8px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
body.done .check { display: block; }

.expanded-content {
  display: none; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; width: 100%; padding: 14px 16px; flex: 1;
}
body.expanded .expanded-content { display: flex; }
body.expanded .wave-col, body.expanded .status-lbl, body.expanded .dots, body.expanded .check { display: none; }

.prompt-text {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 12px; font-weight: 500; color: var(--text);
  text-align: center; line-height: 1.45; max-width: 220px;
}
.prompt-btns { display: flex; gap: 6px; }
.prompt-btn {
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 9px; font-weight: 700; letter-spacing: 0.10em;
  text-transform: uppercase; cursor: pointer; border: 2px solid var(--accent);
  padding: 5px 14px; transition: opacity 0.1s;
}
.prompt-btn:hover { opacity: 0.8; }
.prompt-btn.accept { background: var(--accent); color: #fff; }
.prompt-btn.skip { background: transparent; color: var(--accent); }
</style></head>
<body class="idle ${this.colorMode}-mode">
<div class="capsule">
  <span class="status-lbl" id="statusLbl"></span>
  <div class="wave-col">
    ${bars9}
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <span class="check">&#10003;</span>
  </div>
  <div class="expanded-content">
    <p class="prompt-text" id="expandedText"></p>
    <div class="prompt-btns">
      <button class="prompt-btn accept" id="acceptBtn">Add</button>
      <button class="prompt-btn skip" id="skipBtn">Skip</button>
    </div>
  </div>
</div>
<script>${this.buildScript()}</script>
</body></html>`;
  }

  private buildScript(): string {
    return `
try {
  const { ipcRenderer } = require('electron');
  let hideTimeout = null;
  let expandedMode = null;
  let expandedData = null;
  let currentColorMode = '${this.colorMode}';

  document.body.classList.add(currentColorMode + '-mode');

  const statusLbl = document.getElementById('statusLbl');

  function setStatusLabel(text) {
    if (statusLbl) {
      statusLbl.textContent = text;
      if (text) statusLbl.classList.add('visible');
      else statusLbl.classList.remove('visible');
    }
  }

  function applyStyle({ borderWidth, barRadius, cornerRadius }) {
    const r = document.documentElement;
    if (borderWidth  !== undefined) r.style.setProperty('--bw', borderWidth  + 'px');
    if (barRadius    !== undefined) r.style.setProperty('--br', barRadius    + 'px');
    if (cornerRadius !== undefined) r.style.setProperty('--cr', cornerRadius + 'px');
  }

  ipcRenderer.on('capsule:set-color-mode', (_e, mode) => {
    document.body.classList.remove('light-mode', 'dark-mode');
    currentColorMode = mode;
    document.body.classList.add(mode + '-mode');
  });

  ipcRenderer.on('capsule:set-accent', (_e, color) => {
    document.documentElement.style.setProperty('--accent', color);
  });

  ipcRenderer.on('capsule:set-style', (_e, style) => {
    applyStyle(style);
  });

  ipcRenderer.on('capsule:set-mode', (_e, mode) => {
    if (expandedMode && mode !== 'idle') return;
    const colorClass = currentColorMode + '-mode';
    document.body.className = mode + ' ' + colorClass;
    if (mode === 'recording') {
      setStatusLabel('REC');
      document.body.classList.add('active');
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    } else if (mode === 'transcribing') {
      setStatusLabel('\\u00B7\\u00B7\\u00B7');
      document.body.classList.add('active');
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    } else if (mode === 'done') {
      setStatusLabel('OK');
      hideTimeout = setTimeout(() => { document.body.classList.remove('active'); }, 1500);
    } else if (mode === 'error') {
      setStatusLabel('ERR');
      hideTimeout = setTimeout(() => { document.body.classList.remove('active'); }, 1500);
    } else if (mode === 'idle') {
      setStatusLabel('');
      document.body.classList.remove('active');
      expandedMode = null; expandedData = null;
      document.body.classList.remove('expanded');
      document.querySelectorAll('.bar').forEach((b) => { b.style.transform = 'scaleY(0.08)'; });
    }
  });

  ipcRenderer.on('capsule:update-bars', (_e, data) => {
    if (expandedMode) return;
    const bars = document.querySelectorAll('.bar');
    if (!bars.length) return;
    bars.forEach((bar, i) => {
      const raw = data[i] !== undefined ? data[i] : 0;
      bar.style.transform = 'scaleY(' + Math.max(0.08, Math.min(1, raw)) + ')';
    });
  });

  ipcRenderer.on('capsule:show-snippet', (_e, data) => {
    const { trigger } = data || {};
    expandedMode = 'snippet'; expandedData = data;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn   = document.getElementById('skipBtn');
    if (textEl)    textEl.textContent   = trigger ? \`Insert '\${trigger}'?\` : 'Insert snippet?';
    if (acceptBtn) acceptBtn.textContent = 'Insert';
    if (skipBtn)   skipBtn.textContent   = 'Skip';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:show-dictionary', (_e, data) => {
    const { word, correction } = data || {};
    expandedMode = 'dictionary'; expandedData = data;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn   = document.getElementById('skipBtn');
    if (textEl)    textEl.textContent   = (word && correction) ? \`'\${word}' \\u2192 '\${correction}'?\` : 'Add to dictionary?';
    if (acceptBtn) acceptBtn.textContent = 'Add';
    if (skipBtn)   skipBtn.textContent   = 'Skip';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:show-edit', () => {
    expandedMode = 'edit'; expandedData = null;
    document.body.classList.add('active', 'expanded');
    document.body.classList.remove('recording', 'transcribing');
    const textEl = document.getElementById('expandedText');
    const acceptBtn = document.getElementById('acceptBtn');
    const skipBtn   = document.getElementById('skipBtn');
    if (textEl)    textEl.textContent   = 'Edit the latest dictation?';
    if (acceptBtn) acceptBtn.textContent = 'Edit';
    if (skipBtn)   skipBtn.textContent   = 'Close';
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });

  ipcRenderer.on('capsule:hide-expanded', () => {
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded');
    hideTimeout = setTimeout(() => { document.body.classList.remove('active'); }, 300);
  });

  const acceptBtn = document.getElementById('acceptBtn');
  const skipBtn   = document.getElementById('skipBtn');

  if (acceptBtn) acceptBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const ch = expandedMode === 'snippet' ? 'capsule:snippet-response'
             : expandedMode === 'edit'    ? 'capsule:edit-last'
             :                              'capsule:dictionary-response';
    ipcRenderer.send(ch, { accepted: true, data: expandedData });
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded', 'active');
  });

  if (skipBtn) skipBtn.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const ch = expandedMode === 'snippet' ? 'capsule:snippet-response'
             : expandedMode === 'edit'    ? 'capsule:edit-dismiss'
             :                              'capsule:dictionary-response';
    ipcRenderer.send(ch, { accepted: false, data: expandedData });
    expandedMode = null; expandedData = null;
    document.body.classList.remove('expanded', 'active');
  });

  ipcRenderer.send('capsule:ready');
} catch (e) { console.error('[capsule]', e); }`;
  }
}
