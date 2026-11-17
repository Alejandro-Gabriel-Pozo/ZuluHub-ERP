import { randomBytes } from "node:crypto";
import { sucursalId } from "../primitivas/identificadores/marca";
import type { AlcanceDeExistencia, ExistenciasDelProducto } from "../modulos/catalogo/publico";
import type { TxDeApp } from "./conexiones";

/**
 * El puerto que le contesta al catálogo «¿tiene este producto existencia o un conteo abierto con cargas?» (carta real §6.5, T-6 y T9): la composición es el ÚNICO lugar
 * donde se tocan catálogo y stock, con la MISMA transacción (`TxDeApp` contiene los repositorios de los dos). Un producto SIN artículo de stock no tiene existencia ni
 * conteos (`false`: se oculta y se desactiva sin más; es el caso de un cliente que no controla stock). Con artículo, se mira de verdad: la existencia DISTINTA DE CERO
 * (también negativa) en los depósitos del alcance (la empresa entera, o los de ese local) y si algún conteo ABIERTO de esos depósitos tiene cargas de ese artículo.
 * Es solo una lectura: lo que impide el estado «oculto con existencia» no es este puerto sino los disparadores de la base (`0049`), que rechazan sumar existencia y
 * contar un producto oculto aunque el código se olvide. Reemplaza al provisorio de T2, que respondía «sí» a todo producto con artículo.
 */
function comoTxDeApp(tx: object): TxDeApp {
  if (!("articulosDeStock" in tx)) {
    throw new Error("preguntar por la existencia necesita la transacción compuesta con stock");
  }
  return tx as TxDeApp;
}

const sucursalDelAlcance = (alcance: AlcanceDeExistencia): string | null =>
  alcance.tipo === "EMPRESA" ? null : alcance.sucursalId;

export function crearExistenciasDeCatalogo(): ExistenciasDelProducto {
  return {
    async conExistencia(tx, contexto, productoId, alcance) {
      const stock = comoTxDeApp(tx);
      const articulo = await stock.articulosDeStock.porProducto(contexto.empresaId, productoId);
      if (articulo === null) return false;
      return stock.movimientosDeStock.conExistenciaDelArticulo(
        contexto.empresaId,
        articulo.id,
        sucursalDelAlcance(alcance),
      );
    },
    async conConteoAbiertoConCargas(tx, contexto, productoId, alcance) {
      const stock = comoTxDeApp(tx);
      const articulo = await stock.articulosDeStock.porProducto(contexto.empresaId, productoId);
      if (articulo === null) return false;
      const sucursal = sucursalDelAlcance(alcance);
      return stock.conteosDeStock.abiertoConCargasDelArticulo(
        contexto.empresaId,
        articulo.id,
        sucursal === null ? null : sucursalId(sucursal),
      );
    },
  };
}

/** El puerto de azar del código de la carta: 128 bits al azar en base64url (22 caracteres). Corre una vez por intento; el dominio no tiene azar. */
export const generarCodigoDeCarta = (): string => randomBytes(16).toString("base64url");
