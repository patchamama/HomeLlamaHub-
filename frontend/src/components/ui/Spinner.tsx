interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'w-3.5 h-3.5 border-[1.5px]',
  md: 'w-5 h-5 border-2',
  lg: 'w-8 h-8 border-2',
}

export default function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div
      role="status"
      className={[
        'inline-block rounded-full border-violet-500 border-t-transparent animate-spin',
        sizeClasses[size],
        className,
      ].join(' ')}
      aria-label="Loading"
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-xs text-gray-500 tracking-widest uppercase">Loading</p>
      </div>
    </div>
  )
}
