import { randomBytes } from "node:crypto";
import type { EmpresaId } from "../primitivas/identificadores/marca";
import type { ExistenciasDelProducto } from "../modulos/catalogo/publico";
import type { TxDeApp } from "./conexiones";

/**
 * El puerto que le contesta al catálogo «¿tiene este producto existencia o un conteo abierto con cargas?» (carta real §6.5, T-6): la composición es el ÚNICO lugar
 * donde se tocan catálogo y stock, con la MISMA transacción (`TxDeApp` contiene los repositorios de los dos).
 *
 * PROVISORIO HASTA T9 (el lado de stock de la carta real): hoy responde con lo que ya existe, sin tocar el módulo de stock y FALLANDO CERRADO. Un producto SIN
 * artículo de stock no tiene existencia ni conteos (`false`: se oculta y se desactiva siempre; es el caso del cliente actual, que no controla stock). Un producto CON
 * artículo de stock se responde `true` (con existencia y con conteo): no se oculta ni se desactiva hasta que T9 mire los saldos y los conteos de verdad. Es más
 * estricto de lo que debe, nunca más laxo. T9 reemplaza este archivo.
 */
function comoTxDeApp(tx: object): TxDeApp {
  if (!("articulosDeStock" in tx)) {
    throw new Error("preguntar por la existencia necesita la transacción compuesta con stock");
  }
  return tx as TxDeApp;
}

export function crearExistenciasDeCatalogo(): ExistenciasDelProducto {
  const tieneArticulo = async (tx: object, empresa: EmpresaId, productoId: string) =>
    (await comoTxDeApp(tx).articulosDeStock.porProducto(empresa, productoId)) !== null;
  return {
    conExistencia: (tx, contexto, productoId) => tieneArticulo(tx, contexto.empresaId, productoId),
    conConteoAbiertoConCargas: (tx, contexto, productoId) =>
      tieneArticulo(tx, contexto.empresaId, productoId),
  };
}

/** El puerto de azar del código de la carta: 128 bits al azar en base64url (22 caracteres). Corre una vez por intento; el dominio no tiene azar. */
export const generarCodigoDeCarta = (): string => randomBytes(16).toString("base64url");
