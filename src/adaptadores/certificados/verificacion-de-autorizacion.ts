import {
  certificadoId,
  contextoDeSistema,
  type RepositorioDeCertificados,
} from "../../modulos/fiscal/publico";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Auditoria } from "../../puertos/auditoria";
import type { Transacciones } from "../../puertos/transacciones";
import type { VerificacionDeAutorizacion } from "../../puertos/verificacion-de-autorizacion";

/**
 * La primera llamada exitosa a ARCA con un certificado anota que su titular está autorizado a actuar por la empresa
 * (D-42; spec H7 facturación §B.6.2). Una transacción corta con contexto de sistema, nunca dentro de la de otro caso de
 * uso (ADR-007: la llamada a ARCA va afuera).
 *
 * Idempotente y sin carreras: el cambio es un `UPDATE ... WHERE autorizacion_verificada_en IS NULL` sobre el certificado
 * `VIGENTE` (y la base no deja pisar una verificación ya anotada). De dos llamadas simultáneas gana una: la otra no
 * encuentra fila para cambiar (o, bajo aislamiento serializable, reintenta y ya no la encuentra) y no audita. El hecho
 * queda en la auditoría de la MISMA transacción (`CERTIFICADO_AUTORIZACION_VERIFICADA`): qué certificado y cuándo,
 * nada más.
 */

export type TxDeVerificacion = Readonly<{
  certificados: Pick<RepositorioDeCertificados, "anotarVerificacion">;
  auditoria: Auditoria;
}>;

export type DependenciasDeVerificacion = Readonly<{
  transacciones: Transacciones<TxDeVerificacion>;
  /** La hora de la verificación (la composición pasa el reloj del sistema). */
  reloj: Readonly<{ ahora(): Date }>;
}>;

export function crearVerificacionDeAutorizacion({
  transacciones,
  reloj,
}: DependenciasDeVerificacion): VerificacionDeAutorizacion {
  return {
    anotar(empresa, certificado) {
      const ahora = reloj.ahora();
      return transacciones.ejecutar(
        { contexto: contextoDeSistema(empresa, ahora) },
        async (tx): Promise<Resultado<Readonly<{ cambio: boolean }>, never>> => {
          const anotado = await tx.certificados.anotarVerificacion(
            empresa,
            certificadoId(certificado),
            ahora,
          );
          if (anotado === null) return ok({ cambio: false });
          await tx.auditoria.registrar({
            empresaId: empresa,
            actorPersonaId: null,
            accion: "CERTIFICADO_AUTORIZACION_VERIFICADA",
            entidad: "certificado_arca",
            entidadId: anotado.id,
            antes: { autorizacion: "SIN_VERIFICAR" },
            despues: { autorizacion: "VERIFICADA", verificadaEn: ahora.toISOString() },
          });
          return ok({ cambio: true });
        },
      );
    },
  };
}
