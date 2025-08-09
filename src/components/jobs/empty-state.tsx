'use client';

import { Card, CardContent } from '@/components/ui/card';
import { FileX, Folder } from 'lucide-react';

interface EmptyStateProps {
  type: 'no-job' | 'no-files' | 'no-matches';
  message?: string;
}

export function EmptyState({ type, message }: EmptyStateProps) {
  const getContent = () => {
    switch (type) {
      case 'no-job':
        return {
          icon: <Folder className="h-12 w-12 text-muted-foreground" />,
          title: 'No Job Selected',
          description: message || 'Please select a sync job to view its files.'
        };
      case 'no-files':
        return {
          icon: <FileX className="h-12 w-12 text-muted-foreground" />,
          title: 'No Files Found',
          description: message || 'This job doesn\'t have any files yet. Run a scan to discover files.'
        };
      case 'no-matches':
        return {
          icon: <FileX className="h-12 w-12 text-muted-foreground" />,
          title: 'No Matching Files',
          description: message || 'No files match your current filters. Try adjusting your search criteria.'
        };
      default:
        return {
          icon: <FileX className="h-12 w-12 text-muted-foreground" />,
          title: 'No Data',
          description: message || 'No data available.'
        };
    }
  };

  const { icon, title, description } = getContent();

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        {icon}
        <h3 className="mt-4 text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      </CardContent>
    </Card>
  );
}
