"""Frontend release preflight: refuse to publish a website build made for the wrong environment (audit SF09).

The API release checks the live environment before promoting anything; the website had no equivalent. A
production-mode build quietly compiles in whatever VITE_* values the working environment held, and the Hosting
project flag only picks where the files go: it cannot correct a bundle that talks to the wrong API or sign-in
project. With the Content-Security-Policy, such a build is a site-wide outage.

This check runs locally on the exact artifact about to be published, before `firebase deploy`:

1. the environment file for the target holds the target's API origin, Firebase project and sign-in domain;
2. build-info.json (stamped by vite.config.ts) says the bundle was built in the target's mode, from the commit being
   released, with those same settings (and, for production, from a clean working tree);
3. the compiled JavaScript contains the target's API origin and sign-in domain, and none of the other
   environment's;
4. the Hosting configuration being published has a Content-Security-Policy that allows the target's API and sign-in
   origins and names none of the other environment's.

Usage:  python deploy/frontend_preflight.py production|staging [--config firebase.staging.json] [--allow-dirty]
Exit 0 when every check passes; otherwise each problem is printed and the exit code is 1.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Target:
    mode: str
    env_file: str
    dist: str
    config: str
    api: str
    project: str
    auth_domain: str


TARGETS = {
    "production": Target(
        mode="production",
        env_file="frontend/.env.production",
        dist="frontend/dist",
        config="firebase.json",
        api="https://paperaid-api-307658066472.europe-west4.run.app",
        project="paperaid",
        auth_domain="paperaid.firebaseapp.com",
    ),
    "staging": Target(
        mode="staging",
        env_file="frontend/.env.staging",
        dist="frontend/dist-staging",
        config="firebase.staging.json",
        api="https://paperaid-api-staging-307658066472.europe-west4.run.app",
        project="paperaid-staging",
        auth_domain="paperaid-staging.firebaseapp.com",
    ),
}


def _env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def _git(root: Path, *args: str) -> str:
    # A fixed git command on the repository itself; no outside input reaches it.
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False)  # noqa: S603, S607
    return result.stdout.strip()


def check(
    target_name: str,
    *,
    root: Path = ROOT,
    config: str | None = None,
    commit: str | None = None,
    require_clean: bool | None = None,
) -> list[str]:
    """Every reason not to publish this build to `target_name` (empty when it is safe)."""
    target = TARGETS[target_name]
    other = next(t for name, t in TARGETS.items() if name != target_name)
    problems: list[str] = []

    # 1. The environment file the build was made from.
    env_path = root / target.env_file
    if not env_path.exists():
        return [f"{target.env_file} is missing"]
    env = _env(env_path)
    expected = {
        "VITE_API_BASE_URL": target.api,
        "VITE_FIREBASE_PROJECT_ID": target.project,
        "VITE_FIREBASE_AUTH_DOMAIN": target.auth_domain,
    }
    for key, value in expected.items():
        if env.get(key) != value:
            problems.append(f"{target.env_file}: {key} is {env.get(key)!r}, expected {value!r}")

    # 2. The stamp on the artifact.
    dist = root / target.dist
    info_path = dist / "build-info.json"
    if not info_path.exists():
        problems.append(f"{target.dist}/build-info.json is missing: build with the stamped vite.config.ts")
        return problems
    info = json.loads(info_path.read_text(encoding="utf-8"))
    commit = commit if commit is not None else _git(root, "rev-parse", "HEAD")
    if info.get("mode") != target.mode:
        problems.append(f"the build was made in {info.get('mode')!r} mode, not {target.mode!r}")
    if commit and info.get("commit") != commit:
        problems.append(f"the build is from commit {info.get('commit')!r}, but {commit!r} is being released")
    stamped = (
        ("apiBaseUrl", target.api),
        ("firebaseProjectId", target.project),
        ("firebaseAuthDomain", target.auth_domain),
    )
    for field, value in stamped:
        if info.get(field) != value:
            problems.append(f"build-info.json: {field} is {info.get(field)!r}, expected {value!r}")
    if require_clean if require_clean is not None else target_name == "production":
        if _git(root, "status", "--porcelain", "--untracked-files=no"):
            problems.append("the working tree has uncommitted changes: release a committed state")

    # 3. What is actually compiled into the bundle.
    bundle = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in sorted(dist.rglob("*.js")))
    if not bundle:
        problems.append(f"{target.dist} contains no JavaScript")
    for value in (target.api, target.auth_domain):
        if value not in bundle:
            problems.append(f"the bundle does not contain {value}")
    for value in (other.api, other.auth_domain):
        if value in bundle:
            problems.append(f"the bundle contains the {other.mode} setting {value}")

    # 4. The Hosting configuration's Content-Security-Policy.
    config_path = root / (config or target.config)
    if not config_path.exists():
        problems.append(f"{config_path.name} is missing")
        return problems
    hosting = json.loads(config_path.read_text(encoding="utf-8")).get("hosting", {})
    csp = " ".join(
        header.get("value", "")
        for block in hosting.get("headers", [])
        for header in block.get("headers", [])
        if header.get("key", "").lower() == "content-security-policy"
    )
    if not csp:
        problems.append(f"{config_path.name} has no Content-Security-Policy")
    for value in (target.api, f"https://{target.auth_domain}"):
        if value not in csp:
            problems.append(f"the Content-Security-Policy does not allow {value}")
    for value in (other.api, f"https://{other.auth_domain}"):
        if value in csp:
            problems.append(f"the Content-Security-Policy names the {other.mode} origin {value}")
    if hosting.get("public") and (root / hosting["public"]).resolve() != dist.resolve():
        problems.append(f"{config_path.name} publishes {hosting['public']}, not {target.dist}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("target", choices=sorted(TARGETS))
    parser.add_argument("--config", help="the Hosting configuration being published (default per target)")
    parser.add_argument("--allow-dirty", action="store_true", help="skip the clean-working-tree check")
    args = parser.parse_args()
    problems = check(args.target, config=args.config, require_clean=False if args.allow_dirty else None)
    if problems:
        print(f"Refusing to publish the {args.target} website:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print(f"frontend preflight passed for {args.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
