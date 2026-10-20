import en from "./locales/en";
import es from "./locales/es";
import pt from "./locales/pt";
import tr from "./locales/tr";

export type AppLanguage = "pt" | "en" | "es" | "tr";

export const LANGUAGES: Array<{ code: AppLanguage; label: string; shortLabel: string }> = [
  { code: "pt", label: "Português", shortLabel: "PT" },
  { code: "en", label: "English", shortLabel: "EN" },
  { code: "es", label: "Español", shortLabel: "ES" },
  { code: "tr", label: "Türkçe", shortLabel: "TR" },
];

type TranslationKey = string;
type TranslationValues = Record<string, string | number>;

// Um dicionário por idioma em src/locales. O português tem todas as chaves;
// os demais caem no inglês e depois no português quando falta tradução.
const dictionaries: Record<AppLanguage, Record<TranslationKey, string>> = { pt, en, es, tr };
const fallbacks: Record<AppLanguage, AppLanguage[]> = {
  pt: ["pt"],
  en: ["en", "pt"],
  es: ["es", "en", "pt"],
  tr: ["tr", "en", "pt"],
};

export function hasTranslation(language: AppLanguage, key: TranslationKey) {
  return fallbacks[language].some((candidate) => dictionaries[candidate][key] !== undefined);
}

const languageAliases: Record<string, AppLanguage> = {
  pt: "pt",
  "pt-br": "pt",
  en: "en",
  "en-us": "en",
  es: "es",
  "es-es": "es",
  tr: "tr",
  "tr-tr": "tr",
};

export function getInitialLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem("kpassword:language")?.toLowerCase();
    if (stored && stored in languageAliases) return languageAliases[stored];
  } catch {
    // localStorage may not be available during startup.
  }

  const browserLanguage = navigator.language.toLowerCase();
  return languageAliases[browserLanguage] ?? languageAliases[browserLanguage.split("-")[0]] ?? "pt";
}

export function translate(language: AppLanguage, key: TranslationKey, values: TranslationValues = {}) {
  let template: string = key;
  for (const candidate of fallbacks[language]) {
    const value = dictionaries[candidate][key];
    if (value !== undefined) {
      template = value;
      break;
    }
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    values[name] === undefined ? `{${name}}` : String(values[name]),
  );
}

export function getDateLocale(language: AppLanguage) {
  const locales: Record<AppLanguage, string> = {
    pt: "pt-BR",
    en: "en-US",
    es: "es-ES",
    tr: "tr-TR",
  };

  return locales[language];
}

export function getCategoryLabel(category: string, language: AppLanguage) {
  return translate(language, `category.${category}` as TranslationKey);
}

const passwordLabelKeys: Record<string, TranslationKey> = {
  "Muito fraca": "password.veryWeak",
  "Muito fraco": "password.veryWeak",
  "Fraca": "password.weak",
  "Fraco": "password.weak",
  "Média": "password.medium",
  "Médio": "password.medium",
  "Forte": "password.strong",
  "Muito forte": "password.veryStrong",
};




export function translatePasswordLabel(label: string, language: AppLanguage) {
  const key = passwordLabelKeys[label];
  return key ? translate(language, key) : label;
}

const validationIssueKeys: Record<string, TranslationKey> = {
  "Use pelo menos 12 caracteres.": "validation.minLength",
  "Inclua uma letra maiúscula.": "validation.uppercase",
  "Inclua uma letra minúscula.": "validation.lowercase",
  "Inclua um número.": "validation.number",
  "Inclua um símbolo.": "validation.symbol",
};




export function translateValidationIssue(issue: string, language: AppLanguage) {
  const key = validationIssueKeys[issue];
  return key ? translate(language, key) : issue;
}
