"""
Mirror — blast radius.

Extends graph_builder.dependents_of() (direct dependents only) to the full
transitive chain: everything that depends on this resource, plus
everything that depends on those, and so on. The brainstorm's original
version of this feature wanted customer counts and revenue figures
attached to that chain ("12,420 customers, ₹84,000") — Mirror can't derive
those honestly from AWS metadata, so this file stops at what it CAN derive
for real: the actual transitive resource chain, and, for any Lambda
function found in it, its real total invocation count over the last 90
days (the same CloudWatch API graph_builder.py already uses for recency,
summed instead of just checked for presence). No customer, revenue, or
downtime number is invented anywhere in this file — if a resource isn't a
Lambda, it just gets counted, not assigned a fake traffic number.
"""

import datetime

import boto3

REGION = boto3.Session().region_name or "us-east-1"
cloudwatch = boto3.client("cloudwatch", region_name=REGION)


def transitive_dependents(graph, node_id):
    """
    Real BFS outward along the real edges already discovered by
    graph_builder.py: everything that (directly or transitively) depends
    on node_id. Returns a list of (resource_id, hop_count) pairs —
    hop_count 1 = direct dependent (same as dependents_of()), 2 = depends
    on a direct dependent, etc. Guarded against cycles via a visited set,
    even though this graph's edges (env vars, EventBridge targets)
    shouldn't produce one.
    """
    visited = {node_id}
    frontier = [node_id]
    result = []
    hop = 0

    while frontier:
        hop += 1
        next_frontier = []
        for current in frontier:
            for edge in graph["edges"]:
                if edge["to"] != current:
                    continue
                dependent = edge["from"]
                if dependent in visited:
                    continue
                visited.add(dependent)
                result.append((dependent, hop))
                next_frontier.append(dependent)
        frontier = next_frontier

    return result


def real_traffic_signal(function_name):
    """
    Real total (not just presence, unlike graph_builder's recency check)
    Lambda invocation count over the last 90 days — the one real number
    allowed to stand in for "how much this matters." Returns an int, or
    None if the metric couldn't be read (never a guessed number).
    """
    end = datetime.datetime.utcnow()
    start = end - datetime.timedelta(days=90)
    try:
        resp = cloudwatch.get_metric_statistics(
            Namespace="AWS/Lambda",
            MetricName="Invocations",
            Dimensions=[{"Name": "FunctionName", "Value": function_name}],
            StartTime=start,
            EndTime=end,
            Period=86400,
            Statistics=["Sum"],
        )
        return int(sum(d["Sum"] for d in resp["Datapoints"]))
    except Exception:
        return None


def blast_radius(graph, node_id):
    """
    The full transitive dependent chain for node_id, each entry enriched
    with a real 90-day invocation total when that entry is a Lambda.
    Non-Lambda entries are reported honestly with just their hop count —
    no traffic number is fabricated for a resource type CloudWatch can't
    give one for here.
    """
    chain = transitive_dependents(graph, node_id)
    enriched = []
    for resource_id, hop in chain:
        entry = {"resource": resource_id, "hop": hop}
        if resource_id.startswith("lambda:"):
            fn_name = graph["nodes"].get(resource_id, {}).get("name") or resource_id.split(":", 1)[1]
            entry["invocations_90d"] = real_traffic_signal(fn_name)
        enriched.append(entry)
    return enriched
