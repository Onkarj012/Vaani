import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SettingsSectionId =
  | "general"
  | "permissions"
  | "api"
  | "language"
  | "dictation"
  | "hotkey"
  | "injection"
  | "appearance"
  | "data";
type SettingsPanelValue = {
  isOpen: boolean;
  section: SettingsSectionId;
  open: (section?: SettingsSectionId) => void;
  close: () => void;
  setSection: (section: SettingsSectionId) => void;
};
const SettingsPanelContext = createContext<SettingsPanelValue | null>(null);

// Provides shared settings panel navigation state.
export function SettingsPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSection] = useState<SettingsSectionId>("general");
  const value = useMemo(
    () => ({
      isOpen,
      section,
      open: (next: SettingsSectionId = "general") => {
        setSection(next);
        setIsOpen(true);
      },
      close: () => setIsOpen(false),
      setSection,
    }),
    [isOpen, section],
  );
  return (
    <SettingsPanelContext.Provider value={value}>
      {children}
    </SettingsPanelContext.Provider>
  );
}

// Reads the current settings panel controls.
export function useSettingsPanel(): SettingsPanelValue {
  const value = useContext(SettingsPanelContext);
  if (!value)
    throw new Error(
      "useSettingsPanel must be used within SettingsPanelProvider",
    );
  return value;
}
