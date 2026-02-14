// =============================================================================
// OpenClaw cron integration for bounty polling.
// =============================================================================

import { execSync } from "child_process";
import { ROOT, readConfig, writeConfig } from "./config.js";
import { listActiveBounties } from "./bounty.js";

const DEFAULT_JOB_ID = "openclaw-acp-bounty-poll";
const DEFAULT_SCHEDULE = "*/10 * * * *";
const DEFAULT_POLL_COMMAND = `cd "${ROOT}" && npx acp bounty poll --json`;
const DEFAULT_ADD_TEMPLATE =
    'openclaw cron add --id "{jobId}" --schedule "{schedule}" --command "{command}"';
const DEFAULT_REMOVE_TEMPLATE = 'openclaw cron remove --id "{jobId}"';

function renderTemplate(
    template: string,
    values: Record<string, string>
): string {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) => values[key] ?? "");
}

function runShell(command: string): void {
    execSync(command, {
        cwd: ROOT,
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf-8",
    });
}

export function getBountyPollCronJobId(): string {
    const cfg = readConfig();
    return (
        cfg.OPENCLAW_BOUNTY_CRON_JOB_ID ||
        process.env.OPENCLAW_BOUNTY_CRON_JOB_ID ||
        DEFAULT_JOB_ID
    );
}

export function ensureBountyPollCron(): { enabled: boolean; created: boolean } {
    if (process.env.OPENCLAW_BOUNTY_CRON_DISABLED === "1") {
        return { enabled: false, created: false };
    }

    const cfg = readConfig();
    if (cfg.OPENCLAW_BOUNTY_CRON_JOB_ID) {
        return { enabled: true, created: false };
    }

    const jobId = getBountyPollCronJobId();
    const schedule =
        process.env.OPENCLAW_BOUNTY_CRON_SCHEDULE?.trim() || DEFAULT_SCHEDULE;
    const command =
        process.env.OPENCLAW_BOUNTY_CRON_POLL_COMMAND?.trim() ||
        DEFAULT_POLL_COMMAND;
    const addTemplate =
        process.env.OPENCLAW_BOUNTY_CRON_ADD_TEMPLATE?.trim() ||
        DEFAULT_ADD_TEMPLATE;

    const rendered = renderTemplate(addTemplate, {
        jobId,
        schedule,
        command,
    });

    runShell(rendered);
    writeConfig({ ...cfg, OPENCLAW_BOUNTY_CRON_JOB_ID: jobId });
    return { enabled: true, created: true };
}

export function removeBountyPollCronIfUnused(): {
    enabled: boolean;
    removed: boolean;
} {
    if (process.env.OPENCLAW_BOUNTY_CRON_DISABLED === "1") {
        return { enabled: false, removed: false };
    }

    const active = listActiveBounties();
    if (active.length > 0) {
        return { enabled: true, removed: false };
    }

    const cfg = readConfig();
    const jobId = cfg.OPENCLAW_BOUNTY_CRON_JOB_ID;
    if (!jobId) {
        return { enabled: true, removed: false };
    }

    const removeTemplate =
        process.env.OPENCLAW_BOUNTY_CRON_REMOVE_TEMPLATE?.trim() ||
        DEFAULT_REMOVE_TEMPLATE;
    const rendered = renderTemplate(removeTemplate, { jobId });
    runShell(rendered);

    const next = readConfig();
    delete next.OPENCLAW_BOUNTY_CRON_JOB_ID;
    writeConfig(next);
    return { enabled: true, removed: true };
}

