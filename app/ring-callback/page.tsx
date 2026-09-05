import type { Metadata } from "next";
import { RingCallbackPage } from "@/components/ring-callback-page";

export const metadata: Metadata = {
  referrer: "no-referrer",
};

export default function RingCallbackRoute() {
  return <RingCallbackPage />;
}
