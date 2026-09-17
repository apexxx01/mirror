"""
Mirror — reversibility score.

Answers "if Mirror is wrong and this gets deleted anyway, how much of it can
actually be undone?" — using only real AWS recovery mechanisms already
configured on the resource, never an invented recovery-time estimate or
confidence percentage.

    S3 bucket        -> versioning status (get_bucket_versioning)
    DynamoDB table    -> point-in-time recovery status (describe_continuous_backups)
    Lambda function   -> whether a published version exists to roll back to
                         (list_versions_by_function)
    EventBridge rule  -> trivially reversible: rule definitions are small and
                         typically re-creatable from config, so this is scored
                         HIGH by convention rather than an API check — the one
                         deliberate non-API judgment call in this file, called
                         out here rather than hidden.

Returns one of HIGH / MEDIUM / LOW plus a one-line real reason. No numeric
"recovery time" or "confidence %" is invented — see the project's
no-synthetic-data rule.
"""

import boto3

REGION = boto3.Session().region_name or "us-east-1"

s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.client("dynamodb", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)


def s3_reversibility(bucket_name):
    try:
        resp = s3.get_bucket_versioning(Bucket=bucket_name)
        status = resp.get("Status")
    except Exception:
        return {"level": "LOW", "reason": "could not read versioning status"}

    if status == "Enabled":
        return {"level": "HIGH", "reason": "versioning enabled — deleted objects recoverable"}
    if status == "Suspended":
        return {"level": "MEDIUM", "reason": "versioning suspended — old versions may still exist, new ones won't be"}
    return {"level": "LOW", "reason": "versioning never enabled — deletes are permanent"}


def dynamodb_reversibility(table_name):
    try:
        resp = dynamodb.describe_continuous_backups(TableName=table_name)
        pitr_status = resp["ContinuousBackupsDescription"]["PointInTimeRecoveryDescription"]["PointInTimeRecoveryStatus"]
    except Exception:
        return {"level": "LOW", "reason": "could not read point-in-time recovery status"}

    if pitr_status == "ENABLED":
        return {"level": "HIGH", "reason": "point-in-time recovery enabled — restorable to any point in the last 35 days"}
    return {"level": "LOW", "reason": "point-in-time recovery disabled — table deletion is permanent"}


def lambda_reversibility(function_name):
    try:
        resp = lambda_client.list_versions_by_function(FunctionName=function_name)
        versions = [v["Version"] for v in resp["Versions"] if v["Version"] != "$LATEST"]
    except Exception:
        return {"level": "LOW", "reason": "could not read published versions"}

    if versions:
        return {"level": "HIGH", "reason": f"{len(versions)} published version(s) exist — can redeploy from a prior version"}
    return {"level": "LOW", "reason": "no published versions — only $LATEST exists, nothing to roll back to"}


def eventbridge_reversibility(rule_name):
    return {
        "level": "HIGH",
        "reason": "rule definitions are small and re-creatable from config — the one non-API judgment call in this file",
    }


def reversibility_of(node_type, name):
    if node_type == "s3_bucket":
        return s3_reversibility(name)
    if node_type == "dynamodb_table":
        return dynamodb_reversibility(name)
    if node_type == "lambda_function":
        return lambda_reversibility(name)
    if node_type == "eventbridge_rule":
        return eventbridge_reversibility(name)
    return {"level": "LOW", "reason": "unknown resource type"}
