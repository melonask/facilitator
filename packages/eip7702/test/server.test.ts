import { x402Facilitator } from "@x402/core/facilitator";
import { beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../src/handler.js";

describe("Facilitator Server Handler", () => {
  let mockFacilitator: x402Facilitator;
  let handler: ReturnType<typeof createHandler>;

  beforeEach(() => {
    mockFacilitator = {
      register: mock.fn(),
      getSupported: mock.fn(() => ({
        kinds: [{ x402Version: 2, scheme: "eip7702", network: "eip155:1" }],
        extensions: [],
        signers: {},
      })),
      verify: mock.fn(async (_payload: any, _reqs: any) => ({ isValid: true, payer: "0x123" })),
      settle: mock.fn(async (_payload: any, _reqs: any) => ({
        success: true,
        transaction: "0xhash",
        network: "eip155:1",
        payer: "0x123",
      })),
    } as unknown as x402Facilitator;
    handler = createHandler(mockFacilitator);
  });

  describe("GET /supported", () => {
    it("should return supported kinds", async () => {
      const req = new Request("http://localhost/supported");
      const res = await handler(req);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(data, {
        kinds: [{ x402Version: 2, scheme: "eip7702", network: "eip155:1" }],
        extensions: [],
        signers: {},
      });
    });
  });

  describe("POST /verify", () => {
    it("should verify payload", async () => {
      const body = {
        paymentPayload: { foo: "bar" } as any,
        paymentRequirements: { baz: "qux" } as any,
      };
      const req = new Request("http://localhost/verify", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await handler(req);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(data, { isValid: true, payer: "0x123" });
      assert.equal((mockFacilitator.verify as any).mock.callCount(), 1);
    });

    it("should return 400 if missing body fields", async () => {
      const req = new Request("http://localhost/verify", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await handler(req);
      assert.equal(res.status, 400);
    });
  });

  describe("POST /settle", () => {
    it("should settle payload", async () => {
      const body = {
        paymentPayload: { foo: "bar" } as any,
        paymentRequirements: { baz: "qux" } as any,
      };
      const req = new Request("http://localhost/settle", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await handler(req);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.deepEqual(data, {
        success: true,
        transaction: "0xhash",
        network: "eip155:1",
        payer: "0x123",
      });
      assert.equal((mockFacilitator.settle as any).mock.callCount(), 1);
    });
  });

  describe("OPTIONS", () => {
    it("should handle CORS preflight", async () => {
      const req = new Request("http://localhost/supported", {
        method: "OPTIONS",
      });
      const res = await handler(req);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    });
  });

  describe("404", () => {
    it("should return 404 for unknown paths", async () => {
      const req = new Request("http://localhost/unknown");
      const res = await handler(req);
      assert.equal(res.status, 404);
    });
  });
});
