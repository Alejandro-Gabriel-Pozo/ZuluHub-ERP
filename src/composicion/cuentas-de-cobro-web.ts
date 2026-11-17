import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeAltaDeCuenta,
  entradaDeEdicionDeCuenta,
  entradaDeEstadoDeCuenta,
} from "./entradas-de-caja";
import { accionDeCaja } from "./errores-de-caja";
import type { Web } from "./web";

/**
 * «Cuentas de cobro» de la configuración de caja (maqueta aprobada `medios.html`, 09/11/2026): terminales, QR y cuentas bancarias donde cae lo cobrado, cada una de UNA
 * sucursal. La lista, agregar, editar, desactivar y reactivar. Mismas reglas que `medios-de-pago-web.ts` (el permiso es del caso de uso, la empresa y la persona las pone el
 * servidor, repetir no duplica, la versión protege la edición, lista blanca de lo que sale, todo por `accionDeCaja`) más estas:
 *  - **Una sola sucursal, siempre elegida.** El pedido trae la sucursal de la cuenta y el caso de uso la valida contra el alcance de la persona; una ajena o inexistente sale como el
 *    genérico, sin pistas. Nunca se asume «todas las sucursales» (SUPUESTO, DEC-0351, confirmado por el orquestador: la maqueta exige elegir una).
 *  - **El tipo no se cambia** al editar (el caso de uso no lo admite); el identificador es opcional y nunca una credencial: el dominio rechaza lo que no tiene su forma.
 */

export type DependenciasDeCuentasDeCobroWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCaja"]>,
    | "crearCuentaDeCobro"
    | "editarCuentaDeCobro"
    | "desactivarCuentaDeCobro"
    | "reactivarCuentaDeCobro"
  >;
  consultas: () => Pick<ReturnType<Web["consultasDeCaja"]>, "listarCuentasDeCobro">;
  respuesta: DependenciasDeRespuesta;
}>;

export type CuentaParaLaPantalla = Readonly<{
  id: string;
  tipo: string;
  nombre: string;
  identificadorExterno: string | null;
  sucursalId: string;
  activa: boolean;
  version: number;
}>;

export type CuentasParaLaPantalla = Readonly<{ cuentas: readonly CuentaParaLaPantalla[] }>;

/** Las cuentas a las que llega la persona (todas las de sus sucursales), también las desactivadas. Es una LECTURA: no escribe ni audita. */
export function listarLasCuentasDeCobro(
  d: DependenciasDeCuentasDeCobroWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<CuentasParaLaPantalla>> {
  return accionDeCaja(
    d.respuesta,
    {},
    () => ({ ok: true, valor: {} }),
    () => d.consultas().listarCuentasDeCobro(contexto, { incluirInactivas: true }),
    (lista) => ({
      cuentas: lista.cuentas.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        nombre: c.nombre,
        identificadorExterno: c.identificadorExterno,
        sucursalId: c.sucursalId,
        activa: c.activa,
        version: c.version,
      })),
    }),
  );
}

export function agregarLaCuentaDeCobro(
  d: DependenciasDeCuentasDeCobroWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ cuentaDeCobroId: string }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeAltaDeCuenta,
    (entrada) => d.casosDeUso().crearCuentaDeCobro(contexto, entrada),
    (salida) => ({ cuentaDeCobroId: salida.cuentaDeCobroId }),
  );
}

export function editarLaCuentaDeCobro(
  d: DependenciasDeCuentasDeCobroWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEdicionDeCuenta,
    (entrada) => d.casosDeUso().editarCuentaDeCobro(contexto, entrada),
    (salida) => ({ version: salida.version }),
  );
}

export function desactivarLaCuentaDeCobro(
  d: DependenciasDeCuentasDeCobroWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeCuenta,
    (entrada) => d.casosDeUso().desactivarCuentaDeCobro(contexto, entrada),
    () => ({}),
  );
}

export function reactivarLaCuentaDeCobro(
  d: DependenciasDeCuentasDeCobroWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<Record<string, never>>>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeEstadoDeCuenta,
    (entrada) => d.casosDeUso().reactivarCuentaDeCobro(contexto, entrada),
    () => ({}),
  );
}
