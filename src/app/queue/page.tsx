"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobSelector } from "@/components/jobs/job-selector";
import { FileFilters } from "@/components/jobs/file-filters";
import { FileBrowser } from "@/components/jobs/file-browser";
import { EmptyState } from "@/components/jobs/empty-state";
import { WebSocketProvider } from "@/components/providers/websocket-provider";
import { useJobs } from "@/hooks/useJobs";

export default function QueuePage() {
  const [selectedJobId, setSelectedJobId] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [syncState, setSyncState] = useState("queued"); // Default to queued for queue page
  const [sortBy, setSortBy] = useState("path");
  const [pathFilter, setPathFilter] = useState("");

  const { jobs } = useJobs();

  const selectedJob =
    selectedJobId === "all"
      ? null
      : jobs?.find((job) => job._id === selectedJobId);

  const handleReset = () => {
    setSearchTerm("");
    setSyncState("queued"); // Reset to queued for queue page
    setSortBy("path");
    setPathFilter("");
  };

  return (
    <div className="p-6 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Queue Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Job</label>
            <JobSelector
              value={selectedJobId}
              onValueChange={setSelectedJobId}
            />
          </div>
          <FileFilters
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            syncState={syncState}
            onSyncStateChange={setSyncState}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            pathFilter={pathFilter}
            onPathFilterChange={setPathFilter}
            onReset={handleReset}
          />
        </CardContent>
      </Card>

      {/* ✅ Wrap FileBrowser with job-specific WebSocketProvider */}
      <WebSocketProvider jobId={selectedJobId} key={selectedJobId}>
        <FileBrowser
          jobId={selectedJobId}
          searchTerm={searchTerm}
          syncState={syncState}
          sortBy={sortBy}
          pathFilter={pathFilter}
          jobs={jobs || []}
        />
      </WebSocketProvider>
    </div>
  );
}
