import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  parseEther,
  formatEther,
} from "viem";
import { arc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { compile } from "./compile.mjs";
const source = parseEnv(readFileSync(".env", "utf8")),
  apiEnv = parseEnv(readFileSync("../lottewy-x402/.env", "utf8"));
if (!/^(0x)?[a-f\d]{64}$/i.test(source.DEPLOYER_KEY || ""))
  throw new Error("DEPLOYER_KEY is required");
const account = privateKeyToAccount(
    "0x" + source.DEPLOYER_KEY.replace(/^0x/, ""),
  ),
  relayer = privateKeyToAccount(apiEnv.RELAYER_PRIVATE_KEY).address;
if (
  account.address.toLowerCase() !==
    "0x7ad78fc8097dfea5c12dbb503d6eb6e60f34b40b" ||
  relayer.toLowerCase() !== "0xaf3a40ff429e2976958912a9ab7dbf2fa7d1e043"
)
  throw new Error("Approved wallet identity mismatch");
const client = createPublicClient({
    chain: arc,
    transport: http("https://rpc.blockdaemon.mainnet.arc.io"),
  }),
  wallet = createWalletClient({
    chain: arc,
    account,
    transport: http("https://rpc.blockdaemon.mainnet.arc.io"),
  });
if ((await client.getChainId()) !== 5042)
  throw new Error("Arc Mainnet is required");
const d20 = JSON.parse(readFileSync("docs/arc-mainnet.json", "utf8"));
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
if (
  (await client.getStorageAt({ address: d20.coordinator, slot }))
    ?.slice(-40)
    .toLowerCase() !== d20.coordinatorImplementation.slice(2).toLowerCase() ||
  keccak256(
    await client.getCode({ address: d20.coordinatorImplementation }),
  ) !== d20.coordinatorImplementationCodeHash
)
  throw new Error("D20 coordinator pin mismatch");
const compiled = compile(),
  implementation = compiled["LottewyConsumerV2.sol"].LottewyConsumerV2,
  proxy =
    compiled["@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol"]
      .ERC1967Proxy;
const sourceHash = createHash("sha256")
  .update(implementation.evm.bytecode.object)
  .digest("hex");
mkdirSync("artifacts", { recursive: true });
const path = "artifacts/mainnet-v2-deployment-progress.json",
  progress = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { chainId: 5042, sourceHash };
if (progress.chainId !== 5042 || progress.sourceHash !== sourceHash)
  throw new Error("Deployment checkpoint does not match source/network");
const save = () =>
  writeFileSync(path, JSON.stringify(progress, null, 2) + "\n");
console.log(
  JSON.stringify({
    chainId: 5042,
    admin: account.address,
    relayer,
    adminUsdc: formatEther(
      await client.getBalance({ address: account.address }),
    ),
    broadcast: process.argv.includes("--broadcast"),
  }),
);
if (!process.argv.includes("--broadcast")) process.exit(0);
async function execute(step, data, to) {
  if (!progress[step]) {
    const [latest, pending] = await Promise.all([
      client.getTransactionCount({
        address: account.address,
        blockTag: "latest",
      }),
      client.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
    ]);
    if (latest !== pending)
      throw new Error(
        "Another admin transaction is pending; reconcile before proceeding",
      );
    const gas = await client.estimateGas({
      account: account.address,
      data,
      ...(to ? { to } : {}),
      value: 0n,
    });
    const request = await wallet.prepareTransactionRequest({
      data,
      ...(to ? { to } : {}),
      value: 0n,
      gas: (gas * 120n) / 100n,
      nonce: pending,
    });
    if (
      (request.maxFeePerGas || request.gasPrice) * request.gas >
      parseEther("0.5")
    )
      throw new Error("Deployment gas cap exceeded");
    const raw = await wallet.signTransaction(request);
    progress[step] = { hash: keccak256(raw), raw, nonce: request.nonce };
    save();
  }
  const checkpoint = progress[step];
  let receipt = await client
    .getTransactionReceipt({ hash: checkpoint.hash })
    .catch(() => null);
  if (!receipt) {
    await wallet
      .sendRawTransaction({ serializedTransaction: checkpoint.raw })
      .catch(() => {});
    receipt = await client.waitForTransactionReceipt({
      hash: checkpoint.hash,
      timeout: 120000,
    });
  }
  if (receipt.status !== "success")
    throw new Error("Mainnet transaction reverted: " + step);
  checkpoint.address = receipt.contractAddress;
  checkpoint.block = receipt.blockNumber.toString();
  checkpoint.costUsdc = formatEther(
    receipt.gasUsed * receipt.effectiveGasPrice,
  );
  save();
  console.log(
    JSON.stringify({
      step,
      hash: checkpoint.hash,
      address: checkpoint.address,
      costUsdc: checkpoint.costUsdc,
    }),
  );
  return checkpoint;
}
const impl = await execute(
  "implementation",
  encodeDeployData({
    abi: implementation.abi,
    bytecode: "0x" + implementation.evm.bytecode.object,
    args: [d20.coordinator],
  }),
);
const init = encodeFunctionData({
  abi: implementation.abi,
  functionName: "initialize",
  args: [account.address],
});
const deployed = await execute(
  "proxy",
  encodeDeployData({
    abi: proxy.abi,
    bytecode: "0x" + proxy.evm.bytecode.object,
    args: [impl.address, init],
  }),
);
const read = (functionName, args) =>
  client.readContract({
    address: deployed.address,
    abi: implementation.abi,
    functionName,
    args,
  });
if (
  (await read("owner")).toLowerCase() !== account.address.toLowerCase() ||
  (await read("coordinator")).toLowerCase() !== d20.coordinator.toLowerCase()
)
  throw new Error("Proxy initialization mismatch");
if (!(await read("relayers", [relayer])))
  await execute(
    "authorizeRelayer",
    encodeFunctionData({
      abi: implementation.abi,
      functionName: "setRelayer",
      args: [relayer, true],
    }),
    deployed.address,
  );
if (
  !(await read("relayers", [relayer])) ||
  (await client.getStorageAt({ address: deployed.address, slot }))
    .slice(-40)
    .toLowerCase() !== impl.address.slice(2).toLowerCase()
)
  throw new Error("Proxy authorization/storage mismatch");
const manifest = {
  version: 2,
  upgradeable: true,
  chainId: 5042,
  address: deployed.address,
  codeHash: keccak256(await client.getCode({ address: deployed.address })),
  implementationAddress: impl.address,
  implementationCodeHash: keccak256(
    await client.getCode({ address: impl.address }),
  ),
  owner: account.address,
  relayer,
  transactionHash: deployed.hash,
  implementationTransactionHash: impl.hash,
  blockNumber: deployed.block,
  relayerAuthorization: progress.authorizeRelayer?.hash,
};
writeFileSync(
  "docs/lottewy-mainnet.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(manifest));
