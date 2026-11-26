import { ALICUOTAS_PARA_ELEGIR } from "../nueva/modelo-de-factura";

/**
 * El pedido de «Guardar» de «Cargar una nota del proveedor» (NOTAS-2c-1): lo que se escribe en el formulario y lo que sale hacia el servidor. Puro: sin React ni servidor y SIN ninguna cuenta (ni el IVA, ni el total, ni el tope de
 * lo acreditable: los valida el servidor). Dinero siempre como TEXTO decimal tal cual se escribió, nunca `number`. `null` mientras falta algo (el botón queda apagado). Va aparte del modelo de la pantalla porque arma lo que se
 * manda al servidor con importes: la mutación lo exige a su nivel (`arquitectura/mutacion/web-notas-del-proveedor.json`).
 */
export const ALICUOTAS_DE_LA_NOTA = ALICUOTAS_PARA_ELEGIR;

/** Solo una nota A discrimina IVA: lleva la alícuota de cada importe. Una B o C va sin alícuota (el servidor rechaza una alícuota en una B o C y la falta en una A). La letra es la última del tipo. */
export const discriminaIvaLaNota = (tipo: string): boolean => tipo.endsWith("_A");

export type ImporteEscrito = Readonly<{ id: number; alicuota: string; neto: string }>;

export type NotaEscrita = Readonly<{
  tipo: string;
  puntoDeVenta: string;
  numero: string;
  fecha: string;
  importes: readonly ImporteEscrito[];
  totalSegunNota: string;
}>;

export const IMPORTE_INICIAL: ImporteEscrito = { id: 1, alicuota: "21", neto: "" };

export const NOTA_VACIA: NotaEscrita = {
  tipo: "",
  puntoDeVenta: "",
  numero: "",
  fecha: "",
  importes: [IMPORTE_INICIAL],
  totalSegunNota: "",
};

/** Lo que sale a «Guardar»: la factura que corrige (viene de la ruta) y la nota tal cual se escribió, con los importes como TEXTO. `null` mientras falta algo (el botón queda apagado); las cuentas, el tope y el tipo de la clase los valida el servidor. */
export type PedidoDeNota = Readonly<{
  facturaId: string;
  nota: Readonly<{
    tipo: string;
    puntoDeVenta: string;
    numero: string;
    fecha: string;
    importes: readonly Readonly<{ alicuota: string | null; neto: string }>[];
    totalSegunNota: string;
  }>;
}>;

export function armarElPedidoDeNota(facturaId: string, nota: NotaEscrita): PedidoDeNota | null {
  if (
    nota.tipo === "" ||
    nota.puntoDeVenta === "" ||
    nota.numero === "" ||
    nota.fecha === "" ||
    nota.totalSegunNota === "" ||
    nota.importes.length === 0 ||
    nota.importes.some(
      (i) => i.neto === "" || (discriminaIvaLaNota(nota.tipo) && i.alicuota === ""),
    )
  ) {
    return null;
  }
  return {
    facturaId,
    nota: {
      tipo: nota.tipo,
      puntoDeVenta: nota.puntoDeVenta,
      numero: nota.numero,
      fecha: nota.fecha,
      importes: nota.importes.map((i) => ({
        alicuota: discriminaIvaLaNota(nota.tipo) ? i.alicuota : null,
        neto: i.neto,
      })),
      totalSegunNota: nota.totalSegunNota,
    },
  };
}
