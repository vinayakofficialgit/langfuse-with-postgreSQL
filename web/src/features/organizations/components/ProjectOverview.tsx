


import {
  BookOpen,
  LockIcon,
  MessageSquareText,
  Settings,
  Users,
  ArrowRight,
  KeyRound,
  TrendingUp,
  TrendingDown,
  PlusIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card";
import { Separator } from "@/src/components/ui/separator";
import Header from "@/src/components/layouts/header";
import { Button } from "@/src/components/ui/button";
import Link from "next/link";
import { StringParam, useQueryParams } from "use-query-params";
import { Input } from "@/src/components/ui/input";
import { useHasOrganizationAccess } from "@/src/features/rbac/utils/checkOrganizationAccess";
import { env } from "@/src/env.mjs";
import { Fragment } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  createOrganizationRoute,
  createProjectRoute,
} from "@/src/features/setup/setupRoutes";
import { isCloudPlan, planLabels } from "@langfuse/shared";
import ContainerPage from "@/src/components/layouts/container-page";
import { type User } from "next-auth";
import { api } from "@/src/utils/api";
import { formatDistanceToNow } from "date-fns";

/* ───────────────────────────────────────────────────────
 * Sparkline — inline SVG, no deps
 * ─────────────────────────────────────────────────────── */
const Sparkline = ({
  data,
  color = "#4338ca",
  width = 120,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) => {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const step = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => `${i * step},${height - (v / max) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/* ───────────────────────────────────────────────────────
 * Aggregate metric card
 * ─────────────────────────────────────────────────────── */
const MetricCard = ({
  label,
  value,
  delta,
  invertDelta = false,
}: {
  label: string;
  value: string;
  delta: number | null;
  invertDelta?: boolean;
}) => {
  const isPositive = delta !== null && delta > 0;
  const isGood = invertDelta ? !isPositive : isPositive;
  const color =
    delta === null
      ? "text-slate-400"
      : isGood
        ? "text-emerald-600"
        : "text-rose-600";
  const Icon = delta === null ? null : isPositive ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="mb-1.5 text-[11px] font-medium text-slate-500">
        {label}
      </div>
      <div className="text-lg font-semibold leading-none text-slate-900">
        {value}
      </div>
      <div className={`mt-1 flex items-center gap-1 text-[11px] ${color}`}>
        {Icon && <Icon size={11} />}
        {delta === null ? "—" : `${Math.abs(delta)}%`}
      </div>
    </div>
  );
};

/* ───────────────────────────────────────────────────────
 * Per-project card with live metrics
 * ─────────────────────────────────────────────────────── */
const ProjectCard = ({
  project,
  metric,
}: {
  project: User["organizations"][number]["projects"][number];
  metric?: {
    traces7d: number;
    cost7d: number;
    errorRate: number;
    lastActivity: Date | null;
    dailyTraces: number[];
  };
}) => {
  if (project.deletedAt) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">{project.name}</div>
        <div className="mt-2 text-xs text-slate-400">
          Project is being deleted
        </div>
      </Card>
    );
  }

  const isActive = metric && metric.traces7d > 0;
  const lastActivity = metric?.lastActivity
    ? formatDistanceToNow(new Date(metric.lastActivity), { addSuffix: true })
    : "No activity yet";

  return (
    <Card className="group relative flex flex-col p-4 transition-colors hover:border-slate-300">
      <Link
        href={`/project/${project.id}`}
        className="absolute inset-0"
        aria-label={`Open ${project.name}`}
      />

      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isActive ? "bg-emerald-500" : "bg-slate-300"
            }`}
          />
          <span className="truncate text-sm font-medium">{project.name}</span>
        </div>
        <span className="text-[11px] text-slate-400">{lastActivity}</span>
      </div>

      <div className="text-xl font-semibold leading-none text-slate-900">
        {(metric?.traces7d ?? 0).toLocaleString()}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">traces · 7d</div>

      <div className="my-3">
        <Sparkline data={metric?.dailyTraces ?? new Array(7).fill(0)} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
        <span>${(metric?.cost7d ?? 0).toFixed(2)}</span>
        <span>{((metric?.errorRate ?? 0) * 100).toFixed(2)}% err</span>
        <span className="relative z-10 flex items-center gap-1 font-medium text-indigo-600">
          Open <ArrowRight size={11} />
        </span>
      </div>

      <Link
        href={`/project/${project.id}/settings`}
        className="absolute right-3 top-3 z-10 hidden rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 group-hover:block"
        onClick={(e) => e.stopPropagation()}
      >
        <Settings size={13} />
      </Link>
    </Card>
  );
};

/* ───────────────────────────────────────────────────────
 * Welcome-hero dashboard for a single organization
 * ─────────────────────────────────────────────────────── */
const SingleOrganizationPage = ({
  orgId,
  search,
}: {
  orgId: string;
  search?: string;
}) => {
  const session = useSession();
  const org = session.data?.user?.organizations.find((o) => o.id === orgId);

  const aggregateQuery = api.organizationMetrics.getAggregateMetrics.useQuery(
    { orgId },
    { refetchInterval: 30_000, refetchOnWindowFocus: true, enabled: !!org },
  );
  const projectMetricsQuery =
    api.organizationMetrics.getProjectMetrics.useQuery(
      { orgId },
      { refetchInterval: 30_000, refetchOnWindowFocus: true, enabled: !!org },
    );

  const createProjectAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "projects:create",
  });

  if (!org) return null;

  // Keep demo org using the original simple tile
  const isDemoOrg =
    env.NEXT_PUBLIC_DEMO_ORG_ID === orgId &&
    org.projects.some((p) => p.id === env.NEXT_PUBLIC_DEMO_PROJECT_ID);

  if (isDemoOrg) {
    return (
      <ContainerPage headerProps={{ title: "Demo Organization" }}>
        <DemoOrganizationTile />
      </ContainerPage>
    );
  }

  const agg = aggregateQuery.data;
  const projectMetricsMap = new Map(
    (projectMetricsQuery.data ?? []).map((m) => [m.projectId, m]),
  );

  const userName = session.data?.user?.name?.split(" ")[0] ?? "there";
  const filteredProjects = org.projects.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <ContainerPage headerProps={{ title: org.name }}>
    {/* <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8"> */}
       <div
        className="rounded-xl border border-slate-200 p-6 sm:p-8"
        style={{ backgroundColor: "#F6F4FB" }}
       >
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {org.name}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Welcome back, {userName}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Here&apos;s what&apos;s happening across your projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/organization/${orgId}/settings`}>
                <Settings size={14} />
              </Link>
            </Button>
            {createProjectAccess ? (
              <Button asChild>
                <Link href={createProjectRoute(orgId)}>
                  <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  New project
                </Link>
              </Button>
            ) : (
              <Button disabled>
                <LockIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                New project
              </Button>
            )}
          </div>
        </div>

        {/* Aggregate strip */}
        <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Traces 7d"
            value={(agg?.totalTraces ?? 0).toLocaleString()}
            delta={agg?.deltas.traces ?? null}
          />
          <MetricCard
            label="Observations"
            value={(agg?.totalObservations ?? 0).toLocaleString()}
            delta={agg?.deltas.observations ?? null}
          />
          <MetricCard
            label="Cost 7d"
            value={`$${(agg?.totalCost ?? 0).toFixed(2)}`}
            delta={agg?.deltas.cost ?? null}
            invertDelta
          />
          <MetricCard
            label="Avg latency"
            value={`${agg?.avgLatencyMs ?? 0}ms`}
            delta={agg?.deltas.latency ?? null}
            invertDelta
          />
          <MetricCard
            label="Error rate"
            value={`${((agg?.errorRate ?? 0) * 100).toFixed(2)}%`}
            delta={agg?.deltas.errorRate ?? null}
            invertDelta
          />
          <MetricCard
            label="Active projects"
            value={`${agg?.activeProjects ?? 0}`}
            delta={null}
          />
        </div>

        {/* Projects section */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-900">Your projects</h2>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              metric={projectMetricsMap.get(project.id)}
            />
          ))}
          {createProjectAccess && (
            <Link
              href={createProjectRoute(orgId)}
              className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 transition-colors hover:border-slate-400 hover:text-slate-600"
            >
              <PlusIcon size={20} />
              <span className="mt-1 text-xs font-medium">Add project</span>
            </Link>
          )}
        </div>

        {/* Quick links footer */}
        <div className="flex flex-wrap items-center gap-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <Link
            href="https://langfuse.com/docs"
            target="_blank"
            className="flex items-center gap-1.5 hover:text-slate-900"
          >
            <BookOpen size={13} /> Docs
          </Link>
          <Link
            href={`/organization/${orgId}/settings`}
            className="flex items-center gap-1.5 hover:text-slate-900"
          >
            <KeyRound size={13} /> API keys
          </Link>
          <Link
            href="https://langfuse.com/docs/ask-ai"
            target="_blank"
            className="flex items-center gap-1.5 hover:text-slate-900"
          >
            <MessageSquareText size={13} /> Ask AI
          </Link>
          <Link
            href={`/organization/${orgId}/settings/members`}
            className="flex items-center gap-1.5 hover:text-slate-900"
          >
            <Users size={13} /> Invite members
          </Link>
        </div>
      </div>
    </ContainerPage>
  );
};

/* ───────────────────────────────────────────────────────
 * Demo org tile (unchanged)
 * ─────────────────────────────────────────────────────── */
const DemoOrganizationTile = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Try Langfuse Demo</CardTitle>
      </CardHeader>
      <CardContent>
        We have built a Q&A chatbot that answers questions based on the Langfuse
        Docs. Interact with it to see traces in Langfuse.
      </CardContent>
      <CardFooter>
        <Button asChild variant="secondary">
          <Link href={`/project/${env.NEXT_PUBLIC_DEMO_PROJECT_ID}/traces`}>
            View Demo Project
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
};

/* ───────────────────────────────────────────────────────
 * Multi-org list tile (fallback)
 * ─────────────────────────────────────────────────────── */
const OrganizationActionButtons = ({
  orgId,
  primaryButtonVariant = "default",
}: {
  orgId: string;
  primaryButtonVariant?: "default" | "secondary";
}) => {
  const membersViewAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "organizationMembers:read",
  });
  const createProjectAccess = useHasOrganizationAccess({
    organizationId: orgId,
    scope: "projects:create",
  });

  return (
    <>
      <Button asChild variant="ghost">
        <Link href={`/organization/${orgId}/settings`}>
          <Settings size={14} />
        </Link>
      </Button>
      {membersViewAccess && (
        <Button asChild variant="ghost">
          <Link href={`/organization/${orgId}/settings/members`}>
            <Users size={14} />
          </Link>
        </Button>
      )}
      {createProjectAccess ? (
        <Button asChild variant={primaryButtonVariant}>
          <Link href={createProjectRoute(orgId)}>
            <PlusIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            New project
          </Link>
        </Button>
      ) : (
        <Button disabled variant={primaryButtonVariant}>
          <LockIcon className="mr-2 h-4 w-4" aria-hidden="true" />
          New project
        </Button>
      )}
    </>
  );
};

const OrganizationProjectTilesSimple = ({
  org,
  search,
}: {
  org: User["organizations"][number];
  search?: string;
}) => {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {org.projects
        .filter(
          (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
        )
        .map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <CardTitle className="truncate text-base">
                {project.name}
              </CardTitle>
            </CardHeader>
            {!project.deletedAt ? (
              <CardFooter className="gap-2">
                <Button asChild variant="secondary">
                  <Link href={`/project/${project.id}`}>Go to project</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href={`/project/${project.id}/settings`}>
                    <Settings size={16} />
                  </Link>
                </Button>
              </CardFooter>
            ) : (
              <CardContent>
                <CardDescription>Project is being deleted</CardDescription>
              </CardContent>
            )}
          </Card>
        ))}
    </div>
  );
};

const SingleOrganizationProjectOverviewTile = ({
  orgId,
  search,
}: {
  orgId: string;
  search?: string;
}) => {
  const session = useSession();
  const org = session.data?.user?.organizations.find((o) => o.id === orgId);

  if (!org) return null;

  const isDemoOrg =
    env.NEXT_PUBLIC_DEMO_ORG_ID === orgId &&
    org.projects.some((p) => p.id === env.NEXT_PUBLIC_DEMO_PROJECT_ID);

  if (isDemoOrg) {
    return (
      <div key={orgId}>
        <DemoOrganizationTile />
      </div>
    );
  }

  return (
    <div key={orgId} className="mb-10">
      <Header
        title={org.name}
        className="truncate"
        status={orgId === env.NEXT_PUBLIC_DEMO_ORG_ID ? "Demo Org" : undefined}
        label={
          isCloudPlan(org.plan)
            ? {
                text: planLabels[org.plan],
                href: `/organization/${org.id}/settings/billing`,
              }
            : undefined
        }
        actionButtons={
          <OrganizationActionButtons
            orgId={orgId}
            primaryButtonVariant="secondary"
          />
        }
      />
      <OrganizationProjectTilesSimple org={org} search={search} />
    </div>
  );
};

/* ───────────────────────────────────────────────────────
 * Entry point — auto-redirects root to welcome-hero dashboard
 * ─────────────────────────────────────────────────────── */
export const OrganizationProjectOverview = () => {
  const router = useRouter();
  const queryOrgId = router.query.organizationId as string | undefined;
  const session = useSession();
  const canCreateOrg = session.data?.user?.canCreateOrganizations;
  const organizations = session.data?.user?.organizations;
  const [{ search }, setQueryParams] = useQueryParams({ search: StringParam });

  if (organizations === undefined) {
    return "loading...";
  }

  const showOnboarding =
    organizations.filter((org) => org.id !== env.NEXT_PUBLIC_DEMO_ORG_ID)
      .length === 0 && !queryOrgId;

  // Specific org selected via URL → welcome-hero dashboard
  if (queryOrgId) {
    const org = organizations.find((o) => o.id === queryOrgId);
    if (!org) return null;
    return (
      <SingleOrganizationPage orgId={org.id} search={search ?? undefined} />
    );
  }

  // Root path → auto-show first real org's dashboard (skip multi-org list)
  const realOrgs = organizations.filter(
    (o) => o.id !== env.NEXT_PUBLIC_DEMO_ORG_ID,
  );
  if (realOrgs.length >= 1 && !showOnboarding) {
    return (
      <SingleOrganizationPage
        orgId={realOrgs[0].id}
        search={search ?? undefined}
      />
    );
  }

  // Fallback: onboarding empty state + multi-org list
  return (
    <ContainerPage
      headerProps={{
        title: "Organizations",
        help: {
          description:
            "Organizations help you manage access to projects. Each organization can have multiple projects and team members with different roles.",
          href: "https://langfuse.com/docs/rbac",
        },
        breadcrumb: [{ name: "Organizations", href: "/" }],
        actionButtonsRight: (
          <>
            <Input
              className="mr-1 w-36 lg:w-56"
              placeholder="Search projects"
              onChange={(e) => setQueryParams({ search: e.target.value })}
            />
            {canCreateOrg && (
              <Button data-testid="create-organization-btn" asChild>
                <Link href={createOrganizationRoute}>
                  <PlusIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  New Organization
                </Link>
              </Button>
            )}
          </>
        ),
      }}
    >
      {showOnboarding && <Onboarding />}
      {organizations
        .sort((a, b) => {
          const isDemoA = env.NEXT_PUBLIC_DEMO_ORG_ID === a.id;
          const isDemoB = env.NEXT_PUBLIC_DEMO_ORG_ID === b.id;
          if (isDemoA) return 1;
          if (isDemoB) return -1;
          return 0;
        })
        .map((org) => (
          <Fragment key={org.id}>
            {!queryOrgId && org.id === env.NEXT_PUBLIC_DEMO_ORG_ID && (
              <Separator />
            )}
            <SingleOrganizationProjectOverviewTile
              orgId={org.id}
              search={search ?? undefined}
            />
          </Fragment>
        ))}
    </ContainerPage>
  );
};

/* ───────────────────────────────────────────────────────
 * Onboarding / empty state — unchanged
 * ─────────────────────────────────────────────────────── */
const LangfuseLogo = ({ className }: { className?: string }) => (
  <svg
    width="56"
    height="56"
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect width="120" height="120" rx="24" fill="#0F172A" />
    <path d="M32 86V34h10v42H72v10H32z" fill="#E2E8F0" />
    <path d="M58 86V54h10v32H58z" fill="#818CF8" />
    <path d="M76 86V42h10v44H76z" fill="#6366F1" />
  </svg>
);

const DecoWave = () => (
  <svg
    width="400"
    height="60"
    viewBox="0 0 400 60"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="opacity-[0.06]"
  >
    <path
      d="M0 40 Q50 20 100 35 T200 30 T300 38 T400 25"
      stroke="#6366F1"
      strokeWidth="1.5"
      fill="none"
    />
    <path
      d="M0 50 Q60 30 120 45 T240 35 T360 42 T400 35"
      stroke="#818CF8"
      strokeWidth="1"
      fill="none"
    />
    <circle cx="100" cy="35" r="3" fill="#818CF8" opacity="0.4" />
    <circle cx="200" cy="30" r="2.5" fill="#6366F1" opacity="0.35" />
    <circle cx="300" cy="38" r="3" fill="#A5B4FC" opacity="0.3" />
  </svg>
);

const Onboarding = () => {
  const session = useSession();
  const canCreateOrgs = session.data?.user?.canCreateOrganizations;

  return (
    <>
      <style jsx global>{`
        @keyframes lf-fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes lf-glowPulse {
          0%, 100% { opacity: 0.45; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.65; transform: translate(-50%, -50%) scale(1.08); }
        }
        @keyframes lf-floatSlow {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        .lf-fadeUp-2 { animation: lf-fadeUp 0.7s ease-out 0.12s forwards; opacity: 0; }
        .lf-fadeUp-3 { animation: lf-fadeUp 0.7s ease-out 0.24s forwards; opacity: 0; }
        .lf-fadeUp-4 { animation: lf-fadeUp 0.7s ease-out 0.36s forwards; opacity: 0; }
        .lf-fadeUp-5 { animation: lf-fadeUp 0.7s ease-out 0.48s forwards; opacity: 0; }
        .lf-fadeUp-6 { animation: lf-fadeUp 0.7s ease-out 0.58s forwards; opacity: 0; }
        .lf-logo-float {
          animation: lf-fadeUp 0.7s ease-out forwards,
            lf-floatSlow 5s ease-in-out 1s infinite;
        }
        .lf-glow { animation: lf-glowPulse 6s ease-in-out infinite; }
        .lf-cta-btn { transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
        .lf-cta-btn:hover {
          transform: translateY(-1.5px);
          box-shadow: 0 2px 6px rgba(67, 56, 202, 0.3), 0 8px 24px rgba(67, 56, 202, 0.2);
        }
        .lf-cta-btn:active { transform: translateY(0px); }
        .lf-cta-btn .lf-arrow { transition: transform 0.25s ease; }
        .lf-cta-btn:hover .lf-arrow { transform: translateX(3px); }
      `}</style>

      <div
        className="relative mt-4 flex min-h-[520px] items-center justify-center overflow-hidden rounded-xl border border-slate-200/70"
        data-testid="create-new-project-title"
      >
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "linear-gradient(145deg, #F0F4FF 0%, #F5F3FF 35%, #FAFBFC 70%, #F0FAFF 100%)",
          }}
        />
        <div
          className="absolute inset-0 z-[1]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="lf-glow pointer-events-none absolute z-[2]"
          style={{
            top: "36%",
            left: "50%",
            width: 380,
            height: 380,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(129, 140, 248, 0.12) 0%, rgba(129, 140, 248, 0.04) 40%, transparent 70%)",
            transform: "translate(-50%, -50%)",
          }}
        />

        <div className="relative z-[5] flex flex-col items-center gap-0 pb-14">
          <div className="lf-logo-float mb-7 drop-shadow-[0_2px_12px_rgba(99,102,241,0.12)]">
            <LangfuseLogo />
          </div>

          <h2 className="lf-fadeUp-2 mb-2.5 text-center text-2xl font-semibold tracking-tight text-slate-900">
            Start building your workspace
          </h2>
          <p className="lf-fadeUp-3 mb-7 text-center text-sm font-normal text-slate-500">
            Create your first project or organize your data
          </p>

          <div className="lf-fadeUp-4 flex items-center gap-3">
            {canCreateOrgs && (
              <Button
                asChild
                data-testid="create-project-btn"
                className="lf-cta-btn relative overflow-hidden rounded-[10px] bg-indigo-700 px-7 py-2.5 text-sm font-medium text-white shadow-[0_1px_3px_rgba(67,56,202,0.25),0_4px_14px_rgba(67,56,202,0.15)] hover:bg-indigo-800"
              >
                <Link href={createOrganizationRoute}>
                  <PlusIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                  New Organization
                  <span className="lf-arrow ml-1.5 inline-flex">
                    <ArrowRight size={15} />
                  </span>
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className="rounded-[10px] border-slate-200 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              <Link href="https://langfuse.com/docs" target="_blank">
                <BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />
                Docs
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-[10px] border-slate-200 text-sm font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              <Link href="https://langfuse.com/docs/ask-ai" target="_blank">
                <MessageSquareText className="mr-2 h-4 w-4" aria-hidden="true" />
                Ask AI
              </Link>
            </Button>
          </div>

          <div className="lf-fadeUp-5 mt-9 flex items-center gap-2.5">
            {["Traces", "Prompts", "Evaluations", "Datasets"].map(
              (label, i) => (
                <Fragment key={label}>
                  {i > 0 && <span className="text-sm text-slate-300">·</span>}
                  <span className="text-xs tracking-wide text-slate-400">
                    {label}
                  </span>
                </Fragment>
              ),
            )}
          </div>

          {!canCreateOrgs && (
            <p className="lf-fadeUp-6 mt-6 text-center text-xs text-slate-400">
              Ask your organization admin to invite you to get started.
            </p>
          )}
        </div>

        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[3] -translate-x-1/2">
          <DecoWave />
        </div>
      </div>
    </>
  );
};



