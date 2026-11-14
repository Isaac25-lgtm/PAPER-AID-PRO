#!/usr/bin/env bash
# Build the frontend for the isolated staging environment and deploy it to Firebase Hosting on `paperaid-staging`
# (https://paperaid-staging.web.app). Uses frontend/.env.staging and a staging copy of firebase.json whose
# Content-Security-Policy points at the staging API and sign-in domain instead of production's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python}"
cd "$ROOT/frontend"
npx vite build --mode staging --outDir dist-staging --emptyOutDir

cd "$ROOT"
"$PYTHON" - <<'PY'
import json, pathlib
config = json.loads(pathlib.Path("firebase.json").read_text(encoding="utf-8"))
replacements = {
    "https://paperaid-api-307658066472.europe-west4.run.app": "https://paperaid-api-staging-307658066472.europe-west4.run.app",
    "https://paperaid.firebaseapp.com": "https://paperaid-staging.firebaseapp.com",
}
config["hosting"]["public"] = "frontend/dist-staging"
for block in config["hosting"].get("headers", []):
    for header in block.get("headers", []):
        for old, new in replacements.items():
            header["value"] = header["value"].replace(old, new)
pathlib.Path("firebase.staging.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
PY
firebase deploy --only hosting --project paperaid-staging --config firebase.staging.json
rm -f firebase.staging.json
