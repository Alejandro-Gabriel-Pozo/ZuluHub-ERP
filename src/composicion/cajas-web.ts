import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAltaDeCaja,
  entradaDeEdicionDeCaja,
  entradaDeEstadoDeCaja,
} from "./entradas-de-caja";
import { accionDeCaja } from "./errores-de-caja";
import type { Web } from "./web";

/**
 * «Cajas» de la configuración de caja (maqueta aprobada `medios.html`, 09/11/2026): las cajas de UNA sucursal. La lista, agregar, editar el nombre, desactivar y reactivar. Mismas
 * reglas que `medios-de-pago-web.ts` más estas:
 *  - **La sucursal la fija el servidor** (la elegida en el dispositivo, validada contra el alcance de la persona): llega como argumento, nunca del pedido del navegador. El caso
 *    de uso vuelve a validarla dentro de su transacción. Una ajena o inexistente sale como el genérico. Nunca «todas».
 *  - **«Caja 1» nace sola** con la sucursal: nadie la crea a mano. Sumar otra depende del plan; si no alcanza, el servidor rechaza al guardar con el genérico (`LIMITE_DEL_PLAN`):
 *    la pantalla no replica la regla del plan. Una caja con la sesión abierta no se desactiva: también el genérico.
 */

export type DependenciasDeCajasWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCaja"]>,
    "crearCaja" | "editarCaja" | "desactivarCaja" | "reactivarCaja"
  >;
  consultas: () => Pick<ReturnType<Web["consultasDeCaja"]>, "listarCajas">;
  respuesta: DependenciasDeRespuesta;
}>;

export type CajaParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
  version: number;
}>;

export type CajasParaLaPantalla = Readonly<{ cajas: readonly CajaParaLaPantalla[] }>;

/** Las cajas de la sucursal con la que trabaja la persona, también las desactivadas. Es una LECTURA: no escribe ni audita. */
export function listarLasCajas(
  d: DependenciasDeCajasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<CajasParaLaPantalla>> {
  return accionDeCaja(
    d.respuesta,
    {},
    () => ({ ok: true, valor: {} }),
    () => d.consultas().listarCajas(contexto, { sucursalId, incluirInactivas: true }),
    (lista) => ({
      cajas: lista.cajas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        activa: c.activa,
        version: c.version,
      })),
    }),
  );
}

export function agregarLaCaja(
  d: DependenciasDeCajasWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ cajaId: string }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeAltaDeCaja,
    (entrada) => d.casosDeUso().crearCaja(contexto, { sucursalId, nombre: entrada.nombre }),
    (salida) => ({ cajaId: salida.cajaId }),
  );
}

export function editarLaCaja(
  d: DependenciasDeCajasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEdicionDeCaja,
    (entrada) => d.casosDeUso().editarCaja(contexto, entrada),
    (salida) => ({ version: salida.version }),
  );
}

export function desactivarLaCaja(
  d: DependenciasDeCajasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeCaja,
    (entrada) => d.casosDeUso().desactivarCaja(contexto, entrada),
    () => ({}),
  );
}

export function reactivarLaCaja(
  d: DependenciasDeCajasWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeCaja,
    (entrada) => d.casosDeUso().reactivarCaja(contexto, entrada),
    () => ({}),
  );
}
