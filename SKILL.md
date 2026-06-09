---
name: callquarry
description: Multi-skill validation harness for Pharos Agent Carnival Skill submissions and other EVM agent tools. Use when Codex needs to stress-test a Skill manifest, check Pharos mainnet/testnet RPC compatibility, lint callable schemas, scan prompts for adversarial instructions, simulate read calls or gas estimation, validate sample inputs, and produce a reusable readiness report before hackathon submission or agent integration.
---

# CallQuarry

## Overview

CallQuarry validates reusable agent Skills before they are used by a production agent or submitted to the Pharos Skill Hackathon. It exposes a deterministic CLI plus a target manifest format so other agents can run the same checks consistently, and it includes an opt-in wallet proof mode for testnet execution demos.

## Quick Start

Run the bundled CLI from the skill directory:

```bash
node scripts/callquarry.mjs validate --manifest examples/pharos-balance-target.json --offline
```

Run live Pharos RPC checks when network access is available:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --networks pharos-mainnet,pharos-atlantic-testnet \
  --out reports/callquarry-report.json
```

Run an optional dry wallet proof on Atlantic testnet:

```bash
PHAROS_PRIVATE_KEY=0x... node scripts/callquarry.mjs prove-wallet --network pharos-atlantic-testnet
```

## Core Capabilities

CallQuarry is intentionally a multi-skill module:

1. **Manifest linting** - validate the Skill name, version, entrypoints, input/output schemas, threat model, and Pharos network declarations.
2. **Prompt attack scanning** - detect embedded jailbreak, secret-exfiltration, and instruction-override phrases in prompts, examples, and descriptions.
3. **Test-vector validation** - validate sample inputs against each entrypoint JSON schema.
4. **Pharos RPC probing** - verify configured RPC endpoints, chain IDs, block height, and gas price for Pharos Pacific Mainnet and Atlantic Testnet.
5. **Read-call simulation** - execute declared JSON-RPC read probes such as `eth_getBalance`, `eth_call`, or `eth_blockNumber`.
6. **Gas dry-run checks** - run `eth_estimateGas` for declared transaction simulations without signing or broadcasting.
7. **Wallet proof mode** - optionally sign a zero-value self-transfer or calldata transaction on Pharos testnet, with broadcast disabled unless explicitly confirmed.
8. **Readiness reporting** - produce a scored JSON or text report that downstream agents can consume.

## Workflow

1. Ask for or create a CallQuarry target manifest for the Skill under review.
2. Run an offline pass first to catch schema, prompt, secret, and sample-input problems.
3. Run live network checks against `pharos-mainnet` and `pharos-atlantic-testnet` before claiming Pharos compatibility.
4. Review every `fail` item before submission. Treat `warn` items as judge-facing quality gaps.
5. Attach the generated report to the Skill repository or hackathon submission when useful.

## Target Manifest

Use `examples/pharos-balance-target.json` as the smallest working example. For the manifest field guide, read `references/target-manifest.md`.

Minimum useful fields:

```json
{
  "name": "my-pharos-skill",
  "version": "0.1.0",
  "description": "Reusable Skill description.",
  "networks": ["pharos-mainnet", "pharos-atlantic-testnet"],
  "entrypoints": [
    {
      "id": "getBalance",
      "type": "read",
      "description": "Fetch native balance for a Pharos address.",
      "inputSchema": { "type": "object", "required": ["address"], "properties": {} },
      "outputSchema": { "type": "object", "properties": {} }
    }
  ],
  "threatModel": {
    "permissions": ["rpc-read"],
    "writes": false,
    "secrets": []
  }
}
```

## Safety Rules

- Do not place private keys, seed phrases, bearer tokens, or API keys in a target manifest.
- Prefer `--offline` for first-pass validation.
- Treat live checks as read-only: CallQuarry calls public RPC methods and never signs transactions.
- Use `prove-wallet` only when a user explicitly wants a wallet execution proof. Never ask for a private key in chat; instruct users to set `PHAROS_PRIVATE_KEY` locally.
- Use `transactionSimulations` only for dry-run gas estimation with `eth_estimateGas`.

## Bundled Resources

- `scripts/callquarry.mjs` - dependency-free CLI and validation engine.
- `assets/networks.json` - Pharos mainnet, Atlantic testnet, and legacy testnet RPC metadata.
- `assets/target-manifest.schema.json` - JSON Schema for target Skill manifests.
- `examples/pharos-balance-target.json` - beginner-friendly manifest example.
- `references/target-manifest.md` - detailed manifest field guide.

When extending CallQuarry, add new checks to `scripts/callquarry.mjs` and add at least one test in `tests/callquarry.test.mjs`.
