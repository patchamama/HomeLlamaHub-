import type {
  TokenResponse,
  UserOut,
  UserUpdate,
  ApiToken,
  ApiTokenCreated,
  CreateTokenRequest,
  Host,
  CreateHostRequest,
  HostTestResult,
  Settings,
  Stats,
  AuditFilters,
  ModelTag,
  ChatRequest,
  PagedUsers,
  PagedAudit,
} from './types'

// ─── Token storage helpers ────────────────────────────────────────────────────

const ACCESS_KEY = 'hlh_access_token'
const REFRESH_KEY = 'hlh_refresh_token'

export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  setAccess: (t: string) => localStorage.setItem(ACCESS_KEY, t),
  setRefresh: (t: string) => localStorage.setItem(REFRESH_KEY, t),
  clear: () => {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

// ─── Base fetch wrapper ───────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  useToken = true,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (useToken) {
    const token = tokenStorage.getAccess()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  const response = await fetch(path, { ...options, headers })

  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch {
      detail = await response.text()
    }
    const message =
      typeof detail === 'object' && detail !== null && 'detail' in detail
        ? String((detail as Record<string, unknown>).detail)
        : `HTTP ${response.status}`
    throw new ApiError(response.status, message, detail)
  }

  if (response.status === 204) {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}

// Raw fetch for streaming (returns Response directly)
async function requestRaw(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = tokenStorage.getAccess()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const response = await fetch(path, { ...options, headers })
  if (!response.ok) {
    let detail: unknown
    try {
      detail = await response.json()
    } catch {
      detail = await response.text()
    }
    const message =
      typeof detail === 'object' && detail !== null && 'detail' in detail
        ? String((detail as Record<string, unknown>).detail)
        : `HTTP ${response.status}`
    throw new ApiError(response.status, message, detail)
  }
  return response
}

// ─── API surface ──────────────────────────────────────────────────────────────

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<TokenResponse> {
    // OAuth2 password flow uses form data
    const body = new URLSearchParams({ username: email, password })
    const response = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!response.ok) {
      let detail: unknown
      try { detail = await response.json() } catch { detail = {} }
      const message =
        typeof detail === 'object' && detail !== null && 'detail' in detail
          ? String((detail as Record<string, unknown>).detail)
          : 'Invalid credentials'
      throw new ApiError(response.status, message, detail)
    }
    return response.json()
  },

  async register(email: string, password: string, displayName: string): Promise<UserOut> {
    return request<UserOut>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    }, false)
  },

  async refreshToken(): Promise<void> {
    const refresh = tokenStorage.getRefresh()
    if (!refresh) throw new ApiError(401, 'No refresh token')
    const data = await request<TokenResponse>('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refresh }),
    }, false)
    tokenStorage.setAccess(data.access_token)
    tokenStorage.setRefresh(data.refresh_token)
  },

  async getMe(): Promise<UserOut> {
    return request<UserOut>('/api/auth/me')
  },

  // ── API Tokens ─────────────────────────────────────────────────────────────

  async listTokens(): Promise<ApiToken[]> {
    return request<ApiToken[]>('/api/tokens')
  },

  async createToken(data: CreateTokenRequest): Promise<ApiTokenCreated> {
    return request<ApiTokenCreated>('/api/tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async revokeToken(id: number): Promise<void> {
    return request<void>(`/api/tokens/${id}`, { method: 'DELETE' })
  },

  // ── Admin — Users ──────────────────────────────────────────────────────────

  async listUsers(page = 1): Promise<PagedUsers> {
    return request<PagedUsers>(`/api/admin/users?page=${page}`)
  },

  async updateUser(id: number, data: Partial<UserUpdate>): Promise<UserOut> {
    return request<UserOut>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  // ── Admin — Hosts ──────────────────────────────────────────────────────────

  async listHosts(): Promise<Host[]> {
    return request<Host[]>('/api/admin/hosts')
  },

  async createHost(data: CreateHostRequest): Promise<Host> {
    return request<Host>('/api/admin/hosts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async updateHost(id: number, data: Partial<CreateHostRequest>): Promise<Host> {
    return request<Host>(`/api/admin/hosts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  async deleteHost(id: number): Promise<void> {
    return request<void>(`/api/admin/hosts/${id}`, { method: 'DELETE' })
  },

  async wakeHost(id: number): Promise<void> {
    return request<void>(`/api/admin/hosts/${id}/wake`, { method: 'POST' })
  },

  async testHost(id: number): Promise<HostTestResult> {
    return request<HostTestResult>(`/api/admin/hosts/${id}/test`, { method: 'POST' })
  },

  async refreshAllModels(): Promise<void> {
    return request<void>('/api/admin/hosts/refresh-models', { method: 'POST' })
  },

  // ── Admin — Settings ───────────────────────────────────────────────────────

  async getSettings(): Promise<Settings> {
    return request<Settings>('/api/admin/settings')
  },

  async updateSettings(data: Partial<Settings>): Promise<Settings> {
    return request<Settings>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  // ── Admin — Stats ──────────────────────────────────────────────────────────

  async getStats(): Promise<Stats> {
    return request<Stats>('/api/admin/stats')
  },

  // ── Admin — Audit ──────────────────────────────────────────────────────────

  async getAudit(filters: AuditFilters): Promise<PagedAudit> {
    const params = new URLSearchParams()
    if (filters.ip) params.set('ip', filters.ip)
    if (filters.action) params.set('action', filters.action)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.user_id) params.set('user_id', String(filters.user_id))
    if (filters.page) params.set('page', String(filters.page))
    const qs = params.toString()
    return request<PagedAudit>(`/api/admin/audit${qs ? `?${qs}` : ''}`)
  },

  // ── Ollama proxy ───────────────────────────────────────────────────────────

  async listModels(): Promise<ModelTag[]> {
    const data = await request<{ models: ModelTag[] }>('/ollama/api/tags')
    return data.models ?? []
  },

  async chatCompletion(token: string, body: ChatRequest): Promise<Response> {
    return requestRaw('/ollama/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, stream: true }),
    })
  },
}

export { ApiError }
