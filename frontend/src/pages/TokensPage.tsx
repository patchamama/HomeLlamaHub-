import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { ApiToken, ApiTokenCreated, CreateTokenRequest, TokenScope } from '../lib/types'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Alert from '../components/ui/Alert'
import Input from '../components/ui/Input'

const SCOPES: { value: TokenScope; label: string; description: string }[] = [
  { value: 'inference', label: 'Inference', description: 'Run completions and chat' },
  { value: 'read_models', label: 'Read Models', description: 'List available models' },
]

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<ApiTokenCreated | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [form, setForm] = useState<{ name: string; scopes: TokenScope[]; expires_in_days: string }>({
    name: '', scopes: ['inference'], expires_in_days: '90',
  })

  const [revoking, setRevoking] = useState<number | null>(null)

  async function load() {
    try {
      const data = await api.listTokens()
      setTokens(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load tokens')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate() {
    setCreating(true)
    setCreateError('')
    try {
      const req: CreateTokenRequest = {
        name: form.name.trim(),
        scopes: form.scopes,
        expires_in_days: form.expires_in_days ? Number(form.expires_in_days) : null,
      }
      const created = await api.createToken(req)
      setCreatedToken(created)
      await load()
      setForm({ name: '', scopes: ['inference'], expires_in_days: '90' })
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: number) {
    setRevoking(id)
    try {
      await api.revokeToken(id)
      setTokens((prev) => prev.filter((t) => t.id !== id))
    } catch {
      // silently ignore
    } finally {
      setRevoking(null)
    }
  }

  function toggleScope(scope: TokenScope) {
    setForm((prev) => ({
      ...prev,
      scopes: prev.scopes.includes(scope)
        ? prev.scopes.filter((s) => s !== scope)
        : [...prev.scopes, scope],
    }))
  }

  const columns = [
    {
      key: 'name',
      header: 'Name',
      render: (t: ApiToken) => (
        <div>
          <p className="text-sm text-gray-200 font-medium">{t.name}</p>
          <p className="text-xs text-gray-600 font-mono">{t.prefix}…</p>
        </div>
      ),
    },
    {
      key: 'scopes',
      header: 'Scopes',
      render: (t: ApiToken) => (
        <div className="flex flex-wrap gap-1">
          {t.scopes.map((s) => (
            <Badge key={s} color="purple">{s}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t: ApiToken) => (
        <Badge color={t.is_active ? 'green' : 'red'} dot>
          {t.is_active ? 'Active' : 'Revoked'}
        </Badge>
      ),
    },
    {
      key: 'expires_at',
      header: 'Expires',
      render: (t: ApiToken) => (
        <span className="text-xs text-gray-500">{formatDate(t.expires_at)}</span>
      ),
    },
    {
      key: 'last_used_at',
      header: 'Last Used',
      render: (t: ApiToken) => (
        <span className="text-xs text-gray-500">{formatDate(t.last_used_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (t: ApiToken) => (
        t.is_active ? (
          <Button
            variant="danger"
            size="sm"
            loading={revoking === t.id}
            onClick={() => handleRevoke(t.id)}
          >
            Revoke
          </Button>
        ) : null
      ),
    },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">API Tokens</h1>
          <p className="text-xs text-gray-500 mt-1">Manage your personal access tokens</p>
        </div>
        <Button onClick={() => { setCreateOpen(true); setCreatedToken(null) }}>
          New Token
        </Button>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}

      <div className="hlh-card overflow-hidden">
        <Table
          columns={columns}
          data={tokens}
          keyExtractor={(t) => t.id}
          loading={loading}
          emptyMessage="No tokens yet. Create one to get started."
        />
      </div>

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreatedToken(null) }}
        title="Create API Token"
        footer={
          !createdToken ? (
            <>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button loading={creating} onClick={handleCreate} disabled={!form.name.trim() || form.scopes.length === 0}>
                Create
              </Button>
            </>
          ) : (
            <Button onClick={() => { setCreateOpen(false); setCreatedToken(null) }}>Done</Button>
          )
        }
      >
        {createdToken ? (
          <div className="space-y-4">
            <Alert
              type="warning"
              message="Copy this token now. It won't be shown again."
            />
            <div className="bg-[#0d1117] border border-[#30363d] rounded-md p-3 font-mono text-xs text-emerald-400 break-all select-all">
              {createdToken.raw_token}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {createError && <Alert type="error" message={createError} />}

            <Input
              label="Token Name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. my-app-prod"
            />

            <div>
              <p className="hlh-label">Scopes</p>
              <div className="space-y-2 mt-1">
                {SCOPES.map((s) => (
                  <label key={s.value} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(s.value)}
                      onChange={() => toggleScope(s.value)}
                      className="mt-0.5 accent-violet-500"
                    />
                    <div>
                      <p className="text-xs font-medium text-gray-300">{s.label}</p>
                      <p className="text-[10px] text-gray-600">{s.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <Input
              label="Expires in (days)"
              type="number"
              min={1}
              value={form.expires_in_days}
              onChange={(e) => setForm((p) => ({ ...p, expires_in_days: e.target.value }))}
              hint="Leave empty for no expiry"
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
