"use client";

import { useState } from "react";
import { Composer } from "@/components/composer";

export function ComposerSheetHarness() {
  const [draft, setDraft] = useState("");
  return (
    <Composer
      draft={draft}
      sending={false}
      placeholder="Message"
      onChangeDraft={setDraft}
      onSend={() => undefined}
      onAttach={() => undefined}
      testIdPrefix="harness"
    />
  );
}
