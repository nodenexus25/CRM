import nextConfig from '@talentflow/config/eslint/next';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
];
