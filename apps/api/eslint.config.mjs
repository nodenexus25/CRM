import baseConfig from '@talentflow/config/eslint/base';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // NestJS relies on decorators and dependency-injection classes.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
    },
  },
  {
    files: ['test/**/*.ts', 'prisma/seed.ts', 'prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
