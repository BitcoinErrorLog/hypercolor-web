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
  it("states that Discover is a public index and is skippable", () => {
    const text = source.replace(/\s+/g, " ");
    expect(source).toContain("data-testid=\"discoverPrivacyCopy\"");
    expect(text).toContain("global public index");
    expect(text).toContain("Skip this page");
    expect(text).toContain("Private DMs and groups");
    expect(source).toContain("data-testid=\"discoverLoadTopics\"");
    expect(source).toContain("Retry public topics");
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

  it("keeps the composer disabled and labeled as a public publish", () => {
    expect(view).toContain("data-testid=\"tagChannelComposerDisabled\"");
    expect(view).toContain("Posting here publishes to the public graph");
    expect(view).toContain("disabled");
  });
});
