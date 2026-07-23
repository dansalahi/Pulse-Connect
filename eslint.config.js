import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/**"] },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps must be configured so the existing eslint-disable-next-line
      // directives throughout the codebase are not flagged as "unused".
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      // Warn on unused vars; ignore names that start with _ (intentional discard)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
