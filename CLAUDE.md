# CLAUDE.md — openclaw-acp Codebase Guide

This file provides AI assistants with a complete orientation to the `openclaw-acp` repository: its structure, development conventions, key workflows, and common tasks.

---

## Overview

**openclaw-acp** is a TypeScript CLI and seller runtime for the **Agent Commerce Protocol (ACP)** by Virtuals Protocol. It allows AI agents to:

- **Buy** — search a marketplace and hire specialist agents for tasks
- **Sell** — register service offerings and accept paid jobs from other agents
- **Manage wallets** — transact on Base chain with an auto-provisioned agent identity
- **Launch tokens** — capital formation via agent token issuance
- **Automate** — built-in skills for bounty polling, token scanning, partner outreach, etc.
- **Deploy** — ship the seller runtime to Railway for 24/7 cloud operation

---

## Tech Stack

| Technology                                  | Purpose                                            |
| ------------------------------------------- | -------------------------------------------------- |
| TypeScript (strict, ES2022, Node16 modules) | Primary language                                   |
| `tsx`                                       | Direct TypeScript execution (no build step needed) |
| `axios`                                     | HTTP client for all REST API calls                 |
| `socket.io-client`                          | WebSocket connection for seller runtime            |
| `telegraf`                                  | Telegram bot integration                           |
| `node-cron`                                 | Cron scheduling for automation skills              |
| `p-queue`                                   | Promise queue / rate limiting                      |
| `dotenv`                                    | Environment variable loading                       |
| Prettier + Husky                            | Code formatting enforced via pre-commit hooks      |

---

## Directory Structure

```
openclaw-acp/
├── bin/
│   └── acp.ts               # CLI entry point — argument parsing, routing, help text
├── src/
│   ├── commands/            # One file per CLI command group
│   │   ├── agent.ts         # acp agent list|create|switch
│   │   ├── bounty.ts        # acp bounty create|list|status|select
│   │   ├── deploy.ts        # acp serve deploy railway|status|teardown|logs
│   │   ├── job.ts           # acp job create|status|active|completed
│   │   ├── profile.ts       # acp profile show|update
│   │   ├── resource.ts      # acp sell resource create|delete|query
│   │   ├── search.ts        # acp browse <query>
│   │   ├── sell.ts          # acp sell init|create|delete|list|inspect
│   │   ├── serve.ts         # acp serve start|stop|status|logs
│   │   ├── setup.ts         # acp setup|login|whoami
│   │   ├── token.ts         # acp token launch|info
│   │   └── wallet.ts        # acp wallet address|balance|topup
│   ├── lib/                 # Shared utilities
│   │   ├── api.ts           # ACP API wrappers (offerings, resources, payments)
│   │   ├── auth.ts          # Login, session tokens, agent APIs
│   │   ├── bounty.ts        # Bounty lifecycle helpers + local storage
│   │   ├── client.ts        # Axios instance (base URL + auth header)
│   │   ├── config.ts        # Read/write config.json
│   │   ├── open.ts          # Open URLs in browser
│   │   ├── openclawCron.ts  # Cron job management for bounty polling
│   │   ├── output.ts        # Dual-mode output (JSON vs human-readable)
│   │   └── wallet.ts        # Wallet queries (address, balance)
│   ├── seller/
│   │   ├── offerings/       # Offering directories (one folder per offering)
│   │   │   ├── <agent-name>/
│   │   │   │   └── <offering-name>/
│   │   │   │       ├── offering.json  # Metadata, fee, schema, SLA
│   │   │   │       └── handlers.ts    # Runtime logic
│   │   └── runtime/         # Seller WebSocket runtime
│   │       ├── acpSocket.ts     # Socket.IO connection management
│   │       ├── offerings.ts     # Loader and validator for offering directories
│   │       ├── offeringTypes.ts # Handler type definitions
│   │       ├── seller.ts        # Main runtime entry point
│   │       ├── sellerApi.ts     # ACP seller APIs (accept/reject/pay/deliver)
│   │       └── types.ts         # AcpJobPhase enum
│   ├── skills/              # Autonomous automations (not CLI commands)
│   │   ├── bountyPoller.ts      # Poll bounty candidates every 10 min
│   │   ├── failureGuard.ts      # Job failure recovery
│   │   ├── goplus.ts            # Token verification via GoPlus API
│   │   ├── newTokenScanner.ts   # Detect new tokens on Base chain
│   │   ├── partnerOutreach.ts   # Partner communication automation
│   │   ├── receipt.ts           # Job receipt tracking
│   │   ├── risk.ts              # Multi-chain token risk analysis
│   │   ├── rugcheck.ts          # Token rugpull detection
│   │   ├── upsell.ts            # Cross-sell automation
│   │   └── watch.ts             # Job execution monitoring
│   ├── deploy/
│   │   ├── docker.ts        # Docker image generation
│   │   └── railway.ts       # Railway deployment logic
│   ├── memory/
│   │   └── compaction.ts    # Memory compaction utility
│   ├── types/
│   │   └── receipt.ts       # Job receipt type definitions
│   ├── entry.ts             # HTTP server entry point (health + /r/risk + Telegram webhook)
│   ├── telegramBot.ts       # Telegram bot command handlers
│   └── taskOps.ts           # Task operations utility
├── references/              # Detailed usage guides (Markdown)
│   ├── acp-job.md
│   ├── agent-token.md
│   ├── agent-wallet.md
│   ├── bounty.md
│   ├── deploy.md
│   └── seller.md
├── scripts/
│   └── sync_offerings.sh    # Sync offering directories
├── .env.example             # Environment variable template
├── .prettierrc              # Formatting config
├── config.json              # Runtime config (git-ignored; API keys, session, agents)
├── active-bounties.json     # Local bounty state (git-ignored)
├── package.json
├── tsconfig.json
├── README.md                # Human-facing quick start
└── SKILL.md                 # AI agent skill documentation
```

---

## Running the Project

### Prerequisites

```bash
npm install   # Install all dependencies from repo root
cp .env.example .env  # Then fill in values if needed
```

### CLI Commands

All commands use `tsx` to run TypeScript directly — no build step needed.

```bash
# Run any CLI command
npx tsx bin/acp.ts <command> [subcommand] [args]
# Or via npm scripts:
npm run acp -- <command> [subcommand] [args]

# Common shortcuts
npm run setup              # Interactive setup (login + agent selection)
npm run seller:run         # Start seller runtime (acp serve start)
npm run seller:stop        # Stop seller runtime
npm run seller:check       # Check seller runtime status
```

### Server Entry Point

```bash
npm start     # Starts HTTP server (src/entry.ts) on PORT (default 8080)
```

HTTP routes:

- `GET /health` — health check, returns `{ok: true}`
- `GET /r/risk?tokenAddress=0x...` — token risk analysis (via Resource API)
- `POST /telegram-webhook` — Telegram bot webhook (requires `TELEGRAM_ENABLED=1`)

---

## Environment Variables

Defined in `.env.example` and loaded via `dotenv`:

| Variable             | Default                        | Description                           |
| -------------------- | ------------------------------ | ------------------------------------- |
| `ACP_API_URL`        | `https://claw-api.virtuals.io` | Main ACP REST API                     |
| `ACP_AUTH_URL`       | `https://acpx.virtuals.io`     | Auth and agent management             |
| `ACP_BOUNTY_API_URL` | `https://bounty.virtuals.io`   | Bounty system                         |
| `ACP_SOCKET_URL`     | `https://acpx.virtuals.io`     | Seller WebSocket                      |
| `PORT`               | `8080`                         | HTTP server port                      |
| `TELEGRAM_ENABLED`   | —                              | Set to `1` to enable Telegram webhook |
| `TELEGRAM_BOT_TOKEN` | —                              | Telegram bot token                    |

**Runtime config** is stored in `config.json` (git-ignored):

```typescript
interface ConfigJson {
  SESSION_TOKEN?: { token: string }; // 30-min expiry auth token
  LITE_AGENT_API_KEY?: string; // Active agent API key
  SELLER_PID?: number; // PID of running seller process
  OPENCLAW_BOUNTY_CRON_JOB_ID?: string;
  agents?: AgentEntry[]; // All known agents
  DEPLOYS?: Record<string, DeployInfo>;
}
```

---

## Key Patterns and Conventions

### Output Mode (dual-mode)

All CLI commands support both human-readable and machine-readable output via `src/lib/output.ts`.

```typescript
import { output, log, error, json } from "../lib/output.js";

// Dual-mode: pretty for humans, JSON for agents/scripts
output(data, (d) => `Agent: ${d.name} — ${d.description}`);

// Always JSON (for structured data responses)
json({ jobId: 123, phase: "COMPLETED" });

// Human text only (logs, progress messages)
log("Starting job polling...");

// Errors (exits with code 1)
error("Failed to connect to ACP");
```

- Use `--json` flag or `ACP_JSON=1` env var to get JSON output
- Always use `--json` when calling CLI from scripts or other code
- TTY detection is automatic; ANSI colors are stripped for non-TTY output

### Config Management

```typescript
import { readConfig, getActiveAgent, activateAgent } from "../lib/config.js";

const config = readConfig(); // Read config.json
const agent = getActiveAgent(config); // Get the currently active agent
activateAgent(agentId, config); // Switch active agent
```

### HTTP Client

```typescript
import client from "../lib/client.js"; // Pre-configured axios instance
// Automatically sets Authorization header with active agent API key
const res = await client.get("/acp/jobs/active");
```

### TypeScript / ESM Conventions

- All imports must use `.js` extension (even for `.ts` source files) — required by Node16 ESM:
  ```typescript
  import { readConfig } from "../lib/config.js"; // correct
  import { readConfig } from "../lib/config"; // wrong — will fail at runtime
  ```
- Module type is `"module"` in `package.json` (ESM throughout)
- `strict` mode is enabled in `tsconfig.json` — no implicit `any`
- Target: ES2022, Module resolution: Node16

### Naming Conventions

- **Offering names**: lowercase, alphanumeric + underscores, starts with a letter: `token_risk_quick`, `suicatap_beep`
- **File names**: camelCase for source files (`acpSocket.ts`, `offeringTypes.ts`)
- **Offering directories**: `src/seller/offerings/<agent-name>/<offering-name>/`
- **Variables/functions**: camelCase
- **Types/interfaces**: PascalCase

### Error Handling

```typescript
try {
  const res = await client.post("/acp/jobs", payload);
  return res.data;
} catch (err: any) {
  const msg = err.response?.data?.message ?? err.message ?? String(err);
  error(`Failed to create job: ${msg}`); // exits with code 1
}
```

---

## Seller Runtime

### Job Lifecycle (AcpJobPhase)

```
REQUEST (0) → NEGOTIATION (1) → TRANSACTION (2) → EVALUATION (3) → COMPLETED (4)
                                                                  ↘ REJECTED (5)
                                                                  ↘ EXPIRED (6)
```

1. **REQUEST** — Seller receives job request; calls `validateRequirements` (optional), then accepts or rejects
2. **NEGOTIATION** — Seller calls `requestPayment` with amount; buyer pays
3. **TRANSACTION** — Seller may call `requestAdditionalFunds` if extra payment needed
4. **EVALUATION** — Seller calls `executeJob`, delivers result; job completes

### Handler Interface

Every offering must export these from `handlers.ts`:

```typescript
import { OfferingHandlers } from "../../../runtime/offeringTypes.js";

const handlers: OfferingHandlers = {
  // Required: execute the job and return the deliverable
  async executeJob(request) {
    return { deliverable: "result string or object" };
  },

  // Optional: validate input before accepting
  validateRequirements(request) {
    if (!request.tokenAddress) return { valid: false, reason: "tokenAddress required" };
    return true;
  },

  // Optional: customize payment request message
  requestPayment(request) {
    return "Please send 0.05 USDC to proceed.";
  },

  // Optional: request additional funds mid-job
  async requestAdditionalFunds(request) {
    return { amount: 0.1, tokenAddress: "0x...", recipient: "0x..." };
  },
};

export default handlers;
```

### Offering Metadata (`offering.json`)

```json
{
  "name": "my_offering",
  "description": "What this offering does",
  "priceV2": { "type": "fixed", "value": 0.05 },
  "slaMinutes": 10,
  "requiredFunds": false,
  "requirement": {
    "type": "object",
    "properties": {
      "tokenAddress": { "type": "string", "description": "EVM token address (0x...)" }
    },
    "required": ["tokenAddress"]
  },
  "deliverable": "JSON object with risk verdict and score",
  "resources": []
}
```

---

## Adding a New Offering

1. Create directory: `src/seller/offerings/<agent-name>/<offering-name>/`
2. Create `offering.json` with metadata (name, description, fee, requirement schema, SLA)
3. Create `handlers.ts` exporting an `OfferingHandlers` default export
4. Register with ACP: `npm run offering:create` (or `acp sell create`)
5. Start/restart the seller runtime: `npm run seller:run`

---

## Adding a New CLI Command

1. Create `src/commands/<command>.ts` with exported async functions for each subcommand
2. Add routing in `bin/acp.ts` — follow existing `if/else if` pattern for command dispatch
3. Use `output()` from `src/lib/output.ts` for all user-facing output
4. Use `client` from `src/lib/client.ts` for API calls
5. Support `--json` flag (handled globally by `output.ts`)

---

## Code Formatting

Prettier is enforced via a pre-commit hook (Husky + lint-staged).

```bash
npm run format          # Format all files
npm run format:check    # Check formatting without writing
```

Prettier config (`.prettierrc`):

- Double quotes
- Semicolons on
- 2-space indent
- 100-character line width
- Trailing commas (ES5)

**Never skip the pre-commit hook.** If a commit fails due to formatting, run `npm run format` and re-stage.

---

## Testing

There is no unit test framework. Tests are integration-level bash scripts:

```bash
./test-cli.sh      # CLI smoke tests (setup, search, job, token, wallet)
./test-bounty.sh   # Bounty lifecycle tests
```

When making changes:

- Test manually with relevant `acp` commands
- Use `--json` flag to validate machine-readable output
- Check seller runtime logs: `acp serve logs [--offering <name>] [--job <id>]`

---

## External APIs

| API            | Base URL                       | Purpose                            |
| -------------- | ------------------------------ | ---------------------------------- |
| ACP REST API   | `https://claw-api.virtuals.io` | Job offerings, marketplace, wallet |
| ACP Auth API   | `https://acpx.virtuals.io`     | Agent management, session tokens   |
| ACP Bounty API | `https://bounty.virtuals.io`   | Bounty creation and polling        |
| ACP Socket     | `https://acpx.virtuals.io`     | Seller WebSocket (Socket.IO)       |
| DexScreener    | Public                         | DEX pair data for token analysis   |
| Honeypot.is    | Public                         | Honeypot detection                 |
| GoPlus         | Public                         | Token security verification        |
| Rugcheck       | Public                         | Rugpull detection                  |

---

## Data Types Reference

### Agent

```typescript
interface Agent {
  id: number;
  name: string;
  description: string;
  contractAddress: string;
  walletAddress: string;
  metrics: {
    successfulJobCount: number | null;
    successRate: number | null;
    uniqueBuyerCount: number | null;
    minsFromLastOnlineTime: number | null;
    isOnline: boolean;
  };
  jobs: AgentJob[];
  resources: AgentResource[];
}
```

### ACP Job Event

```typescript
enum AcpJobPhase {
  REQUEST = 0,
  NEGOTIATION = 1,
  TRANSACTION = 2,
  EVALUATION = 3,
  COMPLETED = 4,
  REJECTED = 5,
  EXPIRED = 6,
}

interface AcpJobEventData {
  id: number;
  phase: AcpJobPhase;
  clientAddress: string;
  providerAddress: string;
  evaluatorAddress: string;
  price: number;
  memos: AcpMemoData[];
  context: Record<string, any>;
  memoToSign?: number;
}
```

### Bounty

```typescript
interface ActiveBounty {
  bountyId: string;
  createdAt: string;
  title: string;
  description: string;
  budget: number;
  tags: string[];
  poster_secret: string;
  status: "open" | "pending_match" | "claimed" | "completed" | "expired";
  linkedJobId?: number;
  candidates?: any[];
  requirementSchema?: Record<string, any>;
}
```

---

## Common Tasks for AI Assistants

### "Add a new token analysis offering"

1. Read `src/seller/offerings/suicatap/suicatap_beep/` as a reference
2. Create new directory under `src/seller/offerings/<agent-name>/<offering-name>/`
3. Write `offering.json` with appropriate schema and fee
4. Write `handlers.ts` calling the target API and returning a structured deliverable
5. Register: `acp sell create`

### "Add a new CLI subcommand"

1. Read `bin/acp.ts` to understand routing and help text conventions
2. Read `src/commands/search.ts` or `src/commands/job.ts` as style references
3. Add the handler function, add routing in `bin/acp.ts`, add help text
4. Use `output()` for all output, never `console.log` directly

### "Fix a seller runtime issue"

1. Read `src/seller/runtime/seller.ts` to understand job event handling
2. Read `src/seller/runtime/sellerApi.ts` for API call details
3. Check seller logs: `acp serve logs`

### "Add a new automation skill"

1. Read `src/skills/bountyPoller.ts` as a reference pattern
2. Create `src/skills/<skill-name>.ts`
3. Export a function that can be called on a schedule or event
4. Register in the appropriate entry point (e.g., `src/entry.ts` or `src/seller/runtime/seller.ts`)

---

## Git Workflow

- Main branch: `master`
- Feature branches follow the pattern `claude/<description>-<id>`
- Commit messages are descriptive and lowercase (e.g., `fix /risk: use Resource API`)
- Run `npm run format` before committing to pass the pre-commit hook
- Push with: `git push -u origin <branch-name>`

---

## Important Files to Know

| File                                  | Why It Matters                                                       |
| ------------------------------------- | -------------------------------------------------------------------- |
| `bin/acp.ts`                          | All CLI routing lives here; touch this when adding/changing commands |
| `src/lib/output.ts`                   | Dual-mode output — use this for all user-facing messages             |
| `src/lib/client.ts`                   | Pre-configured HTTP client — always use this for ACP API calls       |
| `src/lib/config.ts`                   | Config read/write — use this to access agent credentials             |
| `src/seller/runtime/offeringTypes.ts` | Handler interface — check this when writing offering handlers        |
| `src/seller/runtime/types.ts`         | `AcpJobPhase` enum — reference this for job lifecycle logic          |
| `.env.example`                        | Canonical list of all environment variables                          |
| `SKILL.md`                            | Detailed AI agent usage guide for the ACP skill                      |
| `references/seller.md`                | Step-by-step guide for creating and registering offerings            |

# Last updated: 2026-03-05

## Setup: complete

---

## SuicaTap Agent Context

### Agent Info

- Name: SuicaTap
- Wallet: 0x342186a2a0B958e57ebE159dCD3E16B52725aEe3
- Goal: Graduation (50 jobs + 80% success rate)
- Platform: app.virtuals.io

### Known Constraints

- honeypot.is is BLOCKED on Railway → always use internal Resource API endpoints
- Never use process.exit(1) in entry.ts context → use non-fatal error logging

### Test Tokens

- EVM: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 (USDC on Base)
- Solana: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

### Current Offerings (13개)

suicatap_ping_free $0.01, suicatap_beep $0.05, suicatap_solana_risk $0.05,
suicatap_trending $0.02, suicatap_policy_gate $0.02, suicatap_compare $0.03,
suicatap_batch $0.15, suicatap_monitor $0.10, suicatap_tx_preflight $0.15,
suicatap_execution_gate $0.30, suicatap_wallet_sweep $0.30,
suicatap_report $0.35, suicatap_review $0.00

### After Every Task

테스트 토큰으로 변경된 offering 검증 후 배포
