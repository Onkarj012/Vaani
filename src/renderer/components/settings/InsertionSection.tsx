import type { Settings } from "@shared/types";
import { Segmented } from "@renderer/components/ui/Segmented";
import {
  Group,
  OptionCards,
  Row,
  type SectionComponentProps,
} from "./SettingsRows";

// Renders the text insertion and paste options.
export default function InsertionSection({
  context: c,
}: SectionComponentProps) {
  return (
    <Group title="Insertion">
      <Row wide title="Insert method">
        <OptionCards
          value={c.settings.injectionMode}
          options={[
            {
              value: "auto",
              label: "Auto",
              description: "Picks the best method for the active app.",
            },
            {
              value: "ax",
              label: "Accessibility API",
              description: "Types text through macOS accessibility.",
            },
            {
              value: "clipboard",
              label: "Copy only",
              description: "Copies text so you paste it yourself.",
            },
          ]}
          onChange={(value) => void c.updateSettings({ injectionMode: value })}
        />
      </Row>
      <Row
        title="Paste mode"
        description="Animated types word by word. Instant pastes in one go."
      >
        <Segmented
          value={c.settings.pasteMode}
          options={[
            { value: "animated", label: "Animated" },
            { value: "instant", label: "Instant" },
          ]}
          onChange={(value) =>
            void c.updateSettings({ pasteMode: value as Settings["pasteMode"] })
          }
        />
      </Row>
    </Group>
  );
}
