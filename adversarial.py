"""
Mirror — adversarial failure injection (real version).

The brainstorm's original idea was to invent hypothetical failure
conditions — network timeout, stale cache, traffic spike — none of which
Mirror has any evidence for, so building that version would violate the
project's own no-fabrication rule. This file builds the real alternative:
does this resource's blast-radius chain have an ACTUAL track record of
problems? For every Lambda found — the resource itself, if it's one, plus
everything in its transitive dependent chain from blast_radius.py — it
queries real CloudWatch Errors and Throttles totals over the last 90 days
(the same get_metric_statistics pattern graph_builder.py already uses for
Invocations, just different metric names). If real errors or throttles
exist, they're reported with the actual numbers. If none exist, that's
reported honestly as "no historical error evidence found" — never
upgraded to a claim that the resource "passed" a test it never ran, and
never disguised by inventing a scenario to make the feature look more
impressive. Mirror is asking "does this chain have a track record of
problems," not "what if I made one up."
"""

import datetime

import boto3

from blast_radius import transitive_dependents

REGION = boto3.Session().region_name or "us-east-1"
cloudwatch = boto3.client("cloudwatch", region_name=REGION)


def real_reliability_signal(function_name):
    """
    Real total Errors and Throttles over the last 90 days for one Lambda
    function — actual CloudWatch data, never simulated. Returns
    {"errors": int|None, "throttles": int|None}; a field is None only if
    that metric genuinely couldn't be read, never a guessed zero.
    """
    end = datetime.datetime.utcnow()
    start = end - datetime.timedelta(days=90)
    result = {}
    for metric in ("Errors", "Throttles"):
        try:
            resp = cloudwatch.get_metric_statistics(
                Namespace="AWS/Lambda",
                MetricName=metric,
                Dimensions=[{"Name": "FunctionName", "Value": function_name}],
                StartTime=start,
                EndTime=end,
                Period=86400,
                Statistics=["Sum"],
            )
            result[metric.lower()] = int(sum(d["Sum"] for d in resp["Datapoints"]))
        except Exception:
            result[metric.lower()] = None
    return result


def adversarial_check(graph, node_id):
    """
    Real historical-reliability evidence for node_id and every Lambda in
    its transitive dependent chain (reusing blast_radius.py's real BFS —
    no new graph-walking logic). Returns a list of
    {"resource": id, "hop": int, "errors": int|None, "throttles": int|None}
    — hop 0 is the resource itself (included only if it's a Lambda), hop
    1+ come straight from transitive_dependents().
    """
    lambdas = []

    if node_id.startswith("lambda:"):
        name = graph["nodes"].get(node_id, {}).get("name") or node_id.split(":", 1)[1]
        lambdas.append((node_id, 0, name))

    for resource_id, hop in transitive_dependents(graph, node_id):
        if resource_id.startswith("lambda:"):
            name = graph["nodes"].get(resource_id, {}).get("name") or resource_id.split(":", 1)[1]
            lambdas.append((resource_id, hop, name))

    entries = []
    for resource_id, hop, name in lambdas:
        signal = real_reliability_signal(name)
        entries.append({"resource": resource_id, "hop": hop, **signal})
    return entries
