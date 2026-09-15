import { describe, expect, it } from "vitest";
import {
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
} from "@/types/payment";
import {
  describePaymentNotice,
  isPaymentMessageKind,
  PAYMENT_NOTICE_LINE,
  paymentKindTitle,
} from "./payment-notice";

const REQUEST_JSON = JSON.stringify({
  version: 1,
  kind: PAYKIT_PAYMENT_REQUEST_KIND,
  event_id: "11111111-1111-4111-8111-111111111111",
  payment_request_id: "22222222-2222-4222-8222-222222222222",
  request: {
    amount: { value: "0.001", asset: "btc" },
    payment_reference: "coffee",
    proposal_expires_at: null,
    recurrence: null,
    accepted_payment_endpoint_identifiers: ["btc-lightning-bolt11"],
    metadata: {},
  },
});

describe("payment notice mapping", () => {
  it("maps a payment-request kind to a read-only notice with amount and reference", () => {
    const notice = describePaymentNotice({
      kind: PAYKIT_PAYMENT_REQUEST_KIND,
      rawJson: REQUEST_JSON,
      body: "",
    });
    expect(notice.title).toBe("Payment request");
    expect(notice.amount).toBe("0.001 BTC");
    expect(notice.reference).toBe("coffee");
    expect(PAYMENT_NOTICE_LINE).toMatch(/not available on web/i);
  });

  it("maps other payment kinds without claiming a send action", () => {
    expect(paymentKindTitle(PAYKIT_PAYMENT_ACCEPTANCE_KIND)).toBe("Payment accepted");
    expect(isPaymentMessageKind(PAYKIT_PAYMENT_REQUEST_KIND)).toBe(true);
    expect(isPaymentMessageKind("chat.message.v0")).toBe(false);
  });

  it("still titles an undecodable payment kind as a notice, not a chat body", () => {
    const notice = describePaymentNotice({
      kind: PAYKIT_PAYMENT_REQUEST_KIND,
      rawJson: "not-json",
      body: "",
    });
    expect(notice.title).toBe("Payment request");
    expect(notice.amount).toBeNull();
  });
});
