"""Environment profiles and checks for deploy/release.sh (no cloud calls: it only inspects JSON it is given).

One profile per environment says exactly what that environment's API service, migration job and release candidate
must be bound to: runtime identity, database secret reference, bucket, Firebase project and the complete Cloud
Tasks routing (project, location, queue, target URL and OIDC sender; the OIDC audience is the target URL).

    release_checks.py shell <env>                 -> SERVICE=... MIGRATE_JOB=... (for `eval`)
    release_checks.py flags <env>                 -> validates $EXTRA_DEPLOY_FLAGS against the allowlist
    release_checks.py live <env>                  -> validates $SERVICE_JSON and $JOB_JSON
    release_checks.py candidate <env> <image>     -> validates $REVISION_JSON (the exact revision to promote)

Diagnostics never print the value of a secret-bearing setting: an inline DATABASE_URL is reported only as
"an inline value".
"""

from __future__ import annotations

import json
import os
import re
import sys

PROFILES = {
    "production": {
        "service": "paperaid-api",
        "migrate_job": "paperaid-migrate",
        "identity": "paperaid-api@paperaid.iam.gserviceaccount.com",
        "database_secret": "paperaid-database-url",
        "env": {
            "ENV": "production",
            "FIREBASE_PROJECT_ID": "paperaid",
            "STORAGE_BACKEND": "gcs",
            "GCS_BUCKET": "paperaid-papers-307658066472",
            "TASKS_BACKEND": "cloud_tasks",
            "TASKS_PROJECT": "paperaid",
            "TASKS_LOCATION": "europe-west1",
            "TASKS_QUEUE": "paper-processing",
            "TASKS_TARGET_URL": "https://paperaid-api-307658066472.europe-west4.run.app",
            "TASKS_SERVICE_ACCOUNT": "paperaid-tasks@paperaid.iam.gserviceaccount.com",
        },
    },
    "staging": {
        "service": "paperaid-api-staging",
        "migrate_job": "paperaid-migrate-staging",
        "identity": "paperaid-staging-api@paperaid.iam.gserviceaccount.com",
        "database_secret": "paperaid-staging-database-url",
        "env": {
            "ENV": "production",  # staging deliberately runs the production code paths
            "FIREBASE_PROJECT_ID": "paperaid-staging",
            "STORAGE_BACKEND": "gcs",
            "GCS_BUCKET": "paperaid-staging-files-307658066472",
            "TASKS_BACKEND": "cloud_tasks",
            "TASKS_PROJECT": "paperaid",
            "TASKS_LOCATION": "europe-west1",
            "TASKS_QUEUE": "paper-processing-staging",
            "TASKS_TARGET_URL": "https://paperaid-api-staging-307658066472.europe-west4.run.app",
            "TASKS_SERVICE_ACCOUNT": "paperaid-staging-api@paperaid.iam.gserviceaccount.com",
        },
    },
}

# Settings an operator may change as part of a release. Everything that says WHICH environment a revision belongs to
# (database, identity, bucket, Firebase project, task routing, CORS, ENV) is deliberately absent.
ALLOWED_SETTINGS = {
    "DB_POOL_SIZE", "DB_MAX_OVERFLOW", "LOG_LEVEL", "HTTP_TIMEOUT_SECONDS", "MAX_UPLOAD_MB",
    "ALLOWED_EMAILS", "ADMIN_EMAILS", "CONTACT_EMAIL",
    "NCBI_API_KEY", "SEMANTIC_SCHOLAR_API_KEY", "CORE_API_KEY", "OPENALEX_API_KEY",
    "AI_PROVIDER", "AI_ACCESS", "AI_PILOT_EMAILS", "AI_AUTOCOMPLETE_ENABLED", "AI_MODEL", "AI_EFFORT",
    "AI_VERIFY_CLAIMS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
    "EMBEDDING_PROVIDER", "EMBEDDING_MODEL",
    "WEB_SEARCH_PROVIDER", "TAVILY_API_KEY", "RATE_LIMIT_DEEP_RESEARCH_PER_HOUR",
    "RATE_LIMIT_SEARCH_PER_MIN", "RATE_LIMIT_AI_PER_MIN", "RATE_LIMIT_UPLOAD_PER_HOUR",
}  # fmt: skip
ALLOWED_FLAGS = ("--update-env-vars", "--update-secrets")
SECRET_SETTINGS = {"DATABASE_URL"}


def refuse(message: str, problems: list[str]) -> None:
    sys.exit(f"Refusing to release: {message}:\n  " + "\n  ".join(problems))


def flag_problems(flags: str) -> list[str]:
    problems = []
    for token in flags.split():
        name, separator, value = token.partition("=")
        if name not in ALLOWED_FLAGS or not separator:
            problems.append(f"flag {name!r} is not allowed (only {' and '.join(ALLOWED_FLAGS)}, as --flag=K=V)")
            continue
        delimiter = ","
        custom = re.match(r"^\^(.+?)\^", value)  # gcloud's ^DELIM^ prefix (e.g. for values containing commas)
        if custom:
            delimiter, value = custom.group(1), value[custom.end() :]
        for pair in value.split(delimiter):
            key = pair.partition("=")[0]
            if key not in ALLOWED_SETTINGS:
                problems.append(f"setting {key!r} cannot be changed by a release (it is not a tuning setting)")
    return problems


def bindings(spec: dict) -> tuple[str | None, str | None, dict[str, str]]:
    """(identity, image, {name: description}) of a service template, job template or revision spec. A value from
    Secret Manager is described as "secret:<name>"; an inline value of a secret-bearing setting is never read."""
    container = spec["containers"][0]
    env: dict[str, str] = {}
    for entry in container.get("env", []):
        ref = (entry.get("valueFrom") or {}).get("secretKeyRef") or {}
        if ref:
            env[entry["name"]] = f"secret:{ref.get('name')}"
        elif entry["name"] in SECRET_SETTINGS:
            env[entry["name"]] = "an inline value"
        else:
            env[entry["name"]] = str(entry.get("value"))
    return spec.get("serviceAccountName"), container.get("image"), env


def binding_problems(label: str, spec: dict, profile: dict, *, full: bool) -> list[str]:
    identity, _, env = bindings(spec)
    problems = []
    if identity != profile["identity"]:
        problems.append(f"{label} runs as {identity!r}, expected {profile['identity']!r}")
    expected_db = f"secret:{profile['database_secret']}"
    if env.get("DATABASE_URL") != expected_db:
        observed = env.get("DATABASE_URL", "not set")
        problems.append(f"{label} DATABASE_URL is {observed}, expected {expected_db}")
    if full:
        for key, expected in profile["env"].items():
            if env.get(key) != expected:
                problems.append(f"{label} {key} is {env.get(key)!r}, expected {expected!r}")
    return problems


def main(argv: list[str]) -> None:
    command, name = argv[1], argv[2] if len(argv) > 2 else ""
    profile = PROFILES.get(name)
    if profile is None:
        sys.exit("Refusing to release: set DEPLOY_ENV=production or DEPLOY_ENV=staging.")
    if command == "shell":
        print(f"SERVICE={profile['service']}; MIGRATE_JOB={profile['migrate_job']}")
    elif command == "flags":
        problems = flag_problems(os.environ.get("EXTRA_DEPLOY_FLAGS", ""))
        if problems:
            refuse("EXTRA_DEPLOY_FLAGS may only tune allowed settings", problems)
    elif command == "live":
        service = json.loads(os.environ["SERVICE_JSON"])["spec"]["template"]["spec"]
        job = json.loads(os.environ["JOB_JSON"])["spec"]["template"]["spec"]["template"]["spec"]
        problems = binding_problems("service", service, profile, full=True)
        problems += binding_problems("migration job", job, profile, full=False)
        if problems:
            refuse("the live configuration does not match this environment", problems)
        print("environment verified")
    elif command == "candidate":
        spec = json.loads(os.environ["REVISION_JSON"])["spec"]
        problems = binding_problems("candidate", spec, profile, full=True)
        image = bindings(spec)[1]
        if image != argv[3]:
            problems.append(f"candidate runs image {image!r}, expected {argv[3]!r}")
        if problems:
            refuse("the candidate revision does not match this environment (no traffic was moved)", problems)
        print("candidate verified")
    else:
        sys.exit(f"unknown command {command!r}")


if __name__ == "__main__":
    main(sys.argv)
