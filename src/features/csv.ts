import type { CredentialCategory, CredentialRecord, VaultItemType, PlainVault } from "../types";
import { parseTotpCandidate, normalizeTotpSecret, isStandardTotp } from "./totp";
import { normalizeCredentialTags, getCredentialTags, getItemType, getActiveCredentials } from "./credentials";
import { createId } from "../lib/id";
import { normalizeUrl } from "../lib/url";

export function escapeCsvValue(value: unknown) {
  const text = String(value ?? "");

  if (/[",\r\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function buildCsv(items: CredentialRecord[]) {
  const headers = [
    "type",
    "title",
    "category",
    "tags",
    "favorite",
    "username",
    "password",
    "url",
    "notes",
    "totpIssuer",
    "totpSecret",
    "cardholderName",
    "cardNumber",
    "cardExpiry",
    "cardCvv",
    "cardIssuer",
    "identityFullName",
    "identityDocument",
    "identityEmail",
    "identityPhone",
    "identityAddress",
    "licenseProduct",
    "licenseKey",
    "licenseOwner",
    "licenseExpiresAt",
    "apiProvider",
    "apiIdentifier",
    "passwordChangedAt",
    "passwordExpiresInDays",
    "passwordExpiryNoticeDays",
    "createdAt",
    "updatedAt",
  ];

  const rows = items.map((item) =>
    headers.map((header) => escapeCsvValue(header === "type" ? getItemType(item) : header === "tags" ? getCredentialTags(item).join("; ") : (item as unknown as Record<string, unknown>)[header])).join(","),
  );

  return [headers.join(","), ...rows].join("\r\n");
}

export function normalizeCsvHeader(header: string) {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type ParsedCsvRow = {
  lineNumber: number;
  values: Record<string, string>;
};

export type ParsedCsvDocument = {
  headers: string[];
  rows: ParsedCsvRow[];
};

export type CsvImportFieldKey =
  | "type"
  | "title"
  | "category"
  | "tags"
  | "favorite"
  | "username"
  | "password"
  | "url"
  | "notes"
  | "totpIssuer"
  | "totpSecret";

export type CsvImportMapping = Record<CsvImportFieldKey, string>;

export type CsvImportPreview = ParsedCsvDocument & {
  filename: string;
  mapping: CsvImportMapping;
};

export type CsvImportPreviewItem = {
  id: string;
  lineNumber: number;
  credential: CredentialRecord;
  errors: string[];
  warnings: string[];
  duplicateTitle?: string;
};

export type CsvImportAnalysis = {
  items: CsvImportPreviewItem[];
  validItems: CsvImportPreviewItem[];
  importableItems: CsvImportPreviewItem[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
};

export const CSV_IMPORT_FIELD_ALIASES: Record<CsvImportFieldKey, string[]> = {
  type: ["type", "tipo", "itemtype", "item_type", "kind"],
  title: ["title", "name", "nome", "titulo", "título", "site", "servico", "serviço"],
  category: ["category", "categoria", "folder", "pasta", "grupo"],
  tags: ["tags", "tag", "etiquetas", "marcadores", "labels", "rotulos", "rótulos"],
  favorite: ["favorite", "favorito", "starred", "favorita"],
  username: ["username", "user", "login", "email", "e-mail", "usuario", "usuário"],
  password: ["password", "senha", "pass", "secret"],
  url: ["url", "site", "website", "link", "uri"],
  notes: ["notes", "nota", "notas", "observacoes", "observações", "content", "conteudo", "conteúdo", "comments"],
  totpIssuer: ["totpissuer", "totp_issuer", "issuer", "emissor"],
  totpSecret: ["totpsecret", "totp_secret", "otp", "2fa", "mfa", "segredo_totp", "otpauth"],
};

export const CSV_IMPORT_FIELDS: Array<{ key: CsvImportFieldKey; labelKey: string }> = [
  { key: "title", labelKey: "import.field.title" },
  { key: "username", labelKey: "import.field.username" },
  { key: "password", labelKey: "import.field.password" },
  { key: "url", labelKey: "import.field.url" },
  { key: "notes", labelKey: "import.field.notes" },
  { key: "category", labelKey: "import.field.category" },
  { key: "tags", labelKey: "import.field.tags" },
  { key: "type", labelKey: "import.field.type" },
  { key: "favorite", labelKey: "import.field.favorite" },
  { key: "totpIssuer", labelKey: "import.field.totpIssuer" },
  { key: "totpSecret", labelKey: "import.field.totpSecret" },
];

export function getEmptyCsvImportMapping(): CsvImportMapping {
  return {
    type: "",
    title: "",
    category: "",
    tags: "",
    favorite: "",
    username: "",
    password: "",
    url: "",
    notes: "",
    totpIssuer: "",
    totpSecret: "",
  };
}

export function parseCsvRecords(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: Array<{ lineNumber: number; values: string[] }> = [];
  let values: string[] = [];
  let current = "";
  let quoted = false;
  let lineNumber = 1;
  let recordLineNumber = 1;
  let hasContent = false;

  function pushRecord() {
    const nextValues = [...values, current.trim()];
    const isBlank = nextValues.every((value) => value.trim().length === 0);

    if (!isBlank || hasContent) {
      records.push({ lineNumber: recordLineNumber, values: nextValues });
    }

    values = [];
    current = "";
    hasContent = false;
    recordLineNumber = lineNumber + 1;
  }

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      hasContent = true;
      continue;
    }

    if ((character === "," || character === ";") && !quoted) {
      values.push(current.trim());
      current = "";
      hasContent = true;
      continue;
    }

    if (character === "\n" && !quoted) {
      pushRecord();
      lineNumber += 1;
      continue;
    }

    if (character === "\n") {
      lineNumber += 1;
    }

    current += character;
    if (character.trim().length > 0) {
      hasContent = true;
    }
  }

  if (quoted) {
    values.push(current.trim());
    records.push({ lineNumber: recordLineNumber, values });
    return records;
  }

  if (current.length > 0 || values.length > 0 || hasContent) {
    pushRecord();
  }

  return records;
}

export function parseCsvDocument(text: string): ParsedCsvDocument {
  const records = parseCsvRecords(text);

  if (records.length < 2) {
    return { headers: [], rows: [] };
  }

  const headers = records[0].values
    .map((header) => normalizeCsvHeader(header))
    .filter(Boolean);

  if (headers.length === 0) {
    return { headers: [], rows: [] };
  }

  const rows = records.slice(1).map(({ values, lineNumber }) => {
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });

    return { lineNumber, values: row };
  });

  return { headers, rows };
}

export function detectCsvImportMapping(headers: string[]): CsvImportMapping {
  const mapping = getEmptyCsvImportMapping();

  for (const field of CSV_IMPORT_FIELDS) {
    const aliases = CSV_IMPORT_FIELD_ALIASES[field.key].map(normalizeCsvHeader);
    mapping[field.key] = headers.find((header) => aliases.includes(header)) ?? "";
  }

  return mapping;
}

export function getCsvValue(row: Record<string, string>, aliases: string[], mappingHeader = "") {
  if (mappingHeader) {
    const mappedValue = row[normalizeCsvHeader(mappingHeader)];
    if (mappedValue) return mappedValue;
  }

  for (const alias of aliases) {
    const value = row[normalizeCsvHeader(alias)];

    if (value) return value;
  }

  return "";
}

export function getMappedCsvValue(row: Record<string, string>, field: CsvImportFieldKey, mapping: CsvImportMapping) {
  return getCsvValue(row, CSV_IMPORT_FIELD_ALIASES[field], mapping[field]);
}

export function normalizeImportedItemType(value: string): VaultItemType {
  const normalized = value.trim().toLowerCase();

  if (["secure_note", "secure note", "note", "nota", "nota segura"].includes(normalized)) return "secure_note";
  if (["card", "cartao", "cartão", "tarjeta"].includes(normalized)) return "card";
  if (["identity", "identidade", "identidad", "kimlik"].includes(normalized)) return "identity";
  if (["license", "licenca", "licença", "licencia", "lisans"].includes(normalized)) return "license";
  if (["api_key", "api key"].includes(normalized)) return "api_key";

  return "credential";
}

export function normalizeImportedCategory(value: string): CredentialCategory {
  const normalized = value.trim().toLowerCase();

  if (["pessoal", "personal"].includes(normalized)) return "Pessoal";
  if (["banco", "bank", "banco/bank"].includes(normalized)) return "Banco";
  if (["e-mail", "email", "mail"].includes(normalized)) return "E-mail";
  if (["sistema", "system", "sistema/system"].includes(normalized)) return "Sistema";
  if (["outro", "other", "otro", "diğer"].includes(normalized)) return "Outro";

  return "Trabalho";
}

export function parseImportedTotpFields(row: Record<string, string>, mapping: CsvImportMapping, fallbackIssuer: string) {
  const rawSecret = getMappedCsvValue(row, "totpSecret", mapping);
  const rawIssuer = getMappedCsvValue(row, "totpIssuer", mapping) || fallbackIssuer;

  if (!rawSecret.trim()) {
    return { secret: "", issuer: rawIssuer };
  }

  try {
    const parsed = parseTotpCandidate(rawSecret, rawIssuer, "manual");

    if (!isStandardTotp(parsed)) {
      return { secret: "", issuer: parsed.issuer || rawIssuer };
    }

    return { secret: parsed.secret, issuer: parsed.issuer || rawIssuer };
  } catch {
    if (/^otpauth:\/\//i.test(rawSecret.trim())) {
      return { secret: "", issuer: rawIssuer };
    }

    return { secret: normalizeTotpSecret(rawSecret), issuer: rawIssuer };
  }
}

export function importedTotpLooksUnsupported(row: Record<string, string>, mapping: CsvImportMapping) {
  const rawSecret = getMappedCsvValue(row, "totpSecret", mapping);

  if (!/^otpauth:\/\//i.test(rawSecret.trim())) return false;

  try {
    const parsed = parseTotpCandidate(rawSecret, getMappedCsvValue(row, "totpIssuer", mapping), "manual");
    return !isStandardTotp(parsed);
  } catch {
    return true;
  }
}

export function rowToImportedCredential(row: Record<string, string>, now: string, mapping = getEmptyCsvImportMapping()): CredentialRecord {
  const itemType = normalizeImportedItemType(getMappedCsvValue(row, "type", mapping));
  const title =
    getMappedCsvValue(row, "title", mapping) ||
    getMappedCsvValue(row, "url", mapping) ||
    getMappedCsvValue(row, "username", mapping) ||
    "Item importado";
  const importedTotp = itemType === "credential"
    ? parseImportedTotpFields(row, mapping, title)
    : { secret: "", issuer: "" };

  return {
    id: createId(),
    itemType,
    title: title.trim(),
    category: normalizeImportedCategory(getMappedCsvValue(row, "category", mapping)),
    tags: normalizeCredentialTags(getMappedCsvValue(row, "tags", mapping)),
    favorite: ["true", "1", "sim", "yes"].includes(getMappedCsvValue(row, "favorite", mapping).toLowerCase()),
    username: itemType === "credential" ? getMappedCsvValue(row, "username", mapping) : "",
    password: itemType === "credential" || itemType === "api_key" ? getMappedCsvValue(row, "password", mapping) : "",
    apiProvider: itemType === "api_key" ? getCsvValue(row, ["apiprovider", "provider"]) : "",
    apiIdentifier: itemType === "api_key" ? getCsvValue(row, ["apiidentifier", "identifier"]) : "",
    apiApplications: [],
    url: itemType === "credential" ? normalizeUrl(getMappedCsvValue(row, "url", mapping)) : "",
    notes: getMappedCsvValue(row, "notes", mapping),
    passwordChangedAt: getCsvValue(row, ["passwordchangedat", "password_changed_at", "alterada_em"]) || now,
    passwordExpiresInDays: Number(getCsvValue(row, ["passwordexpiresindays", "password_expires_in_days", "validade_dias"])) || 0,
    passwordExpiryNoticeDays: Number(getCsvValue(row, ["passwordexpirynoticedays", "password_expiry_notice_days", "aviso_dias"])) || 15,
    passwordHistory: [],
    attachments: [],
    totpIssuer: importedTotp.issuer,
    totpSecret: importedTotp.secret,
    cardholderName: itemType === "card" ? getCsvValue(row, ["cardholdername", "card_holder", "nome_cartao"]) : "",
    cardNumber: itemType === "card" ? getCsvValue(row, ["cardnumber", "card_number", "numero_cartao", "número_cartão"]) : "",
    cardExpiry: itemType === "card" ? getCsvValue(row, ["cardexpiry", "card_expiry", "validade_cartao"]) : "",
    cardCvv: itemType === "card" ? getCsvValue(row, ["cardcvv", "card_cvv", "cvv"]) : "",
    cardIssuer: itemType === "card" ? getCsvValue(row, ["cardissuer", "card_issuer", "banco_cartao", "emissor"]) : "",
    identityFullName: itemType === "identity" ? getCsvValue(row, ["identityfullname", "identity_full_name", "nome_completo"]) : "",
    identityDocument: itemType === "identity" ? getCsvValue(row, ["identitydocument", "identity_document", "documento"]) : "",
    identityEmail: itemType === "identity" ? getCsvValue(row, ["identityemail", "identity_email"]) : "",
    identityPhone: itemType === "identity" ? getCsvValue(row, ["identityphone", "identity_phone", "telefone"]) : "",
    identityAddress: itemType === "identity" ? getCsvValue(row, ["identityaddress", "identity_address", "endereco", "endereço"]) : "",
    licenseProduct: itemType === "license" ? getCsvValue(row, ["licenseproduct", "license_product", "produto"]) : "",
    licenseKey: itemType === "license" ? getCsvValue(row, ["licensekey", "license_key", "chave", "serial"]) : "",
    licenseOwner: itemType === "license" ? getCsvValue(row, ["licenseowner", "license_owner", "proprietario", "proprietário"]) : "",
    licenseExpiresAt: itemType === "license" ? getCsvValue(row, ["licenseexpiresat", "license_expires_at", "expira_em"]) : "",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeDuplicateValue(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function hasImportableCredentialContent(credential: CredentialRecord) {
  return Boolean(
    credential.title.trim() !== "Item importado" ||
      credential.username.trim() ||
      credential.password.trim() ||
      credential.url.trim() ||
      credential.notes.trim() ||
      credential.totpSecret?.trim(),
  );
}

export function findDuplicateCredential(candidate: CredentialRecord, existingCredentials: CredentialRecord[]) {
  const candidateUrl = normalizeDuplicateValue(candidate.url);
  const candidateUser = normalizeDuplicateValue(candidate.username);
  const candidateTitle = normalizeDuplicateValue(candidate.title);

  return existingCredentials.find((existing) => {
    const existingUrl = normalizeDuplicateValue(existing.url);
    const existingUser = normalizeDuplicateValue(existing.username);
    const existingTitle = normalizeDuplicateValue(existing.title);

    if (candidate.itemType !== (existing.itemType ?? "credential")) return false;
    if (candidateUrl && existingUrl && candidateUser && existingUser) {
      return candidateUrl === existingUrl && candidateUser === existingUser;
    }
    if (candidateTitle && existingTitle && candidateUser && existingUser) {
      return candidateTitle === existingTitle && candidateUser === existingUser;
    }
    if (candidateUrl && existingUrl && candidateTitle && existingTitle) {
      return candidateUrl === existingUrl && candidateTitle === existingTitle;
    }

    return false;
  });
}

export function analyzeCsvImport(preview: CsvImportPreview | null, vault: PlainVault | null, includeDuplicates: boolean): CsvImportAnalysis {
  if (!preview || !vault) {
    return {
      items: [],
      validItems: [],
      importableItems: [],
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
    };
  }

  const now = new Date().toISOString();
  const activeCredentials = getActiveCredentials(vault.credentials);
  const items = preview.rows.map((row) => {
    const credential = rowToImportedCredential(row.values, now, preview.mapping);
    const errors: string[] = [];
    const warnings: string[] = [];
    const duplicate = findDuplicateCredential(credential, activeCredentials);

    if (!hasImportableCredentialContent(credential)) {
      errors.push("import.validation.emptyRow");
    }

    if (credential.itemType === "credential" && !credential.password.trim()) {
      warnings.push("import.validation.missingPassword");
    }

    if (credential.itemType === "credential" && importedTotpLooksUnsupported(row.values, preview.mapping)) {
      warnings.push("import.validation.totpSkipped");
    }

    if (duplicate) {
      warnings.push("import.validation.duplicate");
    }

    return {
      id: `${row.lineNumber}-${credential.id}`,
      lineNumber: row.lineNumber,
      credential,
      errors,
      warnings,
      duplicateTitle: duplicate?.title,
    };
  });
  const validItems = items.filter((item) => item.errors.length === 0);
  const importableItems = validItems.filter((item) => includeDuplicates || !item.duplicateTitle);

  return {
    items,
    validItems,
    importableItems,
    totalRows: items.length,
    validCount: validItems.length,
    invalidCount: items.length - validItems.length,
    duplicateCount: items.filter((item) => Boolean(item.duplicateTitle)).length,
  };
}
