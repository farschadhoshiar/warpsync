"use client";

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FolderSync, Plus } from 'lucide-react';

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sync Jobs</h1>
          <p className="text-muted-foreground">
            Manage your file synchronization jobs
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Create Job
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FolderSync className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No sync jobs configured</h3>
          <p className="text-muted-foreground text-center mb-4">
            Create your first sync job to start transferring files between servers
          </p>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Job
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
