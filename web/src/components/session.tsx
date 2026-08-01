'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiError, api, type Circle, type Reliability, type User } from '@/lib/api'

// One verified product session shared by every web surface. Payment approval
// remains a separate passkey ceremony, but account data is no longer selected
// by an impersonable handle cookie.

interface SessionValue {
  user: User | null
  reliability: Reliability | null
  friends: User[]
  circles: Circle[]
  /** Friend ids, most-recently-shared-a-group-with first. Real evidence off
   *  the membership rows — see Social.recentCollaborators — not a guess. */
  recentWith: string[]
  loading: boolean
  /** Set when /v1/me failed for a reason other than "not signed in" — a 500
   *  or a dead proxy must not look identical to a missing cookie. */
  bootError: string | null
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
  const [recentWith, setRecentWith] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{
        user: User
        reliability: Reliability
        friends: User[]
        circles: Circle[]
        recent_with: string[]
      }>('/v1/me')
      setUser(me.user)
      setReliability(me.reliability)
      setFriends(me.friends ?? [])
      setCircles(me.circles ?? [])
      setRecentWith(me.recent_with ?? [])
      setBootError(null)
    } catch (e) {
      // Only a real "no session" response clears the user. A 500, a proxy
      // timeout, or a dead engine must not dump a signed-in person onto the
      // login screen as if their cookie vanished.
      const unauthorized = e instanceof ApiError && (e.status === 401 || e.status === 403)
      if (unauthorized) {
        setUser(null)
        setReliability(null)
        setFriends([])
        setCircles([])
        setRecentWith([])
        setBootError(null)
      } else {
        setBootError(e instanceof Error ? e.message : 'Could not reach the engine.')
      }
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
    setRecentWith([])
  }, [])

  const value = useMemo(
    () => ({
      user,
      reliability,
      friends,
      circles,
      recentWith,
      loading,
      bootError,
      signIn,
      register,
      signOut,
      refresh,
    }),
    [user, reliability, friends, circles, recentWith, loading, bootError, signIn, register, signOut, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession must be used inside SessionProvider')
  return v
}
