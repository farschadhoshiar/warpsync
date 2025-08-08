"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { TrendingUp, TrendingDown, Target } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

interface TransferSuccessData {
  date: string;
  successful: number;
  failed: number;
  total: number;
  successRate: string;
}

interface TransferSuccessTimelineProps {
  data?: TransferSuccessData[];
  loading?: boolean;
  className?: string;
}

const chartConfig = {
  successRate: {
    label: "Success Rate",
    color: "var(--chart-1)",
  },
  successful: {
    label: "Successful",
    color: "var(--chart-2)",
  },
  total: {
    label: "Total",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

// Default data for loading state
const defaultData: TransferSuccessData[] = Array.from({ length: 7 }, (_, i) => ({
  date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  successful: 0,
  failed: 0,
  total: 0,
  successRate: "0"
}));

export function TransferSuccessTimeline({ data = defaultData, loading = false, className }: TransferSuccessTimelineProps) {
  // Calculate trend
  const chartData = data.map(item => ({
    ...item,
    successRateNum: parseFloat(item.successRate)
  }));

  const avgSuccessRate = chartData.length > 0 
    ? chartData.reduce((sum, item) => sum + item.successRateNum, 0) / chartData.length 
    : 0;

  const recentRate = chartData.length > 0 ? chartData[chartData.length - 1].successRateNum : 0;
  const previousRate = chartData.length > 1 ? chartData[chartData.length - 2].successRateNum : recentRate;
  const trendDirection = recentRate >= previousRate;
  const trendChange = Math.abs(recentRate - previousRate);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Transfer Success Rate
          </CardTitle>
          <CardDescription>Loading success rate data...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-auto h-[300px] w-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalTransfers = chartData.reduce((sum, item) => sum + item.total, 0);

  if (totalTransfers === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Transfer Success Rate
          </CardTitle>
          <CardDescription>No transfer data available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-auto h-[300px] w-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No transfers to analyze</p>
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
          <Target className="h-5 w-5" />
          Transfer Success Rate
        </CardTitle>
        <CardDescription>
          Success rate trend over time
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig}>
          <AreaChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 12,
              right: 12,
              top: 12,
              bottom: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => {
                return new Date(value).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
              }}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => `${value}%`}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }}
                  formatter={(value, name) => [
                    name === 'successRateNum' ? `${value}%` : value,
                    name === 'successRateNum' ? 'Success Rate' : name
                  ]}
                />
              }
            />
            <defs>
              <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-successRate)"
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-successRate)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <Area
              dataKey="successRateNum"
              type="monotone"
              fill="url(#successGradient)"
              fillOpacity={0.4}
              stroke="var(--color-successRate)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
      <CardFooter>
        <div className="flex w-full items-start gap-2 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center gap-2 font-medium leading-none">
              {trendDirection ? (
                <>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Trending up by {trendChange.toFixed(1)}%
                </>
              ) : (
                <>
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  Trending down by {trendChange.toFixed(1)}%
                </>
              )}
            </div>
            <div className="flex items-center gap-2 leading-none text-muted-foreground">
              Average success rate: {avgSuccessRate.toFixed(1)}% • Current: {recentRate.toFixed(1)}%
            </div>
          </div>
        </div>
      </CardFooter>
    </Card>
  )
}
