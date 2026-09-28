import path from 'node:path';

import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // the monorepo root, so Next does not go looking for a workspace file above the repository
  turbopack: { root: path.join(__dirname, '../..') },
};

export default config;
