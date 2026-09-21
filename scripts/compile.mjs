import solc from "solc";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
export function compile(extra = {}, evmVersion = "cancun") {
  const root = "node_modules/@d20dao/vrf-sdk/";
  const provenance = JSON.parse(
    readFileSync(root + "PROTOCOL-PROVENANCE.json", "utf8"),
  );
  for (const [file, expected] of Object.entries(provenance.files)) {
    if (file.startsWith("contracts/") && existsSync(root + file)) {
      const actual = createHash("sha256")
        .update(readFileSync(root + file))
        .digest("hex");
      if (actual !== expected)
        throw new Error(`SDK provenance mismatch: ${file}`);
    }
  }
  const input = {
    language: "Solidity",
    sources: {
      "LottewyConsumer.sol": {
        content: readFileSync("contracts/LottewyConsumer.sol", "utf8"),
      },
      "LottewyConsumerV2.sol": {
        content: readFileSync("contracts/LottewyConsumerV2.sol", "utf8"),
      },
      ...extra,
    },
    settings: {
      evmVersion,
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "storageLayout",
          ],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import(path) {
        try {
          return { contents: readFileSync("node_modules/" + path, "utf8") };
        } catch {
          return { error: "Import not found" };
        }
      },
    }),
  );
  const errors = output.errors?.filter((e) => e.severity === "error");
  if (errors?.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return output.contracts;
}
if (process.argv[1]?.endsWith("compile.mjs")) {
  const result = compile();
  mkdirSync("artifacts", { recursive: true });
  writeFileSync(
    "artifacts/LottewyConsumer.json",
    JSON.stringify(result["LottewyConsumer.sol"].LottewyConsumer, null, 2),
  );
  console.log(
    "Consumer compiled: Solidity 0.8.28, Cancun. SDK contract provenance hashes match.",
  );
}
