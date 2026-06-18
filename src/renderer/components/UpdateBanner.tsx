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
      toneClass = "bg-surface text-muted";
      break;
    case "available":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "bg-accent/10 text-accent";
      break;
    case "downloading":
      icon = <Download size={15} />;
      toneClass = "bg-accent/10 text-accent";
      break;
    case "ready":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "bg-accent/10 text-accent";
      break;
    case "no-update":
      icon = <ArrowUpCircle size={15} />;
      toneClass = "bg-accent/10 text-accent";
      break;
    case "error":
      icon = <X size={15} />;
      toneClass = "bg-red-50 text-red-600";
      break;
    default:
      icon = null;
      toneClass = "bg-surface text-muted";
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: -12, height: 0 }}
        className="mx-6 mt-4 lg:mx-12"
      >
        <div className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm ${toneClass}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {icon}
            <span className="truncate font-medium">{message}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canInstall && (
              <button
                onClick={() => window.vaani.quitAndInstall()}
                className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg transition-opacity hover:opacity-90"
              >
                Restart
              </button>
            )}
            {canDownload && (
              <button
                onClick={() => window.vaani.openReleasesPage()}
                className="flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg transition-opacity hover:opacity-90"
              >
                <Download size={13} />
                Download
              </button>
            )}
            {isDismissable && (
              <button onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-1 transition-colors hover:bg-ink/10">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
