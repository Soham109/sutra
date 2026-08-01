'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, type Circle, type Reliability, type User } from '@/lib/api'

// Who you are, app-wide. Identity here is a handle in a cookie — deliberately
// light, because nothing in this app grants spending power. Money still needs
// the member's own passkey on Prava's page, on their own device.

interface SessionValue {
  user: User | null
  reliability: Reliability | null
  friends: User[]
  circles: Circle[]
  loading: boolean
  signIn: (handle: string, name?: string) => Promise<User>
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
    async (handle: string, name?: string) => {
      const res = await api.post<{ user: User }>('/v1/me', { handle, name })
      await refresh()
      return res.user
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await api.post('/v1/me/signout')
    setUser(null)
    setFriends([])
    setCircles([])
  }, [])

  const value = useMemo(
    () => ({ user, reliability, friends, circles, loading, signIn, signOut, refresh }),
    [user, reliability, friends, circles, loading, signIn, signOut, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used inside SessionProvider')
  return v
}
