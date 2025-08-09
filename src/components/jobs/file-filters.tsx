'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface FileFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  syncState: string;
  onSyncStateChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  pathFilter: string;
  onPathFilterChange: (value: string) => void;
  onReset: () => void;
}

export function FileFilters({ 
  searchTerm, 
  onSearchChange, 
  syncState, 
  onSyncStateChange, 
  sortBy, 
  onSortByChange,
  pathFilter,
  onPathFilterChange,
  onReset 
}: FileFiltersProps) {
  const hasFilters = searchTerm || syncState !== 'all' || sortBy !== 'path' || pathFilter;

  return (
    <div className="flex flex-col sm:flex-row gap-4 mb-6">
      <Input
        placeholder="Search files..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1"
      />
      
      <Select value={syncState} onValueChange={onSyncStateChange}>
        <SelectTrigger className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Files</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="synced">Synced</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="queued">Queued</SelectItem>
        </SelectContent>
      </Select>

      <Select value={sortBy} onValueChange={onSortByChange}>
        <SelectTrigger className="w-full sm:w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="path">Path</SelectItem>
          <SelectItem value="size">Size</SelectItem>
          <SelectItem value="modified">Modified</SelectItem>
          <SelectItem value="status">Status</SelectItem>
        </SelectContent>
      </Select>

      <Input
        placeholder="Path filter..."
        value={pathFilter}
        onChange={(e) => onPathFilterChange(e.target.value)}
        className="flex-1"
      />

      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onReset}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
