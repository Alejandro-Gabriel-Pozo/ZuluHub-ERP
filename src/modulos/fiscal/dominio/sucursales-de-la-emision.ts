import {
  exigirSucursal,
  type AlcanceDeSucursales,
  type ErrorDeAlcance,
} from "../../../capacidades/permisos/alcance";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Las sucursales que cuentan al EMITIR un comprobante (decisiones del dueño, `facturador-contratos-de-pantalla.md`): puras, sin
 * reloj ni azar ni lectura de la base. Las lecturas (el alcance de la persona, la sucursal del punto de venta y la de la factura que
 * una nota corrige) las hace el caso de uso dentro de su transacción y se las pasa.
 *
 * Dos reglas separadas porque se aplican en momentos distintos del caso de uso: la de alcance va antes de mirar si el pedido ya se
 * había emitido (una repetición no le devuelve a nadie un comprobante de una sucursal que no es suya), y la de sucursal abierta
 * después (una repetición del mismo pedido da lo mismo que la primera vez aunque la sucursal se haya cerrado mientras tanto, como
 * ya pasa con un punto de venta desactivado).
 */

/**
 * El comprobante que una nota corrige (crédito) o aumenta (débito): solo su sucursal. `null` en la sucursal es un comprobante sin
 * sucursal guardada (solo una carga que apagó los disparadores, 0016): no corresponde a nadie, como lo trata el Detalle.
 */
export type ComprobanteQueSeCorrige = Readonly<{ sucursalId: SucursalId | null }>;

/**
 * D-41 y D-51: el operador emite solo desde puntos de venta de sus sucursales asignadas, y una NOTA además necesita la sucursal de
 * la factura que corrige; gerente y administrador (`"TODAS"`), cualquiera. `alcance` es el de la persona CON las sucursales cerradas
 * que tiene asignadas (`incluirDesactivadas`): si la del punto de venta está cerrada, el motivo es otro y lo da
 * `exigirSucursalAbierta`, no un «fuera de alcance» que el operador no entendería. `corrige` es `null` en una factura.
 * En una nota se mira PRIMERO la factura y después el punto de venta: si la factura no es de una sucursal de la persona, la respuesta
 * es la misma que si no existiera (`COMPROBANTE_ASOCIADO_NO_ENCONTRADO`, como el Detalle, D-39: la existencia no se revela), sin
 * importar si el punto de venta también está fuera de su alcance (decisión del dueño, 29/10/2026 (D-56): el operador de Centro que
 * pide una nota desde un punto de venta de Norte sobre una factura de Norte ve «No encontramos ese comprobante», no «Sucursal fuera
 * de su alcance»). Con la factura en alcance, un punto de venta ajeno da `SUCURSAL_FUERA_DE_ALCANCE`; y en una factura (no nota) el
 * punto de venta ajeno sigue dando `SUCURSAL_FUERA_DE_ALCANCE`.
 * Previene: que un operador emita en una sucursal que no es suya (o una nota que después no podría abrir, D-39).
 * Chequeo: `sucursales-de-la-emision.test.ts` y la matriz de `fiscal-sucursal-operaciones.test.ts`.
 */
export function sucursalesDeLaEmision(
  alcance: AlcanceDeSucursales,
  delPuntoDeVenta: SucursalId,
  corrige: ComprobanteQueSeCorrige | null,
): Resultado<null, ErrorDeAlcance | "COMPROBANTE_ASOCIADO_NO_ENCONTRADO"> {
  if (
    corrige !== null &&
    (corrige.sucursalId === null || !exigirSucursal(alcance, corrige.sucursalId).ok)
  ) {
    return err("COMPROBANTE_ASOCIADO_NO_ENCONTRADO");
  }
  const punto = exigirSucursal(alcance, delPuntoDeVenta);
  return punto.ok ? ok(null) : punto;
}

/**
 * El error de emitir desde una sucursal cerrada, y de dar de alta un punto de venta en una (`crearPuntoDeVenta`), mudarlo a una
 * (`editarPuntoDeVenta`) o activar uno que está en una (`activarPuntoDeVenta`). Lo traduce
 * `errores-fiscales.ts` a `FISCAL_SUCURSAL_CERRADA`.
 */
export type ErrorDeSucursalCerrada = "SUCURSAL_CERRADA";

/**
 * D-50: una sucursal cerrada (desactivada) no emite: ninguno de sus puntos de venta, aunque el punto de venta siga activo. Se mira
 * la sucursal del PUNTO DE VENTA, no la de la factura que una nota corrige (esa puede estar cerrada y la nota se emite igual). Sus
 * comprobantes viejos se siguen viendo (D-37 y D-39). La base lo impone también al confirmar (`comprobante_sucursal_cerrada`,
 * 0017): esto es el error de negocio antes de llegar a ella.
 * Previene: que una sucursal que se cerró siga facturando por un punto de venta que nadie apagó. La misma regla, sobre la sucursal
 * elegida (o la del punto de venta, al activarlo), impide dar de alta, mudar o activar un punto de venta en una sucursal cerrada
 * (decisiones del dueño, 2026-10-29: D-78, D-79 y D-80).
 * Chequeo: `sucursales-de-la-emision.test.ts`, la matriz de `fiscal-sucursal-operaciones.test.ts` y los dos órdenes de la carrera
 * contra el cierre.
 */
export function exigirSucursalAbierta(
  sucursal: Readonly<{ activa: boolean }>,
): Resultado<null, ErrorDeSucursalCerrada> {
  return sucursal.activa ? ok(null) : err("SUCURSAL_CERRADA");
}
