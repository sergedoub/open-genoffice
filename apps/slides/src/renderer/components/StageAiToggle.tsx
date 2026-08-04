import type { ReactNode } from 'react'

interface StageAiToggleProps {
  active: boolean
  icon: ReactNode
  onClick: () => void
  title: string
}

/** Icon-only AI toggle used by the floating stage rail. */
export function StageAiToggle({ active, icon, onClick, title }: StageAiToggleProps) {
  return (
    <button
      className={`stage-ai-btn${active ? ' active' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}
