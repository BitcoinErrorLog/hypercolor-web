import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));
const verifySource = readFileSync(path.join(dir, "appCertVerify.ts"), "utf8");
const nextConfig = readFileSync(
  path.join(dir, "../../next.config.ts"),
  "utf8",
);

describe("AppCert verify stays off the client webpack graph", () => {
  it("does not let webpack follow the Node wasm loader from KeyStore/Enable", () => {
    expect(verifySource).toContain("webpackIgnore: true");
    expect(verifySource).toContain("@/lib/paykit-wasm-node");
    expect(verifySource).toContain('typeof window !== "undefined"');
    expect(nextConfig).toContain("IgnorePlugin");
    expect(nextConfig).toContain("paykit-wasm-node");
  });
});
