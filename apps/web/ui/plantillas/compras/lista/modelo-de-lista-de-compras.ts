import { formatearImporte, formatearPuntoDeVenta } from "../../../patrones/formato-fiscal";
import { nombreDe } from "../../facturacion/modelo-del-detalle";
import { direccionDeLaLista, rutaDeLaCompra, type FiltroAplicado } from "../rutas-de-compras";
import type { TextosDeCompras } from "../textos-de-compras";

/**
 * El modelo de vista de la lista de compras (maqueta `compra-corregir-anular.html`, `vLista`; Compras PR 3): cada fila, los chips del filtro y el estado vacío. Puro: sin React ni servidor.
 * Lo que llega es lo que entrega el servidor (`compras-lista-web.ts`): importes como texto decimal con moneda (nunca `number`), fechas de negocio `AAAA-MM-DD`. El modelo NO calcula ningún importe:
 * muestra el total que devuelve el servidor, o «Sin precio» si no lo hay (nunca «$ 0,00»). Todo dato ausente es «—» o «Sin precio», nunca cero.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type ListaDeComprasParaLaPantalla = Readonly<{
  compras: readonly Readonly<{
    recepcionId: string;
    numero: number;
    proveedor: string | null;
    fechaNegocio: string;
    estado: "ANULADA" | "RECIBIDA_SIN_FACTURAR" | "RECIBIDA_Y_FACTURADA";
    total: Importe | null;
    factura: Readonly<{
      letra: "A" | "B" | "C";
      puntoDeVenta: number;
      numero: number;
    }> | null;
  }>[];
  siguiente: string | null;
  filtros: FiltroAplicado;
}>;

/** El número de una factura como se imprime: punto de venta de cinco dígitos, guion y número de ocho («00004-00005678»). */
export const numeroImpreso = (puntoDeVenta: number, numero: number): string =>
  `${formatearPuntoDeVenta(puntoDeVenta)}-${String(numero).padStart(8, "0")}`;

/** «Factura A 00004-00005678». */
export function nombreDeLaFactura(
  factura: Readonly<{ letra: "A" | "B" | "C"; puntoDeVenta: number; numero: number }>,
): string {
  return nombreDe(
    {},
    `FACTURA_${factura.letra}`,
    numeroImpreso(factura.puntoDeVenta, factura.numero),
  );
}

/** El total de pesos de una fila o de una línea: el importe en pesos, o «Sin precio» si no hay (nunca cero). */
export const totalParaMostrar = (importe: Importe | null, textos: TextosDeCompras): string =>
  importe === null ? textos.sinPrecio : formatearImporte(importe.monto);

export type FilaDeCompraArmada = Readonly<{
  id: string;
  href: string;
  /** «Compra 5 · Carnes del Sur»; sin proveedor que mostrar, «—». */
  titulo: string;
  /** El nombre de la factura si la hay o «Recibida sin facturar»; si está anulada se le suma « · Anulada». */
  segunda: string;
  total: string;
  /** El nombre accesible de la fila entera. */
  nombreAccesible: string;
}>;

export type OpcionDeEstado = Readonly<{ valor: "TODAS" | "SIN_FACTURAR"; etiqueta: string }>;

export type ListaArmada = Readonly<{
  filas: readonly FilaDeCompraArmada[];
  /** Los dos chips («Todas», «Sin facturar») y cuál está aplicado. */
  estados: readonly OpcionDeEstado[];
  filtro: FiltroAplicado;
  /** «Sin resultados» y «Ver todas» si no hay filas; `null` si las hay. */
  vacio: Readonly<{ texto: string; verTodas: Readonly<{ texto: string; href: string }> }> | null;
  /** «Página siguiente»: solo si el servidor dio un cursor. */
  paginaSiguiente: Readonly<{ texto: string; href: string }> | null;
}>;

const SIN_DATO = "—";

export function armarLaLista(
  lista: ListaDeComprasParaLaPantalla,
  textos: TextosDeCompras,
): ListaArmada {
  const filas = lista.compras.map((c): FilaDeCompraArmada => {
    const titulo = `${textos.compra} ${String(c.numero)} · ${c.proveedor ?? SIN_DATO}`;
    const base = c.factura === null ? textos.recibidaSinFacturar : nombreDeLaFactura(c.factura);
    const segunda = c.estado === "ANULADA" ? `${base} · ${textos.anulada}` : base;
    const total = totalParaMostrar(c.total, textos);
    return {
      id: c.recepcionId,
      href: rutaDeLaCompra(c.recepcionId),
      titulo,
      segunda,
      total,
      nombreAccesible: [titulo, segunda, total].join(", "),
    };
  });
  return {
    filas,
    estados: [
      { valor: "TODAS", etiqueta: textos.todas },
      { valor: "SIN_FACTURAR", etiqueta: textos.sinFacturar },
    ],
    filtro: lista.filtros,
    vacio:
      filas.length === 0
        ? {
            texto: textos.sinResultados,
            verTodas: {
              texto: textos.verTodas,
              href: direccionDeLaLista({ estado: "TODAS", desde: null, hasta: null }, null),
            },
          }
        : null,
    paginaSiguiente:
      lista.siguiente === null
        ? null
        : {
            texto: textos.paginaSiguiente,
            href: direccionDeLaLista(lista.filtros, lista.siguiente),
          },
  };
}
