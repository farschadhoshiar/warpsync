'use client';

import { useJobs } from '@/hooks/useJobs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface JobSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function JobSelector({ value, onValueChange }: JobSelectorProps) {
  const { jobs, loading } = useJobs();

  if (loading) {
    return (
      <Select disabled>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Loading jobs..." />
        </SelectTrigger>
      </Select>
    );
  }

  const activeJobs = jobs?.filter(job => job.enabled) || [];

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a sync job" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Jobs</SelectItem>
        {activeJobs.map((job) => (
          <SelectItem key={job._id} value={job._id}>
            {job.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
