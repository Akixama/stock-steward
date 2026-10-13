import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    SHOW_DEVELOPER_TOOLS: process.env.SHOW_DEVELOPER_TOOLS ?? "false",
    AUTOMATIC_TRADING_ENABLED: process.env.AUTOMATIC_TRADING_ENABLED ?? "false",
  },
};

export default nextConfig;
