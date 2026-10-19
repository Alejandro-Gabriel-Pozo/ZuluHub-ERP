import type { ContextoDePlataforma } from "../../contexto/contexto";
import type {
  CambioDeEstadoDeEmpresa,
  Empresa,
  RepositorioDeEmpresas,
} from "../../modulos/empresas/publico";
import type { RepositorioDeInvitaciones } from "../../modulos/identidad/publico";
import {
  empresaId,
  type EmpresaId,
  type InvitacionId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AuditoriaDePlataforma } from "../../puertos/auditoria-de-plataforma";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  MOTIVO_DE_REVOCACION_POR_CANCELACION,
  decidirCancelacionDeAlta,
  invitacionARevocarAlCancelar,
  type ErrorDeCancelacionDeAlta,
} from "../dominio/alta";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  ejecutarCasoDePlataforma,
  type ConstanciaDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_CANCELAR_ALTA = "altas.cancelar";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_CANCELAR_ALTA = {
  accion: "altas.cancelar",
} as const satisfies DeclaracionDeAccionDePlataforma;

/** Lo que la cancelación necesita de la transacción, más allá de la plantilla de plataforma. */
export type TxDeCancelacionDeAlta = TxDeCasoDePlataforma &
  Readonly<{
    empresas: RepositorioDeEmpresas;
    invitaciones: RepositorioDeInvitaciones;
  }>;

/** Lo mínimo para cancelar un alta, con o sin guard (el barrido corre como el sistema, sin él). */
export type TxParaCancelar = Readonly<{
  empresas: RepositorioDeEmpresas;
  invitaciones: RepositorioDeInvitaciones;
  auditoriaDePlataforma: AuditoriaDePlataforma;
}>;

export type ErrorAlCancelarElAlta = ErrorDeCancelacionDeAlta | "VERSION_DESACTUALIZADA";

/**
 * Cancela el alta de una empresa YA LEÍDA y en `PROVISIONING` (el llamador decidió el cambio): la pasa a
 * `CANCELLED` con el motivo, revoca la invitación del gerente si sigue pendiente (`ALTA_CANCELADA`: el
 * enlace deja de servir y el trabajo del mail, si todavía no salió, la encuentra revocada y no envía
 * nada) y deja la constancia de plataforma con el actor del contexto. La usan la cancelación manual y el
 * barrido de altas vencidas: una sola forma de cancelar. Cualquier error revierte la transacción entera.
 *
 * Con el aislamiento SERIALIZABLE, aceptar el alta y cancelarla a la vez no pueden ganar los dos: el que
 * pierde se reintenta, ve la empresa ya activa (o ya cancelada) y recibe `ALTA_NO_PENDIENTE`.
 */
export async function cancelarElAlta(
  tx: TxParaCancelar,
  contexto: ContextoDePlataforma,
  empresa: Empresa,
  cambio: CambioDeEstadoDeEmpresa,
): Promise<
  Resultado<Readonly<{ invitacionRevocada: InvitacionId | null }>, "VERSION_DESACTUALIZADA">
> {
  const cancelada = await tx.empresas.cambiarEstado(empresa.id, empresa.version, cambio);
  if (!cancelada.ok) return err("VERSION_DESACTUALIZADA");

  const ultima = await tx.invitaciones.obtenerAltaVigente(empresa.id);
  const aRevocar = invitacionARevocarAlCancelar(ultima);
  if (aRevocar !== null) {
    const revocada = await tx.invitaciones.revocar(
      aRevocar.id,
      aRevocar.version,
      contexto.ahora,
      MOTIVO_DE_REVOCACION_POR_CANCELACION,
    );
    if (!revocada) return err("VERSION_DESACTUALIZADA");
  }

  await tx.auditoriaDePlataforma.registrar({
    accion: "ALTA_CANCELADA",
    entidad: "empresa",
    entidadId: empresa.id,
    antes: { estado: empresa.estado },
    despues: {
      estado: cancelada.empresa.estado,
      motivo: cancelada.empresa.motivoEstado,
      tenantId: empresa.tenantId,
      invitacionRevocada: aRevocar === null ? null : aRevocar.id,
    },
  });
  return ok({ invitacionRevocada: aRevocar === null ? null : aRevocar.id });
}

export type EntradaDeCancelarAlta = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN volver a cancelar ni auditar. */
  claveDeIdempotencia: string;
  empresaId: string;
  /** Obligatorio: por qué se cancela. Se guarda como motivo de la empresa y en la constancia. */
  motivo: string;
}>;

export type SalidaDeCancelarAlta = Readonly<{
  empresaId: EmpresaId;
  /** La invitación del gerente que se revocó, o `null` si no había una pendiente. */
  invitacionRevocada: InvitacionId | null;
  /** `true` cuando esta llamada repite una anterior con la misma clave: no cambió nada. */
  repetida: boolean;
}>;

export type ErrorAlCancelarAlta =
  ErrorComunDeCasoDePlataforma | ErrorAlCancelarElAlta | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA";

/**
 * Cancelar el alta de una empresa a mano (H5 §B.5.3). Contexto de PLATAFORMA, solo ADMIN
 * (`altas.cancelar`). La empresa tiene que seguir en `PROVISIONING` (si ya está activa o cancelada:
 * `ALTA_NO_PENDIENTE`) y el motivo es obligatorio. Pasa a `CANCELLED`, revoca la invitación pendiente del
 * gerente y deja la constancia `ALTA_CANCELADA`. Todo o nada; repetir la misma clave devuelve lo mismo.
 */
export function armarCancelarAlta(
  dependencias: DependenciasDeCasoDePlataforma<TxDeCancelacionDeAlta>,
) {
  return async function cancelarAlta(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeCancelarAlta,
  ): Promise<Resultado<SalidaDeCancelarAlta, ErrorAlCancelarAlta>> {
    return ejecutarCasoDePlataforma<
      TxDeCancelacionDeAlta,
      SalidaDeCancelarAlta,
      Readonly<{ id: EmpresaId; motivo: string }>,
      ErrorAlCancelarElAlta | "ID_INVALIDO" | "EMPRESA_NO_ENCONTRADA"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_CANCELAR_ALTA.accion,
      operacion: OPERACION_CANCELAR_ALTA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const id = uuidDesdeTexto(entrada.empresaId);
        if (!id.ok) return id;
        const motivo = entrada.motivo.trim();
        return ok({
          entrada: { empresaId: id.valor, motivo },
          valor: { id: empresaId(id.valor), motivo },
        });
      },
      trabajar: async (tx, { id, motivo }) => {
        const empresa = await tx.empresas.obtener(id);
        if (empresa === null) return err("EMPRESA_NO_ENCONTRADA");
        const cambio = decidirCancelacionDeAlta(empresa, motivo);
        if (!cambio.ok) return cambio;
        const hecho = await cancelarElAlta(tx, contexto, empresa, cambio.valor);
        if (!hecho.ok) return hecho;
        // La constancia ya la dejó `cancelarElAlta` (la comparte con el barrido).
        const sinConstancias: readonly ConstanciaDePlataforma[] = [];
        return ok({
          salida: {
            empresaId: id,
            invitacionRevocada: hecho.valor.invitacionRevocada,
            repetida: false,
          },
          constancias: sinConstancias,
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, repetida: true }),
    });
  };
}
