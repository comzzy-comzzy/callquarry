# CallQuarry Target Manifest

CallQuarry validates a target Skill through a small JSON manifest. The manifest is intentionally separate from the Skill's implementation so any agent framework can produce it.

## Required Fields

- `name`: Lowercase skill identifier, 3-64 characters, using letters, numbers, and hyphens.
- `version`: Semantic version such as `0.1.0`.
- `description`: Human-readable purpose and reusable value of the Skill.
- `networks`: Network IDs the Skill claims to support. Use `pharos-mainnet` and `pharos-atlantic-testnet` for current Pharos coverage.
- `entrypoints`: Callable functions, workflows, prompts, or transaction paths exposed by the Skill.
- `threatModel`: Declared permissions, write behavior, and required secrets.

## Entrypoints

Each entrypoint should include:

- `id`: Stable callable name.
- `type`: One of `read`, `write`, `transaction`, `payment`, `oracle`, `tool`, `prompt`, or `workflow`.
- `description`: Specific behavior, not marketing text.
- `inputSchema`: JSON Schema for caller input.
- `outputSchema`: JSON Schema for response shape.
- `testVectors`: Example inputs CallQuarry can validate locally.
- `readCalls`: Optional read-only JSON-RPC checks to run on every selected network.
- `transactionSimulations`: Optional `eth_estimateGas` dry runs. CallQuarry never signs or broadcasts.
- `failureModes`: Expected operational failures and how the Skill should report them.

## Pharos Network IDs

- `pharos-mainnet`: Pharos Pacific Ocean Mainnet, chain ID `1672`, RPC `https://rpc.pharos.xyz`.
- `pharos-atlantic-testnet`: Pharos Atlantic Testnet, chain ID `688689`, RPC `https://atlantic.dplabs-internal.com`.
- `pharos-legacy-testnet`: Older Pharos testnet, chain ID `688688`, RPC `https://testnet.dplabs-internal.com`.

## Security Guidance

Never place live secrets in a target manifest. Use environment variable names or placeholder strings instead. CallQuarry flags suspicious keys such as `privateKey`, `mnemonic`, `apiKey`, `secret`, `token`, and `password`.

For write-capable Skills, include at least one `transactionSimulations` item so judges and downstream agents can verify gas behavior without broadcasting a transaction.
