const { reglas } = require("./arquitectura/reglas.cjs");

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: reglas,
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".cjs", ".mjs"],
    },
  },
};
