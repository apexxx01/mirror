"""
Mirror — dependency graph builder.

Pulls REAL relationships out of your AWS account via boto3: Lambda
environment variables that point at buckets/tables, EventBridge rule
targets, and CloudWatch activity recency. No invented data — every
edge in the graph traces back to an actual API response.

Output: a JSON graph {"nodes": {...}, "edges": [...]} that decide.py
consumes. Run this standalone to inspect what it finds:

    python graph_builder.py > graph.json
"""

import datetime
import json
import sys

import boto3

PREFIX = "mirror-demo"
REGION = boto3.Session().region_name or "us-east-1"

s3 = boto3.client("s3", region_name=REGION)
dynamodb = boto3.client("dynamodb", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
events = boto3.client("events", region_name=REGION)
cloudwatch = boto3.client("cloudwatch", region_name=REGION)


def list_demo_buckets():
    resp = s3.list_buckets()
    return [b["Name"] for b in resp["Buckets"] if b["Name"].startswith(PREFIX)]


def list_demo_tables():
    resp = dynamodb.list_tables()
    return [t for t in resp["TableNames"] if t.startswith(PREFIX)]


def list_demo_functions():
    fns = []
    paginator = lambda_client.get_paginator("list_functions")
    for page in paginator.paginate():
        for fn in page["Functions"]:
            if fn["FunctionName"].startswith(PREFIX):
                fns.append(fn)
    return fns


def list_demo_rules():
    resp = events.list_rules(NamePrefix=PREFIX)
    return resp["Rules"]


def lambda_last_invocation_days_ago(fn_name):
    """CloudWatch recency signal: days since last Invocations datapoint."""
    end = datetime.datetime.utcnow()
    start = end - datetime.timedelta(days=90)
    try:
        resp = cloudwatch.get_metric_statistics(
            Namespace="AWS/Lambda",
            MetricName="Invocations",
            Dimensions=[{"Name": "FunctionName", "Value": fn_name}],
            StartTime=start,
            EndTime=end,
            Period=86400,
            Statistics=["Sum"],
        )
        datapoints = [d for d in resp["Datapoints"] if d["Sum"] > 0]
        if not datapoints:
            return 90  # no activity in the whole lookback window
        latest = max(d["Timestamp"] for d in datapoints)
        return (end - latest.replace(tzinfo=None)).days
    except Exception:
        return 90


def dynamodb_last_activity_days_ago(table_name):
    """Recency signal for a table: days since the last nonzero read OR
    write capacity datapoint, over a 90-day lookback. Real CloudWatch data,
    same pattern as the Lambda invocation check above — this used to be
    omitted here, which meant every table fell back to an unknown/ambiguous
    signal (risk_score 50, always NEEDS_REVIEW) even when it was plainly
    idle. Filling it in gives idle tables the same fair shot at SAFE that
    idle Lambdas already get."""
    end = datetime.datetime.utcnow()
    start = end - datetime.timedelta(days=90)
    latest = None
    for metric in ("ConsumedReadCapacityUnits", "ConsumedWriteCapacityUnits"):
        try:
            resp = cloudwatch.get_metric_statistics(
                Namespace="AWS/DynamoDB",
                MetricName=metric,
                Dimensions=[{"Name": "TableName", "Value": table_name}],
                StartTime=start,
                EndTime=end,
                Period=86400,
                Statistics=["Sum"],
            )
            datapoints = [d for d in resp["Datapoints"] if d["Sum"] > 0]
            if datapoints:
                candidate = max(d["Timestamp"] for d in datapoints)
                if latest is None or candidate > latest:
                    latest = candidate
        except Exception:
            continue
    if latest is None:
        return 90  # no read or write activity in the whole lookback window
    return (end - latest.replace(tzinfo=None)).days


def s3_last_modified_days_ago(bucket_name):
    """Recency signal from the bucket's most recently modified object."""
    end = datetime.datetime.utcnow()
    try:
        resp = s3.list_objects_v2(Bucket=bucket_name)
        objs = resp.get("Contents", [])
        if not objs:
            return 90  # empty bucket, treat as stale
        latest = max(o["LastModified"] for o in objs)
        return (end - latest.replace(tzinfo=None)).days
    except Exception:
        return 90


def build_graph():
    nodes = {}
    edges = []  # {"from": resource_id, "to": resource_id, "via": "env_var" | "event_target"}

    buckets = list_demo_buckets()
    for b in buckets:
        nodes[f"s3:{b}"] = {
            "type": "s3_bucket",
            "name": b,
            "days_since_activity": s3_last_modified_days_ago(b),
        }

    tables = list_demo_tables()
    for t in tables:
        nodes[f"dynamodb:{t}"] = {
            "type": "dynamodb_table",
            "name": t,
            "days_since_activity": dynamodb_last_activity_days_ago(t),
        }

    functions = list_demo_functions()
    for fn in functions:
        fn_name = fn["FunctionName"]
        node_id = f"lambda:{fn_name}"
        nodes[node_id] = {
            "type": "lambda_function",
            "name": fn_name,
            "days_since_activity": lambda_last_invocation_days_ago(fn_name),
        }

        # Real dependency discovery: read the function's actual env vars
        config = lambda_client.get_function_configuration(FunctionName=fn_name)
        env_vars = config.get("Environment", {}).get("Variables", {})

        for key, value in env_vars.items():
            if value in buckets:
                edges.append({"from": node_id, "to": f"s3:{value}", "via": f"env_var:{key}"})
            elif value in tables:
                edges.append({"from": node_id, "to": f"dynamodb:{value}", "via": f"env_var:{key}"})

    rules = list_demo_rules()
    for rule in rules:
        rule_name = rule["Name"]
        node_id = f"eventbridge:{rule_name}"
        nodes[node_id] = {"type": "eventbridge_rule", "name": rule_name, "days_since_activity": None}

        targets = events.list_targets_by_rule(Rule=rule_name)["Targets"]
        for target in targets:
            target_arn = target["Arn"]
            for fn in functions:
                if fn["FunctionArn"] == target_arn:
                    edges.append({
                        "from": node_id,
                        "to": f"lambda:{fn['FunctionName']}",
                        "via": "eventbridge_target",
                    })

    return {"nodes": nodes, "edges": edges}


def dependents_of(graph, node_id):
    """Who points AT this resource — i.e. who breaks if we delete it."""
    return [e["from"] for e in graph["edges"] if e["to"] == node_id]


if __name__ == "__main__":
    graph = build_graph()
    print(json.dumps(graph, indent=2))
