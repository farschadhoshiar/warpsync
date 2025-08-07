import React from 'react';
import { ConnectionStatusBadge } from './connection-status-badge';

// Example component showing all connection status states
export function ConnectionStatusDemo() {
  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-semibold">Connection Status Examples</h3>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">Connected</p>
          <ConnectionStatusBadge 
            status="connected" 
            lastTested="2025-01-07T17:20:00Z"
          />
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">Disconnected</p>
          <ConnectionStatusBadge 
            status="disconnected" 
            lastTested="2025-01-07T17:15:00Z"
          />
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">Testing</p>
          <ConnectionStatusBadge 
            status="testing" 
            lastTested="2025-01-07T17:20:30Z"
          />
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">Error</p>
          <ConnectionStatusBadge 
            status="error" 
            lastTested="2025-01-07T17:18:00Z"
          />
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">Never Tested</p>
          <ConnectionStatusBadge 
            status="never-tested" 
          />
        </div>
        
        <div className="space-y-2">
          <p className="text-sm font-medium">Small Size</p>
          <ConnectionStatusBadge 
            status="connected" 
            size="sm"
            lastTested="2025-01-07T17:20:00Z"
          />
        </div>
      </div>
    </div>
  );
}
