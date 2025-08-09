/**
 * Delete Job Confirmation Dialog Component
 * Provides a proper confirmation dialog for deleting sync jobs with cascade deletion warning
 */

"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DeleteJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  jobName: string;
  jobId: string;
  isDeleting: boolean;
}

export default function DeleteJobDialog({
  isOpen,
  onClose,
  onConfirm,
  jobName,
  jobId,
  isDeleting,
}: DeleteJobDialogProps) {
  const handleConfirm = async () => {
    try {
      await onConfirm();
    } catch (error) {
      console.error("Delete operation failed:", error);

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
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !isDeleting) {
      event.preventDefault();
      handleConfirm();
    } else if (event.key === "Escape" && !isDeleting) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={isDeleting ? undefined : onClose}>
      <DialogContent
        className="max-w-md"
        onKeyDown={handleKeyDown}
        aria-describedby="delete-job-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Sync Job
          </DialogTitle>
          <DialogDescription id="delete-job-description">
            This action cannot be undone. This will permanently delete the sync
            job and all associated data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-2">
            <div>
              <span className="text-sm font-medium text-muted-foreground">
                Job Name:
              </span>
              <p className="text-sm font-semibold">{jobName}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-muted-foreground">
                Job ID:
              </span>
              <p className="text-xs font-mono text-muted-foreground">{jobId}</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-950/20 dark:border-amber-900/50">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Cascade Deletion Warning
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  All file states and transfer history associated with this job
                  will also be permanently deleted.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="min-w-[80px]"
            aria-label={`Delete job ${jobName}`}
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Deleting...
              </>
            ) : (
              "Delete Job"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
