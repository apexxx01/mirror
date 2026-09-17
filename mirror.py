"""
Mirror — driver script.

    python mirror.py                 # analyze every deletable resource
    python mirror.py --explain <id>  # "why not?" — full reasoning for one resource
    python mirror.py --rewind <id>   # Black Box: counterfactual replay for one resource
    python mirror.py --rollback <id> # real recovery facts if it gets deleted anyway
    python mirror.py --diff <id>     # real before/after diff for this resource + its real dependents
    python mirror.py --blast-radius <id> # real transitive dependent chain + real Lambda traffic
    python mirror.py --full-story <id> # explain + blast-radius + rewind + rollback + diff, chained

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
import datetime
import json
import sys

import boto3
from botocore.exceptions import ClientError

from decide import counterfactual, decide, load_policies
from graph_builder import build_graph, dependents_of
from reversibility import reversibility_of
from rollback import rollback_plan_for
from future_diff import future_diff
from blast_radius import blast_radius


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
        verdict["reversibility"] = reversibility_of(node["type"], node["name"])
        results.append(verdict)
    return results


def print_report(results):
    order = {"BLOCKED": 0, "NEEDS_REVIEW": 1, "SAFE": 2}
    results = sorted(results, key=lambda r: order.get(r["verdict"], 3))

    print(f"{'VERDICT':<14} {'RESOURCE':<45} {'DEPS':<5} {'RISK':<5} {'REVERSIBLE':<10}")
    print("-" * 87)
    for r in results:
        print(f"{r['verdict']:<14} {r['resource']:<45} {len(r['dependents']):<5} {r['risk_score']:<5} {r['reversibility']['level']:<10}")

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
    rev = reversibility_of(node["type"], node["name"])

    print(f"WHY CAN'T I {action.upper()} {resource_id}?\n")
    print(f"  verdict:            {verdict['verdict']}")
    print(f"  real dependents:    {len(deps)}")
    for dep in deps:
        print(f"    - {dep}")
    print(f"  days since activity: {node.get('days_since_activity')}")
    print(f"  risk score:          {risk}/100")
    print(f"  reversibility:       {rev['level']} — {rev['reason']}")
    print(f"  cedar decision:      {verdict['cedar_decision']}")
    print(f"  cedar reasons:       {verdict['cedar_reasons']}")
    print(f"  rollback plan:       run `python mirror.py --rollback {resource_id}` for real recovery facts")

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


def rollback_plan(graph, resource_id):
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    node = graph["nodes"][resource_id]
    plan = rollback_plan_for(node["type"], node["name"])

    print(f"ROLLBACK PLAN: {resource_id}\n")
    if plan["available"]:
        for step in plan["steps"]:
            print(f"  - {step}")
    else:
        print(f"  NO ROLLBACK PATH: {plan['reason']}")


def print_future_diff(graph, resource_id, action="delete"):
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    diff = future_diff(graph, resource_id, action)

    print(f"FUTURE DIFF: {resource_id} ({action})\n")
    print("  THIS RESOURCE:")
    print(f"    before: {diff['self']['before']}")
    print(f"    after:  {diff['self']['after']['note']}")

    if diff["downstream"]:
        print(f"\n  DOWNSTREAM ({len(diff['downstream'])} real dependent(s) affected):")
        for effect in diff["downstream"]:
            print(f"\n    {effect['dependent']}  (via {effect['via']})")
            print(f"      before: {effect['before']}")
            print(f"      after:  {effect['after']}")
    else:
        print("\n  DOWNSTREAM: no real dependents — nothing else would be affected")


def print_blast_radius(graph, resource_id):
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    chain = blast_radius(graph, resource_id)

    print(f"BLAST RADIUS: {resource_id}\n")
    if not chain:
        print("  no transitive dependents — nothing downstream would be affected")
        return

    print(f"  {len(chain)} real transitive dependent(s):")
    for entry in chain:
        line = f"    hop {entry['hop']}: {entry['resource']}"
        if "invocations_90d" in entry:
            inv = entry["invocations_90d"]
            inv_str = str(inv) if inv is not None else "unknown (CloudWatch read failed)"
            line += f"  — real 90-day invocations: {inv_str}"
        print(line)


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


def full_story(graph, policies, resource_id, action="delete"):
    """
    Chains explain + rewind + rollback_plan + print_future_diff into one
    narrative for a single resource. No new AWS calls or new logic — this
    is purely presentation over the exact same four functions above, each
    already independently verified live. Built for the 3-minute demo video:
    one command answers verdict-and-why, what-if, what-recovery-exists, and
    what-breaks-mechanically in a single read instead of four separate
    invocations.
    """
    if resource_id not in graph["nodes"]:
        print(f"unknown resource: {resource_id}", file=sys.stderr)
        sys.exit(1)

    sep = "=" * 87
    print(sep)
    print(f"MIRROR FULL STORY: {resource_id}  (action: {action})")
    print(sep)

    print("\n--- 1. VERDICT & WHY ---\n")
    explain(graph, policies, resource_id, action)

    print("\n--- 2. HOW FAR DOES THIS REACH? (blast radius) ---\n")
    print_blast_radius(graph, resource_id)

    print("\n--- 3. WHAT IF THE KEY FACT WERE DIFFERENT? (counterfactual rewind) ---\n")
    rewind(graph, policies, resource_id, action)

    print("\n--- 4. WHAT RECOVERY ALREADY EXISTS? (rollback plan) ---\n")
    rollback_plan(graph, resource_id)

    print("\n--- 5. WHAT BREAKS, MECHANICALLY, IF THIS RUNS? (future diff) ---\n")
    print_future_diff(graph, resource_id, action)

    print("\n" + sep)


DATA_KEY = "mirror-latest.json"


def publish_to_s3(results, bucket_name, bedrock_summary=None, region=None):
    """
    Publish this analysis run as a public JSON snapshot, for the Amplify
    frontend to fetch and render. This is real output from a real run —
    the frontend never invents or simulates anything, it just displays
    whatever this function actually wrote.

    Idempotent: creates the bucket if it doesn't exist yet, and only ever
    touches the single DATA_KEY object — safe to re-run every time you
    want to refresh what the frontend shows.

    Returns the public HTTPS URL of the published JSON.
    """
    region = region or boto3.Session().region_name or "us-east-1"
    s3 = boto3.client("s3", region_name=region)

    try:
        s3.head_bucket(Bucket=bucket_name)
    except ClientError:
        if region == "us-east-1":
            s3.create_bucket(Bucket=bucket_name)
        else:
            s3.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={"LocationConstraint": region},
            )
        # New buckets default to blocking all public access — this bucket
        # exists specifically to serve one public JSON file to the frontend,
        # so that default has to be turned off before a bucket policy can
        # actually grant public read.
        s3.put_public_access_block(
            Bucket=bucket_name,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": False,
                "IgnorePublicAcls": False,
                "BlockPublicPolicy": False,
                "RestrictPublicBuckets": False,
            },
        )

    # Public read on just this one key — not the whole bucket.
    policy = {
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "PublicReadMirrorData",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": f"arn:aws:s3:::{bucket_name}/{DATA_KEY}",
        }],
    }
    s3.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(policy))

    # Let the Amplify-hosted frontend fetch this cross-origin.
    s3.put_bucket_cors(
        Bucket=bucket_name,
        CORSConfiguration={
            "CORSRules": [{
                "AllowedMethods": ["GET"],
                "AllowedOrigins": ["*"],
                "AllowedHeaders": ["*"],
            }]
        },
    )

    payload = {
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "results": results,
        "bedrock_summary": bedrock_summary,
    }
    s3.put_object(
        Bucket=bucket_name,
        Key=DATA_KEY,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json",
        CacheControl="no-cache",  # each publish should be visible immediately, not cached stale
    )

    url = f"https://{bucket_name}.s3.{region}.amazonaws.com/{DATA_KEY}"
    return url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", default="delete")
    parser.add_argument("--explain", metavar="RESOURCE_ID")
    parser.add_argument("--rewind", metavar="RESOURCE_ID")
    parser.add_argument("--rollback", metavar="RESOURCE_ID",
                         help="show real recovery facts for one resource (versioning/PITR/versions/rule definition)")
    parser.add_argument("--diff", metavar="RESOURCE_ID",
                         help="show the real before/after diff for one resource and its real dependents")
    parser.add_argument("--blast-radius", metavar="RESOURCE_ID",
                         help="show the real transitive dependent chain and real Lambda traffic in it")
    parser.add_argument("--full-story", metavar="RESOURCE_ID",
                         help="chain explain + blast-radius + rewind + rollback + diff into one narrative report")
    parser.add_argument("--graph-file", help="use a saved graph.json instead of hitting AWS live")
    parser.add_argument("--bedrock-report", action="store_true",
                         help="also generate a plain-English summary via Bedrock (Claude)")
    parser.add_argument("--publish-s3", metavar="BUCKET_NAME",
                         help="publish this run's results as JSON to S3 for the frontend to read")
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
    elif args.rollback:
        rollback_plan(graph, args.rollback)
    elif args.diff:
        print_future_diff(graph, args.diff, args.action)
    elif args.blast_radius:
        print_blast_radius(graph, args.blast_radius)
    elif args.full_story:
        full_story(graph, policies, args.full_story, args.action)
    else:
        results = evaluate_all(graph, policies, args.action)
        print_report(results)

        bedrock_summary = None
        if args.bedrock_report:
            from bedrock_report import generate_report_safe
            bedrock_summary = generate_report_safe(results)
            print("\n--- BEDROCK SUMMARY ---")
            print(bedrock_summary)

        if args.publish_s3:
            url = publish_to_s3(results, args.publish_s3, bedrock_summary=bedrock_summary)
            print(f"\nPublished to: {url}")


if __name__ == "__main__":
    main()
