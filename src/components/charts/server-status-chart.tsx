"use client"

import { TrendingUp, TrendingDown, Server } from "lucide-react"
import { Pie, PieChart } from "recharts"

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

interface ServerStatusData {
  status: string;
  count: number;
  fill: string;
}

interface ServerStatusChartProps {
  data?: ServerStatusData[];
  loading?: boolean;
  className?: string;
}

const chartConfig = {
  count: {
    label: "Servers",
  },
  connected: {
    label: "Connected",
    color: "var(--chart-1)",
  },
  disconnected: {
    label: "Disconnected", 
    color: "var(--chart-2)",
  },
  testing: {
    label: "Testing",
    color: "var(--chart-3)",
  },
  error: {
    label: "Error",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig

// Default data for loading state
const defaultData: ServerStatusData[] = [
  { status: "connected", count: 0, fill: "var(--color-connected)" },
  { status: "disconnected", count: 0, fill: "var(--color-disconnected)" },
  { status: "testing", count: 0, fill: "var(--color-testing)" },
  { status: "error", count: 0, fill: "var(--color-error)" },
]

export function ServerStatusChart({ data = defaultData, loading = false, className }: ServerStatusChartProps) {
  const chartData = data.filter(item => item.count > 0);
  const totalServers = data.reduce((sum, item) => sum + item.count, 0);
  const connectedServers = data.find(item => item.status === 'connected')?.count || 0;
  const connectionRate = totalServers > 0 ? (connectedServers / totalServers) * 100 : 0;
  
  // Determine if trend is positive (more than 70% connected is good)
  const isPositiveTrend = connectionRate >= 70;
  const trendText = connectionRate >= 90 ? "Excellent connectivity" : 
                   connectionRate >= 70 ? "Good connectivity" : 
                   connectionRate >= 50 ? "Fair connectivity" : "Poor connectivity";

  if (loading) {
    return (
      <Card className={`flex flex-col ${className}`}>
        <CardHeader className="items-center pb-0">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server Status
          </CardTitle>
          <CardDescription>Loading server connection status...</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-0">
          <div className="mx-auto aspect-square max-h-[250px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (totalServers === 0) {
    return (
      <Card className={`flex flex-col ${className}`}>
        <CardHeader className="items-center pb-0">
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server Status
          </CardTitle>
          <CardDescription>No servers configured</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 pb-0">
          <div className="mx-auto aspect-square max-h-[250px] flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Server className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Add servers to see status</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex flex-col ${className}`}>
      <CardHeader className="items-center pb-0">
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Server Status
        </CardTitle>
        <CardDescription>Current connection status of all servers</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 pb-0">
        <ChartContainer
          config={chartConfig}
          className="mx-auto aspect-square max-h-[250px]"
        >
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Pie 
              data={chartData} 
              dataKey="count" 
              nameKey="status"
              innerRadius={50}
              strokeWidth={2}
            />
          </PieChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className="flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 leading-none font-medium">
          {isPositiveTrend ? (
            <>
              <TrendingUp className="h-4 w-4 text-green-500" />
              {trendText} ({connectionRate.toFixed(1)}%)
            </>
          ) : (
            <>
              <TrendingDown className="h-4 w-4 text-red-500" />
              {trendText} ({connectionRate.toFixed(1)}%)
            </>
          )}
        </div>
        <div className="text-muted-foreground leading-none">
          {connectedServers} of {totalServers} servers connected
        </div>
      </CardFooter>
    </Card>
  )
}
