import { checkHoneypot } from "./risk.js";

export async function makeReceipt(address: string, chainId?: string) {
  const r = await checkHoneypot(address, chainId);
  const receipt = {
    type: "suicatap_risk_receipt_v1",
    ts: new Date().toISOString(),
    token: r.token,
    chain: r.chain,
    summary: r.summary,
    honeypot: r.honeypot,
    taxes: r.taxes,
    contract: r.contract,
    note: "Lightweight receipt. Full report: suicatap_report (paid).",
  };
  return JSON.stringify(receipt, null, 2);
}
