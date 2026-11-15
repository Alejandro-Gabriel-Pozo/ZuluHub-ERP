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
 * Cuántas personas se piden en una sola consulta. SUPUESTO DEC-0462: una pantalla (un historial, un cierre) nombra a unas pocas personas;
 * el tope evita una lectura sin límite. Una consulta que pide más se rechaza entera (`ENTRADA_INVALIDA`), no se recorta en silencio.
 */
export const MAXIMO_DE_PERSONAS_POR_CONSULTA = 200;

export type EntradaDeNombresDePersonas = Readonly<{ ids: readonly string[] }>;

export type ErrorAlPedirNombresDePersonas =
  MotivoDeRechazo | ErrorDePersistencia | "ENTRADA_INVALIDA";

/**
 * El nombre con que se muestra a cada persona pedida, para las pantallas que hoy reciben solo ids (caja, ventas, cierre). Pide
 * `permisos.ver_propios` al guard (los tres roles) dentro de su transacción (`read committed`, solo lectura). El alcance es la empresa del
 * contexto: solo vuelven las personas pedidas que tienen membresía en ella (activa o apagada: quien ya se fue sigue figurando en lo que
 * hizo); un id de otra empresa o inexistente no aparece, indistinguible entre sí. Cada id pedido aparece una sola vez.
 *
 * SUPUESTO DEC-0462 (D9, el mismo que `listarMiembros` y el traspaso): la persona todavía no tiene nombre propio, así que su nombre es su
 * email, hasta que la autenticación aporte el nombre. Esta función es el único lugar donde pantallas nuevas lo resuelven: el día que
 * exista el nombre cambia acá y no en cada pantalla.
 */
export function armarNombresDePersonas({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function nombresDePersonas(
    contexto: ContextoOperativo,
    entrada: EntradaDeNombresDePersonas,
  ): Promise<Resultado<ReadonlyMap<PersonaId, string>, ErrorAlPedirNombresDePersonas>> {
    const { empresaId } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<ReadonlyMap<PersonaId, string>, ErrorAlPedirNombresDePersonas>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.nombresDePersonas.accion,
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
