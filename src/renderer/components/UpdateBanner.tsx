import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw, X, ArrowUpCircle } from "lucide-react";
import type { UpdateNotificationPayload } from "@shared/types";

interface UpdateBannerProps {
  notification: UpdateNotificationPayload;
  onDismiss: () => void;
}

export default function UpdateBanner({ notification, onDismiss }: UpdateBannerProps) {
  const { status, version, message } = notification;
  const isDismissable = status === "no-update" || status === "error";

  let icon: React.ReactNode;
  let bgClass: string;
  let textClass: string;

  switch (status) {
    case "checking":
      icon = <RefreshCw size={16} className="animate-spin" />;
      bgClass = "bg-vaani-gray-100 dark:bg-vaani-gray-800 border-vaani-gray-200 dark:border-vaani-gray-700";
      textClass = "text-vaani-gray-600 dark:text-vaani-gray-300";
      break;
    case "downloading":
      icon = <Download size={16} className="animate-bounce" />;
      bgClass = "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
      textClass = "text-blue-700 dark:text-blue-300";
      break;
    case "ready":
      icon = <ArrowUpCircle size={16} />;
      bgClass = "bg-vaani-pink/10 border-vaani-pink/30";
      textClass = "text-vaani-pink";
      break;
    case "no-update":
      icon = <ArrowUpCircle size={16} />;
      bgClass = "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
      textClass = "text-green-700 dark:text-green-300";
      break;
    case "error":
      icon = <X size={16} />;
      bgClass = "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
      textClass = "text-red-700 dark:text-red-300";
      break;
    default:
      icon = null;
      bgClass = "bg-vaani-gray-100 dark:bg-vaani-gray-800 border-vaani-gray-200 dark:border-vaani-gray-700";
      textClass = "text-vaani-gray-600 dark:text-vaani-gray-300";
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, height: 0 }}
        animate={{ opacity: 1, y: 0, height: "auto" }}
        exit={{ opacity: 0, y: -12, height: 0 }}
        className="mx-6 lg:mx-8"
      >
        <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border ${bgClass} ${textClass} text-sm`}>
          <div className="flex items-center gap-2.5 min-w-0">
            {icon}
            <span className="truncate">{message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {status === "ready" && version && (
              <button
                onClick={() => window.vaani.quitAndInstall()}
                className="px-3 py-1 bg-vaani-pink text-white rounded-lg text-xs font-medium hover:bg-vaani-pink/90 transition-colors"
              >
                Restart
              </button>
            )}
            {isDismissable && (
              <button
                onClick={onDismiss}
                aria-label="Dismiss update notification"
                className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
