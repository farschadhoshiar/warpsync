"use client";

import { Card, CardContent } from '@/components/ui/card';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure WarpSync system settings
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Settings className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Settings panel</h3>
          <p className="text-muted-foreground text-center">
            System configuration options will be available here
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
