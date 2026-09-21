import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeFunctionData,
  keccak256,
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { compile } from "./compile.mjs";
const expected = "0x7ad78fc8097dfea5c12dbb503d6eb6e60f34b40b";
const values = parseEnv(readFileSync(".env", "utf8")),
  candidates = Object.values(values).filter((v) =>
    /^(0x)?[a-f\d]{64}$/i.test(v),
  );
if (candidates.length !== 1)
  throw new Error("Expected one private testnet deployer credential");
const account = privateKeyToAccount("0x" + candidates[0].replace(/^0x/, ""));
if (account.address.toLowerCase() !== expected)
  throw new Error("Unexpected deployer identity");
const rpc = "https://rpc.drpc.testnet.arc.io",
  chain = defineChain({
    id: 5042002,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
const client = createPublicClient({ chain, transport: http(rpc) }),
  wallet = createWalletClient({ chain, account, transport: http(rpc) });
if ((await client.getChainId()) !== 5042002)
  throw new Error("Only Arc Testnet is allowed");
const d20 = JSON.parse(readFileSync("docs/arc-testnet.json", "utf8"));
const code = await client.getCode({ address: d20.coordinatorImplementation });
if (!code || keccak256(code) !== d20.coordinatorImplementationCodeHash)
  throw new Error("Coordinator implementation mismatch");
const artifacts = compile(),
  implementationArtifact = artifacts["LottewyConsumerV2.sol"].LottewyConsumerV2,
  proxyArtifact =
    artifacts["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"]
      .ERC1967Proxy;
const sourceHash = createHash("sha256")
  .update(implementationArtifact.evm.bytecode.object)
  .digest("hex");
mkdirSync("artifacts", { recursive: true });
const progressPath = "artifacts/v2-deployment-progress.json";
const progress = existsSync(progressPath)
  ? JSON.parse(readFileSync(progressPath, "utf8"))
  : { sourceHash };
if (progress.sourceHash !== sourceHash)
  throw new Error(
    "Deployment source changed; review the existing progress before continuing",
  );
const persist = () =>
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
const apiEnvPath = "../lottewy-x402/.env",
  apiValues = existsSync(apiEnvPath)
    ? parseEnv(readFileSync(apiEnvPath, "utf8"))
    : {};
apiValues.RELAYER_PRIVATE_KEY ||= generatePrivateKey();
apiValues.DRAFT_SECRET ||= randomBytes(32).toString("hex");
apiValues.JEV_API_KEY ||= values.JEV_API_KEY;
writeFileSync(
  apiEnvPath,
  Object.entries(apiValues)
    .map(([k, v]) => k + "=" + JSON.stringify(v))
    .join("\n") + "\n",
  { mode: 0o600 },
);
const relayer = privateKeyToAccount(apiValues.RELAYER_PRIVATE_KEY);
console.log({
  chainId: chain.id,
  deployer: account.address,
  relayer: relayer.address,
  deployerUsdc: formatEther(
    await client.getBalance({ address: account.address }),
  ),
  broadcast: process.argv.includes("--broadcast"),
});
if (!process.argv.includes("--broadcast")) process.exit(0);
async function deploy(artifact, args) {
  const tx = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: "0x" + artifact.evm.bytecode.object,
    args,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("Contract deployment failed");
  return {
    address: receipt.contractAddress,
    tx,
    block: receipt.blockNumber.toString(),
  };
}
if (!progress.implementation) {
  progress.implementation = await deploy(implementationArtifact, [
    d20.coordinator,
  ]);
  persist();
}
if (!progress.proxy) {
  const data = encodeFunctionData({
    abi: implementationArtifact.abi,
    functionName: "initialize",
    args: [account.address],
  });
  progress.proxy = await deploy(proxyArtifact, [
    progress.implementation.address,
    data,
  ]);
  persist();
}
const owner = await client.readContract({
  address: progress.proxy.address,
  abi: implementationArtifact.abi,
  functionName: "owner",
});
if (owner.toLowerCase() !== expected) throw new Error("Proxy owner mismatch");
if (
  !(await client.readContract({
    address: progress.proxy.address,
    abi: implementationArtifact.abi,
    functionName: "relayers",
    args: [relayer.address],
  }))
) {
  const tx = await wallet.writeContract({
    address: progress.proxy.address,
    abi: implementationArtifact.abi,
    functionName: "setRelayer",
    args: [relayer.address, true],
  });
  await client.waitForTransactionReceipt({ hash: tx });
  progress.relayerAuthorization = tx;
  persist();
}
const balance = await client.getBalance({ address: relayer.address });
if (balance < parseEther("1")) {
  const tx = await wallet.sendTransaction({
    to: relayer.address,
    value: parseEther("1") - balance,
  });
  await client.waitForTransactionReceipt({ hash: tx });
  progress.relayerFunding = tx;
  persist();
}
const manifest = {
  version: 2,
  upgradeable: true,
  chainId: 5042002,
  address: progress.proxy.address,
  codeHash: keccak256(
    await client.getCode({ address: progress.proxy.address }),
  ),
  implementationAddress: progress.implementation.address,
  implementationCodeHash: keccak256(
    await client.getCode({ address: progress.implementation.address }),
  ),
  owner: account.address,
  relayer: relayer.address,
  transactionHash: progress.proxy.tx,
  implementationTransactionHash: progress.implementation.tx,
  blockNumber: progress.proxy.block,
};
writeFileSync(
  "docs/lottewy-v2-testnet.json",
  JSON.stringify(manifest, null, 2),
);
writeFileSync(
  "docs/lottewy-v2-storage-layout.json",
  JSON.stringify(implementationArtifact.storageLayout, null, 2),
);
console.log({
  proxy: manifest.address,
  implementation: manifest.implementationAddress,
  owner,
  relayer: manifest.relayer,
  relayerUsdc: formatEther(
    await client.getBalance({ address: relayer.address }),
  ),
});
