import type { DatoDeConsola, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la consola de plataforma (pantalla «Planes») del registro de datos (ver `registro.ts` y `DatoDeConsola`). Solo los piden archivos de `apps/plataforma`; los de empresa no se piden acá.
 * Fuente de todos: el brief aprobado `11-especificaciones/briefs/plataforma/PR-planes-consola.md` (§3, §6 y §10, decisiones del dueño del 19/11/2026).
 */

const EDITOR = "apps/plataforma/pantallas/editor-de-borrador.cliente.tsx";
const GRUPOS = "apps/plataforma/pantallas/grupos-del-plan.cliente.tsx";
const PUBLICAR = "apps/plataforma/pantallas/publicar-version.cliente.tsx";
const NUEVO_PLAN = "apps/plataforma/pantallas/nuevo-plan.cliente.tsx";
const POLITICA = "apps/plataforma/pantallas/politica-de-plan.cliente.tsx";
const BRIEF_H14B =
  "Pedernal-docs 11-especificaciones/briefs/escalabilidad/PR-H14b-consola-politica-de-cambio-de-plan.md";
const BRIEF = "Pedernal-docs 11-especificaciones/briefs/plataforma/PR-planes-consola.md";
const propositoDe = (para: string, seccion: string): Proposito => ({
  para,
  fuente: `${BRIEF} ${seccion}`,
});

export const DATOS_DE_PLATAFORMA = {
  "codigo-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/capacidades/planes/version-de-plan.ts",
    propositos: [
      propositoDe(
        "Código técnico del plan nuevo (diálogo «Nuevo plan»); no se cambia después.",
        "§3",
      ),
    ],
    consumidores: [NUEVO_PLAN],
    ponerPor: ["planes.crear"],
  },
  "nombre-comercial-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/capacidades/planes/version-de-plan.ts",
    propositos: [
      propositoDe("Nombre comercial de la versión en borrador (editor del borrador).", "§3"),
    ],
    consumidores: [EDITOR],
    ponerPor: ["planes.editar_borrador"],
  },
  "motivo-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/plataforma/dominio/formas-de-entrada.ts",
    propositos: [
      propositoDe("Motivo obligatorio de publicar una versión (diálogo «Publicar»).", "§3"),
    ],
    consumidores: [PUBLICAR],
    ponerPor: ["planes.publicar_version"],
  },
  "limite-de-perilla-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/capacidades/planes/valores.ts",
    propositos: [
      propositoDe("Valor de una perilla de límite que fija la versión (entero ≥ 0).", "§3"),
    ],
    consumidores: [GRUPOS],
    ponerPor: ["planes.editar_borrador"],
  },
  "modulo-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/capacidades/modulos/catalogo.ts",
    propositos: [
      propositoDe("Módulos que incluye la versión en borrador (casillas del catálogo real).", "§3"),
    ],
    consumidores: [GRUPOS],
    ponerPor: ["planes.editar_borrador"],
  },
  "perilla-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/capacidades/planes/perillas.ts",
    propositos: [
      propositoDe(
        "Interruptores que fija la versión en borrador (casillas del catálogo real).",
        "§3",
      ),
    ],
    consumidores: [GRUPOS],
    ponerPor: ["planes.editar_borrador"],
  },
  "dias-de-la-politica-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/primitivas/tiempo/dias-de-la-politica-de-plan.ts",
    propositos: [
      {
        para: "Días de anticipación de una suba, de una baja y del plazo de arrepentimiento (enteros de 0 a 365) al definir una versión nueva de la política de cambio de plan.",
        fuente: `${BRIEF_H14B} §4.2`,
      },
    ],
    consumidores: [POLITICA],
    ponerPor: ["politica_de_plan.definir"],
  },
  "motivo-de-politica-de-plan": {
    ambito: "PLATAFORMA",
    ficha: "src/plataforma/dominio/formas-de-entrada.ts",
    propositos: [
      {
        para: "Motivo obligatorio de una versión nueva de la política de cambio de plan.",
        fuente: `${BRIEF_H14B} §4.2`,
      },
    ],
    consumidores: [POLITICA],
    ponerPor: ["politica_de_plan.definir"],
  },
  "motivo-de-arrepentimiento": {
    ambito: "PLATAFORMA",
    ficha: "src/plataforma/dominio/formas-de-entrada.ts",
    propositos: [
      {
        para: "Motivo obligatorio de deshacer por arrepentimiento un cambio de plan (confirmación en «Plan de una empresa»).",
        fuente:
          "Pedernal-docs 11-especificaciones/briefs/escalabilidad/PR-H14b-consola-politica-de-cambio-de-plan.md §4.3",
      },
    ],
    consumidores: ["apps/plataforma/pantallas/arrepentimiento.cliente.tsx"],
    ponerPor: ["planes.arrepentir"],
  },
} as const satisfies Readonly<Record<string, DatoDeConsola>>;
