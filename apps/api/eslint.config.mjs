import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'max-lines': ['error', 200],
      'complexity': ['error', 10],
      'max-depth': ['error', 3],
      'no-console': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
);
