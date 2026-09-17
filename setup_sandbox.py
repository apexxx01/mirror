"""
Mirror — sandbox environment setup.

Creates a small, real set of AWS resources in YOUR account with two
deliberately non-obvious hidden dependencies, so the graph builder has
something honest to find. Nothing here is simulated — every resource
actually exists once this runs.

The scenario:
  - mirror-demo-scratch-<suffix>      S3 bucket   — genuinely unused, safe to delete
  - mirror-demo-archive-2023-<suffix> S3 bucket   — LOOKS stale/archival, but is
                                                     secretly read by report-generator
  - mirror-demo-temp-cache-<suffix>   DynamoDB    — genuinely unused, safe to delete
  - mirror-demo-user-sessions-<suffix> DynamoDB   — LOOKS like old session data, but is
                                                     secretly read by billing-processor
  - mirror-demo-cleanup-worker        Lambda      — standalone, no dependents, safe to delete
  - mirror-demo-report-generator      Lambda      — env var points at archive-2023 bucket
  - mirror-demo-billing-processor     Lambda      — env var points at user-sessions table
  - mirror-demo-report-schedule       EventBridge rule → triggers report-generator

A naive "delete anything with low recent activity" agent would flag
archive-2023 and user-sessions as safe (they look old/unused). The real
dependency graph proves otherwise. That gap is the whole demo.

Usage:
    aws configure   # once, with your own credentials
    pip install -r requirements.txt
    python setup_sandbox.py            # create everything
    python setup_sandbox.py --teardown # delete everything this script made
"""

import argparse
import io
import json
import sys
import time
import zipfile

import boto3
from botocore.exceptions import ClientError

PREFIX = "mirror-demo"
REGION = boto3.Session().region_name or "us-east-1"

s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.client("dynamodb", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
events = boto3.client("events", region_name=REGION)
iam = boto3.client("iam", region_name=REGION)
sts = boto3.client("sts", region_name=REGION)

ACCOUNT_ID = sts.get_caller_identity()["Account"]
# Bucket names must be globally unique — suffix with account id.
SUFFIX = ACCOUNT_ID[-8:]

BUCKET_SCRATCH = f"{PREFIX}-scratch-{SUFFIX}"
BUCKET_ARCHIVE = f"{PREFIX}-archive-2023-{SUFFIX}"
TABLE_TEMP_CACHE = f"{PREFIX}-temp-cache"
TABLE_USER_SESSIONS = f"{PREFIX}-user-sessions"
FN_CLEANUP_WORKER = f"{PREFIX}-cleanup-worker"
FN_REPORT_GENERATOR = f"{PREFIX}-report-generator"
FN_BILLING_PROCESSOR = f"{PREFIX}-billing-processor"
RULE_REPORT_SCHEDULE = f"{PREFIX}-report-schedule"
ROLE_NAME = f"{PREFIX}-lambda-role"

LAMBDA_HANDLER_CODE = """
def handler(event, context):
    return {"statusCode": 200, "body": "ok"}
"""


def log(msg):
    print(f"[mirror-setup] {msg}")


def ensure_lambda_role():
    """Create (or reuse) a minimal execution role for the demo Lambdas."""
    try:
        role = iam.get_role(RoleName=ROLE_NAME)
        log(f"reusing existing IAM role {ROLE_NAME}")
        return role["Role"]["Arn"]
    except ClientError as e:
        if e.response["Error"]["Code"] != "NoSuchEntity":
            raise

    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }
    role = iam.create_role(
        RoleName=ROLE_NAME,
        AssumeRolePolicyDocument=json.dumps(trust_policy),
        Description="Execution role for Mirror sandbox demo Lambdas",
    )
    iam.attach_role_policy(
        RoleName=ROLE_NAME,
        PolicyArn="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    )
    log(f"created IAM role {ROLE_NAME}, waiting for propagation...")
    time.sleep(10)  # IAM role propagation lag before Lambda can assume it
    return role["Role"]["Arn"]


def make_zip_bytes():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.py", LAMBDA_HANDLER_CODE)
    buf.seek(0)
    return buf.read()


def ensure_bucket(name):
    try:
        s3.head_bucket(Bucket=name)
        log(f"bucket {name} already exists")
    except ClientError:
        if REGION == "us-east-1":
            s3.create_bucket(Bucket=name)
        else:
            s3.create_bucket(
                Bucket=name,
                CreateBucketConfiguration={"LocationConstraint": REGION},
            )
        log(f"created bucket {name}")


def ensure_table(name):
    try:
        dynamodb.describe_table(TableName=name)
        log(f"table {name} already exists")
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise

    dynamodb.create_table(
        TableName=name,
        KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    log(f"created table {name}, waiting until active...")
    dynamodb.get_waiter("table_exists").wait(TableName=name)


def ensure_function(name, role_arn, env_vars=None):
    zip_bytes = make_zip_bytes()
    try:
        lambda_client.get_function(FunctionName=name)
        log(f"function {name} already exists, updating code/env")
        lambda_client.update_function_code(FunctionName=name, ZipFile=zip_bytes)
        if env_vars is not None:
            lambda_client.update_function_configuration(
                FunctionName=name, Environment={"Variables": env_vars}
            )
        return
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise

    lambda_client.create_function(
        FunctionName=name,
        Runtime="python3.12",
        Role=role_arn,
        Handler="index.handler",
        Code={"ZipFile": zip_bytes},
        Environment={"Variables": env_vars or {}},
        Timeout=10,
        Description="Mirror sandbox demo function",
    )
    log(f"created function {name}")


def ensure_schedule_rule(rule_name, target_fn_name):
    events.put_rule(
        Name=rule_name,
        ScheduleExpression="rate(1 day)",
        State="ENABLED",
        Description="Mirror sandbox demo schedule",
    )
    fn = lambda_client.get_function(FunctionName=target_fn_name)
    target_arn = fn["Configuration"]["FunctionArn"]

    events.put_targets(
        Rule=rule_name,
        Targets=[{"Id": f"{rule_name}-target", "Arn": target_arn}],
    )
    try:
        lambda_client.add_permission(
            FunctionName=target_fn_name,
            StatementId=f"{rule_name}-invoke",
            Action="lambda:InvokeFunction",
            Principal="events.amazonaws.com",
            SourceArn=f"arn:aws:events:{REGION}:{ACCOUNT_ID}:rule/{rule_name}",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceConflictException":
            raise
    log(f"created/updated EventBridge rule {rule_name} -> {target_fn_name}")


def create_all():
    log(f"account={ACCOUNT_ID} region={REGION}")
    role_arn = ensure_lambda_role()

    ensure_bucket(BUCKET_SCRATCH)
    ensure_bucket(BUCKET_ARCHIVE)
    ensure_table(TABLE_TEMP_CACHE)
    ensure_table(TABLE_USER_SESSIONS)

    ensure_function(FN_CLEANUP_WORKER, role_arn)
    ensure_function(FN_REPORT_GENERATOR, role_arn, {"REPORTS_BUCKET": BUCKET_ARCHIVE})
    ensure_function(FN_BILLING_PROCESSOR, role_arn, {"SESSIONS_TABLE": TABLE_USER_SESSIONS})

    ensure_schedule_rule(RULE_REPORT_SCHEDULE, FN_REPORT_GENERATOR)

    log("done. Resources created:")
    for r in [BUCKET_SCRATCH, BUCKET_ARCHIVE, TABLE_TEMP_CACHE, TABLE_USER_SESSIONS,
              FN_CLEANUP_WORKER, FN_REPORT_GENERATOR, FN_BILLING_PROCESSOR, RULE_REPORT_SCHEDULE]:
        log(f"  - {r}")
    log("Hidden dependencies planted:")
    log(f"  - {FN_REPORT_GENERATOR} reads env var REPORTS_BUCKET -> {BUCKET_ARCHIVE}")
    log(f"  - {FN_BILLING_PROCESSOR} reads env var SESSIONS_TABLE -> {TABLE_USER_SESSIONS}")


def teardown_all():
    log("tearing down sandbox resources...")

    for rule in [RULE_REPORT_SCHEDULE]:
        try:
            targets = events.list_targets_by_rule(Rule=rule)["Targets"]
            if targets:
                events.remove_targets(Rule=rule, Ids=[t["Id"] for t in targets])
            events.delete_rule(Name=rule)
            log(f"deleted rule {rule}")
        except ClientError as e:
            log(f"skip rule {rule}: {e.response['Error']['Code']}")

    for fn in [FN_CLEANUP_WORKER, FN_REPORT_GENERATOR, FN_BILLING_PROCESSOR]:
        try:
            lambda_client.delete_function(FunctionName=fn)
            log(f"deleted function {fn}")
        except ClientError as e:
            log(f"skip function {fn}: {e.response['Error']['Code']}")

    for table in [TABLE_TEMP_CACHE, TABLE_USER_SESSIONS]:
        try:
            dynamodb.delete_table(TableName=table)
            log(f"deleted table {table}")
        except ClientError as e:
            log(f"skip table {table}: {e.response['Error']['Code']}")

    for bucket in [BUCKET_SCRATCH, BUCKET_ARCHIVE]:
        try:
            objs = s3.list_objects_v2(Bucket=bucket).get("Contents", [])
            if objs:
                s3.delete_objects(
                    Bucket=bucket,
                    Delete={"Objects": [{"Key": o["Key"]} for o in objs]},
                )
            s3.delete_bucket(Bucket=bucket)
            log(f"deleted bucket {bucket}")
        except ClientError as e:
            log(f"skip bucket {bucket}: {e.response['Error']['Code']}")

    log("teardown complete. (IAM role left in place, harmless to keep or delete manually.)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--teardown", action="store_true", help="delete all sandbox resources")
    args = parser.parse_args()

    if args.teardown:
        teardown_all()
    else:
        create_all()
