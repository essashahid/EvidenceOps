import { CONFIDENCE_WEIGHTS, ROUTING_THRESHOLDS } from "@/lib/config";
import type { RoutingStatus } from "@/lib/db/schema";
import { canonical } from "@/lib/text";
import { fieldKind, LIST_ITEM_KEYS, parseFieldPath, type ListField } from "@/lib/schema/report";
import type { VerifyOutcome } from "@/lib/llm/types";
import type { FieldValidation } from "./validate";

export type ConfidenceComponents = {
  evidence_exact_match: number;
  deterministic_validation: number;
  verifier_support: number;
  cross_pass_agreement: number;
  evidence_specificity: number;
};

export type ScoredField = {
  fieldPath: string;
  confidence: number;
  components: ConfidenceComponents;
  routing: Extract<RoutingStatus, "auto_approved" | "review" | "blocked">;
  reason: string;
  contradiction: boolean;
};

export function verifierSupportScore(status: VerifyOutcome["status"]): number {
  return status === "supported" ? 1 : status === "partially_supported" ? 0.5 : 0;
}

/** Snap the verifier's numeric specificity onto the four allowed levels. */
export function specificityScore(raw: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0));
}

function normalizeScalar(fieldPath: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  const kind = fieldKind(fieldPath);
  if (kind === "date") return String(v).trim();
  return typeof v === "object" ? JSON.stringify(v) : canonical(v);
}

/**
 * Cross-pass agreement between the extractor's candidate and the verifier's corrected value:
 * 1.0 exact normalized agreement; 0.75 formatting-only difference; 0.0 materially different.
 * A null corrected value with a supported/partial verdict means the verifier proposed nothing
 * different, which counts as agreement. Deterministic fields (amounts, dates) are normalized first.
 */
export function agreementScore(fieldPath: string, candidate: unknown, corrected: unknown, status: VerifyOutcome["status"]): number {
  if (corrected === null || corrected === undefined) return status === "unsupported" ? 0 : 1;
  if (JSON.stringify(candidate) === JSON.stringify(corrected)) return 1;
  if (fieldKind(fieldPath) === "item") {
    const root = parseFieldPath(fieldPath).root as ListField;
    const a = (candidate ?? {}) as Record<string, unknown>;
    const b = (typeof corrected === "object" ? corrected : {}) as Record<string, unknown>;
    let allEquivalent = true;
    for (const k of LIST_ITEM_KEYS[root]) {
      const av = a[k];
      const bv = b[k];
      if (k === "amount") {
        if (Math.abs(Number(av) - Number(bv)) > 0.5) return 0;
      } else if (k === "severity" || k === "currency") {
        if (canonical(av) !== canonical(bv)) return 0;
      } else if (canonical(av) !== canonical(bv)) {
        if (k === "context" || k === "status_if_stated" || k === "target_entity") allEquivalent = allEquivalent && (bv === null || bv === undefined || av === null || av === undefined);
        else return 0;
      }
      if (JSON.stringify(av) !== JSON.stringify(bv)) allEquivalent = allEquivalent && canonical(av) === canonical(bv);
    }
    return allEquivalent ? 0.75 : 0;
  }
  const a = normalizeScalar(fieldPath, candidate);
  const b = normalizeScalar(fieldPath, corrected);
  if (a === b) return 0.75;
  return 0;
}

export function combine(c: ConfidenceComponents): number {
  const v =
    CONFIDENCE_WEIGHTS.evidence_exact_match * c.evidence_exact_match +
    CONFIDENCE_WEIGHTS.deterministic_validation * c.deterministic_validation +
    CONFIDENCE_WEIGHTS.verifier_support * c.verifier_support +
    CONFIDENCE_WEIGHTS.cross_pass_agreement * c.cross_pass_agreement +
    CONFIDENCE_WEIGHTS.evidence_specificity * c.evidence_specificity;
  return Math.round(v * 1000) / 1000;
}

/**
 * Routing (spec section 20). Code decides; no model chooses the final confidence.
 *  auto_approved: confidence >= 0.86, no contradiction, verifier not unsupported, validation not zero
 *  review:        0.65 <= confidence < 0.86, or verifier partially supported
 *  blocked:       confidence < 0.65, unsupported, contradiction, evidence source missing, quote not found
 */
export function scoreField(validation: FieldValidation, verify: VerifyOutcome, candidate: unknown): ScoredField {
  const components: ConfidenceComponents = {
    evidence_exact_match: validation.evidenceExactMatch,
    deterministic_validation: validation.deterministicScore,
    verifier_support: verifierSupportScore(verify.status),
    cross_pass_agreement: agreementScore(validation.fieldPath, candidate, verify.correctedValue, verify.status),
    evidence_specificity: specificityScore(verify.evidenceSpecificity),
  };
  const confidence = combine(components);
  const reasons: string[] = [];
  let routing: ScoredField["routing"];
  const isNull = candidate === null || candidate === undefined;
  if (!validation.locatorsExist) {
    routing = "blocked";
    reasons.push("cited evidence source does not exist");
  } else if (verify.status === "unsupported") {
    routing = "blocked";
    reasons.push("verifier found the value unsupported");
  } else if (verify.contradictionDetected) {
    routing = "blocked";
    reasons.push("verifier detected a contradiction");
  } else if (!isNull && validation.evidenceExactMatch === 0) {
    routing = "blocked";
    reasons.push("evidence quote cannot be found in the cited source");
  } else if (confidence < ROUTING_THRESHOLDS.review) {
    routing = "blocked";
    reasons.push(`confidence ${confidence.toFixed(2)} below ${ROUTING_THRESHOLDS.review}`);
  } else if (verify.status === "partially_supported") {
    routing = "review";
    reasons.push("verifier found the value only partially supported");
  } else if (confidence < ROUTING_THRESHOLDS.autoApprove || validation.deterministicScore === 0) {
    routing = "review";
    reasons.push(validation.deterministicScore === 0 ? "deterministic validation failed" : `confidence ${confidence.toFixed(2)} below auto-approval threshold ${ROUTING_THRESHOLDS.autoApprove}`);
  } else {
    routing = "auto_approved";
    reasons.push("all checks passed");
  }
  const failing = validation.messages.filter((m) => m.level === "error").map((m) => m.code);
  if (failing.length) reasons.push(`validation errors: ${failing.join(", ")}`);
  const warnings = validation.messages.filter((m) => m.level === "warning").map((m) => m.code);
  if (warnings.length) reasons.push(`warnings: ${warnings.join(", ")}`);
  return { fieldPath: validation.fieldPath, confidence, components, routing, reason: reasons.join("; "), contradiction: verify.contradictionDetected };
}
