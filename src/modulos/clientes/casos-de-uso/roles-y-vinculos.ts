import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  cargoDeVinculoDesdeTexto,
  esTipoDeVinculo,
  validarVinculo,
  type TipoDeVinculo,
} from "../dominio/vinculos";
import { decidirRoles, rolesPedidos, type RolDeParte } from "../dominio/roles";
import { esUuid } from "../persistencia/filas";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeClientes } from "./contrato";
import type { ErrorDeClientes } from "./errores";

type R<S> = Resultado<S, ErrorDeClientes>;

export type EntradaDeCambiarRolesDeParte = Readonly<{
  parteId: string;
  /** El conjunto final de roles activos. */
  roles: readonly string[];
}>;
export type SalidaDeCambiarRolesDeParte = Readonly<{
  agregados: readonly RolDeParte[];
  reactivados: readonly RolDeParte[];
  quitados: readonly RolDeParte[];
}>;

/**
 * Cambiar los roles de una parte (E9 §3.1): se pide el conjunto FINAL de roles activos. Guard `partes.cambiar_roles`; la parte se bloquea. Los roles no se
 * borran: se apagan y se reactivan. Repetición (`SIN_CAMBIOS`): pedir lo que ya está da las tres listas vacías sin escribir ni auditar.
 */
export function armarCambiarRolesDeParte(dependencias: DependenciasDeClientes) {
  return async function cambiarRolesDeParte(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarRolesDeParte,
  ): Promise<R<SalidaDeCambiarRolesDeParte>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarRolesDeParte>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "partes.cambiar_roles",
        ]);
        if (!permiso.ok) return permiso;
        const pedidos = rolesPedidos(entrada.roles);
        if (pedidos === null) return err("ROL_DE_PARTE_INVALIDO");
        const parte = await tx.partes.bloquear(empresaId, entrada.parteId);
        if (parte === null) return err("PARTE_NO_ENCONTRADA");
        const cambio = decidirRoles(await tx.partes.rolesDe(empresaId, [parte.id]), pedidos);
        for (const rol of cambio.agregados) await tx.partes.insertarRol(empresaId, parte.id, rol);
        for (const rol of cambio.reactivados) {
          await tx.partes.cambiarActivoDeRol(empresaId, parte.id, rol, true);
        }
        for (const rol of cambio.quitados) {
          await tx.partes.cambiarActivoDeRol(empresaId, parte.id, rol, false);
        }
        if (cambio.agregados.length + cambio.reactivados.length + cambio.quitados.length > 0) {
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: "PARTE_ROLES_CAMBIADOS",
            entidad: "parte",
            entidadId: parte.id,
            despues: {
              agregados: [...cambio.agregados],
              reactivados: [...cambio.reactivados],
              quitados: [...cambio.quitados],
            },
          });
        }
        return ok(cambio);
      },
    );
    return traducir(resultado);
  };
}

export type EntradaDeVincularContacto = Readonly<{
  /** La persona que es contacto o agente. */
  contactoId: string;
  /** La parte de la que es contacto o agente. */
  deParteId: string;
  tipo: string;
  cargo?: string | null | undefined;
}>;
export type SalidaDeVincularContacto = Readonly<{ yaExistia: boolean }>;

export type EntradaDeDesvincularContacto = Readonly<{
  contactoId: string;
  deParteId: string;
  tipo: string;
}>;
export type SalidaDeDesvincularContacto = Readonly<{ yaEstaba: boolean }>;

/**
 * Vincular una persona como contacto (o agente) de otra parte (E9 §3.1). Guard `partes.vincular_contacto`; las dos partes se bloquean EN ORDEN de id (dos
 * vínculos cruzados a la vez no se traban entre sí). Nadie es contacto de sí mismo; quien es contacto o agente es una persona, y de un agente la otra punta
 * es una empresa. Repetición (`YA_ESTABA`): el vínculo activo con el mismo cargo devuelve `yaExistia`; uno apagado se reactiva (con el cargo nuevo).
 */
export function armarVincularContacto(dependencias: DependenciasDeClientes) {
  return async function vincularContacto(
    contexto: ContextoOperativo,
    entrada: EntradaDeVincularContacto,
  ): Promise<R<SalidaDeVincularContacto>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeVincularContacto>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "partes.vincular_contacto",
        ]);
        if (!permiso.ok) return permiso;
        if (!esTipoDeVinculo(entrada.tipo)) return err("TIPO_DE_VINCULO_INVALIDO");
        const tipo: TipoDeVinculo = entrada.tipo;
        const cargo = cargoDeVinculoDesdeTexto(entrada.cargo);
        if (!cargo.ok) return cargo;
        if (!esUuid(entrada.contactoId) || !esUuid(entrada.deParteId)) {
          return err("PARTE_NO_ENCONTRADA");
        }
        // Bloquear en orden de id: el orden fijo evita el interbloqueo entre dos pedidos cruzados.
        const [primero, segundo] = [entrada.contactoId, entrada.deParteId].sort();
        const a = await tx.partes.bloquear(empresaId, primero ?? "");
        const b = primero === segundo ? a : await tx.partes.bloquear(empresaId, segundo ?? "");
        const contacto = entrada.contactoId === primero ? a : b;
        const deParte = entrada.deParteId === primero ? a : b;
        if (contacto === null || deParte === null) return err("PARTE_NO_ENCONTRADA");
        const valido = validarVinculo(tipo, contacto, deParte);
        if (!valido.ok) return valido;
        const actual = await tx.partes.vinculo(empresaId, contacto.id, deParte.id, tipo);
        if (actual !== null && actual.activo && actual.cargo === cargo.valor) {
          return ok({ yaExistia: true });
        }
        if (actual === null) {
          await tx.partes.insertarVinculo(empresaId, {
            parteId: contacto.id,
            deParteId: deParte.id,
            tipo,
            cargo: cargo.valor,
          });
        } else {
          await tx.partes.actualizarVinculo(
            empresaId,
            { parteId: contacto.id, deParteId: deParte.id, tipo },
            { activo: true, cargo: cargo.valor },
          );
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PARTE_VINCULADA",
          entidad: "parte",
          entidadId: deParte.id,
          despues: { contactoId: contacto.id, tipo, conCargo: cargo.valor !== null },
        });
        return ok({ yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/** Desvincular un contacto (E9 §3.1): guard `partes.desvincular_contacto`; el vínculo se apaga, no se borra. Repetición (`YA_ESTABA`). */
export function armarDesvincularContacto(dependencias: DependenciasDeClientes) {
  return async function desvincularContacto(
    contexto: ContextoOperativo,
    entrada: EntradaDeDesvincularContacto,
  ): Promise<R<SalidaDeDesvincularContacto>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeDesvincularContacto>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, [
          "partes.desvincular_contacto",
        ]);
        if (!permiso.ok) return permiso;
        if (!esTipoDeVinculo(entrada.tipo)) return err("TIPO_DE_VINCULO_INVALIDO");
        if (!esUuid(entrada.contactoId) || !esUuid(entrada.deParteId)) {
          return err("PARTE_NO_ENCONTRADA");
        }
        const actual = await tx.partes.vinculo(
          empresaId,
          entrada.contactoId,
          entrada.deParteId,
          entrada.tipo,
        );
        if (actual === null) return err("PARTE_NO_ENCONTRADA");
        if (!actual.activo) return ok({ yaEstaba: true });
        await tx.partes.actualizarVinculo(
          empresaId,
          { parteId: entrada.contactoId, deParteId: entrada.deParteId, tipo: entrada.tipo },
          { activo: false, cargo: actual.cargo },
        );
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PARTE_DESVINCULADA",
          entidad: "parte",
          entidadId: entrada.deParteId,
          despues: { contactoId: entrada.contactoId, tipo: entrada.tipo },
        });
        return ok({ yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}
