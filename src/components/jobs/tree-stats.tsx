'use client';

import { Card, CardContent } from '@/components/ui/card';

interface TreeStatsProps {
  totalFiles: number;
  totalSize: number;
  selectedCount: number;
  filteredCount: number;
}

export function TreeStats({ totalFiles, totalSize, selectedCount, filteredCount }: TreeStatsProps) {
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{totalFiles.toLocaleString()}</div>
            <div className="text-muted-foreground">Total Files</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{formatFileSize(totalSize)}</div>
            <div className="text-muted-foreground">Total Size</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">{selectedCount.toLocaleString()}</div>
            <div className="text-muted-foreground">Selected</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-600">{filteredCount.toLocaleString()}</div>
            <div className="text-muted-foreground">Filtered</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
