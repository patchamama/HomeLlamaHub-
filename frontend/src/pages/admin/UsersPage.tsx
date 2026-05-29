import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { UserOut, UserUpdate } from '../../lib/types'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Table, { Pagination } from '../../components/ui/Table'
import Modal from '../../components/ui/Modal'
import Alert from '../../components/ui/Alert'

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserOut[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editUser, setEditUser] = useState<UserOut | null>(null)
  const [editForm, setEditForm] = useState<Partial<UserUpdate>>({})
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  async function load(p = page) {
    setLoading(true)
    try {
      const data = await api.listUsers(p)
      setUsers(data.items)
      setPage(data.page)
      setPages(data.pages)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function openEdit(user: UserOut) {
    setEditUser(user)
    setEditForm({ display_name: user.display_name, role: user.role, is_active: user.is_active })
    setEditError('')
  }

  async function handleSave() {
    if (!editUser) return
    setSaving(true)
    setEditError('')
    try {
      await api.updateUser(editUser.id, editForm)
      setEditUser(null)
      await load()
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      key: 'user',
      header: 'User',
      render: (u: UserOut) => (
        <div>
          <p className="text-sm text-gray-200 font-medium">{u.display_name}</p>
          <p className="text-xs text-gray-600">{u.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u: UserOut) => (
        <Badge color={u.role === 'admin' ? 'purple' : 'gray'}>{u.role}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u: UserOut) => (
        <Badge color={u.is_active ? 'green' : 'red'} dot>
          {u.is_active ? 'Active' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Joined',
      render: (u: UserOut) => (
        <span className="text-xs text-gray-500">{formatDate(u.created_at)}</span>
      ),
    },
    {
      key: 'last_login',
      header: 'Last Login',
      render: (u: UserOut) => (
        <span className="text-xs text-gray-500">{formatDate(u.last_login)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (u: UserOut) => (
        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
          Edit
        </Button>
      ),
    },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-100 font-display tracking-tight">Users</h1>
        <p className="text-xs text-gray-500 mt-1">{total} registered accounts</p>
      </div>

      {error && <Alert type="error" message={error} className="mb-4" />}

      <div className="hlh-card overflow-hidden">
        <Table
          columns={columns}
          data={users}
          keyExtractor={(u) => u.id}
          loading={loading}
          emptyMessage="No users found."
        />
        <Pagination page={page} pages={pages} total={total} onPage={(p) => { setPage(p); load(p) }} />
      </div>

      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title="Edit User"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button loading={saving} onClick={handleSave}>Save</Button>
          </>
        }
      >
        {editUser && (
          <div className="space-y-4">
            {editError && <Alert type="error" message={editError} />}

            <div>
              <p className="hlh-label">Display Name</p>
              <input
                className="hlh-input w-full"
                value={editForm.display_name ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, display_name: e.target.value }))}
              />
            </div>

            <div>
              <p className="hlh-label">Role</p>
              <select
                className="hlh-input w-full"
                value={editForm.role}
                onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value as 'admin' | 'user' }))}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.is_active ?? false}
                onChange={(e) => setEditForm((p) => ({ ...p, is_active: e.target.checked }))}
                className="accent-violet-500"
              />
              <span className="text-sm text-gray-300">Account active</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}
