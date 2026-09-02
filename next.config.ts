import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer, webpack }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    config.plugins.push(
      new webpack.DefinePlugin({
        __HYPERCOLOR_E2E_HARNESS__: JSON.stringify(process.env.NEXT_PUBLIC_E2E_HARNESS === "1"),
      }),
    );
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
