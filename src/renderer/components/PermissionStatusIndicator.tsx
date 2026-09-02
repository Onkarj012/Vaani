import { CheckCircle2, ExternalLink, Keyboard, Loader2, Mic, ShieldCheck } from 'lucide-react'
import type { MacOSPermissionState, PermissionStatus } from '@shared/types'
import { getPermissionStatusIndicator, getPermissionStatusLabel } from '@shared/permissionGuard'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import { Tag } from '@renderer/components/ui/tag'

type PermissionKey = keyof PermissionStatus

interface PermissionStatusIndicatorProps {
  status: PermissionStatus
  busyPermission: PermissionKey | null
  onPermissionAction: (permission: PermissionKey) => void
}

const permissionDetails: Array<{
  key: PermissionKey
  title: string
  icon: typeof Mic
}> = [
  { key: 'microphone', title: 'Microphone', icon: Mic },
  { key: 'accessibility', title: 'Accessibility', icon: Keyboard },
]

function needsAction(state: MacOSPermissionState): boolean {
  return state !== 'granted'
}

export default function PermissionStatusIndicator({
  status,
  busyPermission,
  onPermissionAction,
}: PermissionStatusIndicatorProps) {
  const summary = getPermissionStatusIndicator(status)

  return (
    <Card tone={summary.allGranted ? 'mint' : 'peach'} bordered>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <ShieldCheck size={19} />
          </div>
          <div>
            <h2 className="text-display text-xl text-ink">Permissions</h2>
            <p className="mt-1 text-sm text-muted">{summary.description}</p>
          </div>
        </div>
        <Tag tone={summary.allGranted ? 'mint' : 'peach'}>
          {summary.allGranted ? <CheckCircle2 size={13} /> : null}
          {summary.label}
        </Tag>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {permissionDetails.map(({ key, title, icon: Icon }) => {
          const state = status[key]
          const granted = state === 'granted'
          const busy = busyPermission === key
          return (
            <div key={key} className="flex items-center gap-3 rounded-2xl bg-bg/60 px-4 py-3">
              <Icon size={16} className={granted ? 'text-accent' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{title}</div>
                <div className={`text-xs ${granted ? 'text-accent' : 'text-muted'}`}>
                  {getPermissionStatusLabel(state)}
                </div>
              </div>
              {needsAction(state) && (
                <Button
                  variant="soft"
                  size="sm"
                  onClick={() => onPermissionAction(key)}
                  disabled={busyPermission !== null}
                >
                  {busy ? <Loader2 size={14} className="animate-spin-ui" /> : <ExternalLink size={14} />}
                  {state === 'not-determined' ? 'Enable' : 'Settings'}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
