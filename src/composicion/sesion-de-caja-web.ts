import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { ImporteJson } from "../primitivas/dinero/importe";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAjusteDeCaja,
  entradaDeAnulacionDeMovimiento,
  entradaDeApertura,
  entradaDeCierreDeCaja,
  entradaDeMovimientoDeCaja,
  entradaDeSesionDeCaja,
} from "./entradas-de-sesion-de-caja";
import { accionDeCaja } from "./errores-de-caja";
import type { Web } from "./web";

/**
 * Pantalla «Caja» del mostrador (maqueta `caja.html`, textos del 15/11/2026): las acciones de abrir, contar y cerrar, mover efectivo,
 * ajustar y anular un movimiento (las lecturas están en `lecturas-de-sesion-de-caja-web.ts`). Mismas reglas que `cajas-web.ts` más estas:
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance de la persona): llega como argumento, nunca del pedido del navegador, y los casos
 *    de uso y consultas la vuelven a validar. Ninguna elegida es el genérico: nunca «todas». Una sesión o un movimiento se identifican por su id y el servidor deriva su sucursal.
 *  - **Todo lo decide el servidor dentro de su transacción**: el permiso (el ajuste es solo de gerente y administrador: `movimientos_caja.ajustar`; el operador anula solo lo que cargó
 *    él), el estado de la sesión, la jornada y el arqueo. La pantalla no replica ninguna regla; los avisos son el genérico «Esta acción no está permitida» (P5).
 *  - **Repetir no duplica**: abrir, registrar un movimiento, un ajuste y anular llevan la clave que generó la pantalla (la misma clave devuelve lo hecho con `yaExistia`; la misma clave con
 *    otro contenido es rechazada); iniciar y cancelar el cierre y cerrar la caja se resuelven por el estado de la sesión (`yaEstabaEnCierre`, `yaEstabaAbierta`, `yaEstabaCerrada`). Dos aperturas
 *    a la vez de la misma caja: una abre y la otra recibe el genérico. Un movimiento o ajuste nunca se borra: se anula con un registro nuevo.
 *  - **Dinero** como texto decimal con moneda (ARS) y sin redondeo; las fechas, de negocio (Argentina) tal como las sella el servidor al abrir.
 * SUPUESTO (DEC-0452): «‹» desde Contar NO cancela el cierre; solo vuelve a la pantalla anterior. Cancelar el cierre es la acción `cancelarElCierreDeCaja`.
 */

export type DependenciasDeSesionDeCajaWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCaja"]>,
    | "abrirSesion"
    | "iniciarCierre"
    | "cancelarCierre"
    | "cerrarSesion"
    | "registrarMovimientoManual"
    | "registrarAjuste"
    | "anularMovimientoDeCaja"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeCaja"]>,
    | "estadoDeLaCaja"
    | "ultimaSesionDeLaCaja"
    | "resumenDeSesion"
    | "movimientosDeSesion"
    | "fichaDeSesion"
    | "prepararCierre"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** Una línea del arqueo que acaba de cerrarse: por id de medio y de cuenta (los nombres y el tipo ya los tiene la pantalla de «Contar»). */
export type LineaCerradaParaLaPantalla = Readonly<{
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  esperado: ImporteJson;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea quedó conforme. */
  contado: ImporteJson | null;
  conforme: boolean;
  /** contado − esperado; `null` si es conforme. */
  diferencia: ImporteJson | null;
}>;

export function abrirLaCaja(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ sesionId: string; fechaDeNegocio: string; yaExistia: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeApertura,
    (entrada) => d.casosDeUso().abrirSesion(contexto, { ...entrada, sucursalId }),
    (salida) => ({
      sesionId: salida.sesionId,
      fechaDeNegocio: salida.fechaDeNegocio,
      yaExistia: salida.yaExistia,
    }),
  );
}

export function iniciarElCierreDeCaja(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaEnCierre: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeSesionDeCaja,
    (entrada) => d.casosDeUso().iniciarCierre(contexto, { sesionId: entrada.sesionId }),
    (salida) => ({ yaEstabaEnCierre: salida.yaEstabaEnCierre }),
  );
}

export function cancelarElCierreDeCaja(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaAbierta: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeSesionDeCaja,
    (entrada) => d.casosDeUso().cancelarCierre(contexto, { sesionId: entrada.sesionId }),
    (salida) => ({ yaEstabaAbierta: salida.yaEstabaAbierta }),
  );
}

/** Cierra la caja con el arqueo: el efectivo por billetes y monedas, los demás medios con su total o «conforme». Repetir el mismo cierre devuelve lo hecho (`yaEstabaCerrada`). */
export function cerrarLaCaja(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<
  Respuesta<Readonly<{ arqueo: readonly LineaCerradaParaLaPantalla[]; yaEstabaCerrada: boolean }>>
> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeCierreDeCaja,
    (entrada) => d.casosDeUso().cerrarSesion(contexto, entrada),
    (salida) => ({
      arqueo: salida.arqueo.map((l) => ({
        medioDePagoId: l.medioDePagoId,
        cuentaDeCobroId: l.cuentaDeCobroId,
        esperado: l.esperado,
        contado: l.contado,
        conforme: l.conforme,
        diferencia: l.diferencia,
      })),
      yaEstabaCerrada: salida.yaEstabaCerrada,
    }),
  );
}

export function registrarElMovimiento(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ movimientoId: string; yaExistia: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeMovimientoDeCaja,
    (entrada) => d.casosDeUso().registrarMovimientoManual(contexto, entrada),
    (salida) => ({ movimientoId: salida.movimientoId, yaExistia: salida.yaExistia }),
  );
}

/** Solo gerente y administrador (lo exige el caso de uso con `movimientos_caja.ajustar`, no la pantalla). */
export function registrarElAjuste(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ movimientoId: string; yaExistia: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeAjusteDeCaja,
    // El ajuste de la pantalla es el de la sesión abierta: ninguna jornada cerrada que corregir (`corrigeJornada: null`).
    (entrada) => d.casosDeUso().registrarAjuste(contexto, { ...entrada, corrigeJornada: null }),
    (salida) => ({ movimientoId: salida.movimientoId, yaExistia: salida.yaExistia }),
  );
}

/** Se anula con un registro nuevo y un motivo: el movimiento original queda intacto. */
export function anularElMovimiento(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ anulacionId: string; yaExistia: boolean }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeAnulacionDeMovimiento,
    (entrada) => d.casosDeUso().anularMovimientoDeCaja(contexto, entrada),
    (salida) => ({ anulacionId: salida.anulacionId, yaExistia: salida.yaExistia }),
  );
}
