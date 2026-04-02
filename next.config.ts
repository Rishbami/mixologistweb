import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "firebasestorage.googleapis.com",
        protocol: "https",
      },
      {
        hostname: "storage.googleapis.com",
        protocol: "https",
      },
      {
        hostname: "mixologistweb.firebasestorage.app",
        protocol: "https",
      },
    ],
  },
};

export default nextConfig;
