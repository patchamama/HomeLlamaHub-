import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { Host, CreateHostRequest, HostTestResult } from '../../lib/types'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import Alert from '../../components/ui/Alert'
import Input from '../../components/ui/Input'

const emptyForm: CreateHostRequest = {
  name: '',
  base_url: '',
  mac_address: null,
  requires_wol: false,
  is_active: true,
}

const statusColor: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
  online: 'green',
  offline: 'red',
  waking: 'yellow',
  unknown: 'gray',
}

export default function HostsPage() {
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editHost, setEditHost] = useState<Host | null>(null)
  const [form, setForm] = useState<CreateHostRequest>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [testResult, setTestResult] = useState<{ id: number; result: HostTestResult } | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [waking, setWaking] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    try {
      const data = await api.listHosts()
      setHosts(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load hosts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditHost(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(host: Host) {
    setEditHost(host)
    setForm({
      name: host.name,
      base_url: host.base_url,
      mac_address: host.mac_address,
      requires_wol: host.requires_wol,
      is_active: host.is_active,
    })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    setFormError('')
    try {
      if (editHost) {
        await api.updateHost(editHost.id, form)
      } else {
        await api.createHost(form)
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save host')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteHost(id)
      setHosts((prev) => prev.filter((h) => h.id !== id))
    } catch {
      // ignore
    }
  }

  async function handleTest(id: number) {
    setTesting(id)
    setTestResult(null)
    try {
      const result = await api.testHost(id)
      setTestResult({ id, result })
    } catch {
      // ignore
    } finally {
      setTesting(null)
    }
  }

  async function handleWake(id: number) {
    setWaking(id)
    try {
      await api.wakeHost(id)
    } catch {
      // ignore
    } finally {
      setWaking(null)
    }
  }

  async function handleRefreshModels() {
    setRefreshing(true)
    try {
      await api.refreshAllModels()
      await load()
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">Hosts</h1>
          <p className="text-xs text-gray-500 mt-1">Manage Ollama nodes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" loading={refreshing} onClick={handleRefreshModels}>
            Refresh Models
          </Button>
          <Button onClick={openCreate}>Add Host</Button>
        </div>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}

      {loading ? (
        <div className="hlh-card p-8 flex justify-center">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : hosts.length === 0 ? (
        <div className="hlh-card p-8 text-center">
          <p className="text-sm text-gray-500">No hosts configured. Add one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {hosts.map((host) => (
            <div key={host.id} className="hlh-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`status-dot ${host.status}`} />
                    <h3 className="text-sm font-semibold text-gray-100">{host.name}</h3>
                    <Badge color={statusColor[host.status] ?? 'gray'}>{host.status}</Badge>
                    {!host.is_active && <Badge color="red">Disabled</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 font-mono">{host.base_url}</p>
                  {host.mac_address && (
                    <p className="text-xs text-gray-600 mt-1">MAC: {host.mac_address}</p>
                  )}
                  {host.models.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {host.models.slice(0, 6).map((m) => (
                        <span key={m} className="px-1.5 py-0.5 rounded bg-[#21262d] text-[10px] text-gray-400 font-mono border border-[#30363d]">
                          {m}
                        </span>
                      ))}
                      {host.models.length > 6 && (
                        <span className="text-[10px] text-gray-600">+{host.models.length - 6} more</span>
                      )}
                    </div>
                  )}
                  {testResult?.id === host.id && (
                    <div className={`mt-2 text-xs ${testResult.result.reachable ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.result.reachable
                        ? `Reachable — ${testResult.result.latency_ms}ms, ${testResult.result.models_count} models`
                        : `Unreachable — ${testResult.result.error}`}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm" loading={testing === host.id} onClick={() => handleTest(host.id)}>
                    Test
                  </Button>
                  {host.requires_wol && (
                    <Button variant="secondary" size="sm" loading={waking === host.id} onClick={() => handleWake(host.id)}>
                      Wake
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => openEdit(host)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(host.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editHost ? 'Edit Host' : 'Add Host'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleSave}>{editHost ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert type="error" message={formError} />}

          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Mac Mini M1"
          />
          <Input
            label="Base URL"
            value={form.base_url}
            onChange={(e) => setForm((p) => ({ ...p, base_url: e.target.value }))}
            placeholder="http://192.168.1.10:11434"
          />
          <Input
            label="MAC Address"
            value={form.mac_address ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, mac_address: e.target.value || null }))}
            placeholder="AA:BB:CC:DD:EE:FF (optional)"
          />

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.requires_wol}
              onChange={(e) => setForm((p) => ({ ...p, requires_wol: e.target.checked }))}
              className="accent-violet-500"
            />
            <span className="text-sm text-gray-300">Requires Wake-on-LAN</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
              className="accent-violet-500"
            />
            <span className="text-sm text-gray-300">Active</span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
