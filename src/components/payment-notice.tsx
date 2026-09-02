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
        className={`max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm ${
          mine ? "bg-brand text-white" : "bg-card"
        }`}
      >
        <p className="font-medium">{notice.title}</p>
        {notice.amount ? <p>{notice.amount}</p> : null}
        {notice.reference ? (
          <p className={mine ? "text-white/80" : "text-muted-foreground"}>{notice.reference}</p>
        ) : null}
        <p className={`text-xs ${mine ? "text-white/80" : "text-muted-foreground"}`}>
          {PAYMENT_NOTICE_LINE}
        </p>
      </div>
    </div>
  );
}
