import { createPublicClient, http, keccak256, type Address } from "viem";
import { assert, CHAIN_ID, COORDINATOR } from "../shared/core";
import { arc, consumerAbi, coordinatorAbi } from "../shared/chain";
import deployment from "../docs/arc-testnet.json";
import type { Env } from "./index";
const rpc = (env: Env) =>
  createPublicClient({
    chain: arc,
    transport: http(env.RPC_URL, { timeout: 15000, retryCount: 1 }),
  });
export async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i >= 2 || (error instanceof Error && error.name === "Error"))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
}
export async function trustedClient(env: Env) {
  return retryRead(() => validateClient(env));
}
async function validateClient(env: Env) {
  assert(
    /^0x[\da-fA-F]{40}$/.test(env.CONSUMER_ADDRESS) && env.CONSUMER_CODE_HASH,
    "The Lottewy testnet consumer is not configured",
  );
  const client = rpc(env);
  assert(
    (await client.getChainId()) === CHAIN_ID,
    "Only Arc Testnet is supported",
  );
  const address = env.CONSUMER_ADDRESS as Address;
  const [consumerCode, implementationCode, coordinator, registryCode] =
    await Promise.all([
      client.getCode({ address }),
      client.getCode({
        address: deployment.coordinatorImplementation as Address,
      }),
      client.readContract({
        address,
        abi: consumerAbi,
        functionName: "coordinator",
      }),
      client.getCode({ address: deployment.epochImplementation as Address }),
    ]);
  assert(
    consumerCode &&
      keccak256(consumerCode) === env.CONSUMER_CODE_HASH &&
      coordinator.toLowerCase() === COORDINATOR.toLowerCase(),
    "Consumer deployment verification failed",
  );
  assert(
    implementationCode &&
      keccak256(implementationCode) ===
        deployment.coordinatorImplementationCodeHash,
    "D20DAO implementation changed",
  );
  const slot = await client.getStorageAt({
    address: COORDINATOR,
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  });
  assert(
    slot?.slice(-40).toLowerCase() ===
      deployment.coordinatorImplementation.slice(2).toLowerCase(),
    "D20DAO proxy implementation changed",
  );
  const registrySlot = await client.getStorageAt({
    address: deployment.registry as Address,
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  });
  assert(
    registryCode &&
      keccak256(registryCode) === deployment.epochImplementationCodeHash &&
      registrySlot?.slice(-40).toLowerCase() ===
        deployment.epochImplementation.slice(2).toLowerCase(),
    "D20DAO registry implementation changed",
  );
  return client;
}
export async function quote(env: Env) {
  const client = await trustedClient(env),
    block = await client.getBlock();
  assert(block.baseFeePerGas !== null, "Could not read the base fee");
  const baseFee = block.baseFeePerGas;
  const [fee, value] = await Promise.all([
    retryRead(() =>
      client.readContract({
        address: COORDINATOR,
        abi: coordinatorAbi,
        functionName: "quoteFeeAt",
        args: [150000, baseFee],
      }),
    ),
    retryRead(() =>
      client.readContract({
        address: COORDINATOR,
        abi: coordinatorAbi,
        functionName: "quoteFeeAt",
        args: [150000, (baseFee * 130n) / 100n],
      }),
    ),
  ]);
  return {
    fee: fee.toString(),
    value: value.toString(),
    blockNumber: block.number.toString(),
    chainId: CHAIN_ID,
    consumer: env.CONSUMER_ADDRESS,
    platformFee: "0",
    callbackGas: 150000,
  };
}
export { reconcile } from "./reconciliation-engine";
