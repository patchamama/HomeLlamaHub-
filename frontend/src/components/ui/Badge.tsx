type BadgeColor = 'green' | 'red' | 'blue' | 'gray' | 'yellow' | 'purple' | 'cyan'

interface BadgeProps {
  color?: BadgeColor
  children: React.ReactNode
  dot?: boolean
  className?: string
}

const colorClasses: Record<BadgeColor, string> = {
  green:  'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40',
  red:    'bg-red-900/40 text-red-400 border border-red-700/40',
  blue:   'bg-blue-900/40 text-blue-400 border border-blue-700/40',
  gray:   'bg-[#21262d] text-gray-400 border border-[#30363d]',
  yellow: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
  purple: 'bg-violet-900/40 text-violet-400 border border-violet-700/40',
  cyan:   'bg-cyan-900/40 text-cyan-400 border border-cyan-700/40',
}

const dotColors: Record<BadgeColor, string> = {
  green:  'bg-emerald-400',
  red:    'bg-red-400',
  blue:   'bg-blue-400',
  gray:   'bg-gray-400',
  yellow: 'bg-amber-400',
  purple: 'bg-violet-400',
  cyan:   'bg-cyan-400',
}

export default function Badge({ color = 'gray', children, dot = false, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium tracking-wide',
        colorClasses[color],
        className,
      ].join(' ')}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotColors[color]}`} />
      )}
      {children}
    </span>
  )
}
