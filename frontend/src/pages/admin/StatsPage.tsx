import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { Stats } from '../../lib/types'
import { StatCard } from '../../components/ui/Card'
import Alert from '../../components/ui/Alert'
import Button from '../../components/ui/Button'

function formatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const data = await api.getStats()
      setStats(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">Statistics</h1>
          <p className="text-xs text-gray-500 mt-1">System usage overview</p>
        </div>
        <Button variant="secondary" size="sm" loading={loading} onClick={load}>
          Refresh
        </Button>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}

      {loading && !stats ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : stats ? (
        <>
          {/* Primary metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard
              label="Total Jobs"
              value={stats.total_jobs.toLocaleString()}
              color="purple"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              }
            />
            <StatCard
              label="Today"
              value={stats.jobs_today.toLocaleString()}
              color="blue"
              sub={`${stats.errors_today} errors`}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              }
            />
            <StatCard
              label="Avg Duration"
              value={formatMs(stats.avg_duration_ms)}
              color="yellow"
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <StatCard
              label="Active Jobs"
              value={stats.active_jobs}
              color={stats.active_jobs > 0 ? 'green' : 'default'}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
            />
            <StatCard
              label="Queued Jobs"
              value={stats.queued_jobs}
              color={stats.queued_jobs > 5 ? 'red' : 'default'}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              }
            />
            <StatCard
              label="Errors Today"
              value={stats.errors_today}
              color={stats.errors_today > 0 ? 'red' : 'green'}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
            />
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top models */}
            <div className="hlh-card overflow-hidden">
              <div className="px-5 py-4 border-b border-[#30363d]">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Top Models</h3>
              </div>
              {stats.top_models.length === 0 ? (
                <p className="px-5 py-4 text-xs text-gray-600">No data yet</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#30363d]">
                      <th className="px-5 py-2.5 text-left text-gray-600 font-medium">Model</th>
                      <th className="px-5 py-2.5 text-right text-gray-600 font-medium">Requests</th>
                      <th className="px-5 py-2.5 text-right text-gray-600 font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.top_models.map((m) => (
                      <tr key={m.model} className="border-b border-[#30363d]/50 hover:bg-[#21262d]/30">
                        <td className="px-5 py-2.5 text-gray-300 font-mono truncate max-w-[160px]">{m.model}</td>
                        <td className="px-5 py-2.5 text-right text-violet-400 font-semibold">{m.request_count.toLocaleString()}</td>
                        <td className="px-5 py-2.5 text-right text-blue-400">{formatTokens(m.total_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Top users */}
            <div className="hlh-card overflow-hidden">
              <div className="px-5 py-4 border-b border-[#30363d]">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Top Users</h3>
              </div>
              {stats.top_users.length === 0 ? (
                <p className="px-5 py-4 text-xs text-gray-600">No data yet</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#30363d]">
                      <th className="px-5 py-2.5 text-left text-gray-600 font-medium">User</th>
                      <th className="px-5 py-2.5 text-right text-gray-600 font-medium">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.top_users.map((u) => (
                      <tr key={u.user_id} className="border-b border-[#30363d]/50 hover:bg-[#21262d]/30">
                        <td className="px-5 py-2.5">
                          <p className="text-gray-300">{u.display_name}</p>
                          <p className="text-gray-600">{u.email}</p>
                        </td>
                        <td className="px-5 py-2.5 text-right text-violet-400 font-semibold">{u.request_count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
