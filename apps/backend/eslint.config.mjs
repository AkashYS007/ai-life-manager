// Real backend lint quality gate, replacing the long-standing placeholder
// script ("echo '(lint placeholder...)'", flagged as an open gap since the
// architecture audit and re-confirmed in the deployment-maturity pass).
//
// Deliberately using `tseslint.configs.recommended` (non type-checked)
// rather than `recommendedTypeChecked`: this sandbox's `prisma generate` is
// network-blocked (see Update 59), so `@prisma/client` falls back to an
// untyped `any` stub here — a type-aware lint config would produce a wall
// of `@typescript-eslint/no-unsafe-*` findings that are purely an artifact
// of that missing codegen, not real code issues. A real `prisma generate`
// (Railway's build, or any properly-networked machine) can safely upgrade
// this to `recommendedTypeChecked` later without changing anything else
// here.
// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
    },
  },
  {
    rules: {
      // This codebase relies heavily on Prisma's generated types and on
      // `any` at a handful of deliberate integration boundaries (raw
      // webhook payloads, third-party SDK responses) — banning it outright
      // would force a much larger refactor than a lint-gate rollout
      // should carry. Left on as a warning so it's visible, not silently
      // permitted.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // NestJS decorators (@Injectable, @Module, etc.) are classes used
      // only for their side effects/metadata — this rule otherwise flags
      // every one of them as an unused expression.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
