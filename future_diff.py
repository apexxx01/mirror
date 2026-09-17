"""
Mirror — future diff.

Answers "what real fields actually change if this action happens?" by
diffing a resource's own real current state against its real state
immediately after, then propagating that same diff to every real
dependent already discovered by graph_builder. Every line here is either
a field Mirror already computes elsewhere (dependents_of, reversibility_of)
or a direct, mechanical consequence of a real edge in the real graph — an
env var that currently resolves to an existing bucket would resolve to
nothing, an EventBridge rule that currently targets a live function would
target a dead one. Nothing here is simulated or estimated: no invented
latency number, error rate, or business metric. That's what separates this
from the brainstorm's rejected "adversarial futures" idea — this diff never
imagines a scenario, it only restates real graph edges as before/after.
"""

from reversibility import reversibility_of


def self_diff(graph, node_id, action="delete"):
    node = graph["nodes"][node_id]
    deps = [e for e in graph["edges"] if e["to"] == node_id]
    rev = reversibility_of(node["type"], node["name"])

    before = {
        "exists": True,
        "type": node["type"],
        "dependents_count": len(deps),
        "reversibility": rev["level"],
        "days_since_activity": node.get("days_since_activity"),
    }
    after = {
        "exists": False,
        "note": f"resource would no longer exist after {action} — every field above becomes undefined",
    }
    return {"before": before, "after": after}


def downstream_diff(graph, node_id):
    """For every real dependent, the real mechanical effect of this
    resource disappearing — read directly off the edge that already
    exists in the graph, never simulated."""
    effects = []
    for edge in graph["edges"]:
        if edge["to"] != node_id:
            continue
        dependent_id = edge["from"]
        via = edge.get("via", "unknown")

        if via.startswith("env_var:"):
            var_name = via.split(":", 1)[1]
            before = f"env var {var_name} on {dependent_id} resolves to {node_id}, which currently exists"
            after = (
                f"env var {var_name} on {dependent_id} would still be set to the same value, but "
                f"{node_id} would no longer exist — the next read/write through that env var fails "
                f"(e.g. NoSuchBucket / ResourceNotFoundException)"
            )
        elif via == "eventbridge_target":
            before = f"{dependent_id} currently targets {node_id}, which exists and is invokable"
            after = (
                f"{dependent_id} would still fire on its own schedule, but its target {node_id} "
                f"would no longer exist — invocations fail (Lambda ResourceNotFoundException), "
                f"landing in a DLQ if one is configured on the target, or just dropped/logged as a "
                f"failed invocation if not"
            )
        else:
            before = f"{dependent_id} depends on {node_id} via {via}"
            after = f"that dependency would break — {node_id} would no longer exist"

        effects.append({"dependent": dependent_id, "via": via, "before": before, "after": after})
    return effects


def future_diff(graph, node_id, action="delete"):
    if node_id not in graph["nodes"]:
        return None
    return {
        "resource": node_id,
        "action": action,
        "self": self_diff(graph, node_id, action),
        "downstream": downstream_diff(graph, node_id),
    }
