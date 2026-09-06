import { describe, expect, it } from "vitest";
import { allowedGifUrl, stripTenorResults } from "./gif-proxy";

describe("gif proxy", () => {
  it("keeps only id preview gif urls and dims, and allowlists fetch", () => {
    const items = stripTenorResults({
      results: [
        {
          id: "abc",
          media_formats: {
            gif: { url: "https://media.tenor.com/x.gif", dims: [100, 80] },
            tinygif: { url: "https://media.tenor.com/x-tiny.gif", dims: [50, 40] },
          },
          itemurl: "https://tenor.com/view/secret",
        },
        { id: "bad", media_formats: { gif: { url: "http://insecure.example/x.gif" } } },
      ],
    });
    expect(items).toEqual([
      {
        id: "abc",
        previewUrl: "https://media.tenor.com/x-tiny.gif",
        gifUrl: "https://media.tenor.com/x.gif",
        width: 100,
        height: 80,
      },
    ]);
    expect(allowedGifUrl("abc")).toContain("https://media.tenor.com/x.gif");
    expect(allowedGifUrl("nope")).toBeNull();
  });
});
