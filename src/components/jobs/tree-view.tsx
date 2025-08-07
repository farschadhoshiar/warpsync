/**
 * TreeView Component
 * Manages tree state and renders hierarchical file structure
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronDown, FolderTree } from 'lucide-react';
import TreeNode from './tree-node';
import { TreeViewProps, TreeNode as TreeNodeType } from '@/types/tree';

const TreeView: React.FC<TreeViewProps> = ({
  treeData,
  searchTerm,
  statusFilter,
  onNodeAction,
  expandedNodes,
  onToggleNode,
  jobId
}) => {
  // Filter tree nodes based on search term and status filter
  const filterTreeNodes = (nodes: TreeNodeType[], searchTerm?: string, statusFilter?: string): TreeNodeType[] => {
    const filtered: TreeNodeType[] = [];

    for (const node of nodes) {
      // Check if current node matches filters
      const matchesSearch = !searchTerm || 
        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.relativePath.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = !statusFilter || statusFilter === 'all' || node.syncState === statusFilter;

      // Recursively filter children
      const filteredChildren = filterTreeNodes(node.children, searchTerm, statusFilter);

      // Include node if it matches filters OR has matching children
      if ((matchesSearch && matchesStatus) || filteredChildren.length > 0) {
        filtered.push({
          ...node,
          children: filteredChildren
        });
      }
    }

    return filtered;
  };

  // Expand all nodes that have search matches
  const expandSearchMatches = (nodes: TreeNodeType[], searchTerm?: string): Set<string> => {
    const toExpand = new Set<string>();
    
    if (!searchTerm) return toExpand;

    const checkNode = (node: TreeNodeType) => {
      // Check if this node or any descendant matches search
      const hasMatchingDescendant = (n: TreeNodeType): boolean => {
        const nodeMatches = n.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          n.relativePath.toLowerCase().includes(searchTerm.toLowerCase());
        
        if (nodeMatches) return true;
        
        return n.children.some(hasMatchingDescendant);
      };

      if (node.isDirectory && hasMatchingDescendant(node)) {
        toExpand.add(node.id);
        node.children.forEach(checkNode);
      }
    };

    nodes.forEach(checkNode);
    return toExpand;
  };

  const filteredNodes = filterTreeNodes(treeData, searchTerm, statusFilter);
  
  // Auto-expand nodes with search matches
  React.useEffect(() => {
    if (searchTerm) {
      const nodesToExpand = expandSearchMatches(treeData, searchTerm);
      nodesToExpand.forEach(nodeId => {
        if (!expandedNodes.has(nodeId)) {
          onToggleNode(nodeId);
        }
      });
    }
  }, [searchTerm, treeData, expandedNodes, onToggleNode]);

  const getAllNodeIds = (nodes: TreeNodeType[]): string[] => {
    let ids: string[] = [];
    for (const node of nodes) {
      if (node.isDirectory) {
        ids.push(node.id);
        ids = ids.concat(getAllNodeIds(node.children));
      }
    }
    return ids;
  };

  const handleToggleExpandCollapse = () => {
    const allDirectoryIds = getAllNodeIds(filteredNodes);
    
    if (allDirectoryIds.length === 0) return;
    
    const allExpanded = allDirectoryIds.every(id => expandedNodes.has(id));
    
    if (allExpanded) {
      // Collapse all
      Array.from(expandedNodes).forEach(id => {
        if (allDirectoryIds.includes(id)) {
          onToggleNode(id);
        }
      });
    } else {
      // Expand all
      allDirectoryIds.forEach(id => {
        if (!expandedNodes.has(id)) {
          onToggleNode(id);
        }
      });
    }
  };

  // Check if most nodes are expanded to determine button state
  const allDirectoryIds = getAllNodeIds(filteredNodes);
  const expandedCount = allDirectoryIds.filter(id => expandedNodes.has(id)).length;
  const isExpanded = allDirectoryIds.length > 0 && expandedCount > allDirectoryIds.length / 2;

  if (filteredNodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <FolderTree className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No files found</h3>
          <p className="text-muted-foreground">
            {searchTerm || statusFilter !== 'all' 
              ? 'Try adjusting your filters or search term'
              : 'This job has no files yet. Run a scan to discover files.'
            }
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Tree Controls */}
      <div className="flex items-center gap-2 pb-2 border-b">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleExpandCollapse}
          className="text-xs"
        >
          {isExpanded ? (
            <>
              <ChevronRight className="h-3 w-3 mr-1" />
              Collapse All
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              Expand All
            </>
          )}
        </Button>
        
        <div className="ml-auto text-xs text-muted-foreground">
          {filteredNodes.length} {filteredNodes.length === 1 ? 'item' : 'items'}
        </div>
      </div>

      {/* Tree Structure */}
      <div 
        className="space-y-0.5 focus-within:outline-none" 
        tabIndex={0}
        onKeyDown={(e) => {
          // Basic keyboard navigation support
          if (e.key === 'Escape') {
            e.preventDefault();
            // Could be used to close dialog or clear search
          }
        }}
      >
        {filteredNodes.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            expandedNodes={expandedNodes}
            onToggle={onToggleNode}
            onFileAction={onNodeAction}
            searchTerm={searchTerm}
            jobId={jobId}
          />
        ))}
      </div>
    </div>
  );
};

export default TreeView;
