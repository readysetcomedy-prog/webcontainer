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
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/zip',
    },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Netlify ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<DeployResult>;
}
