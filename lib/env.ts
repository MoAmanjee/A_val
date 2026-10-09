function read(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/**
 * Centralised, lazily evaluated environment access. Nothing in here is ever
 * imported by client components, so secrets never reach the browser bundle.
 */
export const env = {
  get nodeEnv() {
    return read("NODE_ENV", "development");
  },
  get appUrl() {
    return read("APP_URL", "http://localhost:3000");
  },
  get authSecret() {
    const s = read("AUTH_SECRET");
    if (!s || s.length < 32) {
      throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters");
    }
    return s;
  },
  get encryptionKey() {
    const s = read("ENCRYPTION_KEY");
    if (!s || s.length < 32) {
      throw new Error("ENCRYPTION_KEY must be set to a random string of at least 32 characters");
    }
    return s;
  },
  get kitchenPin() {
    return read("KITCHEN_PIN", "1234");
  },
  get openaiApiKey() {
    return read("OPENAI_API_KEY");
  },
  get openaiModel() {
    return read("OPENAI_MODEL", "gpt-4.1-mini");
  },
  get whatsappDriver() {
    return read("WHATSAPP_DRIVER", "cloud");
  },
  get whatsappGraphVersion() {
    return read("WHATSAPP_GRAPH_VERSION", "v21.0");
  },
  get whatsappPhoneNumberId() {
    return read("WHATSAPP_PHONE_NUMBER_ID");
  },
  get whatsappAccessToken() {
    return read("WHATSAPP_ACCESS_TOKEN");
  },
  get whatsappVerifyToken() {
    return read("WHATSAPP_VERIFY_TOKEN");
  },
  get whatsappAppSecret() {
    return read("WHATSAPP_APP_SECRET");
  },
  /** Local playground: take orders even outside trading hours. */
  get forceOpen() {
    return read("FORCE_OPEN", "false") === "true";
  },
};
