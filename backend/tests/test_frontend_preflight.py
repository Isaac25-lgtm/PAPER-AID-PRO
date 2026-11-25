"""Audit SF09: the website release refuses a build made for the wrong environment (deploy/frontend_preflight.py).
Synthetic artifacts in a temporary directory; nothing is built, deployed or sent anywhere."""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("frontend_preflight", REPO / "deploy" / "frontend_preflight.py")
assert spec and spec.loader
preflight = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = preflight  # dataclasses look their module up while it loads
spec.loader.exec_module(preflight)

PROD, STAGING = preflight.TARGETS["production"], preflight.TARGETS["staging"]
COMMIT = "a" * 40


def artifact(
    root: Path,
    target,
    *,
    api: str | None = None,
    auth: str | None = None,
    mode: str | None = None,
    commit: str = COMMIT,
) -> None:  # type: ignore[no-untyped-def]
    """A built website for `target` (optionally with wrong settings compiled in), its env file and Hosting config."""
    (root / "frontend").mkdir(parents=True, exist_ok=True)
    shutil.copy(REPO / target.env_file, root / target.env_file)
    dist = root / target.dist / "assets"
    dist.mkdir(parents=True, exist_ok=True)
    api, auth = api or target.api, auth or target.auth_domain
    (dist / "index-abc.js").write_text(f'const B="{api}";initializeApp({{authDomain:"{auth}",projectId:"x"}});')
    info = {"commit": commit, "mode": mode or target.mode, "apiBaseUrl": api, "firebaseProjectId": target.project,
            "firebaseAuthDomain": auth}  # fmt: skip
    (root / target.dist / "build-info.json").write_text(json.dumps(info))
    config = json.loads((REPO / "firebase.json").read_text(encoding="utf-8"))
    if target is STAGING:  # as deploy-staging-frontend.sh writes it
        config["hosting"]["public"] = STAGING.dist
        for block in config["hosting"].get("headers", []):
            for header in block.get("headers", []):
                header["value"] = (
                    header["value"]
                    .replace(PROD.api, STAGING.api)
                    .replace(f"https://{PROD.auth_domain}", f"https://{STAGING.auth_domain}")
                )
    (root / target.config).write_text(json.dumps(config))


def run(root: Path, target_name: str) -> list[str]:
    return preflight.check(target_name, root=root, commit=COMMIT, require_clean=False)


def test_correct_builds_pass_for_both_targets(tmp_path):
    artifact(tmp_path, PROD)
    artifact(tmp_path, STAGING)
    assert run(tmp_path, "production") == []
    assert run(tmp_path, "staging") == []


def test_a_production_build_with_staging_settings_compiled_in_is_refused(tmp_path):
    """The audit's reproduction: a production-mode build that picked up other values from the environment."""
    artifact(tmp_path, PROD, api=STAGING.api, auth=STAGING.auth_domain)
    problems = run(tmp_path, "production")
    assert any("bundle does not contain https://paperaid-api-307658066472" in p for p in problems)
    assert any("bundle contains the staging setting" in p for p in problems)


def test_wrong_mode_wrong_commit_and_a_csp_for_the_other_site_are_refused(tmp_path):
    artifact(tmp_path, PROD, mode="staging", commit="b" * 40)
    problems = run(tmp_path, "production")
    assert any("'staging' mode" in p for p in problems)
    assert any("is being released" in p for p in problems)

    artifact(tmp_path, STAGING)
    config = json.loads((tmp_path / STAGING.config).read_text())
    config["hosting"]["headers"][0]["headers"] = [
        {"key": "Content-Security-Policy", "value": f"connect-src 'self' {PROD.api}"}
    ]
    (tmp_path / STAGING.config).write_text(json.dumps(config))
    problems = run(tmp_path, "staging")
    assert any(f"does not allow {STAGING.api}" in p for p in problems)
    assert any(f"names the production origin {PROD.api}" in p for p in problems)


def test_an_unstamped_build_is_refused(tmp_path):
    artifact(tmp_path, PROD)
    (tmp_path / PROD.dist / "build-info.json").unlink()
    assert any("build-info.json is missing" in p for p in run(tmp_path, "production"))


def test_the_real_environment_files_and_hosting_config_match_their_targets():
    """The committed .env files and firebase.json themselves agree with the release targets."""
    for target in (PROD, STAGING):
        env = preflight._env(REPO / target.env_file)
        assert env["VITE_API_BASE_URL"] == target.api
        assert env["VITE_FIREBASE_PROJECT_ID"] == target.project
        assert env["VITE_FIREBASE_AUTH_DOMAIN"] == target.auth_domain
    csp = json.dumps(json.loads((REPO / "firebase.json").read_text(encoding="utf-8")))
    assert PROD.api in csp and STAGING.api not in csp
