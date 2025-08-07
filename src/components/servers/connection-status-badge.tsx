"use client";

import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ConnectionStatus = 'connected' | 'disconnected' | 'testing' | 'never-tested' | 'error';

interface ConnectionStatusBadgeProps {
  status: ConnectionStatus;
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'default';
  lastTested?: string;
}

export function ConnectionStatusBadge({ 
  status, 
  className, 
  showIcon = true, 
  size = 'default',
  lastTested 
}: ConnectionStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          variant: 'default' as const,
          label: 'Connected',
          icon: CheckCircle,
          className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-100'
        };
      case 'disconnected':
        return {
          variant: 'secondary' as const,
          label: 'Disconnected',
          icon: XCircle,
          className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-100'
        };
      case 'testing':
        return {
          variant: 'secondary' as const,
          label: 'Testing...',
          icon: Loader2,
          className: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-100'
        };
      case 'error':
        return {
          variant: 'destructive' as const,
          label: 'Error',
          icon: XCircle,
          className: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-100'
        };
      case 'never-tested':
      default:
        return {
          variant: 'outline' as const,
          label: 'Untested',
          icon: Clock,
          className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300'
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <Badge 
      variant={config.variant}
      className={cn(
        config.className,
        size === 'sm' && 'text-xs px-2 py-0.5',
        className
      )}
      title={lastTested ? `Last tested: ${new Date(lastTested).toLocaleString()}` : undefined}
    >
      {showIcon && (
        <Icon 
          className={cn(
            iconSize, 
            'mr-1',
            status === 'testing' && 'animate-spin'
          )} 
        />
      )}
      {config.label}
    </Badge>
  );
}
