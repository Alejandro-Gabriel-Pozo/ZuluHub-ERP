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
const DOMINIOS = "apps/plataforma/pantallas/lista-de-dominios.cliente.tsx";
const FICHA_DE_DOMINIOS =
  "Pedernal-docs 11-especificaciones/dominio-propio-textos-y-fichas.md §2.1 (ficha «dominios», aceptada el 25/11/2026 por la delegación de la fila 174, DEC-0901)";
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
  "nombre-de-valor-de-lista": {
    ambito: "PLATAFORMA",
    // El largo y el conjunto permitido viven una vez, en el dominio de las listas (`LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR` y su lista de permitidos).
    ficha: "src/modulos/listas/dominio/valor-de-lista.ts",
    propositos: [
      {
        para: "Nombre de un valor de una lista del sistema (marcas de tarjeta), al agregarlo o corregirlo en la pantalla «Listas» de la consola; único dentro de la lista.",
        fuente:
          "Pedernal-docs 11-especificaciones/conceptos/pantalla-listas-del-sistema-marcas.md (maqueta `listas.html`, aprobada el 09/11/2026 y ajustada el 15/11: «Agregar valor» y «Editar nombre»)",
      },
    ],
    consumidores: ["apps/plataforma/pantallas/lista-de-valores.cliente.tsx"],
    ponerPor: ["listas.editar"],
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
  // «Dominios» (plan de dominio propio, P1): cada campo del alta y del retiro. El largo y el conjunto permitido de cada uno viven una vez, en el dominio de marcas.
  "host-de-dominio": {
    ambito: "PLATAFORMA",
    ficha: "src/modulos/marcas/dominio/host.ts",
    propositos: [
      {
        para: "Nombre del sitio (el host) de un dominio de empresa, al agregarlo en la pantalla «Dominios»; se normaliza y es único mientras no esté retirado.",
        fuente: FICHA_DE_DOMINIOS,
      },
    ],
    consumidores: [DOMINIOS],
    ponerPor: ["dominios.agregar"],
  },
  "empresa-del-dominio": {
    ambito: "PLATAFORMA",
    ficha: "src/plataforma/dominio/formas-de-entrada.ts",
    propositos: [
      {
        para: "Empresa dueña del dominio que se agrega (selector de la pantalla «Dominios»).",
        fuente: FICHA_DE_DOMINIOS,
      },
    ],
    consumidores: [DOMINIOS],
    ponerPor: ["dominios.agregar"],
  },
  "superficie-de-dominio": {
    ambito: "PLATAFORMA",
    ficha: "src/modulos/marcas/dominio/ciclo-de-dominio.ts",
    propositos: [
      {
        para: "Qué muestra el dominio de una empresa: la aplicación o la carta (el sitio de la empresa es de la etapa 2).",
        fuente: FICHA_DE_DOMINIOS,
      },
    ],
    consumidores: [DOMINIOS],
    ponerPor: ["dominios.agregar"],
  },
  "titular-de-dominio": {
    ambito: "PLATAFORMA",
    ficha: "src/modulos/marcas/dominio/ciclo-de-dominio.ts",
    propositos: [
      {
        para: "Quién es el titular del dominio en el registrador: el cliente o el operador.",
        fuente: FICHA_DE_DOMINIOS,
      },
    ],
    consumidores: [DOMINIOS],
    ponerPor: ["dominios.agregar"],
  },
  "motivo-de-retiro-de-dominio": {
    ambito: "PLATAFORMA",
    ficha: "src/modulos/marcas/dominio/ciclo-de-dominio.ts",
    propositos: [
      {
        para: "Motivo obligatorio (hasta 500 caracteres) al retirar un dominio; queda en el historial.",
        fuente: FICHA_DE_DOMINIOS,
      },
    ],
    consumidores: [DOMINIOS],
    ponerPor: ["dominios.retirar"],
  },
} as const satisfies Readonly<Record<string, DatoDeConsola>>;
