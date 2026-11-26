import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeCondiciones,
  entradaDeHabilitar,
  entradaDeReactivar,
  entradaDeSuspender,
} from "./entradas-de-cuenta-corriente";
import { accionDeClientes } from "./errores-de-clientes";
import type { Web } from "./web";

/**
 * Las escrituras de la ficha de cuenta corriente de clientes (CC-5, A2): habilitar a un cliente, cambiar plazo y límite, suspender y reactivar. Cada una ya trae su permiso
 * (`cuenta_corriente.administrar`), su aislamiento por empresa, su transacción, su auditoría en la misma transacción y su repetición segura; acá solo se arma el pedido y se traduce el resultado:
 *  - **La empresa y la persona salen del contexto**, nunca del pedido; un campo de más es el genérico.
 *  - **Habilitar repetido no duplica**: el `id` lo genera la pantalla al abrir el formulario y viaja como clave de idempotencia; el mismo `id` con el mismo contenido devuelve la ficha ya hecha.
 *  - **Cambiar, suspender y reactivar llevan la versión que se vio**: si otra persona cambió la ficha antes, el servidor rechaza; repetir lo ya hecho devuelve lo vigente sin escribir ni auditar de nuevo.
 *  - Todo error de negocio (versión vieja, ya habilitada, plazo o límite o motivo inválido, cliente sin CUIT) sale como el genérico: la pantalla no replica reglas ni distingue casos.
 * Previene: una ficha duplicada por un doble clic, dos personas pisándose el límite y un permiso decidido por la pantalla. Chequeo: `test/integracion/cuenta-corriente-escritura-web.test.ts`.
 */

export type DependenciasDeCuentaCorrienteEscrituraWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCuentaCorriente"]>,
    | "habilitarCuentaDelCliente"
    | "cambiarCondicionesDeLaCuenta"
    | "suspenderCuentaDelCliente"
    | "reactivarCuentaDelCliente"
  >;
  consultas: () => Pick<ReturnType<Web["consultasDeCuentaCorriente"]>, "listarClientesSinCuenta">;
  respuesta: DependenciasDeRespuesta;
}>;

export type ClienteParaHabilitar = Readonly<{
  parteId: string;
  nombre: string | null;
  cuit: string | null;
}>;

/** Los clientes activos sin cuenta corriente, para el formulario de habilitar (incluye a los que no tienen CUIT: la pantalla avisa y no deja habilitar). Es una LECTURA. */
export async function clientesParaHabilitar(
  d: DependenciasDeCuentaCorrienteEscrituraWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<Readonly<{ clientes: readonly ClienteParaHabilitar[] }>>> {
  return accionDeClientes(
    d.respuesta,
    {},
    () => ({ ok: true, valor: {} }),
    () => d.consultas().listarClientesSinCuenta(contexto),
    (lista) => ({
      clientes: lista.map((c) => ({ parteId: c.parteId, nombre: c.nombre, cuit: c.cuit })),
    }),
  );
}

export function habilitarLaCuenta(
  d: DependenciasDeCuentaCorrienteEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ parteId: string }>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeHabilitar,
    (entrada) =>
      d.casosDeUso().habilitarCuentaDelCliente(contexto, {
        claveDeIdempotencia: entrada.id,
        parteId: entrada.parteId,
        plazoDias: entrada.plazoDias,
        limite: entrada.limite,
      }),
    (salida) => ({ parteId: salida.cuenta.parteId }),
  );
}

export function cambiarLasCondiciones(
  d: DependenciasDeCuentaCorrienteEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ parteId: string; sinCambios: boolean }>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeCondiciones,
    (entrada) => d.casosDeUso().cambiarCondicionesDeLaCuenta(contexto, entrada),
    (salida) => ({ parteId: salida.cuenta.parteId, sinCambios: salida.sinCambios }),
  );
}

export function suspenderLaCuenta(
  d: DependenciasDeCuentaCorrienteEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ parteId: string; yaEstaba: boolean }>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeSuspender,
    (entrada) => d.casosDeUso().suspenderCuentaDelCliente(contexto, entrada),
    (salida) => ({ parteId: salida.cuenta.parteId, yaEstaba: salida.yaEstaba }),
  );
}

export function reactivarLaCuenta(
  d: DependenciasDeCuentaCorrienteEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ parteId: string; yaEstaba: boolean }>>> {
  return accionDeClientes(
    d.respuesta,
    crudo,
    entradaDeReactivar,
    (entrada) => d.casosDeUso().reactivarCuentaDelCliente(contexto, entrada),
    (salida) => ({ parteId: salida.cuenta.parteId, yaEstaba: salida.yaEstaba }),
  );
}
