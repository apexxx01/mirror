"""
Mirror — Bedrock report generator.

Turns mirror.py's raw verdict table into a short, plain-English narrative a
judge (or a non-technical teammate) can read in ten seconds. This is the
only file that talks to Bedrock; everything upstream of it (graph_builder,
decide.py) stays pure/deterministic and doesn't know this exists.

Region note: ap-south-1 (Mumbai) does not host Claude models directly —
Bedrock requires the *global* cross-region inference profile ID there, not
a plain region-scoped model ID. The client itself is still created in
ap-south-1; only the modelId changes. See MODEL_ID below.

One-time setup this needs that setup_sandbox.py can't do for you: Bedrock
model access has to be turned on per-account before ANY InvokeModel/Converse
call will work — AWS Console -> Bedrock -> Model access -> Anthropic ->
request access to Claude Haiku (or whichever model you pick). It's usually
instant, but it's a manual click, not an API call.

Usage:
    python bedrock_report.py --graph-file graph.json   # reads mirror's own analysis
    # or import generate_report(results) directly from mirror.py
"""

import argparse
import json

import boto3
from botocore.exceptions import ClientError

REGION = "ap-south-1"
# Global inference profile — required for Claude models from India regions.
MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"


def build_prompt(results):
    blocked = [r for r in results if r["verdict"] == "BLOCKED"]
    review = [r for r in results if r["verdict"] == "NEEDS_REVIEW"]
    safe = [r for r in results if r["verdict"] == "SAFE"]

    lines = ["Mirror analyzed the following AWS resources for safe deletion:\n"]

    lines.append(f"BLOCKED ({len(blocked)} resources — real dependents found):")
    for r in blocked:
        deps = ", ".join(r["dependents"]) or "none listed"
        lines.append(f"  - {r['resource']}: depended on by {deps}")

    lines.append(f"\nNEEDS_REVIEW ({len(review)} resources — no dependents, but risk score high):")
    for r in review:
        lines.append(f"  - {r['resource']}: risk score {r['risk_score']}/100")

    lines.append(f"\nSAFE ({len(safe)} resources — no dependents, low risk):")
    for r in safe:
        lines.append(f"  - {r['resource']}")

    lines.append(
        "\nWrite a short (under 150 words) plain-English summary of this analysis "
        "for a hackathon judge who has 10 seconds to read it. Lead with the "
        "single most important finding — resources that LOOK safe to delete "
        "(low recent activity) but are actually BLOCKED because something real "
        "still depends on them. Be concrete: name the resources. No preamble, "
        "no 'here is a summary', just the summary itself."
    )
    return "\n".join(lines)


def generate_report(results, model_id=MODEL_ID, region=REGION):
    """
    Calls Bedrock's Converse API with a Claude model to turn the raw verdict
    list into a judge-readable narrative. Returns the report text.

    Raises the underlying ClientError on failure (e.g. model access not
    granted yet) — callers should catch it and degrade gracefully rather
    than letting the whole demo run fail because of a report-only feature.
    """
    client = boto3.client("bedrock-runtime", region_name=region)
    prompt = build_prompt(results)

    response = client.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"maxTokens": 400, "temperature": 0.3, "topP": 0.9},
    )
    return response["output"]["message"]["content"][0]["text"]


def generate_report_safe(results, model_id=MODEL_ID, region=REGION):
    """Same as generate_report(), but never raises — returns a fallback
    string on any Bedrock error so the rest of mirror.py's output still
    prints even if Bedrock model access hasn't been granted yet."""
    try:
        return generate_report(results, model_id, region)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "Unknown")
        return (
            f"[Bedrock report unavailable: {code}. If this says AccessDenied, "
            f"enable model access for Anthropic Claude in the Bedrock console "
            f"under Model access, then retry.]"
        )
    except Exception as e:
        return f"[Bedrock report unavailable: {e}]"


if __name__ == "__main__":
    from graph_builder import build_graph
    from decide import decide, load_policies
    from mirror import evaluate_all

    parser = argparse.ArgumentParser()
    parser.add_argument("--graph-file", help="use a saved graph.json instead of hitting AWS live")
    args = parser.parse_args()

    if args.graph_file:
        with open(args.graph_file) as f:
            graph = json.load(f)
    else:
        graph = build_graph()

    policies = load_policies()
    results = evaluate_all(graph, policies)

    print(generate_report_safe(results))
