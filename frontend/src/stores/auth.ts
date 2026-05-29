import { create } from 'zustand'
import type { UserOut, TokenResponse } from '../lib/types'
import { api, tokenStorage } from '../lib/api'

interface AuthState {
  user: UserOut | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isLoading: boolean

  login(email: string, password: string): Promise<void>
  logout(): void
  refresh(): Promise<void>
  setFromResponse(data: TokenResponse): void
  initFromStorage(): Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: tokenStorage.getAccess(),
  refreshToken: tokenStorage.getRefresh(),
  isAuthenticated: false,
  isLoading: true,

  setFromResponse(data: TokenResponse) {
    tokenStorage.setAccess(data.access_token)
    tokenStorage.setRefresh(data.refresh_token)
    set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user,
      isAuthenticated: true,
    })
  },

  async login(email: string, password: string) {
    const data = await api.login(email, password)
    get().setFromResponse(data)
  },

  logout() {
    tokenStorage.clear()
    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    })
  },

  async refresh() {
    await api.refreshToken()
    const newAccess = tokenStorage.getAccess()
    const newRefresh = tokenStorage.getRefresh()
    set({ accessToken: newAccess, refreshToken: newRefresh })
  },

  async initFromStorage() {
    const stored = tokenStorage.getAccess()
    if (!stored) {
      set({ isLoading: false })
      return
    }
    try {
      const user = await api.getMe()
      set({ user, isAuthenticated: true, isLoading: false })
    } catch {
      // Try refresh
      try {
        await get().refresh()
        const user = await api.getMe()
        set({ user, isAuthenticated: true, isLoading: false })
      } catch {
        tokenStorage.clear()
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    }
  },
}))
