##you need node 24 version and postgreSQL db


npm install -g pnpm

pnpm install --ignore-scripts   or   npm install   or  pnpm install 
pnpm --filter web add date-fns

###if you use personal hotspot then you can directly run npx prisma generate without below
set NODE_TLS_REJECT_UNAUTHORIZED=0    or in gitbash export NODE_TLS_REJECT_UNAUTHORIZED=0         #######optional

pnpm add cross-spawn -w
npm install -g turbo
npm install -g dotenv-cli

cd packages/shared


npx prisma generate   ##to generate prisma client

npx prisma db push  or npx prisma migrate deploy     ###Directly syncs schema to DB
 npm run dev  or pnpm dev 




optional if face issue during pnpm install 
rm -rf node_modules pnpm-lock.yaml
pnpm install

#########################################
##.env
DATABASE_URL=postgresql://postgres:vinPostgreSQL&@localhost:5432/langfuse
DIRECT_URL=postgresql://postgres:vinPostgreSQL&@localhost:5432/langfuse




NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=secret

SALT=salt
ENCRYPTION_KEY=12345678901234567890123456789012

# Disable heavy dependencies for now
CLICKHOUSE_URL=""
CLICKHOUSE_MIGRATION_URL=""

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_AUTH=


######################################


npx prisma generate
npx prisma db push




###################################
##postrgesql
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost

CREATE DATABASE langfuse;



localhost:3000

---

# Langfuse: Overall Codeflow & Architecture Summary

## 1. Core Architecture
Langfuse is an open-source LLM Observability structured as a modern Monorepo using `pnpm` and `turbo`. It typically connects with a **PostgreSQL** database (via Prisma) for relational data and optionally **Clickhouse** for heavier analytical workloads.

### High-level Modules:
- **`web/`**: A Next.js application that contains both the React Frontend (Pages & App Router) and the Node.js API layer. It provides the central dashboard interface for developers and admins to view traces, manage prompts, and analyze costs.
- **`worker/`**: A background NodeJS service utilizing queues (Redis, BullMQ). It consumes logs dynamically from ingestion APIs, manages background jobs, processes data asynchronously, and handles things like database migrations.
- **`packages/`**: Shared libraries for both `web` and `worker`. Most importantly, `packages/shared` holds the core application logic including the **Prisma database models** (`packages/shared/prisma/schema.prisma`), Type Definitions, validation logic, encryption helpers, and data structure schemas.
- **`ee/`**: Contains the "Enterprise Edition" implementation, incorporating advanced features like Role-Based Access Control (RBAC), advanced billing limits, audit logs, etc.

## 2. Main Functionalities & Data Models
The core abstractions are designed to give teams full visibility into LLM applications.
- **Observability (Traces & Observations):** Application telemetry streams in as **Traces** (sessions encompassing multiple steps). Each Trace holds **Observations**, which represent granular LLM interactions (like generations, events, span).
- **Prompt Management:** Developers can centrally manage Prompts (`Prompt` model). They are versioned, tagged, and tied to specific projects.
- **Evaluations & Scoring:** Manual/Automated feedback loops are handled by `AnnotationQueue`, `AnnotationQueueItem`, and `Score` models. Users can score individual completions, helping quantify accuracy, tone, and correctness.
- **Projects & Multi-Tenancy:** Everything cascades under a `Project`, nested under an `Organization`. Access via API requires `ApiKey` linked to specific projects. Users are managed through `User`, `Account` and `Membership` bindings.

## 3. Request / Data Codeflow
### 1. **Ingestion (Data Collection)**
- SDKs (e.g. Langchain integrations, Python/JS SDKs) send POST requests containing execution timings, prompt inputs, models used, tokens, and outputs to the **Next.js `/api` ingestion endpoints** within `web/src/pages/api` or `web/src/app/api`.
- For scale, these requests don't hit the primary Postgres database sequentially. They use queuing middleware (often Redis / `worker` process via queues) to be asynchronously batched or stream-processed.

### 2. **Processing (`worker`)**
- Asynchronous tasks like mapping token usage to cost metrics, storing log items, or updating analytical data (in ClickHouse, if enabled) execute in the `worker/`. This keeps the API ingestion response time in low-latency (e.g., <50ms response to the SDK).

### 3. **Presentation & Exploration (`web`)**
- The Next.js frontend retrieves data through robust API interfaces (like `tRPC` in `web/src/server/api`). 
- Features inside `web/src/features` handle logic, pulling data for dynamic dashboards (UI traces, project overview, LLM cost analysis, prompt builder) using React Hooks bindings tailored for tRPC/REST.

## 4. Development Workflow
- When adding new data requirements: modify `packages/shared/prisma/schema.prisma`, then run `npx prisma generate` and `npx prisma db push`.
- Database schemas synchronize first, meaning frontend (`web`) and backend (`worker`) can immediately consume type-safe database queries.
- UI changes go mostly into `web/src/features` (which isolate feature states like Prompts vs Organizations vs Datasets) and are surfaced via `web/src/pages`.