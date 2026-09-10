import { CONFIDENCE_WEIGHTS, ROUTING_THRESHOLDS } from "@/lib/config";
import type { RoutingStatus } from "@/lib/db/schema";
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

export function agreementScore(agreement: VerifyOutcome["agreement"]): number {
  return agreement === "same" ? 1 : agreement === "equivalent_formatting" ? 0.75 : 0;
}

export function specificityScore(s: VerifyOutcome["specificity"]): number {
  return s === "direct" ? 1 : s === "contextual" ? 0.75 : s === "weak" ? 0.4 : 0;
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
 * Code, not a model, decides the final confidence and routing. Thresholds:
 *  auto-approve  >= 0.86 and no contradiction
 *  review        0.65 <= c < 0.86, or verifier partially supported
 *  blocked       c < 0.65, or unsupported / contradiction / nonexistent evidence
 */
export function scoreField(validation: FieldValidation, verify: VerifyOutcome, required: boolean, valueEmpty: boolean): ScoredField {
  const components: ConfidenceComponents = {
    evidence_exact_match: validation.evidenceExactMatch,
    deterministic_validation: validation.deterministicScore,
    verifier_support: verifierSupportScore(verify.status),
    cross_pass_agreement: agreementScore(verify.agreement),
    evidence_specificity: specificityScore(verify.specificity),
  };
  const confidence = combine(components);
  const reasons: string[] = [];
  let routing: ScoredField["routing"];
  if (!validation.locatorExists) {
    routing = "blocked";
    reasons.push("cited evidence locator does not exist");
  } else if (verify.status === "unsupported") {
    routing = "blocked";
    reasons.push("verifier found the value unsupported");
  } else if (verify.contradiction) {
    routing = "blocked";
    reasons.push("verifier detected a contradiction in the source");
  } else if (required && valueEmpty) {
    routing = "blocked";
    reasons.push("required field is empty");
  } else if (confidence < ROUTING_THRESHOLDS.review) {
    routing = "blocked";
    reasons.push(`confidence ${confidence.toFixed(2)} below ${ROUTING_THRESHOLDS.review}`);
  } else if (verify.status === "partially_supported") {
    routing = "review";
    reasons.push("verifier found the value only partially supported");
  } else if (confidence < ROUTING_THRESHOLDS.autoApprove) {
    routing = "review";
    reasons.push(`confidence ${confidence.toFixed(2)} below auto-approval threshold ${ROUTING_THRESHOLDS.autoApprove}`);
  } else {
    routing = "auto_approved";
    reasons.push("all checks passed");
  }
  if (validation.evidenceExactMatch === 0 && validation.locatorExists) reasons.push("quote not found verbatim in source");
  const failing = validation.messages.filter((m) => m.level === "error").map((m) => m.code);
  if (failing.length) reasons.push(`validation errors: ${failing.join(", ")}`);
  return { fieldPath: validation.fieldPath, confidence, components, routing, reason: reasons.join("; "), contradiction: verify.contradiction };
}
