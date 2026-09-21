import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { network } from "hardhat";
import { arc } from "../shared/chain";
import {
  createPublicClient,
  createWalletClient,
  custom,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { readFileSync } from "node:fs";
// @ts-expect-error local compiler helper
import { compile } from "../scripts/compile.mjs";
let provider: any,
  connection: any,
  client: any,
  wallet: any,
  account: Address,
  artifacts: any;
async function deploy(
  name: string,
  file = "MockCoordinator.sol",
  args: any[] = [],
) {
  const artifact = artifacts[file][name];
  const tx = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: `0x${artifact.evm.bytecode.object}`,
    args,
  });
  return (await client.waitForTransactionReceipt({ hash: tx }))
    .contractAddress as Address;
}
async function write(
  address: Address,
  name: string,
  args: any[] = [],
  value = 0n,
  file = "MockCoordinator.sol",
  contract = "MockCoordinator",
) {
  const abi = artifacts[file][contract].abi;
  const sim = await client.simulateContract({
    account,
    address,
    abi,
    functionName: name,
    args,
    value,
  });
  const tx = await wallet.writeContract(sim.request);
  return client.waitForTransactionReceipt({ hash: tx });
}
async function read(
  address: Address,
  name: string,
  args: any[] = [],
  file = "MockCoordinator.sol",
  contract = "MockCoordinator",
) {
  return client.readContract({
    address,
    abi: artifacts[file][contract].abi,
    functionName: name,
    args,
  });
}
const hash = (v: string) => keccak256(new TextEncoder().encode(v));
const key = (owner: Address, id: Hex) =>
  keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [owner, id]),
  );
const file = "LottewyConsumer.sol",
  contract = "LottewyConsumer";
beforeAll(async () => {
  artifacts = compile({
    "MockCoordinator.sol": {
      content: readFileSync("tests/MockCoordinator.sol", "utf8"),
    },
  });
  connection = await network.create("local");
  provider = connection.provider;
  client = createPublicClient({ chain: arc, transport: custom(provider) });
  [account] = await provider.request({ method: "eth_accounts", params: [] });
  wallet = createWalletClient({
    chain: arc,
    account,
    transport: custom(provider),
  });
});
afterAll(async () => {
  await connection?.close();
});
describe("compiled consumer local EVM", () => {
  it("is permissionless, binds payer and commitment, pays exact fee, returns overpayment and forbids another request", async () => {
    const c = await deploy("MockCoordinator"),
      consumer = await deploy(contract, file, [c]);
    const id = hash("one"),
      commitment = hash("list");
    await write(
      consumer,
      "start",
      [id, commitment],
      parseEther("1.2"),
      file,
      contract,
    );
    const draw = await read(
      consumer,
      "draws",
      [key(account, id)],
      file,
      contract,
    );
    expect(draw[0].toLowerCase()).toBe(account.toLowerCase());
    expect(draw[1]).toBe(commitment);
    expect(await client.getBalance({ address: consumer })).toBe(0n);
    const req = await read(c, "requests", [1n]);
    expect(req[1].toLowerCase()).toBe(account.toLowerCase());
    expect(req[2]).toBe(parseEther("1"));
    await expect(
      write(
        consumer,
        "start",
        [id, hash("other")],
        parseEther("1"),
        file,
        contract,
      ),
    ).rejects.toThrow();
  });
  it("rejects unauthorized and unknown callbacks; failed callback retries only the same accepted word", async () => {
    const c = await deploy("MockCoordinator"),
      consumer = await deploy(contract, file, [c]);
    const id = hash("two"),
      word = hash("word");
    await write(
      consumer,
      "start",
      [id, hash("list")],
      parseEther("1"),
      file,
      contract,
    );
    await expect(
      write(consumer, "rawFulfillRandomness", [1n, word], 0n, file, contract),
    ).rejects.toThrow();
    await expect(
      write(c, "forgedCallback", [consumer, 999n, word]),
    ).rejects.toThrow();
    await write(c, "accept", [1n, word, 1000]);
    expect((await read(c, "requests", [1n]))[6]).toBe(false);
    await write(c, "retryCallback", [1n, 150000]);
    const draw = await read(
      consumer,
      "draws",
      [key(account, id)],
      file,
      contract,
    );
    expect(draw[3]).toBe(word);
    expect(draw[4]).toBe(2);
    await expect(
      write(c, "forgedCallback", [consumer, 1n, hash("changed")]),
    ).rejects.toThrow();
    await expect(write(c, "refundRequest", [1n])).rejects.toThrow();
  });
  it("credits failed overpayment and expiry refunds separately; withdrawals cannot double-pay or unlock", async () => {
    const c = await deploy("MockCoordinator"),
      consumer = await deploy(contract, file, [c]),
      payer = await deploy("RejectingPayer"),
      id = hash("three");
    await write(
      payer,
      "start",
      [consumer, id, hash("list")],
      parseEther("1.2"),
      "MockCoordinator.sol",
      "RejectingPayer",
    );
    expect(
      await read(consumer, "overpaymentCredits", [payer], file, contract),
    ).toBe(parseEther(".2"));
    await write(
      payer,
      "withdraw",
      [consumer, account],
      0n,
      "MockCoordinator.sol",
      "RejectingPayer",
    );
    expect(
      await read(consumer, "overpaymentCredits", [payer], file, contract),
    ).toBe(0n);
    await expect(
      write(
        payer,
        "withdraw",
        [consumer, account],
        0n,
        "MockCoordinator.sol",
        "RejectingPayer",
      ),
    ).rejects.toThrow();
    await provider.request({ method: "evm_increaseTime", params: [61] });
    await provider.request({ method: "evm_mine", params: [] });
    await write(c, "refundRequest", [1n]);
    expect(await read(c, "refundCredits", [payer])).toBe(parseEther("1"));
    expect(
      (await read(consumer, "draws", [key(payer, id)], file, contract))[4],
    ).toBe(3);
    await write(
      payer,
      "withdrawD20",
      [c, account],
      0n,
      "MockCoordinator.sol",
      "RejectingPayer",
    );
    expect(await read(c, "refundCredits", [payer])).toBe(0n);
    await expect(write(c, "refundRequest", [1n])).rejects.toThrow();
    await expect(
      write(
        payer,
        "start",
        [consumer, id, hash("list")],
        parseEther("1"),
        "MockCoordinator.sol",
        "RejectingPayer",
      ),
    ).rejects.toThrow();
  });
});
