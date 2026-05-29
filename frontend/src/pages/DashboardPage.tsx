import { useEffect, useState } from 'react'
import { useAuthStore } from '../stores/auth'
import { api } from '../lib/api'
import type { Stats } from '../lib/types'
import { StatCard } from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'

function formatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    api.getStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isAdmin])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">
          Welcome back, {user?.display_name}
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* User info card */}
      <div className="hlh-card p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-violet-900/60 border border-violet-700/40 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-violet-400">
              {user?.display_name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-100">{user?.display_name}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
          <span className={[
            'px-2.5 py-1 rounded text-xs font-semibold tracking-wide uppercase',
            user?.role === 'admin'
              ? 'bg-violet-900/40 text-violet-400 border border-violet-700/40'
              : 'bg-[#21262d] text-gray-400 border border-[#30363d]',
          ].join(' ')}>
            {user?.role}
          </span>
        </div>
      </div>

      {/* Admin stats */}
      {isAdmin && (
        <>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
            System Overview
          </h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M13 10V3L4 14h7v7l9-11h-7z" />
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
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top models */}
                <div className="hlh-card p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
                    Top Models
                  </h3>
                  {stats.top_models.length === 0 ? (
                    <p className="text-xs text-gray-600">No data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.top_models.map((m) => (
                        <div key={m.model} className="flex items-center justify-between">
                          <span className="text-xs text-gray-300 font-mono truncate max-w-[60%]">{m.model}</span>
                          <span className="text-xs text-violet-400 font-semibold">
                            {m.request_count.toLocaleString()} req
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Top users */}
                <div className="hlh-card p-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
                    Top Users
                  </h3>
                  {stats.top_users.length === 0 ? (
                    <p className="text-xs text-gray-600">No data yet</p>
                  ) : (
                    <div className="space-y-3">
                      {stats.top_users.map((u) => (
                        <div key={u.user_id} className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-300">{u.display_name}</p>
                            <p className="text-[10px] text-gray-600">{u.email}</p>
                          </div>
                          <span className="text-xs text-blue-400 font-semibold">
                            {u.request_count.toLocaleString()} req
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      {/* Non-admin quick links */}
      {!isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a href="/console" className="hlh-card p-5 hover:border-violet-600/40 transition-colors block">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-violet-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-200">AI Console</span>
            </div>
            <p className="text-xs text-gray-500">Chat with available models</p>
          </a>
          <a href="/tokens" className="hlh-card p-5 hover:border-violet-600/40 transition-colors block">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-gray-200">My Tokens</span>
            </div>
            <p className="text-xs text-gray-500">Manage API access tokens</p>
          </a>
        </div>
      )}
    </div>
  )
}
