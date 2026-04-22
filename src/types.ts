import type { FileSystemTree } from '@webcontainer/api';

export type { FileSystemTree };

export interface FileEntry {
  path: string;
  content: string | Uint8Array;
}

export interface LogLine {
  id: number;
  text: string;
  kind: 'out' | 'err' | 'info';
}
