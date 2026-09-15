import { ComposerSheetHarness } from "@/components/composer-sheet-harness";
import { requireE2eHarness } from "@/lib/require-e2e-harness";

export default function ComposerSheetRoute() {
  requireE2eHarness();
  return <ComposerSheetHarness />;
}
