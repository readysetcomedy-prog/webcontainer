import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase';

const FN_URL = `${SUPABASE_URL}/functions/v1/gettube`;

export interface GetTubeTopResult {
  title: string;
  channelTitle: string;
  channelSubs: number | null;
  views: number;
  ageDays: number;
  viewsPerDay: number;
  exactish: boolean;
}

export interface GetTubeQueryMetrics {
  query: string;
  approxTotalResults: number;
  top: GetTubeTopResult[];
  medianViews: number;
  medianViewsPerDay: number;
  demandProxy: number;
  smallChannelShare: number;
  recentShare: number;
  exactMatchCount: number;
  error?: string;
}

export interface GetTubePackage {
  verdict: 'make' | 'reframe' | 'skip';
  verdictReason: string;
  reframe: { angle: string; why: string } | null;
  title: string;
  thumbnailText: string;
  altThumbnailText: string;
  primaryQuery: string;
  secondaryQueries: string[];
  description: string;
  tags: string[];
  chapters: string | null;
  opening: string;
  risks: string[];
  requiredImprovement: string | null;
  opportunity: {
    youtubeSearch: 'low' | 'moderate' | 'high';
    browse: 'low' | 'moderate' | 'high';
  };
  confidence: 'low' | 'moderate' | 'high';
}

export interface GetTubeAnalysis {
  package: GetTubePackage;
  extracted: {
    topic: string;
    coreQuestion: string;
    audience: string;
    candidateQueries: string[];
  };
  research: GetTubeQueryMetrics[];
}

export async function analyzeVideo(description: string): Promise<GetTubeAnalysis> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('Sign in to use GetTube.');
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ description }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `GetTube request failed (${res.status})`);
  }
  return body as GetTubeAnalysis;
}
