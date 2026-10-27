import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw, X, ArrowUpCircle } from "lucide-react";
import type { UpdateNotificationPayload } from "@shared/types";

interface UpdateBannerProps {
  notification: UpdateNotificationPayload;
  onDismiss: () => void;
}

export default function UpdateBanner({ notification, onDismiss }: UpdateBannerProps) {
  const { status, version, message } = notification;
  const isDismissable = status === "no-update" || status === "error" || status === "available";
  const canInstall = status === "ready" && version && notification.installable !== false;
  const canDownload = status === "available";

  let icon: React.ReactNode;
  let toneClass: string;

  switch (status) {
    case "checking":
      icon = <RefreshCw size={15} className="animate-spin-ui" />;
      toneClass = "border-line bg-surface text-muted";
      break;
    case "available":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "border-accent/20 bg-accent/[0.07] text-ink [&>div>svg]:text-accent";
      break;
    case "downloading":
      icon = <Download size={15} />;
      toneClass = "border-accent/20 bg-accent/[0.07] text-ink [&>div>svg]:text-accent";
      break;
    case "ready":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "border-accent/20 bg-accent/[0.07] text-ink [&>div>svg]:text-accent";
      break;
    case "no-update":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "border-accent/20 bg-accent/[0.07] text-ink [&>div>svg]:text-accent";
      break;
    case "error":
      icon = <X size={15} />;
      toneClass = "border-red-500/20 bg-red-500/[0.06] text-red-600 dark:text-red-400";
      break;
    default:
      icon = null;
      toneClass = "border-line bg-surface text-muted";
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: -12, height: 0 }}
        className="mx-6 mt-3 md:mx-10"
      >
        <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-[13px] ${toneClass}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {icon}
            <span className="truncate font-medium">{message}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canInstall && (
              <button
                onClick={() => window.vaani.quitAndInstall()}
                className="accent-sheen rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-all hover:brightness-105"
              >
                Restart
              </button>
            )}
            {canDownload && (
              <button
                onClick={() => window.vaani.openReleasesPage()}
                className="accent-sheen flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-all hover:brightness-105"
              >
                <Download size={13} />
                Download
              </button>
            )}
            {isDismissable && (
              <button onClick={onDismiss} aria-label="Dismiss" className="rounded-md p-1 text-muted transition-colors hover:bg-ink/5 hover:text-ink">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
