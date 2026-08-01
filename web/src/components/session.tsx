'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, type Circle, type Reliability, type User } from '@/lib/api'

// One verified product session shared by every web surface. Payment approval
// remains a separate passkey ceremony, but account data is no longer selected
// by an impersonable handle cookie.

interface SessionValue {
  user: User | null
  reliability: Reliability | null
  friends: User[]
  circles: Circle[]
  loading: boolean
  signIn: (email: string, password: string) => Promise<User>
  register: (input: { email: string; password: string; handle: string; name: string }) => Promise<User>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [reliability, setReliability] = useState<Reliability | null>(null)
  const [friends, setFriends] = useState<User[]>([])
  const [circles, setCircles] = useState<Circle[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{
        user: User
        reliability: Reliability
        friends: User[]
        circles: Circle[]
      }>('/v1/me')
      setUser(me.user)
      setReliability(me.reliability)
      setFriends(me.friends ?? [])
      setCircles(me.circles ?? [])
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ user: User }>('/v1/auth/login', { email, password })
      await refresh()
      return res.user
    },
    [refresh],
  )

  const register = useCallback(async (input: { email: string; password: string; handle: string; name: string }) => {
    const res = await api.post<{ user: User }>('/v1/auth/register', input)
    await refresh()
    return res.user
  }, [refresh])

  const signOut = useCallback(async () => {
    await api.post('/v1/me/signout')
    setUser(null)
    setFriends([])
    setCircles([])
  }, [])

  const value = useMemo(
    () => ({ user, reliability, friends, circles, loading, signIn, register, signOut, refresh }),
    [user, reliability, friends, circles, loading, signIn, register, signOut, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used inside SessionProvider')
  return v
}
