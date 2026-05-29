import React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
}

const paddingClasses = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

export default function Card({ children, className = '', padding = 'md', hover = false }: CardProps) {
  return (
    <div
      className={[
        'hlh-card',
        paddingClasses[padding],
        hover ? 'hover:border-[#484f58] transition-colors cursor-pointer' : '',
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string | number
  icon?: React.ReactNode
  color?: 'default' | 'green' | 'red' | 'blue' | 'yellow' | 'purple'
  sub?: string
}

const statColorClasses = {
  default: 'text-gray-100',
  green:   'text-emerald-400',
  red:     'text-red-400',
  blue:    'text-blue-400',
  yellow:  'text-amber-400',
  purple:  'text-violet-400',
}

const statBgClasses = {
  default: 'bg-[#21262d]',
  green:   'bg-emerald-900/30',
  red:     'bg-red-900/30',
  blue:    'bg-blue-900/30',
  yellow:  'bg-amber-900/30',
  purple:  'bg-violet-900/30',
}

export function StatCard({ label, value, icon, color = 'default', sub }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-widest mb-2">{label}</p>
          <p className={`text-3xl font-bold font-display tracking-tight ${statColorClasses[color]}`}>
            {value}
          </p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2.5 rounded-lg ${statBgClasses[color]}`}>
            <span className={statColorClasses[color]}>{icon}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
