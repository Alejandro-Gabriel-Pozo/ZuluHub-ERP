import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/** Los datos de las pantallas del conteo físico de stock (carga, aplicar y cancelar), en su propio archivo (uno por pantalla de stock). `registro.ts` los junta con el resto. */

const CARGA = "apps/web/ui/plantillas/stock/conteo/CargaDeConteo.cliente.tsx";
const APLICAR = "apps/web/ui/plantillas/stock/conteo/FormularioDeAplicarConteo.cliente.tsx";
const REQUIERE_STOCK = { modulo: "stock", estadoDeEmpresa: ["ACTIVE"] } as const;
const PROPOSITO = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/dia-uno-stock-fichas-de-pantalla-2026-11-25.md (FP-STK-10 a FP-STK-12) y la maqueta aprobada `stock-conteo.html` (12/11/2026; textos del 14/11/2026)",
});

export const DATOS_DE_STOCK_CONTEO = {
  "cantidad-contada": {
    ficha: "src/primitivas/cantidad/cantidad.ts",
    propositos: [
      PROPOSITO(
        "Lo que se contó de un artículo en el conteo abierto: cero o más, hasta cuatro decimales, en la unidad de stock del artículo; recontar vale el último.",
      ),
    ],
    consumidores: [CARGA],
    ponerPor: ["conteos.registrar"],
    requiere: REQUIERE_STOCK,
  },
  "hora-del-conteo": {
    ficha: "src/primitivas/tiempo/hora-del-dia.ts",
    propositos: [
      PROPOSITO(
        "La hora (HH:MM) a la que se contó un artículo; vacía vale la hora de la carga. El servidor la lleva al instante con la zona de la sucursal.",
      ),
    ],
    consumidores: [CARGA],
    ponerPor: ["conteos.registrar"],
    requiere: REQUIERE_STOCK,
  },
  "motivo-de-diferencia-de-conteo": {
    ficha: "src/modulos/stock/dominio/motivos-de-diferencia.ts",
    propositos: [
      PROPOSITO(
        "Motivo de lo que queda de diferencia al aplicar el conteo, de la lista cerrada del sistema según sea faltante o sobrante («otra» pide detalle).",
      ),
    ],
    consumidores: [APLICAR],
    ponerPor: ["conteos.aplicar"],
    requiere: REQUIERE_STOCK,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
