import { beforeAll, afterAll, it, expect } from "vitest";
import { network } from "hardhat";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  parseEther,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { arc } from "../shared/chain";
import { hash } from "../shared/core";
import { drawIntent } from "../shared/draw-intent";
// @ts-expect-error local compiler
import { compile } from "../scripts/compile.mjs";
let connection: any,
  client: any,
  wallet: any,
  admin: Address,
  other: Address,
  artifacts: any;
const file = "LottewyConsumerV2.sol",
  name = "LottewyConsumerV2";
beforeAll(async () => {
  artifacts = compile({
    "MockCoordinator.sol": {
      content: readFileSync("tests/MockCoordinator.sol", "utf8"),
    },
    "V3.sol": {
      content:
        'pragma solidity 0.8.28; import {LottewyConsumerV2} from "LottewyConsumerV2.sol"; contract V3 is LottewyConsumerV2 { constructor(address c) LottewyConsumerV2(c) {} function version() external pure override returns(uint256){return 3;} }',
    },
  });
  connection = await network.create("local");
  client = createPublicClient({
    chain: arc,
    transport: custom(connection.provider),
  });
  [admin, other] = await connection.provider.request({
    method: "eth_accounts",
    params: [],
  });
  wallet = createWalletClient({
    chain: arc,
    account: admin,
    transport: custom(connection.provider),
  });
});
afterAll(async () => {
  await connection?.close();
});
async function deploy(f: string, n: string, args: any[] = []) {
  const a = artifacts[f][n];
  const tx = await wallet.deployContract({
    abi: a.abi,
    bytecode: "0x" + a.evm.bytecode.object,
    args,
  });
  return (await client.waitForTransactionReceipt({ hash: tx })).contractAddress;
}
async function setup() {
  const coordinator = await deploy("MockCoordinator.sol", "MockCoordinator");
  const implementation = await deploy(file, name, [coordinator]);
  const init = encodeFunctionData({
    abi: artifacts[file][name].abi,
    functionName: "initialize",
    args: [admin],
  });
  const proxy = await deploy(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
    "ERC1967Proxy",
    [implementation, init],
  );
  return { coordinator, implementation, proxy };
}
async function write(
  address: Address,
  functionName: string,
  args: any[] = [],
  value = 0n,
  account = admin,
) {
  const tx = await wallet.writeContract({
    address,
    abi: artifacts[file][name].abi,
    functionName,
    args,
    value,
    account,
  });
  return client.waitForTransactionReceipt({ hash: tx });
}
async function read(address: Address, functionName: string, args: any[] = []) {
  return client.readContract({
    address,
    abi: artifacts[file][name].abi,
    functionName,
    args,
  });
}
it("initializes only the proxy once and rejects unauthorized upgrades", async () => {
  const { proxy, implementation, coordinator } = await setup();
  expect((await read(proxy, "owner")).toLowerCase()).toBe(admin.toLowerCase());
  await expect(write(proxy, "initialize", [other])).rejects.toThrow();
  await expect(write(implementation, "initialize", [admin])).rejects.toThrow();
  const next = await deploy("V3.sol", "V3", [coordinator]);
  await expect(
    write(proxy, "upgradeToAndCall", [next, "0x"], 0n, other),
  ).rejects.toThrow();
  await write(proxy, "upgradeToAndCall", [next, "0x"]);
  expect(await read(proxy, "version")).toBe(3n);
});
it("relays an owner-signed intent without transferring ownership or refund rights to the relayer", async () => {
  const { proxy, coordinator } = await setup(),
    owner = privateKeyToAccount(generatePrivateKey()),
    id = "agent-test",
    commitment = hash("list");
  const deadline = (await client.getBlock()).timestamp + 300n,
    maxFee = parseEther("2");
  const signature = await owner.signTypedData(
    drawIntent(proxy, owner.address, admin, id, commitment, maxFee, deadline),
  );
  await expect(
    write(
      proxy,
      "startFor",
      [owner.address, hash(id), commitment, maxFee, deadline, signature],
      maxFee,
      other,
    ),
  ).rejects.toThrow();
  await write(
    proxy,
    "startFor",
    [owner.address, hash(id), commitment, maxFee, deadline, signature],
    maxFee,
  );
  const key = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [
      owner.address,
      hash(id),
    ]),
  );
  const result = await read(proxy, "draws", [key]);
  expect(result[0].toLowerCase()).toBe(owner.address.toLowerCase());
  expect(result[1]).toBe(commitment);
  expect(result[4]).toBe(1);
  await expect(
    write(
      proxy,
      "startFor",
      [owner.address, hash(id), commitment, maxFee, deadline, signature],
      maxFee,
    ),
  ).rejects.toThrow();
  const next = await deploy("V3.sol", "V3", [coordinator]);
  await write(proxy, "upgradeToAndCall", [next, "0x"]);
  expect(await read(proxy, "draws", [key])).toEqual(result);
  const request = await client.readContract({
    address: coordinator,
    abi: artifacts["MockCoordinator.sol"].MockCoordinator.abi,
    functionName: "requests",
    args: [result[2]],
  });
  expect(request[1].toLowerCase()).toBe(owner.address.toLowerCase());
  const word = hash("accepted");
  const callback = await wallet.writeContract({
    address: coordinator,
    abi: artifacts["MockCoordinator.sol"].MockCoordinator.abi,
    functionName: "accept",
    args: [result[2], word, 150000],
  });
  await client.waitForTransactionReceipt({ hash: callback });
  expect((await read(proxy, "draws", [key]))[3]).toBe(word);
  expect((await read(proxy, "draws", [key]))[4]).toBe(2);
});
it("enforces the signed commitment, fee ceiling and expiry", async () => {
  const { proxy } = await setup(),
    owner = privateKeyToAccount(generatePrivateKey()),
    id = "limits",
    commitment = hash("list"),
    deadline = (await client.getBlock()).timestamp + 300n,
    maxFee = 0n;
  const signature = await owner.signTypedData(
    drawIntent(proxy, owner.address, admin, id, commitment, maxFee, deadline),
  );
  await expect(
    write(
      proxy,
      "startFor",
      [owner.address, hash(id), commitment, maxFee, deadline, signature],
      parseEther("2"),
    ),
  ).rejects.toThrow();
  await expect(
    write(
      proxy,
      "startFor",
      [owner.address, hash(id), hash("changed"), maxFee, deadline, signature],
      parseEther("2"),
    ),
  ).rejects.toThrow();
  const expired = await owner.signTypedData(
    drawIntent(
      proxy,
      owner.address,
      admin,
      id,
      commitment,
      parseEther("2"),
      1n,
    ),
  );
  await expect(
    write(
      proxy,
      "startFor",
      [owner.address, hash(id), commitment, parseEther("2"), 1n, expired],
      parseEther("2"),
    ),
  ).rejects.toThrow();
});

it("only an explicitly authorized service relayer can sponsor a payer draw", async () => {
  const { proxy, coordinator } = await setup(),
    payer = privateKeyToAccount(generatePrivateKey()).address,
    id = hash("sponsored"),
    commitment = hash("approved");
  await expect(
    write(
      proxy,
      "startSponsored",
      [payer, id, commitment, parseEther("2")],
      parseEther("2"),
      other,
    ),
  ).rejects.toThrow();
  await expect(
    write(proxy, "setRelayer", [other, true], 0n, other),
  ).rejects.toThrow();
  await write(proxy, "setRelayer", [other, true]);
  await write(
    proxy,
    "startSponsored",
    [payer, id, commitment, parseEther("2")],
    parseEther("2"),
    other,
  );
  const key = keccak256(
    encodeAbiParameters(parseAbiParameters("address,bytes32"), [payer, id]),
  );
  expect((await read(proxy, "draws", [key]))[0].toLowerCase()).toBe(
    payer.toLowerCase(),
  );
  const draw = await read(proxy, "draws", [key]);
  const request = await client.readContract({
    address: coordinator,
    abi: artifacts["MockCoordinator.sol"].MockCoordinator.abi,
    functionName: "requests",
    args: [draw[2]],
  });
  expect(request[1].toLowerCase()).toBe(other.toLowerCase());
  await write(proxy, "setRelayer", [other, false]);
  await expect(
    write(
      proxy,
      "startSponsored",
      [payer, hash("another"), commitment, parseEther("2")],
      parseEther("2"),
      other,
    ),
  ).rejects.toThrow();
});
