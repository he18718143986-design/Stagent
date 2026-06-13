export const JEST_CONFIG_BASENAME = /^jest\.config\.(js|cjs|mjs|ts|json)$/i;
export const BABEL_CONFIG_BASENAME = /^babel\.config\.(js|cjs|mjs|ts)$/i;
export const TSCONFIG_BASENAME = /^tsconfig(\.[a-z0-9_-]+)?\.json$/i;
export const EXPO_ENTRY_BASENAME = /^App\.(tsx|jsx)$/i;

export const EXPO_STACK_HINT =
  /\b(expo|jest-expo|react-native|@react-native|expo-av|expo-router)\b/i;
