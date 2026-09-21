import { it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, consumerAbi } from "../shared/chain";
import {
  hash,
  actionData,
  select,
  type Action,
  type Giveaway,
} from "../shared/core";
import deployment from "../docs/arc-testnet.json";

it.skipIf(process.env.RUN_TESTNET !== "1")(
  "explicit Arc testnet end-to-end: SIWE, JEV, D1, consumer, randomness and replay",
  async () => {
    const vars = parseEnv(readFileSync(".env", "utf8"));
    const candidates = Object.entries(vars).filter(
      ([k, v]) => !/JEV/i.test(k) && /^(0x)?[a-f\d]{64}$/i.test(v),
    );
    if (candidates.length !== 1)
      throw new Error(
        "Exactly one testnet private key is required; no secret values logged.",
      );
    const account = privateKeyToAccount(
      (candidates[0][1].startsWith("0x")
        ? candidates[0][1]
        : "0x" + candidates[0][1]) as Hex,
    );
    const rpc = createPublicClient({ chain: arc, transport: http() }),
      wallet = createWalletClient({ chain: arc, account, transport: http() });
    expect(await rpc.getChainId()).toBe(5042002);
    for (const [proxy, impl, expected] of [
      [
        deployment.coordinator,
        deployment.coordinatorImplementation,
        deployment.coordinatorImplementationCodeHash,
      ],
      [
        deployment.registry,
        deployment.epochImplementation,
        deployment.epochImplementationCodeHash,
      ],
    ]) {
      const slot = await rpc.getStorageAt({
        address: proxy as Address,
        slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      });
      expect(slot?.slice(-40).toLowerCase()).toBe(impl.slice(2).toLowerCase());
      expect(
        keccak256((await rpc.getCode({ address: impl as Address }))!),
      ).toBe(expected);
    }
    let consumer: Address;
    if (existsSync("docs/lottewy-testnet.json"))
      consumer = JSON.parse(
        readFileSync("docs/lottewy-testnet.json", "utf8"),
      ).address;
    else {
      const artifact = JSON.parse(
        readFileSync("artifacts/LottewyConsumer.json", "utf8"),
      );
      const gas = await rpc.estimateGas({
        account: account.address,
        data: (await import("viem")).encodeDeployData({
          abi: artifact.abi,
          bytecode: `0x${artifact.evm.bytecode.object}`,
          args: [deployment.coordinator],
        }),
      });
      expect(gas * (await rpc.getGasPrice())).toBeLessThan(parseEther("1"));
      const tx = await wallet.deployContract({
        abi: artifact.abi,
        bytecode: `0x${artifact.evm.bytecode.object}`,
        args: [deployment.coordinator],
      });
      const receipt = await rpc.waitForTransactionReceipt({
        hash: tx,
        confirmations: 3,
      });
      expect(receipt.status).toBe("success");
      consumer = receipt.contractAddress!;
      writeFileSync(
        "docs/lottewy-testnet.json",
        JSON.stringify(
          {
            chainId: 5042002,
            address: consumer,
            codeHash: keccak256((await rpc.getCode({ address: consumer }))!),
            transactionHash: tx,
            blockNumber: receipt.blockNumber.toString(),
          },
          null,
          2,
        ),
      );
      const configuration = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
      const publicDeployment = JSON.parse(
        readFileSync("docs/lottewy-testnet.json", "utf8"),
      );
      configuration.vars.CONSUMER_ADDRESS = consumer;
      configuration.vars.CONSUMER_CODE_HASH = publicDeployment.codeHash;
      writeFileSync("wrangler.jsonc", JSON.stringify(configuration, null, 2));
    }
    // A deployment-only first run is intentional: Wrangler must reload its public configuration.
    if (process.env.TESTNET_DEPLOY_ONLY === "1") return;
    let cookie = "";
    const origin = "http://127.0.0.1:5173";
    async function api(path: string, payload?: unknown) {
      const res = await fetch(origin + "/api" + path, {
        method: payload === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      if (res.headers.has("set-cookie"))
        cookie = res.headers.get("set-cookie")!.split(";")[0];
      const data = (await res.json()) as any;
      if (!res.ok) throw new Error(`Local API ${path}: ${data.error}`);
      return data;
    }
    const challenge = await api("/auth/challenge", {
      address: account.address,
    });
    await api("/auth/verify", {
      nonce: challenge.nonce,
      signature: await account.signMessage({ message: challenge.message }),
    });
    async function act(
      type: string,
      id: string,
      revision: number,
      payload: unknown,
    ) {
      const challenge = await api("/actions/challenge", {});
      const action: Action = {
        signer: account.address,
        actionId: crypto.randomUUID(),
        actionType: type,
        giveawayId: id,
        payloadHash: hash(payload),
        expectedRevision: revision,
        ...challenge,
      };
      return api("/actions", {
        action,
        payload,
        signature: await account.signTypedData(actionData(action)),
      });
    }
    const id = process.env.RESUME_ID || crypto.randomUUID(),
      draft = {
        title: process.env.WEIGHTED_TESTNET==='1'?'Weighted Arc Testnet verification':'Arc Testnet integration verification',
        description: "Synthetic test entries. No prize or real promotion.",
        rules: process.env.WEIGHTED_TESTNET==='1'?'Entries use the public weights in the list. Selection is without replacement; each selected entry is removed entirely. Participation is free. This technical test has no prize.':'Every synthetic entry has an equal chance. Participation is free. This technical test has no prize.',
        ...(process.env.WEIGHTED_TESTNET==='1'?{weights:[1,2,3,4]}:{}),
        entries: [
          "Synthetic Entry One",
          "Synthetic Entry Two",
          "Synthetic Entry Three",
          "Synthetic Entry Four",
        ],
        winners: 2,
        reserves: 1,
      };
    const g = process.env.RESUME_ID
      ? await api(`/giveaways/${id}`)
      : await act("create", id, 0, draft);
    expect(g.review.mode).toBe("live");
    let tx: Hex;
    if (process.env.RESUME_ID && g.evidence) tx = g.evidence.txHash;
    else {
      const pricing = await api("/quote");
      expect(BigInt(pricing.value)).toBeLessThan(parseEther("1"));
      const reserved=await act("start", id, 1, { commitment: g.commitment });
      tx = await wallet.writeContract({
        address: consumer,
        abi: consumerAbi,
        functionName: "start",
        args: [hash(id), g.commitment],
        value: BigInt(pricing.value),
        nonce:reserved.reservation.nonce,
      });
      await api('/submission-hint',{id,txHash:tx,kind:'start'});
    }
    const receipt = await rpc.waitForTransactionReceipt({
      hash: tx,
      confirmations: 12,
    });
    expect(receipt.status).toBe("success");
    const key = keccak256(
      encodeAbiParameters(parseAbiParameters("address,bytes32"), [
        account.address,
        hash(id),
      ]),
    );
    let draw = await rpc.readContract({
      address: consumer,
      abi: consumerAbi,
      functionName: "draws",
      args: [key],
    });
    for (let i = 0; i < 24 && draw[4] === 1; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      draw = await rpc.readContract({
        address: consumer,
        abi: consumerAbi,
        functionName: "draws",
        args: [key],
      });
    }
    expect(draw[4]).toBe(2);
    await fetch("http://127.0.0.1:8787/cdn-cgi/local/scheduled");
    const result = (await api(`/giveaways/${id}`)) as Giveaway;
    expect(result.status).toBe("completed");
    expect(result.evidence?.word).toBe(draw[3]);
    const outcome = select(result.manifest, draw[3], result.commitment);
    expect(outcome.winners).toHaveLength(2);
    const { verifyD20 } = await import("../shared/proof");
    const proof = await verifyD20(result);
    expect(proof.valid).toBe(true);
    writeFileSync(
      process.env.WEIGHTED_TESTNET==='1'?"docs/testnet-weighted-e2e.json":"docs/testnet-e2e.json",
      JSON.stringify(
        {
          giveawayId: id,
          slug: result.slug,
          consumer,
          transactionHash: tx,
          requestId: draw[2].toString(),
          commitment: result.commitment,
          word: draw[3],
          outcome,
          proof,
        },
        null,
        2,
      ),
    );
    if(process.env.WEIGHTED_TESTNET==='1')writeFileSync('docs/testnet-weighted-public-manifest.json',JSON.stringify(result,null,2));
  },
  180000,
);
