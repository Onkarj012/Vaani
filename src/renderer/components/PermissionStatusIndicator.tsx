import { CheckCircle2, ExternalLink, Keyboard, Loader2, Mic, ShieldCheck } from 'lucide-react'
import type { MacOSPermissionState, PermissionStatus } from '@shared/types'
import { getPermissionStatusIndicator, getPermissionStatusLabel } from '@shared/permissionGuard'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import { Tag } from '@renderer/components/ui/tag'
import { IconTile } from '@renderer/components/ui/icon-tile'

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
    <Card tone={summary.allGranted ? 'white' : 'warning'} className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <IconTile tone={summary.allGranted ? 'success' : 'warning'}>
            <ShieldCheck size={18} />
          </IconTile>
          <div>
            <h2 className="type-title text-ink">Permissions</h2>
            <p className="mt-0.5 text-[13px] text-muted">{summary.description}</p>
          </div>
        </div>
        <Tag tone={summary.allGranted ? 'success' : 'warning'}>
          {summary.allGranted ? <CheckCircle2 size={12} /> : null}
          {summary.label}
        </Tag>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {permissionDetails.map(({ key, title, icon: Icon }) => {
          const state = status[key]
          const granted = state === 'granted'
          const busy = busyPermission === key
          return (
            <div key={key} className="flex items-center gap-3 rounded-xl border border-line bg-bg/60 px-3.5 py-2.5">
              <Icon size={15} className={granted ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">{title}</div>
                <div className={`text-xs ${granted ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'}`}>
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
