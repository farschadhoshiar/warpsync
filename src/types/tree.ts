/**
 * Tree structure types for file system representation
 */

export interface TreeNode {
  id: string;
  name: string;
  relativePath: string;
  isDirectory: boolean;
  syncState: string;
  size?: number;
  fileCount?: number;
  directorySize?: number;
  children: TreeNode[];
  parent?: string;
  level?: number;
}

export interface TreeStats {
  totalItems: number;
  directories: number;
  files: number;
  totalSize: number;
  expandLevel: number;
  showFiles: boolean;
}

export interface TreeViewProps {
  treeData: TreeNode[];
  searchTerm?: string;
  statusFilter?: string;
  onNodeAction?: (nodeId: string, action: string) => void;
  expandedNodes: Set<string>;
  onToggleNode: (nodeId: string) => void;
  jobId?: string;
}

export interface TreeNodeProps {
  node: TreeNode;
  level: number;
  expandedNodes: Set<string>;
  onToggle: (nodeId: string) => void;
  onFileAction?: (nodeId: string, action: string) => void;
  searchTerm?: string;
  jobId?: string;
}
