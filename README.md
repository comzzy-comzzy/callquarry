# CallQuarry

CallQuarry is a reusable multi-skill validation harness for Pharos Agent Carnival Skill submissions.

Use it to check whether a Skill is safe, well-structured, and compatible with Pharos mainnet and testnet. It can also run an optional wallet proof that signs and broadcasts a zero-value self-transfer.

For Pharos hackathon review, CallQuarry supports the official Pharos Skill Engine workflow. The engine says it is required for Pharos blockchain tasks and uses Foundry `cast` / `forge` for chain access. Install the required engine first:

```bash
npx skills add https://github.com/PharosNetwork/pharos-skill-engine
```

Then run CallQuarry live checks with `--pharos-engine` to use Foundry `cast` against the Pharos networks defined by that engine. This repository includes `skills-lock.json` from that install so judges can see the official engine source that CallQuarry targets.

## What CallQuarry Does

- Checks Skill manifests and callable schemas
- Scans prompts for common jailbreak or secret-leak patterns
- Validates sample inputs
- Tests Pharos mainnet and Atlantic testnet RPCs
- Runs read-only JSON-RPC calls such as `eth_getBalance`
- Runs gas estimation with `eth_estimateGas`
- Optionally proves wallet execution by signing a transaction
- Optionally broadcasts a zero-value proof transaction

## Safety First

These commands are safe and do not spend gas:

```bash
npm run validate
npm run validate:live
node scripts/callquarry.mjs prove-wallet --network pharos-atlantic-testnet
node scripts/callquarry.mjs prove-wallet --network pharos-mainnet --allow-mainnet
```

These commands broadcast a transaction and spend gas:

```bash
node scripts/callquarry.mjs prove-wallet --network pharos-atlantic-testnet --broadcast --i-understand-this-spends-gas
node scripts/callquarry.mjs prove-wallet --network pharos-mainnet --allow-mainnet --broadcast --i-understand-this-spends-gas
```

Never commit your private key. Set it only in your terminal:

```bash
export PHAROS_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

## Install

Requirements:

- Node.js 20 or newer
- Git
- Foundry `cast` for official Pharos Skill Engine live validation
- A funded Pharos wallet only for wallet proof mode

Clone and install:

```bash
git clone https://github.com/comzzy-comzzy/callquarry.git
cd callquarry
npm install
npx skills add https://github.com/PharosNetwork/pharos-skill-engine
```

Check that Foundry is available:

```bash
cast --version
```

## Website Workbench

CallQuarry includes a browser workbench in `index.html`.

Run it on your own computer:

```bash
npm run site
```

Then open:

```text
http://127.0.0.1:4173/
```

Public VPS demo:

```text
http://161.97.107.130:4173/
```

This VPS is served by Nginx, not the temporary Python server, so it survives terminal logout and normal VPS reboot. Judges can use this URL directly.

The Nginx config is tracked in this repo at `deploy/nginx-callquarry.conf`.

The deployed files live here on the VPS:

```text
/var/www/callquarry/index.html
/etc/nginx/sites-available/callquarry
/etc/nginx/sites-enabled/callquarry
```

After editing `index.html`, publish the update to Nginx:

```bash
install -m 644 index.html /var/www/callquarry/index.html
nginx -t
nginx -s reload
```

Use `127.0.0.1` only when you are browsing from the same machine that is running a local dev server. Use `161.97.107.130` when opening the live site from your phone, laptop, or DoraHacks reviewers.

The website can:

- Load the example Skill manifest
- Generate random valid Pharos Skill manifests for quick judge testing
- Let judges paste their own Pharos Skill manifest JSON
- Run offline manifest validation in the browser
- Run live Pharos mainnet/testnet RPC checks from the browser
- Export a JSON report
- Connect an injected EVM wallet such as MetaMask or Rabby
- Run wallet dry proof without spending gas
- Broadcast a zero-value wallet proof transaction when you explicitly approve it

The website never asks for a private key. Wallet proof uses your browser wallet.

## Step 1: Run Local Tests

This confirms the package works on your machine.

```bash
npm test
```

Expected result:

```text
pass 1
fail 0
```

## Step 2: Run Safe Offline Validation

This does not call any blockchain RPC.

```bash
npm run validate
```

Expected result:

```text
Status: ready
0 failed
```

## Step 3: Run Live Pharos RPC Validation

This checks both Pharos mainnet and Atlantic testnet. It does not need your private key and does not spend gas.

```bash
npm run validate:live
```

Expected result:

```text
Status: ready
Score: 100/100
0 failed
```

## Step 4: Add Your Wallet Key Locally

Only do this in your terminal. Do not paste your private key into GitHub, README files, manifests, or command arguments.

```bash
export PHAROS_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

## Step 5: Test Wallet Proof on Testnet Without Spending Gas

This reads your testnet balance, estimates gas, and signs locally. It does not broadcast.

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet
```

Expected result:

```text
Status: ready
Transaction signed
Transaction broadcast skipped
```

## Step 6: Broadcast Wallet Proof on Testnet

This sends a zero-value self-transfer on Pharos Atlantic testnet. It spends testnet gas.

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet \
  --broadcast \
  --i-understand-this-spends-gas
```

Save a JSON report:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-atlantic-testnet \
  --broadcast \
  --i-understand-this-spends-gas \
  --format json \
  --out reports/wallet-proof-testnet.json
```

## Step 7: Test Wallet Proof on Mainnet Without Spending Gas

This signs locally on Pharos mainnet, but does not broadcast.

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-mainnet \
  --allow-mainnet
```

Expected result:

```text
Status: ready
Transaction signed
Transaction broadcast skipped
```

## Step 8: Broadcast Wallet Proof on Mainnet

This sends a zero-value self-transfer on Pharos mainnet. It spends mainnet gas.

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-mainnet \
  --allow-mainnet \
  --broadcast \
  --i-understand-this-spends-gas
```

If the public RPC rate-limits receipt polling, broadcast with receipt waiting disabled:

```bash
node scripts/callquarry.mjs prove-wallet \
  --network pharos-mainnet \
  --allow-mainnet \
  --broadcast \
  --i-understand-this-spends-gas \
  --wait-confirmations 0
```

Then check the transaction on https://pharosscan.xyz.

## Proven Demo Transactions

CallQuarry was tested successfully with zero-value self-transfers:

- Atlantic testnet: `0x18dd2d9dd73671fc5bf10e508aee640b04a6181c48ba1e3896459881e20bdb06`
- Mainnet: `0x1178a4b4d10384e47c0f396cd314749f6ca1e71b99b642cfcf86ddfa16d5e13e`

## Validate Your Own Skill

CallQuarry validates a target Skill through a JSON manifest. Start from:

```bash
examples/pharos-balance-target.json
```

Run offline:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --offline
```

Run live:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --networks pharos-mainnet,pharos-atlantic-testnet
```

Run live through the official Pharos Skill Engine / Foundry `cast` path:

```bash
npm run validate:engine
```

Expected result: `Status: ready`, `Score: 100/100`, and a passing `Foundry cast available` check.

Save a report:

```bash
node scripts/callquarry.mjs validate \
  --manifest examples/pharos-balance-target.json \
  --networks pharos-mainnet,pharos-atlantic-testnet \
  --format json \
  --out reports/callquarry-report.json
```

## Pharos Networks

CallQuarry ships with these networks:

- `pharos-mainnet`: chain ID `1672`, RPC `https://rpc.pharos.xyz`
- `pharos-atlantic-testnet`: chain ID `688689`, RPC `https://atlantic.dplabs-internal.com`
- `pharos-legacy-testnet`: chain ID `688688`, RPC `https://testnet.dplabs-internal.com`

For compatibility with `PharosNetwork/pharos-skill-engine`, CallQuarry maps:

- `pharos-mainnet` -> `mainnet`
- `pharos-atlantic-testnet` -> `atlantic-testnet`

`pharos-legacy-testnet` is available for direct RPC checks only unless the installed official engine config adds it.

## CLI Help

```bash
node scripts/callquarry.mjs --help
```

## Notes for Hackathon Reviewers

CallQuarry is reusable because it is not tied to one Skill implementation. Any Pharos Skill can provide a target manifest and run through the same validation pipeline.

The default validator is read-only. Wallet proof mode is explicit, guarded, and suitable for demoing real Pharos execution when judges want proof beyond RPC reads and gas simulation.
