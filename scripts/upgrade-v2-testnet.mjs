import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compile } from "./compile.mjs";

const original = JSON.parse(
  readFileSync("docs/lottewy-v2-testnet.json", "utf8"),
);
const artifact = compile()["LottewyConsumerV2.sol"].LottewyConsumerV2;
const priorLayout = JSON.parse(
  readFileSync("docs/lottewy-v2-storage-layout.json", "utf8"),
);
function layoutShape(layout) {
  const shape = (id) => {
    const type = layout.types[id];
    return {
      encoding: type.encoding,
      bytes: type.numberOfBytes,
      label: type.label,
      ...(type.key ? { key: shape(type.key) } : {}),
      ...(type.value ? { value: shape(type.value) } : {}),
      ...(type.members
        ? {
            members: type.members.map((m) => ({
              label: m.label,
              slot: m.slot,
              offset: m.offset,
              type: shape(m.type),
            })),
          }
        : {}),
    };
  };
  return layout.storage.map((s) => ({
    label: s.label,
    slot: s.slot,
    offset: s.offset,
    type: shape(s.type),
  }));
}
if (
  JSON.stringify(layoutShape(priorLayout)) !==
  JSON.stringify(layoutShape(artifact.storageLayout))
)
  throw new Error("Storage layout changed");
const sourceHash = createHash("sha256")
  .update(artifact.evm.bytecode.object)
  .digest("hex");
const path = "artifacts/v2-upgrade-progress.json";
const progress = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { sourceHash, original };
if (progress.sourceHash !== sourceHash)
  throw new Error("Upgrade progress belongs to different source");
const save = () => writeFileSync(path, JSON.stringify(progress, null, 2));
const values = parseEnv(readFileSync(".env", "utf8"));
const keys = Object.values(values).filter((v) => /^(0x)?[a-f\d]{64}$/i.test(v));
if (keys.length !== 1) throw new Error("Expected one deployer credential");
const account = privateKeyToAccount("0x" + keys[0].replace(/^0x/, ""));
if (
  account.address.toLowerCase() !== "0x7ad78fc8097dfea5c12dbb503d6eb6e60f34b40b"
)
  throw new Error("Unexpected deployer");
const rpc = "https://rpc.drpc.testnet.arc.io";
const chain = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const client = createPublicClient({ chain, transport: http(rpc) }),
  wallet = createWalletClient({ account, chain, transport: http(rpc) });
if ((await client.getChainId()) !== chain.id)
  throw new Error("Not Arc Testnet");
const owner = await client.readContract({
  address: original.address,
  abi: artifact.abi,
  functionName: "owner",
});
if (owner.toLowerCase() !== account.address.toLowerCase())
  throw new Error("Owner mismatch");
console.log({
  chainId: chain.id,
  proxy: original.address,
  storageLayout: "unchanged",
  broadcast: process.argv.includes("--broadcast"),
});
if (!process.argv.includes("--broadcast")) process.exit(0);
async function execute(name, call) {
  if (!progress[name]) {
    const request = await wallet.prepareTransactionRequest({
      ...call,
      account,
      chain,
    });
    if (request.gas * request.maxFeePerGas > parseEther("0.5"))
      throw new Error("Upgrade exceeds test gas cap");
    const raw = await wallet.signTransaction(request);
    progress[name] = { raw, hash: keccak256(raw) };
    save();
  }
  const pending = progress[name];
  let receipt = await client
    .getTransactionReceipt({ hash: pending.hash })
    .catch(() => null);
  if (!receipt) {
    await client
      .sendRawTransaction({ serializedTransaction: pending.raw })
      .catch(() => {});
    receipt = await client.waitForTransactionReceipt({
      hash: pending.hash,
      timeout: 60000,
    });
  }
  if (receipt.status !== "success")
    throw new Error("Upgrade transaction reverted");
  pending.address = receipt.contractAddress;
  pending.block = receipt.blockNumber.toString();
  save();
  return pending;
}
const d20 = JSON.parse(readFileSync("docs/arc-testnet.json", "utf8"));
const next = await execute("implementation", {
  data: encodeDeployData({
    abi: artifact.abi,
    bytecode: "0x" + artifact.evm.bytecode.object,
    args: [d20.coordinator],
  }),
});
const upgrade = await execute("upgrade", {
  to: original.address,
  data: encodeFunctionData({
    abi: artifact.abi,
    functionName: "upgradeToAndCall",
    args: [next.address, "0x"],
  }),
});
const slot = await client.getStorageAt({
  address: original.address,
  slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
});
if (slot?.slice(-40).toLowerCase() !== next.address.slice(2).toLowerCase())
  throw new Error("Upgrade not active");
const manifest = {
  ...original,
  implementationAddress: next.address,
  implementationCodeHash: keccak256(
    await client.getCode({ address: next.address }),
  ),
  implementationTransactionHash: next.hash,
  upgradeTransactionHash: upgrade.hash,
  previousImplementationAddress: progress.original.implementationAddress,
};
for (const target of [
  "docs/lottewy-v2-testnet.json",
  "docs/lottewy-testnet.json",
  "../lottewy-x402/src/protocol/docs/lottewy-testnet.json",
])
  writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(
  "docs/lottewy-v2-storage-layout.json",
  JSON.stringify(artifact.storageLayout, null, 2) + "\n",
);
for (const configPath of ["wrangler.jsonc", "../lottewy-x402/wrangler.jsonc"]) {
  let text = readFileSync(configPath, "utf8")
    .replaceAll(
      progress.original.implementationAddress,
      manifest.implementationAddress,
    )
    .replaceAll(
      progress.original.implementationCodeHash,
      manifest.implementationCodeHash,
    );
  writeFileSync(configPath, text);
}
console.log({
  proxy: manifest.address,
  implementation: manifest.implementationAddress,
  upgradeTransaction: upgrade.hash,
});
