"""
Mirror — driver script.

    python mirror.py                 # analyze every deletable resource
    python mirror.py --explain <id>  # "why not?" — full reasoning for one resource
    python mirror.py --rewind <id>   # Black Box: counterfactual replay for one resource

This is the only file that does I/O (AWS calls via graph_builder, stdout).
graph_builder.build_graph() reads your real AWS account. decide() is pure —
it never touches the network, so every verdict below is fully reproducible
from the graph.json snapshot alone.

Risk scoring: Mirror's one genuine judgment call is turning "days since
activity" into a 0-100 risk_score. That formula is deliberately simple and
fully disclosed here — no hidden weighting, nothing fabricated:

    risk_score = 100 - min(days_since_activity, 100)

i.e. touched today -> risk_score ~100 (would look "important" if we scored
it backwards — see below), untouched for 90+ days -> risk_score 0.

Wait — that's inverted from what you'd want for "how sure are we this is
abandoned." Mirror's risk_score means "how risky is this evidence to act
on," not "how active is it." A resource nobody has read from in 90 days
LOOKS safe to delete on activity alone — that's exactly the trap the whole
project exists to catch. So risk_score here is low when a resource is
merely inactive, and the only thing that overrides "low risk, go ahead" is
a REAL dependency edge (dependents_count > 0), which is a hard Cedar forbid
regardless of the score. That's why archive-2023 and user-sessions get
BLOCKED in the demo even though they look untouched for months: activity
recency never gets a vote once a real dependent exists.
"""

import argparse
import json
import sys

from decide import counterfactual, decide, load_policies
from graph_builder import build_graph, dependents_of


def risk_score_from_activity(days_since_activity):
    """0-100. Long-idle resources score low risk on their own — activity
    recency alone is never grounds for BLOCKED; only real dependents are."""
    if days_since_activity is None:
        return 50  # no signal available (e.g. DynamoDB tables here) — treat as ambiguous, not safe
    return max(0, 100 - min(days_since_activity, 100))


def evaluate_all(graph, policies, action="delete"):
    results = []
    for node_id, node in graph["nodes"].items():
        deps = dependents_of(graph, node_id)
        risk = risk_score_from_activity(node.get("days_since_activity"))
        verdict = decide(action, node_id, len(deps), risk, policies)
        verdict["dependents"] = deps
        verdict["node_type"] = node["type"]
        verdict["node_name"] = node["name"]
        results.append(verdict)
    return results


def print_report(results):
    order = {"BLOCKED": 0, "NEEDS_REVIEW": 1, "SAFE": 2}
    results = sorted(results, key=lambda r: order.get(r["verdict"], 3))

    print(f"{'VERDICT':<14} {'RESOURCE':<45} {'DEPS':<5} {'RISK':<5}")
    print("-" * 75)
    for r in results:
        print(f"{r['verdict']:<14} {r['resource']:<45} {len(r['dependents']):<5} {r['risk_score']:<5}")

    blocked = [r for r in results if r["verdict"] == "BLOCKED"]
    if blocked:
        print("\nBLOCKED — real dependents found, deletion refused regardless of activity:")
        for r in blocked:
            print(f"  {r['resource']}")
            for dep in r["dependents"]:
                print(f"    <- depended on by {dep}")


def explain(graph, policies, resource_id, action="delete"):
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    node = graph["nodes"][resource_id]
    deps = dependents_of(graph, resource_id)
    risk = risk_score_from_activity(node.get("days_since_activity"))
    verdict = decide(action, resource_id, len(deps), risk, policies)

    print(f"WHY CAN'T I {action.upper()} {resource_id}?\n")
    print(f"  verdict:            {verdict['verdict']}")
    print(f"  real dependents:    {len(deps)}")
    for dep in deps:
        print(f"    - {dep}")
    print(f"  days since activity: {node.get('days_since_activity')}")
    print(f"  risk score:          {risk}/100")
    print(f"  cedar decision:      {verdict['cedar_decision']}")
    print(f"  cedar reasons:       {verdict['cedar_reasons']}")

    if verdict["verdict"] == "BLOCKED":
        print("\n  BLOCKED BECAUSE:")
        for dep in deps:
            print(f"    - {dep} depends on this resource and would break")
        print("    - a real dependency always overrides activity/age signals")
    elif verdict["verdict"] == "SAFE":
        print("\n  SAFE BECAUSE: no real dependents found, and low risk score.")
    else:
        print("\n  NEEDS REVIEW BECAUSE: no dependents found, but risk score is high")
        print("    enough that Mirror isn't confident — a human should look.")


def rewind(graph, policies, resource_id, action="delete"):
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    node = graph["nodes"][resource_id]
    deps = dependents_of(graph, resource_id)
    risk = risk_score_from_activity(node.get("days_since_activity"))
    base_evidence = {"dependents_count": len(deps), "risk_score": risk}

    actual = decide(action, resource_id, len(deps), risk, policies)
    print(f"REWIND: {resource_id}\n")
    print(f"  ACTUAL: dependents={len(deps)} risk={risk} -> {actual['verdict']}")

    if len(deps) > 0:
        cf = counterfactual(action, resource_id, base_evidence, policies, dependents_count=0)
        print(f"  IF this resource had zero dependents -> {cf['verdict']}")
        print("  (this is the exact gap a naive activity-only agent would have missed)")
    else:
        cf = counterfactual(action, resource_id, base_evidence, policies,
                             dependents_count=max(1, len(deps) + 1))
        print(f"  IF this resource had a dependent -> {cf['verdict']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", default="delete")
    parser.add_argument("--explain", metavar="RESOURCE_ID")
    parser.add_argument("--rewind", metavar="RESOURCE_ID")
    parser.add_argument("--graph-file", help="use a saved graph.json instead of hitting AWS live")
    args = parser.parse_args()

    if args.graph_file:
        with open(args.graph_file) as f:
            graph = json.load(f)
    else:
        graph = build_graph()

    policies = load_policies()

    if args.explain:
        explain(graph, policies, args.explain, args.action)
    elif args.rewind:
        rewind(graph, policies, args.rewind, args.action)
    else:
        results = evaluate_all(graph, policies, args.action)
        print_report(results)


if __name__ == "__main__":
    main()
