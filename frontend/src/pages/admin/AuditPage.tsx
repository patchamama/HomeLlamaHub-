import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { AuditEvent, AuditFilters } from '../../lib/types'
import Badge from '../../components/ui/Badge'
import Table, { Pagination } from '../../components/ui/Table'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'

const ACTION_COLORS: Record<string, 'green' | 'red' | 'blue' | 'yellow' | 'gray'> = {
  login: 'green',
  logout: 'gray',
  register: 'blue',
  create: 'blue',
  update: 'yellow',
  delete: 'red',
  revoke: 'red',
  wake: 'yellow',
}

function actionColor(action: string): 'green' | 'red' | 'blue' | 'yellow' | 'gray' {
  const key = Object.keys(ACTION_COLORS).find((k) => action.toLowerCase().includes(k))
  return key ? ACTION_COLORS[key] : 'gray'
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [filters, setFilters] = useState<AuditFilters>({})
  const [pendingFilters, setPendingFilters] = useState<AuditFilters>({})

  async function load(p = 1, f = filters) {
    setLoading(true)
    try {
      const data = await api.getAudit({ ...f, page: p })
      setEvents(data.items)
      setPage(data.page)
      setPages(data.pages)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function applyFilters() {
    setFilters(pendingFilters)
    load(1, pendingFilters)
  }

  function clearFilters() {
    setPendingFilters({})
    setFilters({})
    load(1, {})
  }

  const columns = [
    {
      key: 'timestamp',
      header: 'Time',
      render: (e: AuditEvent) => (
        <span className="text-xs text-gray-500 font-mono whitespace-nowrap">{formatTimestamp(e.timestamp)}</span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (e: AuditEvent) => (
        <div className="flex items-center gap-1.5">
          <Badge color={actionColor(e.action)}>{e.action}</Badge>
          {!e.success && <Badge color="red">failed</Badge>}
        </div>
      ),
    },
    {
      key: 'user',
      header: 'User',
      render: (e: AuditEvent) => (
        <span className="text-xs text-gray-400">{e.user_email ?? '—'}</span>
      ),
    },
    {
      key: 'ip_address',
      header: 'IP',
      render: (e: AuditEvent) => (
        <span className="text-xs text-gray-500 font-mono">{e.ip_address}</span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (e: AuditEvent) => (
        <span className="text-xs text-gray-500 truncate max-w-[160px] block">{e.target ?? '—'}</span>
      ),
    },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">Audit Log</h1>
        <p className="text-xs text-gray-500 mt-1">{total.toLocaleString()} total events</p>
      </div>

      {/* Filters */}
      <div className="hlh-card p-4 mb-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="hlh-label">Action</label>
            <input
              className="hlh-input w-full text-xs"
              placeholder="e.g. login"
              value={pendingFilters.action ?? ''}
              onChange={(e) => setPendingFilters((p) => ({ ...p, action: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className="hlh-label">IP Address</label>
            <input
              className="hlh-input w-full text-xs"
              placeholder="e.g. 192.168.1.1"
              value={pendingFilters.ip ?? ''}
              onChange={(e) => setPendingFilters((p) => ({ ...p, ip: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className="hlh-label">From</label>
            <input
              type="date"
              className="hlh-input w-full text-xs"
              value={pendingFilters.from ?? ''}
              onChange={(e) => setPendingFilters((p) => ({ ...p, from: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className="hlh-label">To</label>
            <input
              type="date"
              className="hlh-input w-full text-xs"
              value={pendingFilters.to ?? ''}
              onChange={(e) => setPendingFilters((p) => ({ ...p, to: e.target.value || undefined }))}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={applyFilters}>Apply</Button>
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
        </div>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}

      <div className="hlh-card overflow-hidden">
        <Table
          columns={columns}
          data={events}
          keyExtractor={(e) => e.id}
          loading={loading}
          emptyMessage="No audit events found."
        />
        <Pagination
          page={page}
          pages={pages}
          total={total}
          onPage={(p) => { setPage(p); load(p) }}
        />
      </div>
    </div>
  )
}
