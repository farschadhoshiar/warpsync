'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Download, 
  Upload, 
  RotateCcw, 
  FileText, 
  CheckSquare, 
  Square, 
  Trash2,
  Play
} from 'lucide-react';

interface FileActionsProps {
  selectedFiles: string[];
  onSelectAll: () => void;
  onDeselectAll: () => void;
  hasSelection: boolean;
  allSelected: boolean;
  onDownload: () => void;
  onUpload: () => void;
  onResync: () => void;
  onViewDetails: () => void;
  onDelete: () => void;
  onQueue: () => void;
  isLoading?: boolean;
}

export function FileActions({
  selectedFiles,
  onSelectAll,
  onDeselectAll,
  hasSelection,
  allSelected,
  onDownload,
  onUpload,
  onResync,
  onViewDetails,
  onDelete,
  onQueue,
  isLoading = false
}: FileActionsProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={allSelected ? onDeselectAll : onSelectAll}
          >
            {allSelected ? <Square className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>

          {hasSelection && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onDownload}
                disabled={isLoading}
              >
                <Download className="h-4 w-4" />
                Download ({selectedFiles.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onUpload}
                disabled={isLoading}
              >
                <Upload className="h-4 w-4" />
                Upload ({selectedFiles.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onResync}
                disabled={isLoading}
              >
                <RotateCcw className="h-4 w-4" />
                Resync ({selectedFiles.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onQueue}
                disabled={isLoading}
              >
                <Play className="h-4 w-4" />
                Queue ({selectedFiles.length})
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onViewDetails}
                disabled={isLoading}
              >
                <FileText className="h-4 w-4" />
                Details
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={isLoading}
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedFiles.length})
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
