import { useMemo } from 'react';
import type { FileEntry } from '../types';

interface Node {
  name: string;
  path: string;
  children?: Node[];
}

function buildTree(files: FileEntry[]): Node {
  const root: Node = { name: '', path: '', children: [] };
  const index = new Map<string, Node>();
  index.set('', root);
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const parts = f.path.split('/').filter(Boolean);
    let parentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (!index.has(path)) {
        const isFile = i === parts.length - 1;
        const node: Node = isFile ? { name, path } : { name, path, children: [] };
        index.get(parentPath)!.children!.push(node);
        index.set(path, node);
      }
      parentPath = path;
    }
  }
  const sortDirs = (n: Node) => {
    if (!n.children) return;
    n.children.sort((a, b) => {
      const ad = !!a.children;
      const bd = !!b.children;
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortDirs);
  };
  sortDirs(root);
  return root;
}

function TreeNode({
  node,
  depth,
  activePath,
  onSelect,
}: {
  node: Node;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  if (node.children) {
    return (
      <div>
        {depth > 0 && (
          <div className="tree-row tree-dir" style={{ paddingLeft: depth * 12 }}>
            <span className="tree-icon">▾</span>
            {node.name}
          </div>
        )}
        {node.children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            activePath={activePath}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }
  const active = node.path === activePath;
  return (
    <div
      className={`tree-row tree-file ${active ? 'active' : ''}`}
      style={{ paddingLeft: depth * 12 }}
      onClick={() => onSelect(node.path)}
    >
      <span className="tree-icon">·</span>
      {node.name}
    </div>
  );
}

export default function FileTree({
  files,
  activePath,
  onSelect,
}: {
  files: FileEntry[];
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="file-tree">
      <TreeNode node={tree} depth={0} activePath={activePath} onSelect={onSelect} />
    </div>
  );
}
