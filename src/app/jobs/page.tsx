"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FolderSync, Plus } from "lucide-react";
import { toast } from "sonner";
import { io } from "socket.io-client";
import JobForm from "@/components/jobs/job-form";
import { useJobs } from "@/hooks/useJobs";
import DeleteJobDialog from "@/components/jobs/delete-job-dialog";
import { SchedulerCard } from "@/components/scheduler/scheduler-card";

interface SyncJobFormData {
  name: string;
  description?: string;
  enabled: boolean;
  sourceServerId: string;
  targetType: "server" | "local";
  targetServerId?: string;
  sourcePath: string;
  targetPath: string;
  chmod: string;
  scanInterval: number;
  direction: "download" | "upload" | "bidirectional";
  deleteExtraneous: boolean;
  preserveTimestamps: boolean;
  preservePermissions: boolean;
  compressTransfer: boolean;
  dryRun: boolean;
  maxRetries: number;
  retryDelay: number;
  autoQueueEnabled: boolean;
  autoQueuePatterns: string[];
  autoQueueExcludePatterns: string[];
  maxConcurrentTransfers: number;
  maxConnectionsPerTransfer: number;
  delugeAction: "none" | "remove" | "remove_data" | "set_label";
  delugeDelay: number;
  delugeLabel?: string;
}

interface Job {
  _id: string;
  name: string;
  enabled: boolean;
  serverProfileId:
    | string
    | { _id: string; name: string; address: string; port: number };
  targetType: "server" | "local";
  targetServerId?:
    | string
    | { _id: string; name: string; address: string; port: number };
  remotePath: string;
  localPath: string;
  chmod: string;
  scanInterval: number;
  syncOptions: {
    direction: "download" | "upload" | "bidirectional";
    deleteExtraneous: boolean;
    preserveTimestamps: boolean;
    preservePermissions: boolean;
    compressTransfer: boolean;
    dryRun: boolean;
  };
  retrySettings: {
    maxRetries: number;
    retryDelay: number;
  };
  autoQueue: {
    enabled: boolean;
    patterns: string[];
    excludePatterns: string[];
  };
  delugeAction: {
    action: "none" | "remove" | "remove_data" | "set_label";
    delay: number;
    label?: string;
  };
  parallelism: {
    maxConcurrentTransfers: number;
    maxConnectionsPerTransfer: number;
  };
  lastScan?: string;
  createdAt: string;
  updatedAt: string;
  serverProfile?: {
    name: string;
    address: string;
    port: number;
  };
}

export default function JobsPage() {
  const router = useRouter();
  const [showJobForm, setShowJobForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [scanningJob, setScanningJob] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null);
  const [isDeletingJob, setIsDeletingJob] = useState(false);
  const { jobs, loading, createJob, updateJob, deleteJob, refetch } = useJobs();

  const handleCreateJob = async (data: SyncJobFormData) => {
    try {
      // Transform the form data to match the API schema
      const transformedData = {
        name: data.name,
        enabled: data.enabled,
        serverProfileId: data.sourceServerId,
        targetType: data.targetType,
        targetServerId: data.targetServerId,
        remotePath: data.sourcePath,
        localPath: data.targetPath,
        chmod: data.chmod,
        scanInterval: data.scanInterval,
        syncOptions: {
          direction: data.direction,
          deleteExtraneous: data.deleteExtraneous,
          preserveTimestamps: data.preserveTimestamps,
          preservePermissions: data.preservePermissions,
          compressTransfer: data.compressTransfer,
          dryRun: data.dryRun,
        },
        retrySettings: {
          maxRetries: data.maxRetries,
          retryDelay: data.retryDelay,
        },
        autoQueue: {
          enabled: data.autoQueueEnabled,
          patterns: data.autoQueuePatterns,
          excludePatterns: data.autoQueueExcludePatterns,
        },
        delugeAction: {
          action: data.delugeAction,
          delay: data.delugeDelay,
          label: data.delugeLabel,
        },
        parallelism: {
          maxConcurrentTransfers: data.maxConcurrentTransfers,
          maxConnectionsPerTransfer: data.maxConnectionsPerTransfer,
        },
      };

      await createJob(transformedData);
      setShowJobForm(false);
      refetch();
      toast.success("Job Created", {
        description: `Successfully created sync job "${data.name}" ${data.targetType === "local" ? "to local directory" : "between servers"}`,
      });
    } catch (error) {
      toast.error("Failed to Create Job", {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
      throw error; // Re-throw to keep form in error state
    }
  };

  const handleEditJob = (job: Job) => {
    console.log("📝 Edit Job clicked - raw job data:", {
      _id: job._id,
      name: job.name,
      serverProfileId: job.serverProfileId,
      targetType: job.targetType,
      remotePath: job.remotePath,
      localPath: job.localPath,
    });

    setEditingJob(job);
    setShowJobForm(true);
  };

  const handleUpdateJob = async (data: SyncJobFormData) => {
    if (!editingJob) return;

    try {
      const transformedData = {
        name: data.name,
        enabled: data.enabled,
        serverProfileId: data.sourceServerId,
        targetType: data.targetType,
        targetServerId: data.targetServerId,
        remotePath: data.sourcePath,
        localPath: data.targetPath,
        chmod: data.chmod,
        scanInterval: data.scanInterval,
        syncOptions: {
          direction: data.direction,
          deleteExtraneous: data.deleteExtraneous,
          preserveTimestamps: data.preserveTimestamps,
          preservePermissions: data.preservePermissions,
          compressTransfer: data.compressTransfer,
          dryRun: data.dryRun,
        },
        retrySettings: {
          maxRetries: data.maxRetries,
          retryDelay: data.retryDelay,
        },
        autoQueue: {
          enabled: data.autoQueueEnabled,
          patterns: data.autoQueuePatterns,
          excludePatterns: data.autoQueueExcludePatterns,
        },
        delugeAction: {
          action: data.delugeAction,
          delay: data.delugeDelay,
          label: data.delugeLabel,
        },
        parallelism: {
          maxConcurrentTransfers: data.maxConcurrentTransfers,
          maxConnectionsPerTransfer: data.maxConnectionsPerTransfer,
        },
      };

      console.log("Sending update data:", transformedData);

      await updateJob(editingJob._id, transformedData);
      setShowJobForm(false);
      setEditingJob(null);
      refetch();
      toast.success("Job Updated", {
        description: `Successfully updated sync job "${data.name}"`,
      });
    } catch (error) {
      console.error("Update job error:", error);
      toast.error("Failed to Update Job", {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
      throw error;
    }
  };

  const handleViewFiles = (job: { _id: string; name: string }) => {
    router.push(`/files?jobId=${job._id}`);
  };

  const handleCloseJobForm = () => {
    setShowJobForm(false);
    setEditingJob(null);
  };

  const handleScanJob = async (jobId: string, jobName: string) => {
    setScanningJob(jobId);

    // Initial loading toast
    const toastId = `scan-${jobId}`;
    toast.loading("Preparing scan...", { id: toastId });

    let socket: any = null;
    let socketConnected = false;

    try {
      // Set up WebSocket connection
      console.log("Creating WebSocket connection for job:", jobId);
      socket = io({
        query: { jobId },
      });

      // Add connection debugging
      socket.on("connect", () => {
        console.log("✅ Socket connected for job:", jobId, "ID:", socket.id);
        socketConnected = true;
      });

      socket.on("connect_error", (error: any) => {
        console.error("❌ Socket connection error:", error);
      });

      socket.on("disconnect", (reason: any) => {
        console.log("Socket disconnected:", reason);
        socketConnected = false;
      });

      socket.on("room:joined", (data: any) => {
        console.log("🏠 Joined room:", data);
      });

      socket.on("room:error", (data: any) => {
        console.error("🏠 Room error:", data);
      });

      // Set up unified job progress event listener
      socket.on("job:progress", (data: any) => {
        console.log("📨 Received job:progress event:", data);

        // Only process events for this job
        if (data.jobId !== jobId) return;

        switch (data.type) {
          case "scan:ssh-connecting":
            console.log("📡 Processing SSH connecting");
            toast.loading("Attempting to connect to server via SSH...", {
              id: toastId,
            });
            break;

          case "scan:ssh-connected":
            console.log("✅ Processing SSH connected");
            toast.loading("Successfully connected to remote server", {
              id: toastId,
            });
            break;

          case "scan:syncing-states":
            console.log("🔄 Processing syncing states");
            toast.loading("Syncing Filestates", { id: toastId });
            break;

          default:
            console.log("❓ Unknown job progress type:", data.type);
        }
      });

      // Add general debugging
      socket.onAny((eventName: string, ...args: any[]) => {
        if (eventName !== "job:progress") {
          // Avoid duplicate logging
          console.log("📨 Socket event:", eventName, args);
        }
      });

      console.log("WebSocket setup complete for job:", jobId);

      // Start the scan
      const response = await fetch(`/api/jobs/${jobId}/scan`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to scan job");
      }

      const scanResults = data.data.scanResults;
      const totalChanges =
        scanResults.totalStatusChanges ||
        scanResults.newFiles +
          scanResults.changedFiles +
          scanResults.localOnlyFiles;

      // Final success toast with comprehensive status
      toast.success("Scan Completed", {
        id: toastId,
        description: `${totalChanges} status changes found: ${scanResults.newFiles} new, ${scanResults.changedFiles} changed, ${scanResults.localOnlyFiles} local-only in "${jobName}"`,
      });

      // Refresh jobs list to update last scan time
      refetch();
    } catch (error) {
      toast.error("Scan Failed", {
        id: toastId,
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      // Clean up socket connection
      if (socket) {
        socket.off("job:progress");
        socket.disconnect();
      }
      setScanningJob(null);
    }
  };

  const handleDeleteClick = (job: Job) => {
    setJobToDelete(job);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!jobToDelete) return;

    setIsDeletingJob(true);
    try {
      await deleteJob(jobToDelete._id);
      setIsDeleteDialogOpen(false);
      setJobToDelete(null);
      toast.success("Job deleted successfully", {
        description: `"${jobToDelete.name}" and all associated file states have been deleted.`,
      });
    } catch (error) {
      console.error("Failed to delete job:", error);

      // Extract meaningful error message
      let errorMessage = "Unknown error occurred";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      } else if (error && typeof error === "object" && "message" in error) {
        errorMessage = String(error.message);
      }

      toast.error("Failed to delete job", {
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setIsDeletingJob(false);
    }
  };

  const handleDeleteCancel = () => {
    if (isDeletingJob) return;
    setIsDeleteDialogOpen(false);
    setJobToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Background Scheduler Status */}
      <SchedulerCard />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sync Jobs</h1>
          <p className="text-muted-foreground">
            Manage your file synchronization jobs
          </p>
        </div>
        <Button onClick={() => setShowJobForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Job
        </Button>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading jobs...</p>
            </div>
          </CardContent>
        </Card>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderSync className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No sync jobs configured
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first sync job to start transferring files between
              servers
            </p>
            <Button onClick={() => setShowJobForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Job
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <Card key={job._id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{job.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {job.serverProfile?.name} • {job.remotePath} →{" "}
                      {job.localPath.startsWith("/data/local")
                        ? `Local: ${job.localPath}`
                        : job.localPath}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          job.enabled
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {job.enabled ? "Enabled" : "Disabled"}
                      </span>
                      {job.localPath.startsWith("/data/local") && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Local Sync
                        </span>
                      )}
                      {job.lastScan && (
                        <span className="text-xs text-muted-foreground">
                          Last scan:{" "}
                          {new Date(job.lastScan).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleScanJob(job._id, job.name)}
                      disabled={scanningJob === job._id}
                    >
                      {scanningJob === job._id ? "Scanning..." : "Scan Now"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewFiles(job)}
                    >
                      View Files
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditJob(job)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteClick(job)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Job Creation/Edit Dialog */}
      <Dialog open={showJobForm} onOpenChange={setShowJobForm}>
        <DialogContent className="max-w-12xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingJob ? "Edit Sync Job" : "Create New Sync Job"}
            </DialogTitle>
          </DialogHeader>
          <JobForm
            initialData={
              editingJob
                ? {
                    name: editingJob.name,
                    enabled: editingJob.enabled,
                    sourceServerId:
                      typeof editingJob.serverProfileId === "object" &&
                      editingJob.serverProfileId &&
                      "_id" in editingJob.serverProfileId
                        ? String(editingJob.serverProfileId._id)
                        : String(editingJob.serverProfileId),
                    targetType:
                      editingJob.targetType ||
                      (editingJob.localPath.startsWith("/data/local")
                        ? "local"
                        : "server"),
                    targetServerId: editingJob.targetServerId
                      ? typeof editingJob.targetServerId === "object" &&
                        editingJob.targetServerId &&
                        "_id" in editingJob.targetServerId
                        ? String(editingJob.targetServerId._id)
                        : String(editingJob.targetServerId)
                      : undefined,
                    sourcePath: editingJob.remotePath,
                    targetPath: editingJob.localPath,
                    chmod: editingJob.chmod,
                    scanInterval: editingJob.scanInterval,
                    direction: editingJob.syncOptions?.direction || "download",
                    deleteExtraneous:
                      editingJob.syncOptions?.deleteExtraneous || false,
                    preserveTimestamps:
                      editingJob.syncOptions?.preserveTimestamps || true,
                    preservePermissions:
                      editingJob.syncOptions?.preservePermissions || true,
                    compressTransfer:
                      editingJob.syncOptions?.compressTransfer || true,
                    dryRun: editingJob.syncOptions?.dryRun || false,
                    maxRetries: editingJob.retrySettings?.maxRetries || 3,
                    retryDelay: editingJob.retrySettings?.retryDelay || 5000,
                    autoQueueEnabled: editingJob.autoQueue?.enabled || false,
                    autoQueuePatterns: editingJob.autoQueue?.patterns || [],
                    autoQueueExcludePatterns:
                      editingJob.autoQueue?.excludePatterns || [],
                    maxConcurrentTransfers:
                      editingJob.parallelism?.maxConcurrentTransfers || 3,
                    maxConnectionsPerTransfer:
                      editingJob.parallelism?.maxConnectionsPerTransfer || 5,
                    delugeAction: editingJob.delugeAction?.action || "none",
                    delugeDelay: editingJob.delugeAction?.delay || 15,
                    delugeLabel: editingJob.delugeAction?.label || "",
                  }
                : undefined
            }
            onSubmit={editingJob ? handleUpdateJob : handleCreateJob}
            onCancel={handleCloseJobForm}
            isEditing={!!editingJob}
            isLoading={false}
          />
        </DialogContent>
      </Dialog>

      {/* Delete Job Confirmation Dialog */}
      <DeleteJobDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        jobName={jobToDelete?.name || ""}
        jobId={jobToDelete?._id || ""}
        isDeleting={isDeletingJob}
      />
    </div>
  );
}
