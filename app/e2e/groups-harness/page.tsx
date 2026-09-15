import { GroupsHarnessPage } from "@/components/groups-harness-page";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function GroupsHarnessRoute() {
  requireE2eHarness();
  return <GroupsHarnessPage />;
}
