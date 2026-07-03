const analysisSchema = {
  type: "object",
  required: [
    "summary_original",
    "summary_ko",
    "terms",
    "full_text_translation_ko",
    "follow_up_questions_original",
    "follow_up_questions_ko"
  ],
  properties: {
    summary_original: { type: "string" },
    summary_ko: { type: "string" },
    terms: {
      type: "array",
      items: {
        type: "object",
        required: ["term", "definition_original", "definition_ko"],
        properties: {
          term: { type: "string" },
          definition_original: { type: "string" },
          definition_ko: { type: "string" }
        }
      }
    },
    full_text_translation_ko: { type: "string" },
    translation_ko: { type: "string" },
    follow_up_questions_original: { type: "array", items: { type: "string" } },
    follow_up_questions_ko: { type: "array", items: { type: "string" } },
    follow_up_questions: { type: "array", items: { type: "string" } },
    sources: { type: "array" }
  }
};

const selectionExplainSchema = {
  type: "object",
  required: ["explanation_original", "explanation_ko", "terms", "translation_ko", "follow_up_questions"],
  properties: {
    explanation_original: { type: "string" },
    explanation_ko: { type: "string" },
    terms: {
      type: "array",
      items: {
        type: "object",
        required: ["term", "definition_original", "definition_ko"],
        properties: {
          term: { type: "string" },
          definition_original: { type: "string" },
          definition_ko: { type: "string" }
        }
      }
    },
    translation_ko: { type: "string" },
    follow_up_questions: { type: "array", items: { type: "string" } }
  }
};

const factCheckSchema = {
  type: "object",
  required: ["claim", "verdict", "explanation_ko", "sources", "caveats", "confidence"],
  properties: {
    claim: { type: "string" },
    verdict: { enum: ["supported", "contradicted", "unclear", "not_checkable"] },
    explanation_ko: { type: "string" },
    sources: { type: "array" },
    caveats: { type: "array", items: { type: "string" } },
    confidence: { enum: ["high", "medium", "low"] }
  }
};

const followUpAnswerSchema = {
  type: "object",
  required: ["question", "answer", "sources", "caveats"],
  properties: {
    question: { type: "string" },
    answer: { type: "string" },
    sources: { type: "array" },
    caveats: { type: "array", items: { type: "string" } }
  }
};

function hasRequiredShape(value, schemaName) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (schemaName === "fact_check") {
    return factCheckSchema.required.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  if (schemaName === "selection_explain") {
    return selectionExplainSchema.required.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  if (schemaName === "follow_up_answer") {
    return followUpAnswerSchema.required.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  }

  return analysisSchema.required.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

module.exports = {
  analysisSchema,
  selectionExplainSchema,
  factCheckSchema,
  followUpAnswerSchema,
  hasRequiredShape
};
