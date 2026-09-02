import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "discover-page.tsx"),
  "utf8",
);
const view = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "tag-channel-view.tsx"),
  "utf8",
);

describe("discover-page public surface", () => {
  it("states that Public mode is a public index and is skippable until load", () => {
    expect(source).toContain("data-testid=\"discoverPrivacyCopy\"");
    expect(source).toContain("PUBLIC_GRAPH_WARNING");
    expect(source).toContain("PUBLIC_SUBSTRATE_LINE");
    expect(source).toContain("data-testid=\"discoverLoadTopics\"");
    expect(source).toContain("Load public topics");
    expect(source).toContain("createDiscoverTopicsLoader");
    expect(source).toContain("normalizeTagLabel");
    expect(source).not.toMatch(/useEffect\s*\(/);
    expect(source).toContain("onClick={() => void loadTopics()}");
  });

  it("does not touch private groups, inbox, or follows", () => {
    expect(source).not.toContain("GroupService");
    expect(source).not.toContain("inboxStore");
    expect(source).not.toContain("following(");
    expect(source).not.toContain("viewer_id");
    expect(source).not.toContain("hypercolor.app/v1/group");
  });

  it("keeps posting informational and labeled as a public publish", () => {
    expect(view).toContain("data-testid=\"tagChannelComposerDisabled\"");
    expect(view).toContain("Posting here publishes to the public graph");
  });
});
