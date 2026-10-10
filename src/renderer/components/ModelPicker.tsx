import { Select } from '@renderer/components/ui/Select'
import { KNOWN_PROVIDERS } from '@shared/defaults'
import { formatModelPrice, modelEntries, modelOptionValue, pickerEntries, type ModelRole } from '@shared/modelList'

// One picker per role. Each option shows the model, its provider, and its price.
export function ModelPicker({ role, provider, modelId, onChange }: {
  role: ModelRole
  provider: string
  modelId: string
  onChange: (provider: string, modelId: string) => void
}) {
  const offered = pickerEntries(role)
  const current = modelEntries(role).find((entry) => entry.provider === provider && entry.modelId === modelId)
  // A saved hidden fallback is still shown as the current choice, never as a raw ID.
  const choices = current && !offered.includes(current) ? [...offered, current] : offered
  const options = choices.map((entry) => {
    const providerName = KNOWN_PROVIDERS.find((p) => p.id === entry.provider)?.name ?? entry.provider
    return {
      value: modelOptionValue(entry.provider, entry.modelId),
      label: `${entry.displayName} · ${providerName} · ${formatModelPrice(entry.price)}`,
    }
  })

  return (
    <Select
      value={modelOptionValue(provider, modelId)}
      onChange={(value) => {
        const entry = choices.find((candidate) => modelOptionValue(candidate.provider, candidate.modelId) === value)
        if (entry) onChange(entry.provider, entry.modelId)
      }}
      options={options}
    />
  )
}
