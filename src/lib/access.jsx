import { createContext, useContext, useEffect, useState, useCallback } from 'react'
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

  useEffect(() => {
    if (session === undefined) return
    if (!session) { setAccess(null); setLoading(false); return }
    setLoading(true)
    load()
  }, [session, load])

  const can = (perm) => !!access && (access.is_owner || (access.permissions || []).includes(perm))

  return <Ctx.Provider value={{ session, access, loading, can, reload: load }}>{children}</Ctx.Provider>
}

export const useAccess = () => useContext(Ctx)
