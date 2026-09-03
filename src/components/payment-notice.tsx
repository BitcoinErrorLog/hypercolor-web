"use client";

import { PAYMENT_NOTICE_LINE, type PaymentNoticeView } from "@/lib/payment-notice";

export function PaymentNotice({
  notice,
  mine,
}: {
  notice: PaymentNoticeView;
  mine: boolean;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid="paymentNotice">
      <div
        className={`hc-bubble space-y-2 ${
          mine ? "hc-bubble-mine" : "hc-bubble-theirs"
        }`}
      >
        <p className="font-medium">{notice.title}</p>
        {notice.amount ? <p>{notice.amount}</p> : null}
        {notice.reference ? (
          <p className={mine ? "hc-on-brand-muted" : "text-muted-foreground"}>{notice.reference}</p>
        ) : null}
        <p className={`text-xs ${mine ? "hc-on-brand-muted" : "text-muted-foreground"}`}>
          {PAYMENT_NOTICE_LINE}
        </p>
      </div>
    </div>
  );
}
