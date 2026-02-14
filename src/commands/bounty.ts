// =============================================================================
// acp bounty create [query]
// acp bounty list
// acp bounty status <bountyId>
// acp bounty select <bountyId>
// =============================================================================

import readline from "readline";
import client from "../lib/client.js";
import * as output from "../lib/output.js";
import { getMyAgentInfo } from "../lib/wallet.js";
import {
    type ActiveBounty,
    type BountyCreateInput,
    createBounty,
    getActiveBounty,
    getMatchStatus,
    listActiveBounties,
    removeActiveBounty,
    removeWatchFile,
    rejectCandidates,
    saveActiveBounty,
    syncBountyJobStatus,
    writeWatchFile,
    confirmMatch,
} from "../lib/bounty.js";
import { deleteSecret, readSecret, storeSecret } from "../lib/keychain.js";
import {
    ensureBountyPollCron,
    removeBountyPollCronIfUnused,
} from "../lib/openclawCron.js";

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

function parseCandidateId(raw: unknown): number | null {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
        return parseInt(raw.trim(), 10);
    }
    return null;
}

function candidateField(candidate: any, names: string[]): string | undefined {
    for (const name of names) {
        const value = candidate?.[name];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}

function candidatePriceDisplay(candidate: Record<string, unknown>): string {
    const rawPrice =
        candidate.price ??
        candidate.job_offering_price ??
        candidate.jobOfferingPrice ??
        candidate.job_fee ??
        candidate.jobFee ??
        candidate.fee;
    const rawType =
        candidate.priceType ??
        candidate.price_type ??
        candidate.jobFeeType ??
        candidate.job_fee_type;

    if (rawPrice == null) return "Unknown";
    const price = String(rawPrice);
    const type = rawType != null ? String(rawType).toLowerCase() : "";
    if (type === "fixed") return `${price} USDC`;
    if (type === "percentage") return `${price} (${type})`;
    return rawType != null ? `${price} ${String(rawType)}` : price;
}

function parseRequirements(requirements?: string): Record<string, unknown> {
    if (!requirements || !requirements.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(requirements);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // Fall through to text wrapper.
    }
    return { requirementsText: requirements };
}

type JsonSchemaProperty = {
    type?: string;
    description?: string;
};

type RequirementSchema = {
    type?: string;
    required?: string[];
    properties?: Record<string, JsonSchemaProperty>;
};

function getCandidateRequirementSchema(candidate: Record<string, unknown>): RequirementSchema | null {
    const schemaCandidate =
        candidate.requirementSchema ??
        candidate.requirement_schema ??
        candidate.requirement;
    if (!schemaCandidate || typeof schemaCandidate !== "object" || Array.isArray(schemaCandidate)) {
        return null;
    }
    return schemaCandidate as RequirementSchema;
}

async function collectRequirementsFromSchema(
    rl: readline.Interface,
    schema: RequirementSchema
): Promise<Record<string, unknown>> {
    const properties = schema.properties ?? {};
    const requiredSet = new Set((schema.required ?? []).filter((k) => typeof k === "string"));
    const keys = Object.keys(properties);
    const out: Record<string, unknown> = {};

    if (keys.length === 0) return out;

    output.log("\n  Fill service requirements:");
    for (const key of keys) {
        const prop = properties[key] ?? {};
        const isRequired = requiredSet.has(key);
        const desc =
            typeof prop.description === "string" && prop.description.trim()
                ? ` - ${prop.description.trim()}`
                : "";
        while (true) {
            const answer = (
                await question(
                    rl,
                    `  ${key}${isRequired ? " [required]" : " [optional]"}${desc}: `
                )
            ).trim();

            if (!answer) {
                if (isRequired) {
                    output.error(`"${key}" is required.`);
                    continue;
                }
                out[key] = "";
                break;
            }
            out[key] = answer;
            break;
        }
    }

    return out;
}

export async function createInteractive(query?: string): Promise<void> {
    if (output.isJsonMode()) {
        output.fatal(
            "Interactive bounty creation is not supported in --json mode. Use human mode."
        );
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        let whoamiName = "";
        try {
            const me = await getMyAgentInfo();
            whoamiName = me.name?.trim() ?? "";
        } catch {
            // Non-fatal fallback to stored profile or manual input.
        }

        const defaultPosterName = whoamiName;
        const poster_name =
            (
                await question(
                    rl,
                    `  Poster name${defaultPosterName ? ` [${defaultPosterName}]` : ""}: `
                )
            ).trim() || defaultPosterName || "";

        if (!poster_name) {
            output.fatal("Poster name is required.");
        }

        const querySeed = query?.trim() || "";
        const defaultTitle = querySeed
            ? `${querySeed}`
            : "Need service provider";
        const defaultDescription = querySeed
            ? `${querySeed}`
            : "Need a provider to fulfill this request.";

        const title =
            (await question(rl, `  Title [${defaultTitle}]: `)).trim() ||
            defaultTitle;
        const description =
            (await question(rl, `  Description [${defaultDescription}]: `)).trim() ||
            defaultDescription;
        const budgetRaw = (await question(rl, "  Budget in USD (number, e.g. 50): ")).trim();
        let categoryInput = "digital";
        while (true) {
            const raw = (
                await question(rl, "  Category [digital|physical] (default: digital): ")
            )
                .trim()
                .toLowerCase();
            if (!raw) {
                categoryInput = "digital";
                break;
            }
            if (raw === "digital" || raw === "physical") {
                categoryInput = raw;
                break;
            }
            output.error('Invalid category. Enter only "digital" or "physical".');
        }
        const tags =
            (await question(rl, `  Tags comma-separated [defi,web3,ai]: `)).trim() ||
            "";

        const budget = Number(budgetRaw);
        if (!Number.isFinite(budget) || budget <= 0) {
            output.fatal("Budget must be a positive number.");
        }
        const payload: BountyCreateInput = {
            poster_name,
            title,
            description,
            budget,
            category: categoryInput,
            tags,
        };

        const created = await createBounty(payload);
        const keychainAccountRef = `bounty:${created.bountyId}:${poster_name}`;
        storeSecret(keychainAccountRef, created.posterSecret);

        const watchPath = writeWatchFile(created.bountyId, {
            bountyId: created.bountyId,
            status: "open",
            createdAt: new Date().toISOString(),
            query: querySeed,
            title,
            budget,
        });

        const active: ActiveBounty = {
            bountyId: created.bountyId,
            createdAt: new Date().toISOString(),
            status: "open",
            title,
            description,
            budget,
            category: categoryInput,
            tags,
            posterName: poster_name,
            keychainAccountRef,
            schedulerWatchPath: watchPath,
        };
        saveActiveBounty(active);
        try {
            const cron = ensureBountyPollCron();
            if (cron.enabled && cron.created) {
                output.log("  OpenClaw cron job registered for `acp bounty poll`.\n");
            }
        } catch (e) {
            output.warn(
                `Failed to register OpenClaw cron poller. You can still poll manually with \`acp bounty poll\`. ${e instanceof Error ? e.message : String(e)
                }`
            );
        }

        output.output(
            {
                bountyId: created.bountyId,
                watchFile: watchPath,
                status: "open",
            },
            (data) => {
                output.heading("Bounty Created");
                output.field("Bounty ID", data.bountyId);
                output.field("Status", data.status);
                output.field("Watch File", data.watchFile);
                output.log(
                    "\n  The OpenClaw scheduler can now monitor this bounty for pending matches.\n"
                );
            }
        );
    } finally {
        rl.close();
    }
}

export async function create(query?: string): Promise<void> {
    return createInteractive(query);
}

export async function list(): Promise<void> {
    const bounties = listActiveBounties();
    output.output({ bounties }, (data) => {
        output.heading("Active Bounties");
        if (data.bounties.length === 0) {
            output.log("  No active bounties.\n");
            return;
        }
        for (const b of data.bounties) {
            output.field("Bounty ID", b.bountyId);
            output.field("Status", b.status);
            output.field("Title", b.title);
            if (b.acpJobId) output.field("ACP Job ID", b.acpJobId);
            output.log("");
        }
    });
}

export async function poll(): Promise<void> {
    const bounties = listActiveBounties();
    const result: {
        checked: number;
        pendingMatch: Array<{
            bountyId: string;
            candidateCount: number;
        }>;
        cleaned: Array<{
            bountyId: string;
            status: string;
        }>;
        errors: Array<{
            bountyId: string;
            error: string;
        }>;
    } = {
        checked: 0,
        pendingMatch: [],
        cleaned: [],
        errors: [],
    };

    for (const b of bounties) {
        result.checked += 1;
        try {
            const remote = await getMatchStatus(b.bountyId);
            const status = String(remote.status).toLowerCase();
            if (status === "fulfilled" || status === "expired" || status === "rejected") {
                removeWatchFile(b.schedulerWatchPath);
                deleteSecret(b.keychainAccountRef);
                removeActiveBounty(b.bountyId);
                result.cleaned.push({ bountyId: b.bountyId, status });
                continue;
            }

            saveActiveBounty({ ...b, status: remote.status });
            if (status === "pending_match") {
                result.pendingMatch.push({
                    bountyId: b.bountyId,
                    candidateCount: Array.isArray(remote.candidates)
                        ? remote.candidates.length
                        : 0,
                });
            }
        } catch (e) {
            result.errors.push({
                bountyId: b.bountyId,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    console.log("in result");

    try {
        removeBountyPollCronIfUnused();
    } catch {
        // non-fatal
    }
    console.log("outputting result");

    output.output(result, (r) => {
        output.heading("Bounty Poll");
        output.field("Checked", r.checked);
        output.field("Pending Match", r.pendingMatch.length);
        output.field("Cleaned", r.cleaned.length);
        output.field("Errors", r.errors.length);
        if (r.pendingMatch.length > 0) {
            output.log("\n  Pending Match:");
            for (const p of r.pendingMatch) {
                output.log(
                    `    - ${p.bountyId} (${p.candidateCount} candidate(s)) -> run: acp bounty select ${p.bountyId}`
                );
            }
        }
        if (r.errors.length > 0) {
            output.log("\n  Errors:");
            for (const err of r.errors) {
                output.log(`    - ${err.bountyId}: ${err.error}`);
            }
        }
        output.log("");
    });
}

export async function status(bountyId: string): Promise<void> {
    if (!bountyId) output.fatal("Usage: acp bounty status <bountyId>");
    const active = getActiveBounty(bountyId);
    if (!active) output.fatal(`Bounty not found in local state: ${bountyId}`);

    const posterSecret = readSecret(active.keychainAccountRef);
    if (!posterSecret) {
        output.warn(
            `Bounty ${bountyId} could not sync job status: missing poster secret in keychain.`
        );
    } else {
        try {
            await syncBountyJobStatus({
                bountyId,
                posterSecret,
            });
        } catch (e) {
            output.warn(
                `Failed to sync bounty job status: ${e instanceof Error ? e.message : String(e)}`
            );
        }
    }

    const remote = await getMatchStatus(bountyId);
    const normalized = String(remote.status).toLowerCase();
    const isTerminal =
        normalized === "fulfilled" || normalized === "expired" || normalized === "rejected";
    const next = { ...active, status: remote.status };
    if (isTerminal) {
        removeWatchFile(active.schedulerWatchPath);
        deleteSecret(active.keychainAccountRef);
        removeActiveBounty(bountyId);
        try {
            removeBountyPollCronIfUnused();
        } catch {
            // non-fatal
        }
    } else {
        saveActiveBounty(next);
    }

    output.output(
        {
            bountyId,
            local: next,
            remote,
        },
        (data) => {
            output.heading(`Bounty ${data.bountyId}`);
            output.field("Status", data.remote.status);
            output.field("Title", data.local.title);
            output.field("Candidates", data.remote.candidates.length);
            if (isTerminal) {
                output.log("  Local bounty record cleaned up (terminal status).");
            }
            output.log("");
        }
    );

    if (!output.isJsonMode() && String(remote.status).toLowerCase() === "pending_match") {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        let shouldSelect = false;
        try {
            const answer = (
                await question(rl, "  Bounty is pending_match. Select provider now? (Y/n): ")
            )
                .trim()
                .toLowerCase();
            shouldSelect = answer === "y" || answer === "yes" || answer === "";
        } finally {
            rl.close();
        }
        if (shouldSelect) {
            await select(bountyId);
        }
    }
}

export async function select(bountyId: string): Promise<void> {
    if (!bountyId) output.fatal("Usage: acp bounty select <bountyId>");
    const active = getActiveBounty(bountyId);
    if (!active) output.fatal(`Bounty not found in local state: ${bountyId}`);
    const posterSecret = readSecret(active.keychainAccountRef);
    if (!posterSecret) {
        output.fatal("Missing poster secret in keychain for this bounty.");
    }

    const match = await getMatchStatus(bountyId);
    if (String(match.status).toLowerCase() !== "pending_match") {
        output.fatal(`Bounty is not pending_match. Current status: ${match.status}`);
    }
    if (!Array.isArray(match.candidates) || match.candidates.length === 0) {
        output.fatal("No candidates available for this bounty.");
    }

    if (output.isJsonMode()) {
        output.output({ bountyId, status: match.status, candidates: match.candidates }, () => { });
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        output.heading(`Select Candidate for Bounty ${bountyId}`);
        for (let i = 0; i < match.candidates.length; i++) {
            const c = match.candidates[i] as Record<string, unknown>;
            const candidateId = parseCandidateId(c.id) ?? -1;
            output.log(
                `  [${i + 1}] candidateId=${candidateId} ${JSON.stringify(c)}`
            );
        }
        output.log("  [0] None of these candidates");

        const choiceRaw = (await question(rl, "  Choose candidate number: ")).trim();
        if (choiceRaw === "0") {
            await rejectCandidates({
                bountyId,
                posterSecret,
            });
            saveActiveBounty({
                ...active,
                status: "open",
                selectedCandidateId: undefined,
                acpJobId: undefined,
            });
            output.log(
                "  Rejected current candidates. Bounty moved back to open for new matching.\n"
            );
            return;
        }
        const idx = parseInt(choiceRaw, 10) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= match.candidates.length) {
            output.fatal("Invalid candidate selection.");
        }
        const selected = match.candidates[idx] as Record<string, unknown>;
        const candidateId = parseCandidateId(selected.id);
        if (candidateId == null) output.fatal("Selected candidate has invalid id.");

        const walletDefault = candidateField(selected, [
            "agent_wallet",
            "agentWallet",
            "agent_wallet_address",
            "agentWalletAddress",
            "walletAddress",
            "providerWalletAddress",
            "provider_address",
        ]);
        const offeringDefault = candidateField(selected, [
            "job_offering",
            "jobOffering",
            "offeringName",
            "jobOfferingName",
            "offering_name",
            "name",
        ]);

        const wallet = walletDefault || "";
        const offering = offeringDefault || "";

        if (!wallet) {
            output.fatal(
                "Selected candidate is missing provider wallet (expected agent_wallet or walletAddress fields)."
            );
        }
        if (!offering) {
            output.fatal(
                "Selected candidate is missing job offering (expected job_offering/offeringName fields)."
            );
        }

        const providerName =
            candidateField(selected, ["agent_name", "agentName", "name"]) || "(unknown)";
        const offeringPrice = candidatePriceDisplay(selected);

        output.log("\n  Selected Candidate");
        output.log("  ------------------");
        output.log(`  Provider: ${providerName}`);
        output.log(`  Wallet:   ${wallet}`);
        output.log(`  Offering: ${offering}`);
        output.log(`  Price:    ${offeringPrice}`);
        const confirm = (
            await question(rl, "\n  Continue and create ACP job for this candidate? (Y/n): ")
        )
            .trim()
            .toLowerCase();
        if (!(confirm === "y" || confirm === "yes" || confirm === "")) {
            output.log("  Candidate selection cancelled.\n");
            return;
        }

        const schema = getCandidateRequirementSchema(selected);
        const serviceRequirements =
            schema != null
                ? await collectRequirementsFromSchema(rl, schema)
                : parseRequirements(active.requirements);

        const job = await client.post<{ data?: { jobId?: number }; jobId?: number }>(
            "/acp/jobs",
            {
                providerWalletAddress: wallet,
                jobOfferingName: offering,
                serviceRequirements,
            }
        );
        const acpJobId = String(job.data?.data?.jobId ?? job.data?.jobId ?? "");
        if (!acpJobId) output.fatal("Failed to create ACP job for selected candidate.");

        await confirmMatch({
            bountyId,
            posterSecret,
            candidateId,
            acpJobId,
        });

        const next: ActiveBounty = {
            ...active,
            status: "claimed",
            selectedCandidateId: candidateId,
            acpJobId,
        };
        removeWatchFile(active.schedulerWatchPath);
        next.schedulerWatchPath = undefined;
        saveActiveBounty(next);

        output.output(
            {
                bountyId,
                candidateId,
                acpJobId,
                status: "claimed",
            },
            (data) => {
                output.heading("Bounty Claimed");
                output.field("Bounty ID", data.bountyId);
                output.field("Candidate ID", data.candidateId);
                output.field("ACP Job ID", data.acpJobId);
                output.field("Status", data.status);
                output.log(
                    `\n  Use \`acp job status <jobId>\` to monitor the ACP job.`
                );
                output.log(
                    `  Then run \`acp bounty status ${data.bountyId}\` to sync/update bounty status.\n`
                );
            }
        );
    } finally {
        rl.close();
    }
}

export async function cleanup(bountyId: string): Promise<void> {
    if (!bountyId) output.fatal("Usage: acp bounty cleanup <bountyId>");
    const active = getActiveBounty(bountyId);
    if (!active) {
        output.log(`  Bounty not found locally: ${bountyId}`);
        return;
    }
    removeWatchFile(active.schedulerWatchPath);
    deleteSecret(active.keychainAccountRef);
    removeActiveBounty(bountyId);
    try {
        removeBountyPollCronIfUnused();
    } catch {
        // non-fatal
    }
    output.log(`  Cleaned up bounty ${bountyId}\n`);
}

