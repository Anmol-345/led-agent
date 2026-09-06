import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  http,
  multicall3Abi,
  parseAbiParameters,
  toHex,
  type Hex,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CUSTOMER_CREDIT_VAULT_ABI } from "../../contracts/generatedAbis";
import { VAULT_CHAIN_ID, BaseVaultClient, createReservationTypedData } from "./vault";

type MockRpcRequest = {
  id: number | string | null;
  method: string;
  params: readonly JsonValue[];
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

function isRecord(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRpcRequest(body: BodyInit | null | undefined): MockRpcRequest {
  if (typeof body !== "string") {
    throw new Error("Mock RPC request body must be JSON text.");
  }
  const parsed: JsonValue = JSON.parse(body);
  if (
    !isRecord(parsed) ||
    typeof parsed.method !== "string" ||
    (typeof parsed.id !== "number" &&
      typeof parsed.id !== "string" &&
      parsed.id !== null)
  ) {
    throw new Error("Mock RPC request is invalid.");
  }
  return {
    id: parsed.id,
    method: parsed.method,
    params: Array.isArray(parsed.params) ? parsed.params : [],
  };
}

function rpcCallData(request: MockRpcRequest): string | undefined {
  const call = request.params[0];
  return isRecord(call) && typeof call.data === "string"
    ? call.data
    : undefined;
}

function mockTransport(
  handler: (request: MockRpcRequest) => JsonValue,
): Transport {
  return http("https://rpc.example.test", {
    retryCount: 0,
    fetchFn: async (_input, init) => {
      const request = parseRpcRequest(init?.body);
      return new Response(
        JSON.stringify({
          id: request.id,
          jsonrpc: "2.0",
          result: handler(request),
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
}

test("BaseVaultClient ABI decoding and typed reads", async (t) => {
  const client = new BaseVaultClient({
    vaultAddress: "0x1111111111111111111111111111111111111111",
    rpcUrl: "https://mainnet.base.org",
  });

  await t.test("decodes Deposited event log", () => {
    const topics = encodeEventTopics({
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      eventName: "Deposited",
      args: {
        customer: "0x2222222222222222222222222222222222222222",
      },
    });
    const data = encodeAbiParameters(parseAbiParameters("uint256"), [100_000_000n]);

    const decoded = client.decodeVaultEventLog({
      topics,
      data,
    });

    assert.equal(decoded.eventName, "Deposited");
    if (decoded.eventName === "Deposited") {
      assert.equal(decoded.args.customer.toLowerCase(), "0x2222222222222222222222222222222222222222");
      assert.equal(decoded.args.amount, 100_000_000n);
    }
  });

  await t.test("decodes Settled event log", () => {
    const resId = toHex(1, { size: 32 });
    const topics = encodeEventTopics({
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      eventName: "Settled",
      args: {
        reservationId: resId,
      },
    });
    const data = encodeAbiParameters(parseAbiParameters("uint256, uint256"), [30_000_000n, 20_000_000n]);

    const decoded = client.decodeVaultEventLog({
      topics,
      data,
    });

    assert.equal(decoded.eventName, "Settled");
    if (decoded.eventName === "Settled") {
      assert.equal(decoded.args.reservationId, resId);
      assert.equal(decoded.args.finalCharge, 30_000_000n);
      assert.equal(decoded.args.releasedAmount, 20_000_000n);
    }
  });
});

test("BaseVaultClient simulates, submits, and confirms billing writes", async () => {
  const calls: string[] = [];
  const transactionHash: `0x${string}` = `0x${"a".repeat(64)}`;
  const blockHash: `0x${string}` = `0x${"b".repeat(64)}`;
  const billingKey: Hex = `0x${"1".repeat(64)}`;
  const billing = privateKeyToAccount(billingKey).address;
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const billingRole = toHex(1, { size: 32 });
  const billingRoleCall = encodeFunctionData({
    abi: CUSTOMER_CREDIT_VAULT_ABI,
    functionName: "BILLING_ROLE",
  });
  const hasRoleCall = encodeFunctionData({
    abi: CUSTOMER_CREDIT_VAULT_ABI,
    functionName: "hasRole",
    args: [billingRole, billing],
  });
  const transport = mockTransport(request => {
    calls.push(request.method);
    switch (request.method) {
      case "eth_call": {
        const data = rpcCallData(request);
        if (data === billingRoleCall) {
          return encodeFunctionResult({
            abi: CUSTOMER_CREDIT_VAULT_ABI,
            functionName: "BILLING_ROLE",
            result: billingRole,
          });
        }
        if (data === hasRoleCall) {
          return encodeFunctionResult({
            abi: CUSTOMER_CREDIT_VAULT_ABI,
            functionName: "hasRole",
            result: true,
          });
        }
        return "0x";
      }
      case "eth_chainId":
        return "0x2105";
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_estimateGas":
        return "0x100000";
      case "eth_maxPriorityFeePerGas":
        return "0x1";
      case "eth_gasPrice":
        return "0x2";
      case "eth_getBlockByNumber":
        return {
          baseFeePerGas: "0x1",
          blobGasUsed: "0x0",
          difficulty: "0x0",
          excessBlobGas: "0x0",
          extraData: "0x",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          hash: blockHash,
          logsBloom: `0x${"0".repeat(512)}`,
          miner: "0x0000000000000000000000000000000000000000",
          mixHash: `0x${"0".repeat(64)}`,
          nonce: "0x0000000000000000",
          number: "0x1",
          parentBeaconBlockRoot: `0x${"0".repeat(64)}`,
          parentHash: `0x${"0".repeat(64)}`,
          receiptsRoot: `0x${"0".repeat(64)}`,
          sha3Uncles: `0x${"0".repeat(64)}`,
          size: "0x0",
          stateRoot: `0x${"0".repeat(64)}`,
          timestamp: "0x1",
          totalDifficulty: "0x0",
          transactions: [],
          transactionsRoot: `0x${"0".repeat(64)}`,
          uncles: [],
          withdrawals: [],
          withdrawalsRoot: `0x${"0".repeat(64)}`,
        };
      case "eth_sendRawTransaction":
        return transactionHash;
      case "eth_getTransactionReceipt":
        return {
          blockHash,
          blockNumber: "0x1",
          contractAddress: null,
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          from: billing,
          gasUsed: "0x5208",
          logs: [],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          to: vaultAddress,
          transactionHash,
          transactionIndex: "0x0",
          type: "0x2",
        };
      default:
        throw new Error(`Unexpected RPC method: ${request.method}`);
    }
  });
  const client = new BaseVaultClient({
    billingSignerPrivateKey: billingKey,
    transport,
    vaultAddress,
  });

  const hash = await client.submitReserve({
    reservationId: `0x${"2".repeat(64)}`,
    customer: "0x2222222222222222222222222222222222222222",
    maximumCharge: 1_000_000n,
    expiresAt: 2_000_000_000,
    termsHash: toHex(3, { size: 32 }),
    customerSignature: toHex(4, { size: 65 }),
  });
  const outcome = await client.transactionOutcome(hash);

  assert.equal(hash, transactionHash);
  assert.equal(outcome, "confirmed");
  assert.equal(calls[0], "eth_call");
  assert.ok(calls.includes("eth_sendRawTransaction"));
  assert.equal(calls.at(-1), "eth_getTransactionReceipt");
});

test("BaseVaultClient reads available and reserved from one pinned block", async () => {
  const calls: Array<{ method: string; blockTag?: string }> = [];
  const transport = mockTransport(request => {
    if (request.method === "eth_blockNumber") {
      calls.push({ method: request.method });
      return "0xf4240";
    }
    if (request.method === "eth_call") {
      const blockTag = request.params[1];
      calls.push({
        method: request.method,
        blockTag: typeof blockTag === "string" ? blockTag : undefined,
      });
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: [
          {
            success: true,
            returnData: encodeAbiParameters(parseAbiParameters("uint256"), [70_000_000n]),
          },
          {
            success: true,
            returnData: encodeAbiParameters(parseAbiParameters("uint256"), [30_000_000n]),
          },
        ],
      });
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });
  const client = new BaseVaultClient({
    transport,
    vaultAddress: "0x1111111111111111111111111111111111111111",
  });

  const snapshot = await client.getAccountSnapshot(
    "0x2222222222222222222222222222222222222222",
  );

  assert.deepEqual(snapshot, {
    available: 70_000_000n,
    reserved: 30_000_000n,
    blockNumber: 1_000_000n,
  });
  assert.deepEqual(calls.map(call => call.method), ["eth_blockNumber", "eth_call"]);
  assert.equal(calls[1].blockTag, "0xf4240");
});

test("BaseVaultClient rejects a billing signer without the vault role", async () => {
  const billingKey: Hex = `0x${"1".repeat(64)}`;
  const billingRole = toHex(1, { size: 32 });
  let roleRead = false;
  const transport = mockTransport(request => {
    if (request.method !== "eth_call") {
      throw new Error(`Unexpected RPC method: ${request.method}`);
    }
    if (!roleRead) {
      roleRead = true;
      return encodeFunctionResult({
        abi: CUSTOMER_CREDIT_VAULT_ABI,
        functionName: "BILLING_ROLE",
        result: billingRole,
      });
    }
    return encodeFunctionResult({
      abi: CUSTOMER_CREDIT_VAULT_ABI,
      functionName: "hasRole",
      result: false,
    });
  });
  const client = new BaseVaultClient({
    billingSignerPrivateKey: billingKey,
    transport,
    vaultAddress: "0x1111111111111111111111111111111111111111",
  });

  await assert.rejects(
    () =>
      client.submitReserve({
        reservationId: toHex(2, { size: 32 }),
        customer: "0x2222222222222222222222222222222222222222",
        maximumCharge: 1_000_000n,
        expiresAt: 2_000_000_000,
        termsHash: toHex(3, { size: 32 }),
        customerSignature: toHex(4, { size: 65 }),
      }),
    /does not have BILLING_ROLE/,
  );
});

test("BaseVaultClient distinguishes a reverted billing receipt", async () => {
  const transactionHash: `0x${string}` = `0x${"a".repeat(64)}`;
  const blockHash: `0x${string}` = `0x${"b".repeat(64)}`;
  const transport = mockTransport(request => {
    if (request.method === "eth_call") return "0x";
    if (request.method === "eth_chainId") return "0x2105";
    if (request.method === "eth_sendTransaction") return transactionHash;
    if (request.method === "eth_getTransactionReceipt") {
      return {
        blockHash,
        blockNumber: "0x1",
        contractAddress: null,
        cumulativeGasUsed: "0x5208",
        effectiveGasPrice: "0x1",
        from: "0x2222222222222222222222222222222222222222",
        gasUsed: "0x5208",
        logs: [],
        logsBloom: `0x${"0".repeat(512)}`,
        status: "0x0",
        to: "0x1111111111111111111111111111111111111111",
        transactionHash,
        transactionIndex: "0x0",
        type: "0x2",
      };
    }
    throw new Error(`Unexpected RPC method: ${request.method}`);
  });
  const client = new BaseVaultClient({
    transport,
    vaultAddress: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(await client.transactionOutcome(transactionHash), "reverted");
});

test("BaseVaultClient keeps an unavailable receipt outcome unknown", async () => {
  const transactionHash: Hex = `0x${"a".repeat(64)}`;
  const client = new BaseVaultClient({
    receiptTimeoutMs: 1,
    transport: mockTransport(request => {
      throw new Error(`RPC unavailable for ${request.method}`);
    }),
    vaultAddress: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(await client.transactionOutcome(transactionHash), "unknown");
});

test("BaseVaultClient verifies exact EOA reservation terms", async () => {
  const account = privateKeyToAccount(`0x${"2".repeat(64)}`);
  const vaultAddress = "0x1111111111111111111111111111111111111111";
  const reservation = {
    reservationId: toHex(1, { size: 32 }),
    customer: account.address,
    maximumCharge: 20_000_000n,
    expiresAt: 2_000_000_000,
    termsHash: toHex(2, { size: 32 }),
  };
  const signature = await account.signTypedData(
    createReservationTypedData({
      chainId: VAULT_CHAIN_ID,
      vaultAddress,
      ...reservation,
    }),
  );
  const client = new BaseVaultClient({
    transport: mockTransport(request => {
      throw new Error(`No contract verifier for ${request.method}`);
    }),
    vaultAddress,
  });

  assert.equal(
    await client.verifyReservationAuthorization({
      ...reservation,
      customerSignature: signature,
    }),
    true,
  );
  assert.equal(
    await client.verifyReservationAuthorization({
      ...reservation,
      maximumCharge: reservation.maximumCharge + 1n,
      customerSignature: signature,
    }),
    false,
  );
});

test("BaseVaultClient accepts ERC-1271 validation through the public client", async () => {
  const client = new BaseVaultClient({
    transport: mockTransport(request => {
      if (request.method === "eth_call") {
        return toHex(1, { size: 32 });
      }
      throw new Error(`Unexpected RPC method: ${request.method}`);
    }),
    vaultAddress: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(
    await client.verifyReservationAuthorization({
      reservationId: toHex(1, { size: 32 }),
      customer: "0x3333333333333333333333333333333333333333",
      maximumCharge: 20_000_000n,
      expiresAt: 2_000_000_000,
      termsHash: toHex(2, { size: 32 }),
      customerSignature: toHex(3, { size: 65 }),
    }),
    true,
  );
});
