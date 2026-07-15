import { supabase } from './supabase';
import type { GetTubeAnalysis } from './gettube';

export interface SavedAnalysis {
  id: string;
  title: string | null;
  description: string;
  result: GetTubeAnalysis;
  createdAt: number;
}

interface Row {
  id: string;
  title: string | null;
  description: string;
  result: GetTubeAnalysis;
  created_at: string;
}

function toSaved(r: Row): SavedAnalysis {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    result: r.result,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function listAnalyses(): Promise<SavedAnalysis[]> {
  const { data, error } = await supabase
    .from('gettube_analyses')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(toSaved);
}

export async function saveAnalysis(
  description: string,
  result: GetTubeAnalysis,
): Promise<SavedAnalysis> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user.id;
  if (!userId) throw new Error('Sign in to save analyses.');
  // Title from the produced package for a readable list; fall back to the
  // first line of the input.
  const title =
    result.package?.title?.trim() ||
    description.split('\n')[0].slice(0, 80) ||
    'Untitled analysis';
  const { data, error } = await supabase
    .from('gettube_analyses')
    .insert({ user_id: userId, title, description, result })
    .select()
    .single();
  if (error) throw error;
  return toSaved(data as Row);
}

export async function deleteAnalysis(id: string): Promise<void> {
  const { error } = await supabase.from('gettube_analyses').delete().eq('id', id);
  if (error) throw error;
}
