import {
  decodePaymentEnvelope,
  isPaykitPaymentKind,
  PAYKIT_PAYMENT_ACCEPTANCE_KIND,
  PAYKIT_PAYMENT_CANCELLATION_KIND,
  PAYKIT_PAYMENT_PROOF_KIND,
  PAYKIT_PAYMENT_REJECTION_KIND,
  PAYKIT_PAYMENT_REQUEST_KIND,
  PAYKIT_PRIVATE_PAYMENT_LIST_KIND,
} from "@/types/payment";

export const PAYMENT_NOTICE_LINE =
  "Payments are not available on web. Open Hypercolor on mobile to act on this.";

export type PaymentNoticeView = {
  title: string;
  amount: string | null;
  reference: string | null;
};

export function paymentKindTitle(kind: string): string {
  switch (kind) {
    case PAYKIT_PAYMENT_REQUEST_KIND:
      return "Payment request";
    case PAYKIT_PAYMENT_ACCEPTANCE_KIND:
      return "Payment accepted";
    case PAYKIT_PAYMENT_REJECTION_KIND:
      return "Payment rejected";
    case PAYKIT_PAYMENT_CANCELLATION_KIND:
      return "Payment cancelled";
    case PAYKIT_PAYMENT_PROOF_KIND:
      return "Payment proof";
    case PAYKIT_PRIVATE_PAYMENT_LIST_KIND:
      return "Tip list";
    default:
      return "Payment request";
  }
}

export function describePaymentNotice(input: {
  kind: string;
  rawJson?: string;
  body?: string;
}): PaymentNoticeView {
  const title = paymentKindTitle(input.kind);
  const decoded =
    (input.rawJson ? decodePaymentEnvelope(input.rawJson) : null) ??
    (input.body ? decodePaymentEnvelope(input.body) : null);
  if (decoded && decoded.kind === PAYKIT_PAYMENT_REQUEST_KIND) {
    const value = decoded.request.amount.value;
    const asset = decoded.request.amount.asset;
    return {
      title,
      amount: `${value} ${asset.toUpperCase()}`,
      reference: decoded.request.payment_reference || null,
    };
  }
  return { title, amount: null, reference: null };
}

export function isPaymentMessageKind(kind: string): boolean {
  return isPaykitPaymentKind(kind);
}
