# CallQuarry

CallQuarry is a reusable multi-skill validation harness for Pharos Agent Carnival Skill submissions. It checks a Skill before another agent trusts it.

It can lint callable schemas, scan prompts for adversarial text, validate sample inputs, probe Pharos mainnet/testnet RPCs, dry-run read calls, estimate gas, and generate a scored readiness report.

## What It Checks

- Skill manifest quality
- Entrypoint input and output schemas
- Prompt-injection and secret-leak risks
- Local sample inputs
- Pharos Pacific Ocean Mainnet RPC compatibility
- Pharos Atlantic Testnet RPC compatibility
- JSON-RPC read probes
- `eth_estimateGas` dry runs

CallQuarry is read-only by default. It never asks for a private key, never signs transactions, and never broadcasts transactions.

## Requirements

- Node.js 20 or newer
- Git
- Internet access only when running live Pharos RPC checks

## Install

Clone the repo:

```bash
git clone https://github.com/comzzy-comzzy/callquarry.git
cd callquarry
```

Install local package metadata:

```bash
npm install
```

There are no runtime npm dependencies.

## Run the Beginner Example

First run an offline validation. This does not call any blockchain RPC.

```bash
npm run validate
```

Equivalent direct command:

```bash
node scripts/callquarry.mjs validate --manifest examples/pharos-balance-target.json --offline
```

You should see a report with a score, pass/warn/fail counts, and check details.

## Run Against Pharos Mainnet and Testnet

Use this when you want to prove the target Skill is compatible with both supported Pharos networks:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --networks pharos-mainnet,pharos-atlantic-testnet
```

Save the report as JSON:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --networks pharos-mainnet,pharos-atlantic-testnet \
  --format json \
  --out reports/callquarry-report.json
```

## Validate Your Own Skill

Create a target manifest for your Skill:

```json
{
  "name": "my-pharos-skill",
  "version": "0.1.0",
  "description": "Reusable Skill that performs one clear job for Pharos agents.",
  "networks": ["pharos-mainnet", "pharos-atlantic-testnet"],
  "entrypoints": [
    {
      "id": "getThing",
      "type": "read",
      "description": "Read one useful value from a Pharos RPC or contract.",
      "inputSchema": {
        "type": "object",
        "required": ["address"],
        "properties": {
          "address": {
            "type": "string",
            "pattern": "^0x[a-fA-F0-9]{40}$"
          }
        }
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "value": {
            "type": "string"
          }
        }
      },
      "testVectors": [
        {
          "id": "valid-address",
          "input": {
            "address": "0x0000000000000000000000000000000000000000"
          }
        }
      ]
    }
  ],
  "threatModel": {
    "permissions": ["rpc-read"],
    "writes": false,
    "secrets": []
  }
}
```

Then run:

```bash
node scripts/callquarry.mjs validate --manifest path/to/your-manifest.json --offline
```

When offline checks pass, run live checks:

```bash
node scripts/callquarry.mjs validate \
  --manifest path/to/your-manifest.json \
  --networks pharos-mainnet,pharos-atlantic-testnet
```

## CLI Options

```text
callquarry validate --manifest <file> [options]

Options:
  --networks <ids>      Comma-separated network IDs, "default", or "all"
  --network-file <file> Custom network metadata JSON
  --offline             Skip live RPC checks
  --timeout-ms <n>      RPC timeout in milliseconds
  --format <text|json>  Output format
  --out <file>          Save report to a file
  --strict              Return exit code 1 on warnings as well as failures
```

## Pharos Networks

CallQuarry ships with:

- `pharos-mainnet`: chain ID `1672`, RPC `https://rpc.pharos.xyz`
- `pharos-atlantic-testnet`: chain ID `688689`, RPC `https://atlantic.dplabs-internal.com`
- `pharos-legacy-testnet`: chain ID `688688`, RPC `https://testnet.dplabs-internal.com`

The default live validation uses mainnet and Atlantic testnet.

## Test Locally

Run the test suite:

```bash
npm test
```

The tests use an injected mock JSON-RPC client, so they do not need blockchain network access.
