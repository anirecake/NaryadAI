import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Employee } from './domain'
import { isConfigured, supabase, tabToEmail } from './supabase'

interface AuthState {
  loading: boolean
  session: Session | null
  employee: Employee | null
  login: (tab: string, pin: string) => Promise<'ok' | 'bad_credentials' | 'no_employee'>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null!)

async function loadEmployee(): Promise<Employee | null> {
  const { data } = await supabase.rpc('current_employee')
  return data?.id ? (data as Employee) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      if (data.session) setEmployee(await loadEmployee())
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const login: AuthState['login'] = async (tab, pin) => {
    const { error } = await supabase.auth.signInWithPassword({ email: tabToEmail(tab), password: pin })
    if (error) return 'bad_credentials'
    const emp = await loadEmployee()
    if (!emp) {
      await supabase.auth.signOut()
      return 'no_employee'
    }
    setEmployee(emp)
    return 'ok'
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setEmployee(null)
  }

  return <AuthContext.Provider value={{ loading, session, employee, login, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

// Куда отправить пользователя после входа
export const homeFor = (role: Employee['role']) =>
  role === 'worker' ? '/worker' : role === 'master' ? '/master' : '/panel'
