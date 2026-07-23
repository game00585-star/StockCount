import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
export default tseslint.config(
  {ignores:['dist','coverage']}, js.configs.recommended, ...tseslint.configs.recommended,
  {files:['**/*.{ts,tsx}'],languageOptions:{ecmaVersion:2022,globals:globals.browser},plugins:{'react-hooks':reactHooks,'react-refresh':reactRefresh},rules:{...reactHooks.configs.recommended.rules,'react-hooks/immutability':'off','react-hooks/exhaustive-deps':'off','react-refresh/only-export-components':'off','@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':'off','no-unused-vars':'off','prefer-const':'off'}}
);
