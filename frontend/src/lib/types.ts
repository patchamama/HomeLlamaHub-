// ─── Auth & User ─────────────────────────────────────────────────────────────

export interface UserOut {
  id: number
  email: string
  display_name: string
  role: 'admin' | 'user'
  is_active: boolean
  created_at: string
  last_login: string | null
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  user: UserOut
}

export interface UserUpdate {
  display_name: string
  role: 'admin' | 'user'
  is_active: boolean
}

// ─── API Tokens ───────────────────────────────────────────────────────────────

export type TokenScope = 'inference' | 'read_models'

export interface ApiToken {
  id: number
  name: string
  prefix: string
  scopes: TokenScope[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
}

export interface ApiTokenCreated extends ApiToken {
  raw_token: string
}

export interface CreateTokenRequest {
  name: string
  scopes: TokenScope[]
  expires_in_days: number | null
}

// ─── Hosts ────────────────────────────────────────────────────────────────────

export type HostStatus = 'online' | 'offline' | 'unknown' | 'waking'

export interface Host {
  id: number
  name: string
  base_url: string
  mac_address: string | null
  requires_wol: boolean
  is_active: boolean
  status: HostStatus
  models: string[]
  last_seen: string | null
  created_at: string
}

export interface CreateHostRequest {
  name: string
  base_url: string
  mac_address: string | null
  requires_wol: boolean
  is_active: boolean
}

export interface HostTestResult {
  reachable: boolean
  latency_ms: number | null
  models_count: number | null
  error: string | null
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  max_concurrent_requests: number
  request_timeout_seconds: number
  allow_registration: boolean
  updated_at: string
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface ModelStat {
  model: string
  request_count: number
  total_tokens: number
}

export interface UserStat {
  user_id: number
  email: string
  display_name: string
  request_count: number
}

export interface Stats {
  total_jobs: number
  jobs_today: number
  errors_today: number
  avg_duration_ms: number
  active_jobs: number
  queued_jobs: number
  total_today: number
  top_models: ModelStat[]
  top_users: UserStat[]
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  id: number
  timestamp: string
  ip_address: string
  user_id: number | null
  user_email: string | null
  action: string
  target: string | null
  success: boolean
  details: Record<string, unknown> | null
}

export interface AuditFilters {
  ip?: string
  action?: string
  from?: string
  to?: string
  user_id?: number
  page?: number
}

// ─── Paged responses ─────────────────────────────────────────────────────────

export interface PagedUsers {
  items: UserOut[]
  total: number
  page: number
  per_page: number
  pages: number
}

export interface PagedAudit {
  items: AuditEvent[]
  total: number
  page: number
  per_page: number
  pages: number
}

// ─── Ollama / Models ──────────────────────────────────────────────────────────

export interface ModelTag {
  name: string
  modified_at: string
  size: number
  digest: string
}

export interface ModelListResponse {
  models: ModelTag[]
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatDelta {
  role?: string
  content?: string
}

export interface ChatStreamChoice {
  index: number
  delta: ChatDelta
  finish_reason: string | null
}

export interface ChatStreamChunk {
  id: string
  object: string
  created: number
  model: string
  choices: ChatStreamChoice[]
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: string
  queue_active: number
  queue_waiting: number
  version: string
}
