# Work tracking

AutoTour uses AgentHouse records in `.agenthouse/work/` as the repository-owned source for stories, bugs, acceptance criteria, decisions, and evidence. These JSON files are reviewed and committed with the work they describe.

## Create a story

Choose a short, stable ID and an outcome-oriented title:

```sh
node .agenthouse/run.mjs work new --id capture-login --title "Record a modular login walkthrough" --kind feature
```

Complete the generated record with:

- the user-visible outcome and exclusions;
- in-scope behavior and dependencies;
- three to eight observable acceptance criteria;
- risks, decisions, and concrete verification;
- implementation and evidence as the work progresses.

Inspect the record at any time:

```sh
node .agenthouse/run.mjs work show --id capture-login
```

## Create a work branch

Story branches use `{id}-{slug}` and start from `develop` by default:

```sh
git switch develop
node .agenthouse/run.mjs work branch --id capture-login
```

## Advance and verify

AgentHouse stages cover discovery, definition, design, planning, implementation, verification, acceptance, and release. Advance only when the required fields and real evidence exist:

```sh
node .agenthouse/run.mjs work advance --id capture-login --to define
node .agenthouse/run.mjs gate --item .agenthouse/work/capture-login.json --phase ready
node .agenthouse/run.mjs evaluate --profile pull-request --frozen --subject <commit>
```

Technical checks do not grant product approval. Required human decisions remain explicit and must not be fabricated by an agent.

## Remote tracking

AgentHouse manages repository-local lifecycle records. A Git hosting service can still provide issue discussions, pull requests, milestones, and server-side branch protection. Link those external IDs or URLs from the work record when they exist; keep acceptance criteria and evidence in the committed AgentHouse record.
