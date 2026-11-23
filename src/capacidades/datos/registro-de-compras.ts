import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la lista de compras del registro de datos (ver `registro.ts`), en su propio archivo (una línea en el registro por módulo, sin pisar a los demás): los tres campos del filtro de la
 * pantalla «Compras» (Compras PR 3). Son filtros de lectura: los pone quien puede ver las compras (`recepciones.ver`, los tres roles). La lista cerrada del estado y la validez de una fecha viven UNA vez
 * (`src/composicion/entradas-de-compras.ts` y `src/primitivas/tiempo/fecha-civil.ts`); la pantalla no copia ninguna regla: lo que no es permitido vuelve al valor por defecto en el servidor.
 */

const FORMULARIO_DE_FILTROS =
  "apps/web/ui/plantillas/compras/lista/FormularioDeFiltrosDeCompras.cliente.tsx";
const REQUIERE_COMPRAS = { modulo: "compras", estadoDeEmpresa: ["ACTIVE"] } as const;
const VER_COMPRAS = ["recepciones.ver"] as const;

const DEL_FILTRO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/briefs/compras/PR-3-lista-y-ficha-de-compra.md §4.1 punto 5 y §4.3 (chips «Todas» y «Sin facturar» y «Aplicar filtros» como el listado de facturación y el directorio, DDD:294); quién: los tres roles (recepciones.ver, DDD:247)",
});

export const DATOS_DE_COMPRAS = {
  "estado-de-compra-de-busqueda": {
    ficha: "src/composicion/entradas-de-compras.ts",
    propositos: [
      DEL_FILTRO("Estado por el que se filtra la lista de compras: todas o sin facturar."),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-desde-de-compra": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      DEL_FILTRO(
        "Fecha de negocio desde la que se listan las compras (inclusive; vacía, sin límite).",
      ),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
  "fecha-hasta-de-compra": {
    ficha: "src/primitivas/tiempo/fecha-civil.ts",
    propositos: [
      DEL_FILTRO(
        "Fecha de negocio hasta la que se listan las compras (inclusive; vacía, sin límite).",
      ),
    ],
    consumidores: [FORMULARIO_DE_FILTROS],
    ponerPor: VER_COMPRAS,
    requiere: REQUIERE_COMPRAS,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
