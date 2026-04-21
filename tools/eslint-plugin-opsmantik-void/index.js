const PROTECTED_PIPELINE_MUTATORS = new Set([
  "reducePipelineState",
  "pipelineTransition",
  "assertTransition",
]);

const noEmptyCatchVoid = {
  meta: {
    type: "problem",
    docs: { description: "Disallow empty catch blocks on protected paths." },
    schema: [],
  },
  create(context) {
    return {
      CatchClause(node) {
        if (!node.body || node.body.body.length !== 0) return;
        context.report({
          node,
          message: "Empty catch blocks are forbidden. Handle, log, or rethrow explicitly.",
        });
      },
    };
  },
};

const noDateNowTier0 = {
  meta: {
    type: "problem",
    docs: { description: "Disallow Date.now() in Tier-0 code paths." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee &&
          node.callee.type === "MemberExpression" &&
          node.callee.object &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Date" &&
          node.callee.property &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "now"
        ) {
          context.report({
            node,
            message: "Date.now() is forbidden in protected paths. Use DB-authoritative time.",
          });
        }
      },
    };
  },
};

const pipelineStageMutationGuard = {
  meta: {
    type: "problem",
    docs: { description: "Restrict PipelineStage mutation helpers to authorized reducers." },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes("pipeline-fsm")) return {};

    function reportIfForbidden(node) {
      if (!node.callee || node.callee.type !== "Identifier") return;
      if (!PROTECTED_PIPELINE_MUTATORS.has(node.callee.name)) return;
      context.report({
        node,
        message: `Pipeline stage mutator '${node.callee.name}' is only allowed in authorized reducers.`,
      });
    }

    return {
      CallExpression: reportIfForbidden,
    };
  },
};

export default {
  rules: {
    "no-empty-catch-void": noEmptyCatchVoid,
    "no-date-now-tier0": noDateNowTier0,
    "pipeline-stage-mutation-guard": pipelineStageMutationGuard,
  },
};
