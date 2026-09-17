"""
Mirror — automatic rollback plan.

Extends reversibility.py from "how recoverable is this in principle" to
"here is the actual, real recovery information for this specific resource,
right now" — using only values read live from the AWS API before anything
is deleted. Nothing here is invented: every fact in a plan is either a real
AWS API response value (a PITR restore window, a Lambda version number, an
EventBridge rule's own live definition) or an explicit, hedged note about
real AWS behavior — never a fabricated recovery-time estimate or
confidence percentage.

    S3 bucket        -> real versioning status + real version/delete-marker
                         counts. Explicitly notes the real caveat that
                         object versioning does NOT protect against bucket
                         deletion (a bucket must be emptied first, which
                         permanently destroys all versions) — this is
                         well-documented AWS behavior, not a guess.
    DynamoDB table    -> the REAL earliest/latest restorable timestamps
                         from describe_continuous_backups when PITR is
                         enabled. Notes that AWS supports restoring
                         recently-deleted PITR-enabled tables via
                         restore-table-to-point-in-time using the deleted
                         table's ARN, but hedges the exact procedure since
                         it depends on account/region behavior at the time.
    Lambda function   -> the actual latest published version number and
                         its real LastModified timestamp (if any exist).
                         Notes the real caveat that deleting the function
                         deletes ALL published versions too.
    EventBridge rule  -> the rule's OWN real definition (schedule
                         expression / event pattern, state, and real
                         target ARNs), captured live — this data is itself
                         the rollback plan, not a description of one.

Returns {"available": bool, "steps": [...], "reason": str|None}. `steps`
are real facts/notes, never invented numbers.
"""

import boto3

REGION = boto3.Session().region_name or "us-east-1"

s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.client("dynamodb", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
events = boto3.client("events", region_name=REGION)


def s3_rollback_plan(bucket_name):
    try:
        versioning = s3.get_bucket_versioning(Bucket=bucket_name).get("Status")
    except Exception:
        return {"available": False, "steps": [], "reason": "could not read versioning status"}

    if versioning != "Enabled":
        return {
            "available": False,
            "steps": [],
            "reason": "versioning not enabled — no prior object versions exist to restore",
        }

    try:
        resp = s3.list_object_versions(Bucket=bucket_name, MaxKeys=1000)
        version_count = len(resp.get("Versions", []))
        delete_marker_count = len(resp.get("DeleteMarkers", []))
    except Exception:
        version_count = None
        delete_marker_count = None

    steps = [
        f"versioning enabled — {version_count if version_count is not None else 'unknown'} object "
        f"version(s) and {delete_marker_count if delete_marker_count is not None else 'unknown'} "
        f"delete marker(s) currently stored",
        "real caveat: object versioning protects against individual object deletes, NOT bucket "
        "deletion — a bucket must be fully emptied (including all versions) before it can be "
        "deleted, and that emptying step is permanent even with versioning on",
    ]
    return {"available": True, "steps": steps, "reason": None}


def dynamodb_rollback_plan(table_name):
    try:
        resp = dynamodb.describe_continuous_backups(TableName=table_name)
        pitr = resp["ContinuousBackupsDescription"]["PointInTimeRecoveryDescription"]
        status = pitr["PointInTimeRecoveryStatus"]
    except Exception:
        return {"available": False, "steps": [], "reason": "could not read point-in-time recovery status"}

    if status != "ENABLED":
        return {
            "available": False,
            "steps": [],
            "reason": "point-in-time recovery disabled — no restore window exists",
        }

    earliest = pitr.get("EarliestRestorableDateTime")
    latest = pitr.get("LatestRestorableDateTime")
    steps = [
        f"point-in-time recovery enabled — real restorable window: {earliest} to {latest}",
        "restore-in-place command: aws dynamodb restore-table-to-point-in-time "
        f"--source-table-name {table_name} --target-table-name {table_name}-restored "
        "--restore-date-time <timestamp-within-the-window-above>",
        "note: AWS also supports restoring a PITR-enabled table after it has been deleted, using "
        "--source-table-arn instead of --source-table-name (the ARN of the now-deleted table, "
        "obtainable from CloudTrail) — exact availability window depends on account/region, verify "
        "before relying on it",
    ]
    return {"available": True, "steps": steps, "reason": None}


def lambda_rollback_plan(function_name):
    try:
        resp = lambda_client.list_versions_by_function(FunctionName=function_name)
        versions = [v for v in resp["Versions"] if v["Version"] != "$LATEST"]
    except Exception:
        return {"available": False, "steps": [], "reason": "could not read published versions"}

    if not versions:
        return {
            "available": False,
            "steps": [],
            "reason": "no published versions exist — nothing to redeploy from after deletion",
        }

    latest = max(versions, key=lambda v: int(v["Version"]))
    steps = [
        f"{len(versions)} published version(s) exist — most recent is version {latest['Version']} "
        f"(last modified {latest.get('LastModified')})",
        "real caveat: deleting the function deletes ALL published versions with it — this only "
        "helps roll back a bad deploy while the function still exists, not recover it after "
        "deletion",
        f"roll back a bad deploy: aws lambda update-alias --function-name {function_name} "
        f"--name <alias> --function-version {latest['Version']}",
    ]
    return {"available": True, "steps": steps, "reason": None}


def eventbridge_rollback_plan(rule_name):
    try:
        rule = events.describe_rule(Name=rule_name)
        targets = events.list_targets_by_rule(Rule=rule_name)["Targets"]
    except Exception:
        return {"available": False, "steps": [], "reason": "could not read rule definition"}

    definition = rule.get("ScheduleExpression") or rule.get("EventPattern") or "(no expression/pattern set)"
    steps = [
        f"real rule definition captured live: {definition} (state: {rule.get('State')})",
        f"{len(targets)} real target(s): " + (", ".join(t["Arn"] for t in targets) if targets else "none"),
        "this captured definition IS the rollback plan — recreate with aws events put-rule using "
        "the expression above, then aws events put-targets with the target ARNs above",
    ]
    return {"available": True, "steps": steps, "reason": None}


def rollback_plan_for(node_type, name):
    if node_type == "s3_bucket":
        return s3_rollback_plan(name)
    if node_type == "dynamodb_table":
        return dynamodb_rollback_plan(name)
    if node_type == "lambda_function":
        return lambda_rollback_plan(name)
    if node_type == "eventbridge_rule":
        return eventbridge_rollback_plan(name)
    return {"available": False, "steps": [], "reason": "unknown resource type"}
