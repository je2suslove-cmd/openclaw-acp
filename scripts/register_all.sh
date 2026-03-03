#!/usr/bin/env bash
# =============================================================================
# register_all.sh — Register all local-only offerings with ACP marketplace
# Usage: bash scripts/register_all.sh
# =============================================================================

set -e

OFFERINGS=(
  suicatap_beep
  suicatap_batch
  suicatap_solana_risk
  suicatap_tx_preflight
  suicatap_execution_gate
  suicatap_wallet_sweep
  suicatap_monitor
  suicatap_report
  suicatap_review
  suicatap_loyalty_scan
  suicatap_ping_free
  token_risk_quick
)

echo "🍉 SuicaTap — Registering offerings with ACP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

for name in "${OFFERINGS[@]}"; do
  echo -n "  → $name ... "
  if npx tsx bin/acp.ts sell create "$name" 2>/dev/null; then
    echo "✅ registered"
    ((PASS++))
  else
    echo "❌ failed"
    ((FAIL++))
  fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Done: $PASS registered, $FAIL failed"
echo ""
echo "Next: npm run seller:run"
