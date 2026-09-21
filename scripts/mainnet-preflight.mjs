// Read-only by construction: no wallet client, transaction signing or broadcast.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  createPublicClient,
  http,
  keccak256,
  formatEther,
  parseAbi,
  encodeDeployData,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { compile } from "./compile.mjs";
if (process.argv.length > 2)
  throw new Error(
    "This read-only preflight accepts no flags and cannot deploy",
  );
const web = parseEnv(readFileSync(".env", "utf8")),
  api = parseEnv(readFileSync("../lottewy-x402/.env", "utf8"));
const key = web.DEPLOYER_KEY || api.DEPLOYER_KEY;
if (!key || !/^(0x)?[a-f\d]{64}$/i.test(key))
  throw new Error("DEPLOYER_KEY is missing or invalid");
const admin = privateKeyToAccount("0x" + key.replace(/^0x/, "")).address;
const relayer = privateKeyToAccount(api.RELAYER_PRIVATE_KEY).address;
if (
  admin.toLowerCase() !== "0x7ad78fc8097dfea5c12dbb503d6eb6e60f34b40b" ||
  relayer.toLowerCase() !== "0xaf3a40ff429e2976958912a9ab7dbf2fa7d1e043"
)
  throw new Error("Wallet identity does not match the approved addresses");
const response = await fetch("https://d20dao.org/deployments/arc-mainnet.json");
if (!response.ok)
  throw new Error("Official D20 mainnet deployment is unavailable");
const d20 = await response.json();
if (d20.chainId !== 5042) throw new Error("Unexpected D20 network");
const rpcUrl = "https://rpc.blockdaemon.mainnet.arc.io",
  client = createPublicClient({
    transport: http(rpcUrl, { timeout: 15000, retryCount: 1 }),
  });
if ((await client.getChainId()) !== 5042)
  throw new Error("RPC is not Arc Mainnet");
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
for (const [proxy, implementation, expected] of [
  [
    d20.coordinator,
    d20.coordinatorImplementation,
    d20.coordinatorImplementationCodeHash,
  ],
  [d20.registry, d20.epochImplementation, d20.epochImplementationCodeHash],
]) {
  const [current, code] = await Promise.all([
    client.getStorageAt({ address: proxy, slot }),
    client.getCode({ address: implementation }),
  ]);
  if (
    current?.slice(-40).toLowerCase() !==
      implementation.slice(2).toLowerCase() ||
    !code ||
    keccak256(code) !== expected
  )
    throw new Error("D20 mainnet implementation pin mismatch");
}
const block = await client.getBlock({ blockTag: "finalized" });
const [adminBalance, relayerBalance, fee, gasPrice] = await Promise.all([
  client.getBalance({ address: admin, blockNumber: block.number }),
  client.getBalance({ address: relayer, blockNumber: block.number }),
  client.readContract({
    address: d20.coordinator,
    abi: parseAbi([
      "function quoteFeeAt(uint32,uint256) view returns(uint256)",
    ]),
    functionName: "quoteFeeAt",
    args: [150000, (block.baseFeePerGas * 130n) / 100n],
    blockNumber: block.number,
  }),
  client.getGasPrice(),
]);
const supportedResponse = await fetch(
  "https://gateway-api.circle.com/v1/x402/supported",
);
if (!supportedResponse.ok)
  throw new Error("Gateway mainnet capability lookup failed");
const supported = await supportedResponse.json(),
  networks = ["eip155:5042", "eip155:8453", "eip155:1"];
const paymentOptions = networks.map((network) => {
  const kind = supported.kinds?.find(
    (k) =>
      k.network === network &&
      k.scheme === "exact" &&
      k.extra?.assets?.some((a) => a.symbol === "USDC" && a.decimals === 6),
  );
  if (!kind)
    throw new Error("Required mainnet Gateway network missing: " + network);
  return {
    network,
    verifyingContract: kind.extra.verifyingContract,
    asset: kind.extra.assets.find(
      (a) => a.symbol === "USDC" && a.decimals === 6,
    ).address,
  };
});
const compiled = compile(),
  implementation = compiled["LottewyConsumerV2.sol"].LottewyConsumerV2;
const deploymentData = encodeDeployData({
  abi: implementation.abi,
  bytecode: "0x" + implementation.evm.bytecode.object,
  args: [d20.coordinator],
});
const implementationGas = await client.estimateGas({
  account: admin,
  data: deploymentData,
});
const report = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  deployed: false,
  chainId: 5042,
  rpcUrl,
  finalizedBlock: block.number.toString(),
  wallets: {
    admin,
    seller: admin,
    relayer,
    adminNativeUsdc: formatEther(adminBalance),
    relayerNativeUsdc: formatEther(relayerBalance),
  },
  d20: {
    coordinator: d20.coordinator,
    registry: d20.registry,
    coordinatorImplementation: d20.coordinatorImplementation,
    coordinatorImplementationCodeHash: d20.coordinatorImplementationCodeHash,
    epochImplementation: d20.epochImplementation,
    epochImplementationCodeHash: d20.epochImplementationCodeHash,
    codePinsVerified: true,
    quotedFeeUsdc: formatEther(fee),
    callbackGas: 150000,
  },
  gateway: { url: "https://gateway-api.circle.com", networks: paymentOptions },
  contract: {
    name: "LottewyConsumerV2",
    compiler: "0.8.28",
    implementationCreationGas: implementationGas.toString(),
    implementationEstimatedGasCostUsdc: formatEther(
      implementationGas * gasPrice,
    ),
    proxyAddress: null,
    implementationAddress: null,
    owner: admin,
    relayer,
  },
  publication: { approved: false, supportEmail: null, priceUsdc: null },
  notes: [
    "No transaction signed or broadcast. Gas estimate is not a fee guarantee.",
    "Proxy initialization and relayer authorization require later approved deployment.",
    "Existing runtime remains testnet-only; a reviewed mainnet release profile must be generated after the new deployment addresses and code hashes exist.",
    "Do not import testnet payment authorizations or testnet DB into mainnet.",
  ],
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "docs/mainnet-preflight.json",
  JSON.stringify(report, null, 2) + "\n",
);
writeFileSync("docs/arc-mainnet.json", JSON.stringify(d20, null, 2) + "\n");
writeFileSync(
  "artifacts/mainnet-contract-plan.json",
  JSON.stringify(
    {
      coordinator: d20.coordinator,
      implementationCreationData: deploymentData,
      proxyArtifact:
        compiled["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"]
          .ERC1967Proxy,
      initializer: encodeFunctionData({
        abi: implementation.abi,
        functionName: "initialize",
        args: [admin],
      }),
      storageLayout: implementation.storageLayout,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(report, null, 2));
