import { getLiveSession } from "@/services/link/session";
import { runDmEnsure, runDmSignup } from "@/services/link/dmHarness";
import { LinkService } from "@/services/link/LinkService";
import {
  createLinkNativeError,
  PaykitLinkWeb,
  type PaymentEndpointMap,
} from "@/services/link/PaykitLinkWeb";
import { StorageService } from "@/services/StorageService";
import { KeyStore } from "@/services/KeyStore";
import { LINK_RECEIVER_PATH } from "@/types/link";
import { PAYKIT_PRIVATE_PAYMENT_LIST_KIND } from "@/types/payment";

export { runDmEnsure, runDmSignup };

export type PaymentsPublicView = {
  endpoint: string | undefined;
  list: PaymentEndpointMap;
  methods: string[];
  receiverPaths: string[];
};

function requireLiveSession() {
  const live = getLiveSession();
  if (!live) {
    throw createLinkNativeError("auth", "live session required");
  }
  return live;
}

export async function runPaymentsSetEndpoint(
  identifier: string,
  payload: string,
): Promise<void> {
  const live = requireLiveSession();
  await PaykitLinkWeb.setPaymentEndpoint(
    live.handle,
    LINK_RECEIVER_PATH,
    identifier.trim(),
    payload,
  );
}

export async function runPaymentsRemoveEndpoint(identifier: string): Promise<void> {
  const live = requireLiveSession();
  await PaykitLinkWeb.removePaymentEndpoint(
    live.handle,
    LINK_RECEIVER_PATH,
    identifier.trim(),
  );
}

export async function runPaymentsReadPublic(
  payeePubky: string,
  receiverPath: string,
  identifier: string,
): Promise<PaymentsPublicView> {
  const payee = payeePubky.trim();
  const path = receiverPath.trim();
  const id = identifier.trim();
  const [endpoint, list, methods, receiverPaths] = await Promise.all([
    PaykitLinkWeb.getPaymentEndpoint(payee, path, id),
    PaykitLinkWeb.getPaymentList(payee, path),
    PaykitLinkWeb.listPaymentMethods(payee, path),
    PaykitLinkWeb.listPaykitReceiverPaths(payee),
  ]);
  return { endpoint, list, methods, receiverPaths };
}

export async function runPaymentsSendPrivateList(
  peerPubky: string,
  endpoints: PaymentEndpointMap,
): Promise<void> {
  const peer = peerPubky.trim();
  await LinkService.withPeerQueue(peer, async () => {
    const linkId = await LinkService.establishedLinkId(peer);
    const { snapshot } = await PaykitLinkWeb.sendPrivatePaymentList(linkId, endpoints);
    const owner = await KeyStore.getPubky();
    if (owner) {
      await StorageService.updateLinkSnapshot(owner, peer, snapshot, "established");
    }
  });
}

export async function runPaymentsReceivePrivateList(
  peerPubky: string,
): Promise<PaymentEndpointMap[]> {
  const peer = peerPubky.trim();
  return LinkService.withPeerQueue(peer, async () => {
    const owner = await KeyStore.getPubky();
    if (!owner) throw new Error("runPaymentsReceivePrivateList: no local pubky");
    const linkId = await LinkService.establishedLinkId(peer);
    const { messages, snapshot } = await PaykitLinkWeb.receivePrivateMessages(linkId);
    await StorageService.updateLinkSnapshot(owner, peer, snapshot, "established");
    const lists: PaymentEndpointMap[] = [];
    for (const message of messages) {
      if (
        message.kind !== null &&
        message.kind !== PAYKIT_PRIVATE_PAYMENT_LIST_KIND
      ) {
        continue;
      }
      try {
        lists.push(await PaykitLinkWeb.parsePrivatePaymentListJson(message.rawJson));
      } catch {
        // other inbound kinds, or an unparseable list
      }
    }
    return lists;
  });
}
