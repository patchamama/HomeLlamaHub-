import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { Settings } from '../../lib/types'
import Button from '../../components/ui/Button'
import Alert from '../../components/ui/Alert'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [form, setForm] = useState<Partial<Settings>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    api.getSettings()
      .then((data) => {
        setSettings(data)
        setForm(data)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      const updated = await api.updateSettings(form)
      setSettings(updated)
      setForm(updated)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mt-12" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">Settings</h1>
        <p className="text-xs text-gray-500 mt-1">Global gateway configuration</p>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}
      {success && <Alert type="success" message="Settings saved." className="mb-4" />}

      <div className="hlh-card p-6 space-y-6">
        <div>
          <label className="hlh-label">Max Concurrent Requests</label>
          <input
            type="number"
            min={1}
            max={100}
            className="hlh-input w-full"
            value={form.max_concurrent_requests ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, max_concurrent_requests: Number(e.target.value) }))}
          />
          <p className="text-[10px] text-gray-600 mt-1">Max parallel inference jobs across all hosts</p>
        </div>

        <div>
          <label className="hlh-label">Request Timeout (seconds)</label>
          <input
            type="number"
            min={10}
            max={600}
            className="hlh-input w-full"
            value={form.request_timeout_seconds ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, request_timeout_seconds: Number(e.target.value) }))}
          />
          <p className="text-[10px] text-gray-600 mt-1">Hard timeout per inference request</p>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-gray-300">Allow Registration</p>
            <p className="text-[10px] text-gray-600">Let new users create accounts</p>
          </div>
          <button
            onClick={() => setForm((p) => ({ ...p, allow_registration: !p.allow_registration }))}
            className={[
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              form.allow_registration ? 'bg-violet-600' : 'bg-[#30363d]',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                form.allow_registration ? 'translate-x-4' : 'translate-x-0.5',
              ].join(' ')}
            />
          </button>
        </div>

        {settings?.updated_at && (
          <p className="text-[10px] text-gray-600">
            Last updated: {new Date(settings.updated_at).toLocaleString()}
          </p>
        )}

        <Button onClick={handleSave} loading={saving} className="w-full">
          Save Settings
        </Button>
      </div>
    </div>
  )
}
