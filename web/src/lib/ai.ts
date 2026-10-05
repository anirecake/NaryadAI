import { supabase } from './supabase'

// Вызовы Edge Function ai-insights (Claude; без ключа — режим правил)
export async function aiInsights<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai-insights', { body })
  if (error) throw error
  return data as T
}

export interface Suggestion { code: string; name: string; specialty: string; norm_hours: number; confidence: number; why: string; ai: boolean }

export interface FindingView {
  kind: string; severity: 'high' | 'medium'; subject: string; title: string
  conclusion: string; recommendation: string | null; facts: Record<string, unknown>
}
