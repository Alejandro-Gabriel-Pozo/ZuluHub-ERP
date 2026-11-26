import { accionesDeCaso } from "../../../capacidades/permisos/declaracion";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { decidirAnonimizacion, esMotivoDeAnonimizacion } from "../dominio/anonimizacion";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeClientes } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeClientes } from "./errores";

type R<S> = Resultado<S, ErrorDeClientes>;

/** El trabajo que avisa a los módulos que guardan copias que una parte se anonimizó (hoy ninguno tiene manejador: se encola igual, ADR-007). */
export const TRABAJO_PARTE_ANONIMIZADA = "clientes.parte_anonimizada";

/** La clave de idempotencia del aviso: UNO por parte, aunque el pedido llegue dos veces o a la vez. */
export const claveDeParteAnonimizada = (parteId: string): string => `parte:${parteId}:anonimizada`;

export type EntradaDeAnonimizarParte = Readonly<{
  parteId: string;
  /** `PEDIDO_DEL_TITULAR` o `BAJA_DE_EMPRESA`; cualquier otro valor se rechaza. */
  motivo: string;
  /** Si el pedido quedó documentado fuera del sistema. Es lo único que se guarda del pedido: el texto de una referencia no se guarda en ningún lado. */
  conReferenciaDelPedido?: boolean | undefined;
}>;

export type SalidaDeAnonimizarParte = Readonly<{ yaEstabaAnonimizada: boolean }>;

/**
 * Anonimizar una parte (derecho de supresión; `clientes-y-proveedores.md` §B.8): en UNA transacción se apagan sus roles y vínculos (con el cargo), se vacían todos
 * sus datos personales, se dejan los avisos a los módulos con copias y se audita. La fila, el id y todo lo que la referencia se conservan.
 *
 * - Guard `partes.anonimizar` (solo el gerente). Después, el motivo (lista cerrada). La parte se bloquea (`FOR UPDATE`) ANTES de mirar qué lo impide: un asiento
 *   del libro de saldos que llega a la vez toma `FOR SHARE` de la misma fila, así que uno espera al otro; si el asiento gana, la parte tiene saldo y queda
 *   impedida; si gana la anonimización, el asiento falla con `PARTE_ANONIMIZADA`.
 * - Impedida (`ANONIMIZACION_IMPEDIDA`) si algún módulo lo pide: hoy, saldo distinto de cero, a favor o en contra. No cambia nada.
 * - Repetición (`YA_ESTABA`): una parte ya anonimizada devuelve `yaEstabaAnonimizada` sin escribir, auditar ni encolar. Una anonimizada no se puede bloquear (la
 *   política de la base excluye su fila del `FOR UPDATE`), así que se lee sin bloqueo: es terminal, no vuelve a cambiar.
 * - Todo o nada: si falla cualquier paso (incluida la copia de otro módulo), no queda ni la parte vacía, ni los roles apagados, ni la auditoría, ni el aviso.
 * - La auditoría y el aviso nunca llevan datos de la parte: solo el motivo, si hay referencia, cuántos roles y vínculos se apagaron y quién lo hizo.
 */
export function armarAnonimizarParte(dependencias: DependenciasDeClientes) {
  return async function anonimizarParte(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnonimizarParte,
  ): Promise<R<SalidaDeAnonimizarParte>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeAnonimizarParte>> => {
        const permiso = await autorizar(
          tx,
          contexto,
          dependencias.reglas,
          accionesDeCaso(DECLARACIONES.anonimizarParte),
        );
        if (!permiso.ok) return permiso;
        if (!esMotivoDeAnonimizacion(entrada.motivo)) {
          return err("MOTIVO_DE_ANONIMIZACION_INVALIDO");
        }
        const motivo = entrada.motivo;

        const bloqueada = await tx.partes.bloquear(empresaId, entrada.parteId);
        const parte = bloqueada ?? (await tx.partes.obtener(empresaId, entrada.parteId));
        if (parte === null) return err("PARTE_NO_ENCONTRADA");

        // Una anonimizada no vuelve a cambiar ni puede tener impedimentos: no se pregunta.
        const impedimentos =
          parte.estado === "ANONIMIZADA"
            ? []
            : await tx.anonimizacionDePartes.impedimentos.impedimentos(empresaId, parte.id);
        const decision = decidirAnonimizacion(parte.estado, impedimentos);
        if (decision.tipo === "YA_ESTABA") return ok({ yaEstabaAnonimizada: true });
        if (decision.tipo === "IMPEDIDA") {
          return err({ error: "ANONIMIZACION_IMPEDIDA", impedimentos: decision.impedimentos });
        }

        const apagadas = await tx.partes.apagarRelacionesDe(empresaId, parte.id);
        const anonimizada = await tx.partes.anonimizar(empresaId, parte.id);
        if (anonimizada === null) {
          throw new Error("clientes: la parte bloqueada no se pudo anonimizar");
        }
        const copias = await tx.anonimizacionDePartes.copias.anonimizarCopiasEnTx(
          empresaId,
          parte.id,
          contexto.ahora,
        );
        if (!copias.ok) return err(copias.error);
        await tx.trabajos.encolar({
          empresaId,
          tipo: TRABAJO_PARTE_ANONIMIZADA,
          datos: { parteId: parte.id },
          claveDeIdempotencia: claveDeParteAnonimizada(parte.id),
        });
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PARTE_ANONIMIZADA",
          entidad: "parte",
          entidadId: parte.id,
          antes: { estado: parte.estado },
          despues: {
            estado: "ANONIMIZADA",
            motivo,
            conReferenciaDelPedido: entrada.conReferenciaDelPedido === true,
            rolesApagados: apagadas.roles,
            vinculosApagados: apagadas.vinculos,
          },
        });
        return ok({ yaEstabaAnonimizada: false });
      },
    );
    return traducir(resultado);
  };
}
