// =============================================================================
// macOS keychain helpers for storing bounty poster secrets.
// =============================================================================

import { execFileSync } from "child_process";

const SERVICE = "openclaw-acp-bounty";

function runSecurity(args: string[]): string {
    return execFileSync("security", args, { encoding: "utf-8" }).trim();
}

export function storeSecret(account: string, secret: string): void {
    runSecurity([
        "add-generic-password",
        "-a",
        account,
        "-s",
        SERVICE,
        "-w",
        secret,
        "-U",
    ]);
}

export function readSecret(account: string): string | null {
    try {
        return runSecurity([
            "find-generic-password",
            "-a",
            account,
            "-s",
            SERVICE,
            "-w",
        ]);
    } catch {
        return null;
    }
}

export function deleteSecret(account: string): void {
    try {
        runSecurity(["delete-generic-password", "-a", account, "-s", SERVICE]);
    } catch {
        // Best-effort cleanup.
    }
}

