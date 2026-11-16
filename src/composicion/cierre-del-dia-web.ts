import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeLaLecturaDelCierre } from "./lectura-del-cierre";
import {
  entradaDeCerrarElDia,
  entradaDeCorregirElMedio,
  entradaDeDarElConforme,
  entradaDeDeclararElTotal,
  entradaDeJornadaDelCierre,
} from "./entradas-de-cierre";
import { accionDeCierre } from "./errores-de-cierre";
import type { Web } from "./web";

/**
 * Las acciones de «Cierre del día» en la composición (X5; maqueta aceptada `cierre-del-dia.html`): empezar el cierre, cancelarlo, corregir el medio de un cobro, declarar un total, dar el conforme
 * general y cerrar el día (la lectura está en `lectura-del-cierre.ts`). Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next: la acción del servidor resuelve el CONTEXTO
 * (persona, empresa) y la SUCURSAL (la elegida en el dispositivo y validada; llega como argumento, nunca del pedido del navegador). Cada caso de uso exige SU acción al guard dentro de su
 * transacción: acá no se decide ningún permiso, y cada error sale por `errores-de-cierre.ts` (ADR-016). Las acciones que cambian datos con clave de idempotencia (corregir, declarar, conforme)
 * reciben la clave del navegador y el caso de uso la hace valer; empezar, cancelar y cerrar se repiten sin duplicar por el estado de la jornada y por el contenido del cierre (`repiteElCierre`).
 */

export type DependenciasDeCierreWeb = DependenciasDeLaLecturaDelCierre &
  Readonly<{
    casosDeCierre: () => Pick<
      ReturnType<Web["casosDeUsoDeCierre"]>,
      "iniciarAuditoria" | "cancelarAuditoria" | "cerrarJornada"
    >;
    casosDeCaja: () => Pick<
      ReturnType<Web["casosDeUsoDeCaja"]>,
      "corregirMedioDeCobro" | "declararTotal" | "darConformeGeneral"
    >;
  }>;

/** «Empezar el cierre»: con impedimentos el caso de uso lo rechaza y la pantalla vuelve a leer para mostrar lo que impide. */
export function empezarElCierre(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaEnAuditoria: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeJornadaDelCierre,
    (entrada) =>
      d
        .casosDeCierre()
        .iniciarAuditoria(contexto, { sucursalId, fechaDeNegocio: entrada.fechaDeNegocio }),
    (salida) => ({ yaEstabaEnAuditoria: salida.yaEstabaEnAuditoria }),
  );
}

export function cancelarElCierre(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaAbierta: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeJornadaDelCierre,
    (entrada) =>
      d
        .casosDeCierre()
        .cancelarAuditoria(contexto, { sucursalId, fechaDeNegocio: entrada.fechaDeNegocio }),
    (salida) => ({ yaEstabaAbierta: salida.yaEstabaAbierta }),
  );
}

/**
 * «Cerrar el día»: lo reconocido viaja con lo que se vio (`huellaVista`); si cambió algo, `CIERRE_CONTROLES_CAMBIARON` y la pantalla vuelve a leer. La observación general del
 * día no tiene campo en la maqueta: se manda `null` (pregunta pendiente al dueño). Se repite sin duplicar: el mismo pedido sobre una jornada ya cerrada es el mismo cierre.
 */
export function cerrarElDia(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstabaCerrada: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeCerrarElDia,
    (entrada) =>
      d.casosDeCierre().cerrarJornada(contexto, {
        sucursalId,
        fechaDeNegocio: entrada.fechaDeNegocio,
        huellaVista: entrada.huellaVista,
        reconocimientos: entrada.reconocimientos,
        observacion: null,
      }),
    (salida) => ({ yaEstabaCerrada: salida.yaEstabaCerrada }),
  );
}

/** «Corregir medio» de un cobro: la sucursal sale del cobro (el caso de uso la valida contra el alcance), no de la pantalla. */
export function corregirElMedio(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeCorregirElMedio,
    (entrada) => d.casosDeCaja().corregirMedioDeCobro(contexto, entrada),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}

/** Declarar el total de un medio y cuenta distintos del efectivo (el efectivo sale de los billetes). */
export function declararElTotal(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeDeclararElTotal,
    (entrada) => d.casosDeCaja().declararTotal(contexto, { ...entrada, sucursalId }),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}

/** El «Conforme general» de la jornada (uno solo por jornada). */
export function darElConforme(
  d: DependenciasDeCierreWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeCierre(
    d.respuesta,
    crudo,
    entradaDeDarElConforme,
    (entrada) => d.casosDeCaja().darConformeGeneral(contexto, { ...entrada, sucursalId }),
    (salida) => ({ yaExistia: salida.yaExistia }),
  );
}
