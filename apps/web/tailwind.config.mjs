import preset from '@talentflow/config/tailwind/preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx,mdx}',
    './node_modules/@talentflow/ui/src/**/*.{ts,tsx}',
  ],
};
