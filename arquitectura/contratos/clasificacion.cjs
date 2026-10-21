/**
 * Clasificación de rutas del guardián de contratos (contratos-arquitectonicos.md §2.2).
 *
 * Toda ruta versionada cae en EXACTAMENTE una clase. Las reglas se agrupan en NIVELES de prioridad:
 * el primer nivel (de arriba hacia abajo) que tiene alguna regla que calza decide; dentro de ese
 * nivel, si las reglas que calzan dan clases distintas la ruta es ambigua y FALLA. Una ruta que no
 * calza con ningún nivel FALLA: nunca se ignora.
 *
 * Los módulos de `src/modulos/` y las carpetas de `src/` y `apps/` se listan UNO POR UNO a propósito:
 * un directorio nuevo no se clasifica solo, obliga a decidir su clase (y a declarar sus contratos).
 * Para sumar una unidad nueva se agrega su línea acá y se crea su `contratos.json`.
 *
 * Clases que no se analizan: `generado` y `docs`. Esa exclusión NO está implícita en esta tabla:
 * vive en `exclusiones.json`, con motivo, responsable, aprobación y vencimiento, y sale en el informe.
 */
const { compilar } = require("./globs.cjs");

const CLASES = Object.freeze([
  "frontend",
  "backend",
  "migraciones",
  "scripts",
  "workers",
  "generado",
  "docs",
  "config",
  "pruebas",
]);

/** Las únicas clases que se pueden excluir del análisis. Excluir otra (p. ej. backend) es inválido. */
const CLASES_EXCLUIBLES = Object.freeze(["generado", "docs"]);

/**
 * Clases que este repositorio TIENE que tener con archivos. Si una queda en cero el guardián falla:
 * es la diferencia entre «pasó» y «no encontró nada que mirar». `workers` no está: todavía no existe.
 */
const CLASES_ESPERADAS = Object.freeze([
  "frontend",
  "backend",
  "migraciones",
  "scripts",
  "generado",
  "docs",
  "config",
  "pruebas",
]);

const MODULOS_DE_NEGOCIO = ["empresas", "fiscal", "identidad", "marcas", "planes", "tenants"];
const GRUPOS_DE_SRC = [
  "adaptadores",
  "capacidades",
  "composicion",
  "consultas-de-grupo",
  "contexto",
  "plataforma",
  "primitivas",
  "puertos",
];
const ARCHIVOS_DE_LA_RAIZ = [
  ".dependency-cruiser.cjs",
  ".gitignore",
  ".gitleaks.toml",
  ".prettierignore",
  ".prettierrc.json",
  "eslint.config.js",
  "knip.json",
  "neon.ts",
  "package.json",
  "stryker.config.json",
  "tsconfig.json",
  "vitest.config.ts",
];

/** @typedef {{ clase: string, glob: string }} Regla */
/** @typedef {{ nombre: string, reglas: Regla[] }} Nivel */

/** @type {Nivel[]} */
const NIVELES = [
  {
    nombre: "Documentación y archivos generados",
    reglas: [
      { clase: "generado", glob: "package-lock.json" },
      { clase: "generado", glob: "skills-lock.json" },
      { clase: "docs", glob: "**/*.md" },
      { clase: "docs", glob: ".claude/**" },
    ],
  },
  {
    nombre: "Declaración de contratos de cada unidad",
    reglas: [
      { clase: "config", glob: "src/modulos/*/contratos.json" },
      { clase: "config", glob: "src/*/contratos.json" },
      { clase: "config", glob: "apps/*/contratos.json" },
      { clase: "config", glob: "scripts/contratos.json" },
      { clase: "config", glob: "migraciones/contratos.json" },
      { clase: "config", glob: "workers/contratos.json" },
    ],
  },
  {
    nombre: "Pruebas y sus insumos",
    reglas: [
      { clase: "pruebas", glob: "**/*.test.ts" },
      { clase: "pruebas", glob: "**/*.test.tsx" },
      { clase: "pruebas", glob: "**/golden/**" },
      { clase: "pruebas", glob: "test/**" },
    ],
  },
  {
    nombre: "Migraciones, scripts y workers",
    reglas: [
      { clase: "migraciones", glob: "migraciones/**" },
      { clase: "scripts", glob: "scripts/**" },
      { clase: "workers", glob: "workers/**" },
    ],
  },
  {
    nombre: "Servidor dentro de las apps",
    reglas: [
      { clase: "backend", glob: "apps/web/servidor/**" },
      { clase: "backend", glob: "apps/web/proxy.ts" },
      { clase: "backend", glob: "apps/web/app/**/route.ts" },
      { clase: "backend", glob: "apps/web/app/**/acciones.ts" },
      { clase: "backend", glob: "apps/plataforma/servidor/**" },
      { clase: "backend", glob: "apps/plataforma/proxy.ts" },
      { clase: "backend", glob: "apps/plataforma/app/**/route.ts" },
      { clase: "backend", glob: "apps/plataforma/app/**/acciones.ts" },
    ],
  },
  {
    nombre: "Aplicación web",
    reglas: [
      { clase: "frontend", glob: "apps/web/app/**" },
      { clase: "frontend", glob: "apps/web/pantallas/**" },
      { clase: "frontend", glob: "apps/web/ui/**" },
      { clase: "config", glob: "apps/web/next.config.ts" },
      { clase: "config", glob: "apps/web/package.json" },
      { clase: "config", glob: "apps/web/tsconfig.json" },
      { clase: "config", glob: "apps/web/vercel.json" },
      { clase: "frontend", glob: "apps/plataforma/app/**" },
      { clase: "frontend", glob: "apps/plataforma/pantallas/**" },
      // Lógica pura de las pantallas (sin servidor ni framework): es parte del frontend.
      { clase: "frontend", glob: "apps/plataforma/logica/**" },
      { clase: "config", glob: "apps/plataforma/next.config.ts" },
      { clase: "config", glob: "apps/plataforma/package.json" },
      { clase: "config", glob: "apps/plataforma/tsconfig.json" },
      { clase: "config", glob: "apps/plataforma/vercel.json" },
    ],
  },
  {
    nombre: "Código fuente de src",
    reglas: [
      ...GRUPOS_DE_SRC.map((grupo) => ({ clase: "backend", glob: `src/${grupo}/**` })),
      ...MODULOS_DE_NEGOCIO.map((modulo) => ({
        clase: "backend",
        glob: `src/modulos/${modulo}/**`,
      })),
    ],
  },
  {
    nombre: "Configuración y herramientas del repositorio",
    reglas: [
      { clase: "config", glob: "arquitectura/**" },
      { clase: "config", glob: ".github/**" },
      ...ARCHIVOS_DE_LA_RAIZ.map((archivo) => ({ clase: "config", glob: archivo })),
    ],
  },
];

const ARCHIVO_DE_REGLAS = "arquitectura/contratos/clasificacion.cjs";

/**
 * Compila los niveles y devuelve los problemas de forma (clase inexistente, glob inválido). Una
 * tabla de reglas inválida hace fallar todo el guardián: no se clasifica con una tabla rota.
 */
function compilarNiveles(niveles) {
  const problemas = [];
  const compilados = niveles.map((nivel, indice) => ({
    nombre: nivel.nombre,
    indice: indice + 1,
    reglas: nivel.reglas.map((regla) => {
      let expresion = null;
      if (!CLASES.includes(regla.clase)) {
        problemas.push(
          `nivel ${indice + 1}: la clase «${regla.clase}» no existe (${CLASES.join(", ")})`,
        );
      }
      try {
        expresion = compilar(regla.glob);
      } catch (error) {
        problemas.push(`nivel ${indice + 1}: ${error.message}`);
      }
      return { clase: regla.clase, glob: regla.glob, expresion, coincidencias: 0 };
    }),
  }));
  return { compilados, problemas };
}

/**
 * Clasifica las rutas. Devuelve la clase de cada una, las rutas por clase, cuántas rutas calzó cada
 * regla (evidencia para el informe) y las fallas.
 *
 * @param {string[]} rutas Rutas versionadas, relativas a la raíz.
 * @param {{ niveles?: Nivel[] }} [opciones]
 */
function clasificar(rutas, opciones = {}) {
  const niveles = opciones.niveles ?? NIVELES;
  const fallas = [];
  const { compilados, problemas } = compilarNiveles(niveles);
  for (const problema of problemas) {
    fallas.push({
      codigo: "regla-de-clasificacion-invalida",
      archivo: ARCHIVO_DE_REGLAS,
      contrato: null,
      motivo: `La tabla de clasificación es inválida: ${problema}.`,
      correccion: "Corregí la regla en la tabla de clasificación.",
    });
  }
  const porRuta = new Map();
  const porClase = Object.fromEntries(CLASES.map((clase) => [clase, []]));
  if (problemas.length > 0) {
    return { porRuta, porClase, reglas: describirReglas(compilados), fallas };
  }

  for (const ruta of [...rutas].sort()) {
    let decidida = false;
    for (const nivel of compilados) {
      const calzan = nivel.reglas.filter((regla) => regla.expresion.test(ruta));
      if (calzan.length === 0) continue;
      for (const regla of calzan) regla.coincidencias += 1;
      const clases = [...new Set(calzan.map((regla) => regla.clase))];
      if (clases.length > 1) {
        fallas.push({
          codigo: "clasificacion-ambigua",
          archivo: ruta,
          contrato: null,
          motivo: `La ruta cae en ${clases.join(" y ")} a la vez dentro del nivel «${nivel.nombre}» (${calzan
            .map((regla) => regla.glob)
            .join(", ")}).`,
          correccion: `Separá las reglas en niveles distintos o corregí el glob en ${ARCHIVO_DE_REGLAS}.`,
        });
      } else {
        porRuta.set(ruta, clases[0]);
        porClase[clases[0]].push(ruta);
      }
      decidida = true;
      break;
    }
    if (!decidida) {
      fallas.push({
        codigo: "ruta-sin-clase",
        archivo: ruta,
        contrato: null,
        motivo:
          "La ruta versionada no calza con ninguna clase (frontend, backend, migraciones, scripts, workers, generado, docs, config, pruebas).",
        correccion: `Agregá su regla de clasificación en ${ARCHIVO_DE_REGLAS}; una ruta sin clase no se ignora.`,
      });
    }
  }
  return { porRuta, porClase, reglas: describirReglas(compilados), fallas };
}

/** Las reglas con la cantidad de rutas que calzaron: evidencia de qué se ejecutó. */
function describirReglas(compilados) {
  return compilados.flatMap((nivel) =>
    nivel.reglas.map((regla) => ({
      nivel: nivel.indice,
      nombreDelNivel: nivel.nombre,
      clase: regla.clase,
      glob: regla.glob,
      rutas: regla.coincidencias,
    })),
  );
}

module.exports = {
  CLASES,
  CLASES_EXCLUIBLES,
  CLASES_ESPERADAS,
  NIVELES,
  ARCHIVO_DE_REGLAS,
  clasificar,
};
