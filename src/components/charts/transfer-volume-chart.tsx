"use client"

import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { TrendingUp, Activity } from "lucide-react"

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

interface TransferData {
  date: string;
  successful: number;
  failed: number;
  total: number;
  successRate: string;
}

interface TransferVolumeChartProps {
  data?: TransferData[];
  loading?: boolean;
  className?: string;
}

const chartConfig = {
  successful: {
    label: "Successful",
    color: "var(--chart-1)",
  },
  failed: {
    label: "Failed",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

// Default data for loading state
const defaultData: TransferData[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  successful: 0,
  failed: 0,
  total: 0,
  successRate: "0"
}));

export function TransferVolumeChart({ data = defaultData, loading = false, className }: TransferVolumeChartProps) {
  const [activeChart, setActiveChart] = React.useState<keyof typeof chartConfig>("successful")

  const total = React.useMemo(
    () => ({
      successful: data.reduce((acc, curr) => acc + curr.successful, 0),
      failed: data.reduce((acc, curr) => acc + curr.failed, 0),
    }),
    [data]
  )

  const totalTransfers = total.successful + total.failed;
  const successRate = totalTransfers > 0 ? (total.successful / totalTransfers * 100).toFixed(1) : "0";
  const trend = parseFloat(successRate) >= 90 ? "high" : parseFloat(successRate) >= 70 ? "medium" : "low";

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Transfer Volume
            </CardTitle>
            <CardDescription>Loading transfer data...</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:p-6">
          <div className="aspect-auto h-[250px] w-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalTransfers === 0) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Transfer Volume
            </CardTitle>
            <CardDescription>No transfer data available</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:p-6">
          <div className="aspect-auto h-[250px] w-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No transfers recorded</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col items-stretch border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Transfer Volume
          </CardTitle>
          <CardDescription>
            Daily file transfers - Success rate: {successRate}%
          </CardDescription>
        </div>
        <div className="flex">
          {["successful", "failed"].map((key) => {
            const chart = key as keyof typeof chartConfig
            return (
              <button
                key={chart}
                data-active={activeChart === chart}
                className="data-[active=true]:bg-muted/50 relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6"
                onClick={() => setActiveChart(chart)}
              >
                <span className="text-muted-foreground text-xs">
                  {chartConfig[chart].label}
                </span>
                <span className="text-lg leading-none font-bold sm:text-3xl">
                  {total[key as keyof typeof total].toLocaleString()}
                </span>
              </button>
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:p-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={(value) => {
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
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
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }}
                />
              }
            />
            <Bar dataKey={activeChart} fill={`var(--color-${activeChart})`} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
        <div className="flex items-center gap-2 text-sm mt-4">
          <TrendingUp className={`h-4 w-4 ${
            trend === "high" ? "text-green-500" : 
            trend === "medium" ? "text-yellow-500" : "text-red-500"
          }`} />
          <span className="font-medium">
            {trend === "high" ? "Excellent" : trend === "medium" ? "Good" : "Needs attention"} success rate
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
