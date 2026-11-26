import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/** Los datos de los formularios de movimientos de stock (Entrada, Salida, Transferir, Ajustar, Anular), en su propio archivo (uno por pantalla de stock). `registro.ts` los junta con el resto. */

const CARPETA = "apps/web/ui/plantillas/stock/movimientos/FormularioDeMovimiento.cliente.tsx";
/** La grilla de la carga inicial (STK-C, FP-STK-08) pide los mismos cuatro datos que los formularios: el depósito, el artículo, la cantidad y el costo por unidad. */
const GRILLA_DE_LA_CARGA =
  "apps/web/ui/plantillas/stock/carga-inicial/FormularioDeCargaInicial.cliente.tsx";
const REQUIERE_STOCK = { modulo: "stock", estadoDeEmpresa: ["ACTIVE"] } as const;
const PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/dia-uno-stock-fichas-de-pantalla-2026-11-25.md (FP-STK-04 a FP-STK-07) y la maqueta aprobada el 09/11/2026 (`stock.html`, carpeta de prototipos de Pedernal-docs 10-ux-ui)",
});
const ENTRADA_Y_SALIDA = ["stock.registrar_entrada", "stock.registrar_salida"] as const;
const TODAS = [
  "stock.registrar_entrada",
  "stock.registrar_salida",
  "stock.transferir",
  "stock.ajustar",
] as const;

export const DATOS_DE_STOCK_MOVIMIENTOS = {
  "deposito-de-stock": {
    ficha: "src/modulos/stock/casos-de-uso/depositos.ts",
    propositos: [
      PROPOSITO(
        "Depósito de la sucursal donde entra, sale, se transfiere o se ajusta existencia (solo los activos; en Entrada no los de Cuarentena ni Rechazo).",
      ),
    ],
    consumidores: [CARPETA, GRILLA_DE_LA_CARGA],
    ponerPor: TODAS,
    requiere: REQUIERE_STOCK,
  },
  "articulo-de-stock": {
    ficha: "src/modulos/stock/casos-de-uso/articulos.ts",
    propositos: [
      PROPOSITO(
        "Artículo que se mueve: solo los controlados y activos; su unidad es la de stock y no se elige.",
      ),
    ],
    consumidores: [CARPETA, GRILLA_DE_LA_CARGA],
    ponerPor: TODAS,
    requiere: REQUIERE_STOCK,
  },
  "cantidad-de-movimiento-de-stock": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      PROPOSITO(
        "Cantidad del movimiento: mayor que cero, hasta cuatro decimales, en la unidad de stock del artículo.",
      ),
    ],
    consumidores: [CARPETA, GRILLA_DE_LA_CARGA],
    ponerPor: TODAS,
    requiere: REQUIERE_STOCK,
  },
  "motivo-de-movimiento-de-stock": {
    ficha: "src/modulos/stock/dominio/motivos.ts",
    propositos: [
      PROPOSITO(
        "Motivo de una entrada o una salida a mano, de la lista cerrada que da el servidor (la venta y la producción no se ofrecen).",
      ),
    ],
    consumidores: [CARPETA],
    ponerPor: ENTRADA_Y_SALIDA,
    requiere: REQUIERE_STOCK,
  },
  "costo-por-unidad-de-entrada": {
    ficha: "src/primitivas/dinero/precio-unitario.ts",
    propositos: [
      PROPOSITO(
        "Costo por unidad de una entrada por compra, opcional (vacío es «sin costo»); alimenta el promedio de costo.",
      ),
    ],
    consumidores: [CARPETA, GRILLA_DE_LA_CARGA],
    ponerPor: ["stock.registrar_entrada"],
    requiere: REQUIERE_STOCK,
  },
  "detalle-de-movimiento-de-stock": {
    ficha: "src/primitivas/texto/detalle-de-stock.ts",
    propositos: [
      PROPOSITO(
        "Detalle del movimiento: opcional en entradas y salidas; obligatorio al ajustar y al anular.",
      ),
    ],
    consumidores: [CARPETA],
    ponerPor: [...TODAS, "stock.anular"],
    requiere: REQUIERE_STOCK,
  },
  "sentido-de-ajuste": {
    ficha: "src/modulos/stock/casos-de-uso/movimientos.ts",
    propositos: [
      PROPOSITO("Si el ajuste suma lo que sobra o resta lo que falta de la existencia."),
    ],
    consumidores: [CARPETA],
    ponerPor: ["stock.ajustar"],
    requiere: REQUIERE_STOCK,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
