#!/usr/bin/env bash
set -euo pipefail
mkdir -p src/seller/offerings/suicatap
rsync -a --delete src/seller/offerings/acp-whoami/ src/seller/offerings/suicatap/
echo "[ok] synced offerings: acp-whoami -> suicatap"
