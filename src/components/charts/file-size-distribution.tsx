"use client"

import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts"
import { FolderOpen, TrendingUp } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

interface FileSizeData {
  range: string;
  count: number;
  fill: string;
}

interface FileSizeDistributionProps {
  data?: FileSizeData[];
  loading?: boolean;
  className?: string;
}

const chartConfig = {
  count: {
    label: "Files",
  },
  small: {
    label: "< 1MB",
    color: "var(--chart-1)",
  },
  medium: {
    label: "1-10MB",
    color: "var(--chart-2)",
  },
  large: {
    label: "10-100MB",
    color: "var(--chart-3)",
  },
  xlarge: {
    label: "100MB-1GB",
    color: "var(--chart-4)",
  },
  huge: {
    label: "> 1GB",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig

// Default data for loading state
const defaultData: FileSizeData[] = [
  { range: "< 1MB", count: 0, fill: "var(--color-small)" },
  { range: "1-10MB", count: 0, fill: "var(--color-medium)" },
  { range: "10-100MB", count: 0, fill: "var(--color-large)" },
  { range: "100MB-1GB", count: 0, fill: "var(--color-xlarge)" },
  { range: "> 1GB", count: 0, fill: "var(--color-huge)" },
];

export function FileSizeDistributionChart({ data = defaultData, loading = false, className }: FileSizeDistributionProps) {
  const totalFiles = data.reduce((sum, item) => sum + item.count, 0);
  const largestCategory = data.reduce((max, item) => item.count > max.count ? item : max, data[0]);
  
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            File Size Distribution
          </CardTitle>
          <CardDescription>Loading file size data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-auto h-[300px] w-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalFiles === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            File Size Distribution
          </CardTitle>
          <CardDescription>No file data available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-auto h-[300px] w-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FolderOpen className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No files to analyze</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          File Size Distribution
        </CardTitle>
        <CardDescription>
          Distribution of files by size ranges
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <BarChart
            accessibilityLayer
            data={data}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="range"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => value.toLocaleString()}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[200px]"
                  formatter={(value, name) => [
                    `${value?.toLocaleString()} files`,
                    name
                  ]}
                />
              }
              cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }}
            />
            <Bar
              dataKey="count"
              fill="var(--color-primary)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
        <div className="flex items-center gap-2 text-sm mt-4">
          <TrendingUp className="h-4 w-4 text-green-500" />
          <span className="font-medium">
            Most files ({((largestCategory.count / totalFiles) * 100).toFixed(1)}%) are in the {largestCategory.range} range
          </span>
        </div>
        <div className="text-muted-foreground text-sm mt-2">
          Total files analyzed: {totalFiles.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  )
}
