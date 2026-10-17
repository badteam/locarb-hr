import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { supabase } from './supabase'

const Ctx = createContext(null)

export function AccessProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [access, setAccess] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_access')
    setAccess(data || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Only a different user means a fresh load. Token refreshes (e.g. when coming back to the browser tab)
  // keep the screen as it is instead of showing "loading" and starting the page from zero.
  const userId = session === undefined ? undefined : session?.user?.id ?? null
  const lastUser = useRef(undefined)
  useEffect(() => {
    if (userId === undefined) return
    if (userId === lastUser.current) return
    lastUser.current = userId
    if (!userId) { setAccess(null); setLoading(false); return }
    setLoading(true)
    load()
  }, [userId, load])

  const can = useCallback((perm) => !!access && (access.is_owner || (access.permissions || []).includes(perm)), [access])
  const value = useMemo(() => ({ session, access, loading, can, reload: load }), [session, access, loading, can, load])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAccess = () => useContext(Ctx)
