import {
  cantidadCanonica,
  esConsumidorFinal,
  type ClienteEscrito,
  type RenglonEscrito,
} from "./eleccion-de-emision";

/**
 * El pedido de la factura (D-24, D-84, D-85): el receptor tal como se escribió (o el consumidor final sin identificar), un renglón
 * por cada uno escrito con su precio CON IVA INCLUIDO y sin descuento, y siempre «productos» (la pantalla no pide las fechas de un
 * servicio). La clave de idempotencia la pone el intento (`useEnvioDeLaEmision`); la empresa, el emisor y el ambiente los decide el
 * servidor. La alícuota solo viaja si la empresa discrimina IVA (`discriminaIva`, que decide el servidor: la letra no se muestra,
 * D-26). Previene: mandar al servidor algo distinto de lo que la persona vio en «Revisar». Chequeo: `test/web/emitir-pedido.test.ts`
 * (y `test/integracion/web-emitir-factura-real.test.ts`, con el backend real).
 */

type DocumentoDelPedido =
  Readonly<{ tipo: "SIN_IDENTIFICAR" }> | Readonly<{ tipo: string; numero: string }>;

type RenglonDelPedido = Readonly<{
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  descuento: null;
  alicuota: string | null;
}>;

/** Los valores de la factura SIN la clave: se fijan al primer toque y se reusan en cada reintento. */
export type PedidoDeEmision = Readonly<{
  puntoDeVentaId: string;
  concepto: "PRODUCTOS";
  servicio: null;
  modoDePrecio: "IVA_INCLUIDO";
  receptor: Readonly<{
    nombre: string | null;
    documento: DocumentoDelPedido;
    condicionIva: string;
    domicilio: string | null;
  }>;
  renglones: readonly RenglonDelPedido[];
}>;

/** El consumidor final no lleva documento ni nombre; su condición frente al IVA es siempre la misma (D-24). */
const CONDICION_DEL_CONSUMIDOR_FINAL = "CONSUMIDOR_FINAL";

function receptorDe(cliente: ClienteEscrito): PedidoDeEmision["receptor"] {
  if (esConsumidorFinal(cliente)) {
    return {
      nombre: null,
      documento: { tipo: "SIN_IDENTIFICAR" },
      condicionIva: CONDICION_DEL_CONSUMIDOR_FINAL,
      domicilio: null,
    };
  }
  return {
    nombre: cliente.nombre.trim(),
    // El número va como se escribió (con los puntos o guiones que admite su tipo): el servidor lo valida y lo guarda canónico (Q6).
    documento: { tipo: cliente.documento, numero: cliente.numero.trim() },
    condicionIva: cliente.condicionIva,
    domicilio: cliente.domicilio.trim() === "" ? null : cliente.domicilio.trim(),
  };
}

export function armarElPedido(
  cliente: ClienteEscrito,
  renglones: readonly RenglonEscrito[],
  puntoDeVentaId: string,
  discriminaIva: boolean,
): PedidoDeEmision {
  return {
    puntoDeVentaId,
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    receptor: receptorDe(cliente),
    renglones: renglones.map((r) => ({
      descripcion: r.descripcion.trim(),
      cantidad: cantidadCanonica(r.cantidad),
      precioUnitario: r.precio,
      descuento: null,
      alicuota: discriminaIva && r.alicuota !== "" ? r.alicuota : null,
    })),
  };
}
