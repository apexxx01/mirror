# Mirror

An agent that previews the real consequences of a risky action — against
your actual AWS account, not a simulated one — before it's allowed to run.
Gated by [Cedar](https://www.cedarpolicy.com/), AWS's open-source policy
engine, so the authorization decision is genuine policy evaluation, not a
hand-rolled if/else.

**The core trick:** a naive "delete anything that looks unused" agent
judges resources by activity recency alone. Mirror builds a real dependency
graph from live AWS metadata — Lambda environment variables, EventBridge
targets — and refuses to delete anything with a real dependent, no matter
how stale it looks. The demo scenario plants two resources that *look*
abandoned but are secretly load-bearing, and shows Mirror catching both.

Nothing here is synthetic. Every number in the output — dependency edges,
CloudWatch activity, the Cedar verdict — comes from a real API call against
resources this script actually created in your AWS account.

## Files

| File | What it does |
|---|---|
| `setup_sandbox.py` | Creates the demo AWS resources (2 buckets, 2 tables, 3 Lambdas, 1 EventBridge rule) with two planted hidden dependencies. Idempotent — safe to re-run. `--teardown` removes everything. |
| `graph_builder.py` | Builds the real dependency graph from your AWS account via boto3/CloudWatch. No invented edges — every one traces back to an actual `get_function_configuration()` env var or `list_targets_by_rule()` call. |
| `decide.py` | The pure decision core: `decide(action, resource, dependents_count, risk_score, policies) -> verdict`. Calls Cedar via `cedarpy`. Deterministic — same inputs always produce the same verdict, which is what makes `counterfactual()` (the rewind feature) technically real instead of scripted. |
| `policies/mirror.cedar` | The actual Cedar policy source. `policy0` hard-forbids deleting anything with a real dependent. `policy1` permits deleting anything with zero dependents and a low risk score. Anything else falls to Cedar's implicit deny, which `decide.py` reports as `NEEDS_REVIEW`. |
| `mirror.py` | Driver script. Ties `graph_builder` + `decide` together into a report, a `--explain` ("why not?") view, and a `--rewind` (counterfactual replay) view. |

## Setup

```bash
pip install -r requirements.txt --break-system-packages   # or use a venv
aws configure   # your own AWS credentials — Mirror only reads what you create below
```

The IAM identity you configure needs permission to create/delete S3
buckets, DynamoDB tables, Lambda functions, an IAM role, and an
EventBridge rule — i.e. roughly `AdministratorAccess` on a scratch/sandbox
account, or a scoped policy covering those five services. Nothing here
touches any resource outside the `mirror-demo-*` naming prefix.

## Run the demo

```bash
# 1. Create the sandbox resources in your AWS account (idempotent — safe to re-run)
python setup_sandbox.py

# 2. See the full analysis: every demo resource, real verdict for each
python mirror.py

# 3. Ask Mirror to explain a specific blocked resource
python mirror.py --explain s3:mirror-demo-archive-2023-<your-account-suffix>

# 4. Counterfactual replay (Black Box) — "what if this had no dependents?"
python mirror.py --rewind s3:mirror-demo-archive-2023-<your-account-suffix>

# 4b. Rollback plan — real recovery facts if it gets deleted anyway
python mirror.py --rollback s3:mirror-demo-archive-2023-<your-account-suffix>

# 5. Clean up everything this created
python setup_sandbox.py --teardown
```

Resource IDs use the exact bucket/table/function names `setup_sandbox.py`
printed when it ran — `python mirror.py` (no flags) lists every resource ID
it found, so copy one from there for `--explain`/`--rewind`.

To inspect the raw graph without touching AWS again, save it once and
replay analysis against the saved snapshot:

```bash
python graph_builder.py > graph.json
python mirror.py --graph-file graph.json
```

(`decide.py` never calls AWS itself, so `--graph-file` mode is instant and
fully reproducible — useful for rehearsing the demo without hitting API
rate limits or waiting on CloudWatch.)

## Rollback plan

`python mirror.py --rollback <id>` answers "if Mirror is wrong and this
gets deleted anyway, what can actually be recovered?" using only real AWS
recovery signals read live via boto3 — S3 versioning + version/delete-marker
counts, DynamoDB point-in-time-recovery restore windows, Lambda published
version numbers, and (for EventBridge rules) the rule's own live
definition, captured as the rollback plan itself. No recovery-time
estimate or confidence percentage is invented — every fact shown is a real
API response value, and resources with no real recovery path get an
explicit "no rollback path" instead of a guess. Built on the same real
signals as the reversibility score (`reversibility.py`), which is also
shown in the main report table and in `--explain`.

## Bedrock report (optional)

Turns the verdict table into a plain-English summary via Bedrock (Claude
Haiku, using the global inference profile required for India regions —
see comments in `bedrock_report.py`). Requires enabling model access once:
AWS Console → Bedrock → Model access → request access to Anthropic Claude.

```bash
python mirror.py --bedrock-report
```

Degrades gracefully (prints a clear message, doesn't crash the rest of the
run) if model access hasn't been granted yet.

## Why the architecture looks like this

`decide()` is a pure function on purpose. It takes evidence
(`dependents_count`, `risk_score`) and a policy set, and returns a verdict
— no AWS calls, no clock reads, no hidden state. That's what makes the
"rewind" feature in `mirror.py --rewind` a *real* counterfactual: swapping
one field and re-running the exact same function through the exact same
Cedar policies is a legitimate "what if," not a canned alternate answer
written in advance.

The risk score itself is the one place Mirror makes a judgment call rather
than reading a bare fact, and it's fully disclosed in `mirror.py`:
`risk_score = 100 - min(days_since_activity, 100)`. Recently-touched
resources score high risk (we can't be sure nothing outside this graph
still depends on them); long-idle resources score low. Critically, risk
score only ever matters when `dependents_count == 0` — a single real
dependency always overrides it via Cedar's hard `forbid`. That ordering is
the whole thesis: real relationships beat guesses about staleness, every
time.

## Extending past the hackathon scope

`decide()` and `policies/mirror.cedar` don't know anything about AWS
specifically — they operate on `(action, resource_id, dependents_count,
risk_score)`. `graph_builder.py` is the only AWS-specific file; swapping in
a different graph source (a different cloud, an internal service registry,
an agent framework's own tool-call log) would let the same decision core
gate any action, which is the direction described in the brainstorm doc's
"skill-agnostic Mirror" idea.
