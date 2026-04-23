import JSZip from 'jszip';
import type { FileEntry } from '../types';

export interface DeployResult {
  id: string;
  url: string;
  admin_url: string;
  deploy_url: string;
  ssl_url: string;
  site_id: string;
}

async function zipFiles(files: FileEntry[]): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.path.replace(/^\//, ''), f.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

async function findRecentDeploy(
  token: string,
  siteId: string,
  sinceMs: number,
): Promise<DeployResult | null> {
  const res = await fetch(
    `https://api.netlify.com/api/v1/sites/${siteId}/deploys?per_page=5`,
    {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) return null;
  const deploys = (await res.json()) as Array<
    DeployResult & { created_at?: string }
  >;
  for (const d of deploys) {
    if (!d.created_at) continue;
    const ts = new Date(d.created_at).getTime();
    if (ts >= sinceMs) return d;
  }
  return null;
}

export async function deployToNetlify(
  token: string,
  files: FileEntry[],
  siteId?: string,
): Promise<DeployResult> {
  if (!token) throw new Error('Netlify token required');
  if (files.length === 0) throw new Error('No files to deploy');
  const blob = await zipFiles(files);
  const url = siteId
    ? `https://api.netlify.com/api/v1/sites/${siteId}/deploys`
    : `https://api.netlify.com/api/v1/sites`;
  const startedAt = Date.now() - 2000;
  try {
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/zip',
      },
      body: blob,
    });
    if (!res.ok) {
      throw new Error(`Netlify ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as DeployResult;
  } catch (err) {
    const isNetworkError =
      err instanceof TypeError ||
      (err instanceof Error && /fetch/i.test(err.message));
    if (isNetworkError && siteId) {
      const recovered = await findRecentDeploy(token, siteId, startedAt);
      if (recovered) return recovered;
    }
    if (isNetworkError) {
      throw new Error(
        `Could not read Netlify's response (${(err as Error).message}). The upload may still have succeeded — check your Netlify dashboard. If the deploy is there, you can safely ignore this error.`,
      );
    }
    throw err;
  }
}
