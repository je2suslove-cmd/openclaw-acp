// =============================================================================
// acp compute — Manage LLM compute credits (self-funding via agent wallet)
//
// Subcommands:
//   setup     Enable compute for this agent
//   status    Show compute balance, mode, and config
//   topup     Manually top up LLM credits
//   config    Update compute configuration
//   history   Show top-up transaction history
//   models    List available models with pricing
//   disable   Disable compute
// =============================================================================

import client from "../lib/client.js";
import * as output from "../lib/output.js";

// -- Types --

interface ComputeStatus {
  enabled: boolean;
  computeBalance?: number;
  walletBalance?: number;
  monthlySpend?: number;
  monthlyLimit?: number;
  mode?: "full" | "normal" | "economy" | "low" | "hibernating";
  autoTopUp?: {
    enabled: boolean;
    threshold: number;
    amount: number;
  };
  lastTopUp?: string | null;
  lastTopUpTxHash?: string | null;
  requestCountToday?: number;
  preferredModel?: string;
  endpoint?: string;
}

interface ComputeEnableResponse {
  enabled: boolean;
  computeBalance: number;
  endpoint: string;
  message: string;
}

interface ComputeTransaction {
  id: string;
  amount: number;
  trigger: "auto" | "manual";
  txHash: string;
  status: "pending" | "confirmed" | "failed";
  provider: string;
  createdAt: string;
}

interface ComputeModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

// -- Commands --

export async function setup(opts: {
  topUpAmount?: number;
  lowBalanceThreshold?: number;
  maxMonthlySpend?: number;
  preferredModel?: string;
}): Promise<void> {
  try {
    const body: Record<string, unknown> = {};
    if (opts.topUpAmount != null) body.topUpAmount = opts.topUpAmount;
    if (opts.lowBalanceThreshold != null) body.lowBalanceThreshold = opts.lowBalanceThreshold;
    if (opts.maxMonthlySpend != null) body.maxMonthlySpend = opts.maxMonthlySpend;
    if (opts.preferredModel != null) body.preferredModel = opts.preferredModel;

    const res = await client.post<{ data: ComputeEnableResponse }>("/acp/compute/enable", body);
    const data = res.data.data;

    output.output(data, (d) => {
      output.heading("Compute Enabled");
      output.field("Status", d.enabled ? "Active" : "Inactive");
      output.field("Balance", `$${d.computeBalance.toFixed(2)}`);
      output.field("LLM Endpoint", d.endpoint);
      output.log("");
      output.success(d.message);
      output.log("");
      output.log(
        `  ${output.colors.dim("Use your existing ACP key as the API key for inference calls.")}`
      );
      output.log(
        `  ${output.colors.dim("Endpoint:")} ${output.colors.cyan(d.endpoint)}`
      );
      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to enable compute: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function status(): Promise<void> {
  try {
    const res = await client.get<{ data: ComputeStatus }>("/acp/compute/status");
    const data = res.data.data;

    output.output(data, (d) => {
      output.heading("Compute Status");

      if (!d.enabled) {
        output.field("Status", "Not enabled");
        output.log(
          `\n  ${output.colors.dim('Run "acp compute setup" to enable LLM compute.')}\n`
        );
        return;
      }

      const modeColors: Record<string, (s: string) => string> = {
        full: output.colors.green,
        normal: output.colors.green,
        economy: output.colors.yellow,
        low: output.colors.red,
        hibernating: output.colors.red,
      };
      const modeColor = modeColors[d.mode ?? ""] ?? ((s: string) => s);

      output.field("Status", "Active");
      output.field("Mode", modeColor(d.mode?.toUpperCase() ?? "UNKNOWN"));
      output.field("Compute Balance", `$${(d.computeBalance ?? 0).toFixed(2)}`);
      output.field("Wallet Balance", `$${(d.walletBalance ?? 0).toFixed(2)}`);
      output.field(
        "Monthly Spend",
        `$${(d.monthlySpend ?? 0).toFixed(2)} / $${(d.monthlyLimit ?? 0).toFixed(2)}`
      );
      output.field("Requests Today", String(d.requestCountToday ?? 0));
      output.field("Preferred Model", d.preferredModel ?? "-");

      if (d.autoTopUp) {
        output.log("");
        output.log(`  ${output.colors.bold("Auto Top-Up")}`);
        output.field("Enabled", d.autoTopUp.enabled ? "Yes" : "No");
        output.field("Threshold", `$${d.autoTopUp.threshold.toFixed(2)}`);
        output.field("Amount", `$${d.autoTopUp.amount.toFixed(2)}`);
      }

      if (d.lastTopUp) {
        output.log("");
        output.field("Last Top-Up", d.lastTopUp);
        if (d.lastTopUpTxHash) {
          output.field("Tx Hash", d.lastTopUpTxHash);
        }
      }

      if (d.endpoint) {
        output.log("");
        output.field("LLM Endpoint", d.endpoint);
      }

      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to get compute status: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function topup(amount: number): Promise<void> {
  if (!amount || amount <= 0) {
    output.fatal("Amount must be a positive number (USD).");
  }

  try {
    const res = await client.post<{ data: { computeBalance: number; txHash: string; message: string } }>(
      "/acp/compute/topup",
      { amount }
    );
    const data = res.data.data;

    output.output(data, (d) => {
      output.heading("Compute Top-Up");
      output.field("Amount", `$${amount.toFixed(2)}`);
      output.field("New Balance", `$${d.computeBalance.toFixed(2)}`);
      if (d.txHash) {
        output.field("Tx Hash", d.txHash);
      }
      output.log("");
      output.success(d.message);
      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to top up compute: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function config(opts: {
  lowBalanceThreshold?: number;
  topUpAmount?: number;
  maxMonthlySpend?: number;
  preferredModel?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (opts.lowBalanceThreshold != null) body.lowBalanceThreshold = opts.lowBalanceThreshold;
  if (opts.topUpAmount != null) body.topUpAmount = opts.topUpAmount;
  if (opts.maxMonthlySpend != null) body.maxMonthlySpend = opts.maxMonthlySpend;
  if (opts.preferredModel != null) body.preferredModel = opts.preferredModel;

  if (Object.keys(body).length === 0) {
    output.fatal(
      "No config flags provided. Use --threshold, --topup-amount, --monthly-limit, or --model."
    );
  }

  try {
    const res = await client.patch<{ data: ComputeStatus }>("/acp/compute/config", body);
    const data = res.data.data;

    output.output(data, (d) => {
      output.heading("Compute Config Updated");
      if (d.autoTopUp) {
        output.field("Threshold", `$${d.autoTopUp.threshold.toFixed(2)}`);
        output.field("Top-Up Amount", `$${d.autoTopUp.amount.toFixed(2)}`);
      }
      if (d.monthlyLimit != null) {
        output.field("Monthly Limit", `$${d.monthlyLimit.toFixed(2)}`);
      }
      if (d.preferredModel) {
        output.field("Preferred Model", d.preferredModel);
      }
      output.log("");
      output.success("Configuration updated.");
      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to update compute config: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function history(opts: { page?: number; pageSize?: number }): Promise<void> {
  try {
    const params: Record<string, string> = {};
    if (opts.page != null) params.page = String(opts.page);
    if (opts.pageSize != null) params.pageSize = String(opts.pageSize);

    const res = await client.get<{ data: ComputeTransaction[] }>("/acp/compute/history", {
      params,
    });
    const data = res.data.data;

    output.output(data, (txns) => {
      output.heading("Compute Transaction History");
      if (!txns || txns.length === 0) {
        output.log("  No transactions found.");
        output.log("");
        return;
      }

      for (const tx of txns) {
        const statusColor =
          tx.status === "confirmed"
            ? output.colors.green
            : tx.status === "failed"
              ? output.colors.red
              : output.colors.yellow;

        output.log(
          `  ${output.colors.dim(tx.createdAt)}  ${statusColor(tx.status.padEnd(10))}  ` +
            `$${tx.amount.toFixed(2).padStart(8)}  ${tx.trigger.padEnd(6)}  ${output.colors.dim(tx.txHash)}`
        );
      }
      output.log("");
    });
  } catch (e) {
    output.fatal(
      `Failed to get compute history: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

export async function models(): Promise<void> {
  try {
    const res = await client.get<{ data: ComputeModel[] }>("/acp/compute/models");
    const data = res.data.data;

    output.output(data, (mdls) => {
      output.heading("Available Compute Models");
      if (!mdls || mdls.length === 0) {
        output.log("  No models available.");
        output.log("");
        return;
      }

      output.log(
        `  ${output.colors.bold("Model".padEnd(45))}  ${output.colors.bold("Context".padEnd(10))}  ${output.colors.bold("Input $/1M".padEnd(12))}  ${output.colors.bold("Output $/1M")}`
      );
      output.log(`  ${"-".repeat(85)}`);

      for (const m of mdls) {
        const ctx =
          m.contextWindow >= 1_000_000
            ? `${(m.contextWindow / 1_000_000).toFixed(1)}M`
            : `${(m.contextWindow / 1_000).toFixed(0)}K`;
        const inputCost = (m.pricing.prompt * 1_000_000).toFixed(2);
        const outputCost = (m.pricing.completion * 1_000_000).toFixed(2);

        output.log(
          `  ${m.id.padEnd(45)}  ${ctx.padEnd(10)}  $${inputCost.padStart(10)}  $${outputCost.padStart(10)}`
        );
      }
      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to list compute models: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function disable(): Promise<void> {
  try {
    const res = await client.delete<{ data: { message: string } }>("/acp/compute");
    const data = res.data.data;

    output.output(data, (d) => {
      output.heading("Compute Disabled");
      output.success(d.message);
      output.log("");
    });
  } catch (e) {
    output.fatal(`Failed to disable compute: ${e instanceof Error ? e.message : String(e)}`);
  }
}
