import { isWeakStrength, type PasswordStrength } from "../password-strength";
import type { CredentialRecord } from "../types";
import { translate } from "../i18n";
import { isCredentialItem, daysBetween, getCredentialPasswordChangedAt, getPasswordExpiryInfo } from "./credentials";

export type DiagnosticFilter =
  | "all"
  | "weak"
  | "reused"
  | "old"
  | "expired"
  | "expiring"
  | "missingTotp"
  | "incomplete";

export type DiagnosticIssue = Exclude<DiagnosticFilter, "all">;

export type QuickVaultFilter =
  | "all"
  | "favorites"
  | "weak"
  | "reused"
  | "old"
  | "expired"
  | "expiring"
  | "missingTotp"
  | "incomplete"
  | "withTags";

export const DIAGNOSTIC_QUICK_FILTERS: DiagnosticIssue[] = [
  "weak",
  "reused",
  "old",
  "expired",
  "expiring",
  "missingTotp",
  "incomplete",
];

export function isDiagnosticQuickFilter(filter: QuickVaultFilter): filter is DiagnosticIssue {
  return DIAGNOSTIC_QUICK_FILTERS.includes(filter as DiagnosticIssue);
}

export type AssistantActionKind = "addTotp" | "changePassword" | "reviewPassword" | "completeCredential";

export type AssistantAction = {
  id: string;
  credential: CredentialRecord;
  issue: DiagnosticIssue;
  priority: number;
  tone: "danger" | "warning" | "neutral";
  kind: AssistantActionKind;
};

export type AssistantTagSuggestion = {
  id: string;
  credential: CredentialRecord;
  tag: string;
  priority: number;
};

export const ASSISTANT_ISSUE_PRIORITY: Record<DiagnosticIssue, number> = {
  reused: 120,
  expired: 112,
  weak: 104,
  missingTotp: 92,
  expiring: 76,
  old: 68,
  incomplete: 54,
};

export function getAssistantIssueTone(issue: DiagnosticIssue): "danger" | "warning" | "neutral" {
  if (issue === "reused" || issue === "expired") return "danger";
  if (issue === "weak" || issue === "missingTotp" || issue === "expiring") return "warning";
  return "neutral";
}

export function getAssistantActionKind(issue: DiagnosticIssue): AssistantActionKind {
  if (issue === "missingTotp") return "addTotp";
  if (issue === "incomplete") return "completeCredential";
  if (issue === "weak" || issue === "reused" || issue === "expired") return "changePassword";
  return "reviewPassword";
}

export function getCredentialImportanceScore(credential: CredentialRecord) {
  const haystack = `${credential.title} ${credential.url} ${credential.category}`.toLowerCase();
  let score = 0;

  if (credential.favorite) score += 22;
  if (["Banco", "E-mail", "Sistema"].includes(credential.category)) score += 16;
  if (/bank|banco|nubank|itau|itaú|bradesco|santander|caixa|inter|finance|pay|paypal|wise|binance|mercado\s*pago/.test(haystack)) score += 18;
  if (/mail|gmail|outlook|hotmail|proton|icloud|email|e-mail/.test(haystack)) score += 15;
  if (/github|gitlab|vercel|cloudflare|aws|azure|google|microsoft|admin|root|sistema/.test(haystack)) score += 14;

  return score;
}

export function inferCredentialTag(credential: CredentialRecord) {
  const haystack = `${credential.title} ${credential.url} ${credential.category}`.toLowerCase();

  if (/bank|banco|nubank|itau|itaú|bradesco|santander|caixa|inter|finance|pay|paypal|wise|binance|mercado\s*pago/.test(haystack)) return "banco";
  if (/mail|gmail|outlook|hotmail|proton|icloud|email|e-mail/.test(haystack)) return "email";
  if (/github|gitlab|vercel|cloudflare|aws|azure|docker|npm|dev|deploy|código|codigo|code/.test(haystack)) return "desenvolvimento";
  if (/amazon|mercado\s*livre|shop|loja|compra|compras|aliexpress|shopee|magazine|magalu/.test(haystack)) return "compras";
  if (/netflix|spotify|disney|prime|hbo|max|stream|youtube|twitch/.test(haystack)) return "streaming";
  if (/instagram|facebook|linkedin|twitter|x\.com|tiktok|social/.test(haystack)) return "social";
  if (/slack|teams|zoom|work|trabalho|empresa|corp/.test(haystack)) return "trabalho";
  if (credential.favorite) return "importante";

  return "revisar";
}

export const OLD_PASSWORD_DAYS = 180;

export type DiagnosticGuidance = {
  explanation: string;
  action: string;
};

export const DIAGNOSTIC_GUIDANCE_KEYS: Partial<Record<DiagnosticIssue, DiagnosticGuidance>> = {
  weak: {
    explanation: "diagnostic.guidance.weak.explanation",
    action: "diagnostic.guidance.weak.action",
  },
  reused: {
    explanation: "diagnostic.guidance.reused.explanation",
    action: "diagnostic.guidance.reused.action",
  },
  old: {
    explanation: "diagnostic.guidance.old.explanation",
    action: "diagnostic.guidance.old.action",
  },
  expired: {
    explanation: "diagnostic.guidance.expired.explanation",
    action: "diagnostic.guidance.expired.action",
  },
  expiring: {
    explanation: "diagnostic.guidance.expiring.explanation",
    action: "diagnostic.guidance.expiring.action",
  },
  missingTotp: {
    explanation: "diagnostic.guidance.missingTotp.explanation",
    action: "diagnostic.guidance.missingTotp.action",
  },
  incomplete: {
    explanation: "diagnostic.guidance.incomplete.explanation",
    action: "diagnostic.guidance.incomplete.action",
  },
};

export function getVaultIssueGuidance(
  issue: DiagnosticIssue,
  translateText: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => string,
) {
  const guidance = DIAGNOSTIC_GUIDANCE_KEYS[issue] ?? {
    explanation: "diagnostic.guidance.generic.explanation",
    action: "diagnostic.guidance.generic.action",
  };
  const values = issue === "old" ? { days: OLD_PASSWORD_DAYS } : undefined;

  return {
    explanation: translateText(guidance.explanation, values),
    action: translateText(guidance.action, values),
  };
}

export function getCredentialDiagnosticIssues(
  credential: CredentialRecord,
  passwordCounts: Map<string, number>,
  // Resultado da analise assincrona de forca. `null` significa "ainda nao
  // analisada": nesse caso a credencial nao e marcada como fraca, para nao
  // inventar um veredito antes de o worker responder.
  strength: PasswordStrength | null,
): DiagnosticIssue[] {
  if (!isCredentialItem(credential)) return [];

  const issues: DiagnosticIssue[] = [];
  const normalizedPassword = credential.password.trim();
  const expiryInfo = getPasswordExpiryInfo(credential);

  if (!normalizedPassword || isWeakStrength(strength)) {
    issues.push("weak");
  }

  if (normalizedPassword && (passwordCounts.get(normalizedPassword) ?? 0) > 1) {
    issues.push("reused");
  }

  if (expiryInfo.status === "expired") {
    issues.push("expired");
  } else if (expiryInfo.status === "soon") {
    issues.push("expiring");
  }

  if (daysBetween(getCredentialPasswordChangedAt(credential)) >= OLD_PASSWORD_DAYS) {
    issues.push("old");
  }

  if (!credential.totpSecret?.trim()) {
    issues.push("missingTotp");
  }

  if (!credential.url.trim() || !credential.username.trim()) {
    issues.push("incomplete");
  }

  return issues;
}

export function getVaultHealthTone(score: number) {
  if (score >= 85) return "safe";
  if (score >= 70) return "good";
  if (score >= 50) return "warning";
  return "danger";
}

export function getVaultHealthScore(issueCounts: Record<DiagnosticIssue, number>) {
  const penalties =
    issueCounts.expired * 12 +
    issueCounts.reused * 10 +
    issueCounts.weak * 8 +
    issueCounts.expiring * 5 +
    issueCounts.old * 4 +
    issueCounts.missingTotp * 3 +
    issueCounts.incomplete * 2;

  return Math.max(0, Math.min(100, 100 - penalties));
}
