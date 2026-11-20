import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de la pantalla «Cierre del día» del registro de datos (ver `registro.ts`), en su propio archivo para que dos ramas que suman datos de módulos distintos no
 * toquen las mismas líneas. Un dato no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). Son los campos de la maqueta aceptada
 * (`cierre-del-dia.html`, DDD:175 y DDD:183): la observación opcional al reconocer un control, el motivo al corregir el medio de un cobro y el
 * importe que se declara por medio; el medio y la cuenta del diálogo «Corregir medio» son los datos `medio-de-cobro` y `cuenta-de-cobro`, que viven en `registro-de-caja.ts` (un dato, una definición). La OBSERVACIÓN GENERAL del día NO está: la maqueta no la dibuja, así que no tiene campo ni dato (un dato sin consumidor falla): pregunta
 * pendiente al dueño (`conceptos/pantalla-cierre-del-dia.md` §3).
 */

const REQUIERE_CIERRE = { modulo: "cierre", estadoDeEmpresa: ["ACTIVE"] } as const;
const REQUIERE_CAJA = { modulo: "caja", estadoDeEmpresa: ["ACTIVE"] } as const;
const MODAL_DE_RECONOCER = "apps/web/ui/plantillas/cierre/ModalDeReconocer.cliente.tsx";
const MODAL_DE_CORREGIR = "apps/web/ui/plantillas/cierre/ModalDeCorregirMedio.cliente.tsx";
const LINEA_DE_CONCILIACION = "apps/web/ui/plantillas/cierre/LineaDeConciliacion.cliente.tsx";
const FUENTE = (donde: string): string =>
  `Pedernal-docs/11-especificaciones/conceptos/pantalla-cierre-del-dia.md ${donde} y la maqueta aceptada \`cierre-del-dia.html\` (decisiones del dueño, DDD:175 y DDD:183)`;
const PROPOSITO_DE_CORREGIR = (para: string): Proposito => ({ para, fuente: FUENTE("§3") });

export const DATOS_DE_CIERRE = {
  "texto-de-reconocimiento": {
    ficha: "src/modulos/cierre/dominio/explicacion.ts",
    propositos: [
      {
        para: "Observación opcional (una línea, hasta el largo de la explicación) al reconocer un control del cierre del día (diálogo «Reconocer»); se manda al cerrar.",
        fuente: FUENTE("§3 (campo «Observación del reconocimiento»)"),
      },
    ],
    consumidores: [MODAL_DE_RECONOCER],
    ponerPor: ["jornadas.cerrar"],
    requiere: REQUIERE_CIERRE,
  },
  "motivo-de-correccion-de-medio": {
    ficha: "src/modulos/caja/dominio/texto.ts",
    propositos: [
      PROPOSITO_DE_CORREGIR(
        "Motivo obligatorio (una línea, la lista de permitidos de la explicación) de la corrección del medio de un cobro.",
      ),
    ],
    consumidores: [MODAL_DE_CORREGIR],
    ponerPor: ["cobros.corregir_medio"],
    requiere: REQUIERE_CAJA,
  },
  "importe-de-total-declarado": {
    ficha: "src/primitivas/dinero/importe.ts",
    propositos: [
      {
        para: "Total que dicen los comprobantes (terminal, QR o banco) de un medio que no es efectivo, declarado en la conciliación por medio del cierre del día.",
        fuente: FUENTE("§3 (campo «Declarado»)"),
      },
    ],
    consumidores: [LINEA_DE_CONCILIACION],
    ponerPor: ["declaraciones_de_total.registrar"],
    requiere: REQUIERE_CAJA,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
