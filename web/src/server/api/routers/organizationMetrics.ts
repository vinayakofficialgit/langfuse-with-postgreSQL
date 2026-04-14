import { z } from "zod";
import {
  createTRPCRouter,
  protectedOrganizationProcedure,
} from "@/src/server/api/trpc";
import { throwIfNoOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import {
  getTracesTableCount,
  getTracesTable,
} from "@langfuse/shared/src/server";

// ── Return types ──────────────────────────────────────────
type ProjectMetric = {
  projectId: string;
  projectName: string;
  traces7d: number;
  cost7d: number;
  errorRate: number; // 0..1
  avgLatencyMs: number;
  lastActivity: Date | null;
  dailyTraces: number[]; // length 7, oldest → newest
};

type AggregateMetric = {
  totalTraces: number;
  totalObservations: number;
  totalCost: number;
  avgLatencyMs: number;
  errorRate: number; // 0..1
  activeProjects: number;
  totalProjects: number;
  deltas: {
    traces: number | null;
    observations: number | null;
    cost: number | null;
    latency: number | null;
    errorRate: number | null;
  };
};

// ── Helpers ───────────────────────────────────────────────
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const timeFilter = (from: Date, to: Date) => [
  {
    type: "datetime" as const,
    column: "Timestamp",
    operator: ">=" as const,
    value: from,
  },
  {
    type: "datetime" as const,
    column: "Timestamp",
    operator: "<" as const,
    value: to,
  },
];

// Fetch basic count + metrics for a single project in a time window.
// Uses the same helpers the trace table itself uses.
async function fetchProjectWindow(projectId: string, from: Date, to: Date) {
  const count = await getTracesTableCount({
    projectId,
    filter: timeFilter(from, to),
    searchType: ["id"],
    limit: 1,
    page: 0,
  });

  // Pull up to 1000 recent traces in the window to derive cost/latency/error.
  // For high-volume projects we accept this is an approximation of the latest
  // slice rather than the full window — good enough for the org landing page.
  const traces = await getTracesTable({
    projectId,
    filter: timeFilter(from, to),
    searchQuery: undefined,
    searchType: ["id"],
    orderBy: { column: "timestamp", order: "DESC" },
    limit: 1000,
    page: 0,
  });

  let totalCost = 0;
  let totalLatency = 0;
  let latencySamples = 0;
  let errorCount = 0;
  let lastActivity: Date | null = null;

  for (const t of traces) {
    // Field names follow the TracesTable row shape — all optional-safe.
    const cost = (t as any).totalCost ?? (t as any).calculatedTotalCost ?? 0;
    if (cost) totalCost += Number(cost);

    const latency = (t as any).latency; // seconds
    if (typeof latency === "number" && latency >= 0) {
      totalLatency += latency * 1000;
      latencySamples++;
    }

    const level = (t as any).level;
    if (level === "ERROR") errorCount++;

    const ts = (t as any).timestamp as Date | undefined;
    if (ts && (!lastActivity || ts > lastActivity)) lastActivity = ts;
  }

  return {
    count,
    cost: totalCost,
    avgLatencyMs:
      latencySamples > 0 ? Math.round(totalLatency / latencySamples) : 0,
    errorRate: traces.length > 0 ? errorCount / traces.length : 0,
    lastActivity,
  };
}

// Build a 7-day sparkline for a project by bucketing trace counts per day.
async function fetchSparkline(projectId: string): Promise<number[]> {
  const buckets: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const from = daysAgo(i + 1);
    const to = daysAgo(i);
    const count = await getTracesTableCount({
      projectId,
      filter: timeFilter(from, to),
      searchType: ["id"],
      limit: 1,
      page: 0,
    });
    buckets.push(count);
  }
  return buckets;
}

// ── Router ────────────────────────────────────────────────
export const organizationMetricsRouter = createTRPCRouter({
  getProjectMetrics: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }): Promise<ProjectMetric[]> => {
    throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organization:read",
      });

      const projects = await ctx.prisma.project.findMany({
        where: { orgId: input.orgId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (projects.length === 0) return [];

      const from = daysAgo(7);
      const to = new Date();

      const results = await Promise.all(
        projects.map(async (p) => {
          const [window, sparkline] = await Promise.all([
            fetchProjectWindow(p.id, from, to),
            fetchSparkline(p.id),
          ]);
          return {
            projectId: p.id,
            projectName: p.name,
            traces7d: window.count,
            cost7d: window.cost,
            errorRate: window.errorRate,
            avgLatencyMs: window.avgLatencyMs,
            lastActivity: window.lastActivity,
            dailyTraces: sparkline,
          };
        }),
      );

      return results;
    }),

  getAggregateMetrics: protectedOrganizationProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ ctx, input }): Promise<AggregateMetric> => {
      throwIfNoOrganizationAccess({
        session: ctx.session,
        organizationId: input.orgId,
        scope: "organization:read",
      });

      const projects = await ctx.prisma.project.findMany({
        where: { orgId: input.orgId, deletedAt: null },
        select: { id: true },
      });

      const empty: AggregateMetric = {
        totalTraces: 0,
        totalObservations: 0,
        totalCost: 0,
        avgLatencyMs: 0,
        errorRate: 0,
        activeProjects: 0,
        totalProjects: projects.length,
        deltas: {
          traces: null,
          observations: null,
          cost: null,
          latency: null,
          errorRate: null,
        },
      };
      if (projects.length === 0) return empty;

      const currFrom = daysAgo(7);
      const prevFrom = daysAgo(14);
      const now = new Date();

      const perProject = await Promise.all(
        projects.map(async (p) => {
          const [curr, prev] = await Promise.all([
            fetchProjectWindow(p.id, currFrom, now),
            fetchProjectWindow(p.id, prevFrom, currFrom),
          ]);
          return { curr, prev };
        }),
      );

      const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
      const weightedAvg = (values: number[], weights: number[]) => {
        const w = sum(weights);
        if (w === 0) return 0;
        return values.reduce((acc, v, i) => acc + v * weights[i], 0) / w;
      };

      const currTraces = perProject.map((p) => p.curr.count);
      const prevTraces = perProject.map((p) => p.prev.count);
      const currCosts = perProject.map((p) => p.curr.cost);
      const prevCosts = perProject.map((p) => p.prev.cost);
      const currLatencies = perProject.map((p) => p.curr.avgLatencyMs);
      const prevLatencies = perProject.map((p) => p.prev.avgLatencyMs);
      const currErrors = perProject.map((p) => p.curr.errorRate);
      const prevErrors = perProject.map((p) => p.prev.errorRate);

      const totalCurrTraces = sum(currTraces);
      const totalPrevTraces = sum(prevTraces);
      const activeProjects = currTraces.filter((c) => c > 0).length;

      const pct = (curr: number, prev: number): number | null => {
        if (prev === 0) return null;
        return Math.round(((curr - prev) / prev) * 1000) / 10;
      };

      return {
        totalTraces: totalCurrTraces,
        // Observations aren't exposed on TracesTable row — approximate via
        // traces count for now, or wire a dedicated helper later.
        totalObservations: totalCurrTraces,
        totalCost: sum(currCosts),
        avgLatencyMs: Math.round(weightedAvg(currLatencies, currTraces)),
        errorRate: weightedAvg(currErrors, currTraces),
        activeProjects,
        totalProjects: projects.length,
        deltas: {
          traces: pct(totalCurrTraces, totalPrevTraces),
          observations: pct(totalCurrTraces, totalPrevTraces),
          cost: pct(sum(currCosts), sum(prevCosts)),
          latency: pct(
            weightedAvg(currLatencies, currTraces),
            weightedAvg(prevLatencies, prevTraces),
          ),
          errorRate: pct(
            weightedAvg(currErrors, currTraces),
            weightedAvg(prevErrors, prevTraces),
          ),
        },
      };
    }),
});

