import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export default function Input({ label, error, hint, className = '', id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="hlh-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        className={[
          'hlh-input w-full',
          error ? 'border-red-500/60 focus:ring-red-500/50 focus:border-red-500' : '',
          className,
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-red-400 mt-0.5">{error}</p>
      )}
      {hint && !error && (
        <p className="text-xs text-gray-500 mt-0.5">{hint}</p>
      )}
    </div>
  )
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ label, error, className = '', id, ...props }: TextareaProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="hlh-label">
          {label}
        </label>
      )}
      <textarea
        id={inputId}
        {...props}
        className={[
          'hlh-input w-full resize-none',
          error ? 'border-red-500/60 focus:ring-red-500/50 focus:border-red-500' : '',
          className,
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-red-400 mt-0.5">{error}</p>
      )}
    </div>
  )
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export function Select({ label, error, options, className = '', id, ...props }: SelectProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="hlh-label">
          {label}
        </label>
      )}
      <select
        id={inputId}
        {...props}
        className={[
          'hlh-input w-full appearance-none cursor-pointer',
          error ? 'border-red-500/60' : '',
          className,
        ].join(' ')}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#161b22]">
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-xs text-red-400 mt-0.5">{error}</p>
      )}
    </div>
  )
}
