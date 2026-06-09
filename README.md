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
- Optional signed wallet proof on Pharos testnet

CallQuarry is read-only by default. The optional wallet proof mode is disabled unless you explicitly run `prove-wallet`.

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

The validator path is dependency-light. Wallet proof mode uses `viem` for EVM signing and raw transaction broadcast.

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

## Optional Wallet Proof

Use this only when you want to prove that CallQuarry can sign a real Pharos-compatible transaction.

Safety defaults:

- Uses `pharos-atlantic-testnet` by default
- Does not broadcast unless `--broadcast` is supplied
- Refuses broadcast unless `--i-understand-this-spends-gas` is supplied
- Refuses mainnet unless `--allow-mainnet` is supplied
- Reads the private key only from an environment variable
- Never prints or stores the private key

Set your private key in your shell. Do not paste it into a manifest, README, command argument, or GitHub issue.

```bash
export PHAROS_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

Dry proof on Atlantic testnet. This reads balance, estimates gas, and signs locally, but does not broadcast:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet
```

Real broadcast proof on Atlantic testnet. This sends a zero-value self-transfer and spends only testnet gas:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet \
  --broadcast \
  --i-understand-this-spends-gas
```

Save the proof as JSON:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet \
  --broadcast \
  --i-understand-this-spends-gas \
  --format json \
  --out reports/wallet-proof.json
```

Mainnet proof is deliberately harder to run:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-mainnet \
  --allow-mainnet
```

Add `--broadcast --i-understand-this-spends-gas` only if you intentionally want a mainnet proof transaction.

## Test Locally

Run the test suite:

```bash
npm test
```

The tests use an injected mock JSON-RPC client, so they do not need blockchain network access.
