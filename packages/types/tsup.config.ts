import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // The shared tsconfig sets `incremental`, which the declaration bundler
  // cannot honour (TS5074). Declarations are single-file here, so it is off.
  dts: { compilerOptions: { incremental: false } },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
