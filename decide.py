"""
Mirror — the decision core.

decide() is a PURE function: same inputs -> same output, every time, no
hidden state, no I/O, no clock reads. That purity is not a style choice —
it's what makes Black Box's counterfactual replay ("what if dependents_count
had been 0?") technically real instead of a scripted illusion. Replay is
just: call decide() again with one field changed, diff the verdicts.

The actual authorization decision is made by Cedar (via cedarpy), not by
hand-written if/else — this is genuine authorization-as-policy. decide()'s
job is just: build the request Cedar expects, call it, and translate its
raw Allow/Deny + reason codes into a verdict a human (or a report) can read.

Verified against the real policies/mirror.cedar (see comments in that file
for the policy0/policy1 meanings — this mapping MUST stay in sync with
policy order there):

    Decision.Allow, reasons=['policy1']  -> SAFE        (explicit permit)
    Decision.Deny,  reasons=['policy0']  -> BLOCKED      (hard forbid fired)
    Decision.Deny,  reasons=[]           -> NEEDS_REVIEW (implicit deny,
                                             no rule matched either way)
"""

import json
import os

import cedarpy

POLICY_PATH = os.path.join(os.path.dirname(__file__), "policies", "mirror.cedar")

# Which policy id means what. Keep this in sync with policies/mirror.cedar —
# if that file's policy order changes, this dict must change too.
POLICY_ID_MEANING = {
    "policy0": "BLOCKED",
    "policy1": "SAFE",
}


def load_policies(path=POLICY_PATH):
    with open(path) as f:
        return f.read()


def decide(action, resource_id, dependents_count, risk_score, policies, principal="agent"):
    """
    Pure function: (action, resource, evidence, policy_set) -> verdict.

    action:            e.g. "delete"
    resource_id:       node id from graph_builder.py, e.g. "s3:mirror-demo-archive-2023"
    dependents_count:  int — from graph_builder.dependents_of(graph, resource_id)
    risk_score:        int 0-100 — see mirror.py for how it's derived from
                        days_since_activity (this is the one place Mirror makes
                        a judgment call rather than reading a fact; it's a
                        transparent formula, never fabricated data)
    policies:          the Cedar policy source as a string (load_policies())
    principal:         who's asking — for the hackathon demo this is always
                        the single agent, kept as a parameter so this isn't
                        hardcoded for no reason

    Returns a verdict dict — never raises on a normal deny, never mutates
    anything, never touches AWS. All I/O happens in the caller.
    """
    request = {
        "principal": f'Mirror::Agent::"{principal}"',
        "action": f'Mirror::Action::"{action}"',
        "resource": f'Mirror::Resource::"{resource_id}"',
        "context": {
            "dependents_count": dependents_count,
            "risk_score": risk_score,
        },
    }
    entities = []  # no entity hierarchy needed — every fact lives in context

    result = cedarpy.is_authorized(request, policies, entities)
    reasons = list(result.diagnostics.reasons)

    if str(result.decision) == "Decision.Allow" and "policy1" in reasons:
        verdict = "SAFE"
    elif "policy0" in reasons:
        verdict = "BLOCKED"
    else:
        # Deny with no forbid reason = Cedar's implicit deny. Nothing said
        # yes, nothing said no — that's genuine uncertainty, not danger.
        verdict = "NEEDS_REVIEW"

    return {
        "action": action,
        "resource": resource_id,
        "dependents_count": dependents_count,
        "risk_score": risk_score,
        "verdict": verdict,
        "cedar_decision": str(result.decision),
        "cedar_reasons": reasons,
    }


def counterfactual(action, resource_id, base_evidence, policies, principal="agent", **changed_fields):
    """
    Black Box's rewind feature, in one function. Swap exactly one evidence
    field and re-run decide() — because decide() is pure, this is a real
    counterfactual (the same engine, the same policies, one changed fact),
    not a canned alternate answer.

    base_evidence: {"dependents_count": ..., "risk_score": ...} — the real,
                   observed values.
    changed_fields: whichever of those you want to imagine differently.

    Example: counterfactual(action, resource_id, base_evidence, policies,
                             dependents_count=0)
             answers "what would Mirror have said if this resource had no
             dependents?" — everything else held exactly as observed.
    """
    evidence = dict(base_evidence)
    evidence.update(changed_fields)
    return decide(action, resource_id, evidence["dependents_count"], evidence["risk_score"], policies, principal)


if __name__ == "__main__":
    # Smoke test with the exact three cases verified live against the real
    # policy file — run this after editing mirror.cedar to confirm the
    # mapping above still holds.
    policies = load_policies()

    blocked = decide("delete", "s3:mirror-demo-archive-2023", dependents_count=1, risk_score=20, policies=policies)
    safe = decide("delete", "s3:mirror-demo-scratch", dependents_count=0, risk_score=10, policies=policies)
    review = decide("delete", "s3:mirror-demo-mystery", dependents_count=0, risk_score=80, policies=policies)

    print(json.dumps(blocked, indent=2))
    print(json.dumps(safe, indent=2))
    print(json.dumps(review, indent=2))

    assert blocked["verdict"] == "BLOCKED"
    assert safe["verdict"] == "SAFE"
    assert review["verdict"] == "NEEDS_REVIEW"

    # Counterfactual: same resource, imagine it had no dependents.
    rewind = counterfactual(
        "delete", "s3:mirror-demo-archive-2023",
        base_evidence={"dependents_count": 1, "risk_score": 20},
        policies=policies,
        dependents_count=0,
    )
    print("counterfactual (dependents_count forced to 0):")
    print(json.dumps(rewind, indent=2))
    assert rewind["verdict"] == "SAFE"

    print("\nAll smoke tests passed.")
