import type { NextConfig } from "next";

function resolveDistDir(): string {
  const raw = process.env.NEXT_DIST_DIR;
  // Next 16 joins distDir onto the project root, so `/tmp/foo` becomes
  // `<repo>/tmp/foo` on this volume and JSON manifests get stray bytes.
  if (raw && !raw.startsWith("/") && raw !== "public") return raw;
  return ".next";
}

const nextConfig: NextConfig = {
  output: "export",
  distDir: resolveDistDir(),
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer, webpack }) => {
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /\/\._[^/]+$/ }));
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        "node:fs": false,
        "node:fs/promises": false,
        "node:path": false,
        "node:os": false,
      };
    }
    return config;
  },
};

export default nextConfig;
