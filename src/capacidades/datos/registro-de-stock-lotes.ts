import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/** Los datos de los formularios de escritura de «Lotes» (Corregir y Reasignar; STK-E1), en su propio archivo (uno por pantalla de stock). `registro.ts` los junta con el resto. */

const CORREGIR = "apps/web/ui/plantillas/stock/lotes/FormularioDeCorregirLote.cliente.tsx";
const REASIGNAR = "apps/web/ui/plantillas/stock/lotes/FormularioDeReasignarLote.cliente.tsx";
const REQUIERE_STOCK = { modulo: "stock", estadoDeEmpresa: ["ACTIVE"] } as const;
const PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/dia-uno-stock-fichas-de-pantalla-2026-11-25.md (FP-STK-13 y FP-STK-16) y dia-uno-stock-inventario-de-textos-2026-11-25.md (L-05 a L-09, L-15)",
});

export const DATOS_DE_STOCK_LOTES = {
  "vencimiento-de-lote": {
    ficha: "src/modulos/stock/casos-de-uso/corregir-lote.ts",
    propositos: [
      PROPOSITO(
        "Fecha de vencimiento de un lote (AAAA-MM-DD, entre 2000 y 2200): con control de vencimiento no se puede dejar sin fecha ni pasar de la de elaboración.",
      ),
    ],
    consumidores: [CORREGIR],
    ponerPor: ["lotes.corregir"],
    requiere: REQUIERE_STOCK,
  },
  "lote-de-destino-de-reasignacion": {
    ficha: "src/modulos/stock/casos-de-uso/reasignar-lote.ts",
    propositos: [
      PROPOSITO(
        "Lote que recibe la existencia que se reasigna: uno que ya existe del mismo artículo, distinto del de origen; nunca se crea un lote desde acá.",
      ),
    ],
    consumidores: [REASIGNAR],
    ponerPor: ["lotes.reasignar"],
    requiere: REQUIERE_STOCK,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
