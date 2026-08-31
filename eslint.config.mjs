import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "vendor/**",
    "**/._*",
    // Verbatim Hypercolor wire copies — drift-gated, not style-gated.
    "src/db/sql.ts",
    "src/db/schema.ts",
    "src/db/migrations.ts",
    "src/types/**",
    "src/flags/**",
    "src/stores/**",
    "src/services/NexusClient.ts",
    "src/services/StorageService.ts",
    "src/services/backup/snapshot.ts",
    "src/services/group/groupEvents.ts",
    "src/services/group/applyGroupInbound.ts",
    "src/services/attachments/applyAttachmentInbound.ts",
    "src/services/attachments/redaction.ts",
    "src/services/payments/applyPaymentInbound.ts",
    "src/services/link/inboundEnvelope.ts",
    "src/services/link/wotGate.ts",
    "src/services/payments/endpointValidation.ts",
    "src/utils/bolt11.ts",
    "src/utils/displaySanitize.ts",
    "src/utils/jsonDuplicateKeys.ts",
    "src/utils/onchainAddress.ts",
    "src/utils/pubkyId.ts",
    "e2e/support/vendor/**",
    "e2e/support/.vendor/**",
    ".next-playwright/**",
    "tmp/**",
  ]),
]);

export default eslintConfig;
