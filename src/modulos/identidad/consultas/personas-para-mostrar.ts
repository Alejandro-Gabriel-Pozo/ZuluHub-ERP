import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  esUuidCanonico,
  personaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Cuántas personas se piden en una sola consulta. SUPUESTO DEC-0464: una pantalla (un historial, un cierre) muestra a unas pocas personas;
 * el tope evita una lectura sin límite. Una consulta que pide más se rechaza entera (`ENTRADA_INVALIDA`), no se recorta en silencio.
 */
export const MAXIMO_DE_PERSONAS_POR_CONSULTA = 200;

export type EntradaDePersonasParaMostrar = Readonly<{ ids: readonly string[] }>;

export type ErrorAlPedirPersonasParaMostrar =
  MotivoDeRechazo | ErrorDePersistencia | "ENTRADA_INVALIDA";

/**
 * El valor con que se muestra a cada persona pedida, para las pantallas que hoy reciben solo ids (caja, ventas, cierre): su CORREO (el
 * dueño decidió que se muestre el correo, sin nombre: fila «Respuestas 24 a 27», 26A, del 15/11/2026). Pide `permisos.ver_propios` al guard
 * (los tres roles) dentro de su transacción (`read committed`, solo lectura). El alcance es la empresa del contexto: solo vuelven las
 * personas pedidas que tienen membresía en ella (activa o apagada: quien ya se fue sigue figurando en lo que hizo), así que no se filtra el
 * correo de nadie que no sea de la empresa; un id de otra empresa o inexistente no aparece, indistinguible entre sí. Cada id pedido aparece
 * una sola vez. Si algún día hay nombre propio, se cambia acá y no en cada pantalla.
 */
export function armarPersonasParaMostrar({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function personasParaMostrar(
    contexto: ContextoOperativo,
    entrada: EntradaDePersonasParaMostrar,
  ): Promise<Resultado<ReadonlyMap<PersonaId, string>, ErrorAlPedirPersonasParaMostrar>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<ReadonlyMap<PersonaId, string>, ErrorAlPedirPersonasParaMostrar>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.personasParaMostrar.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        // Lo que se PERMITE: una lista de hasta `MAXIMO_DE_PERSONAS_POR_CONSULTA` ids con forma de uuid; cualquier otra cosa se rechaza.
        if (!Array.isArray(entrada.ids) || entrada.ids.length > MAXIMO_DE_PERSONAS_POR_CONSULTA) {
          return err("ENTRADA_INVALIDA");
        }
        if (!entrada.ids.every((id) => typeof id === "string" && esUuidCanonico(id))) {
          return err("ENTRADA_INVALIDA");
        }
        const pedidas = [...new Set(entrada.ids)].map(personaId);
        const filas = await tx.membresias.emailsDeMiembros(empresaId, pedidas);
        return ok(new Map(filas.map((fila) => [fila.personaId, fila.email])));
      },
    );
  };
}
