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
  // True when this line came from an in-place terminal redraw (progress
  // bars). The next redraw chunk replaces this line instead of appending.
  redraw?: boolean;
}
