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
 *
 * Una vez verificado, un certificado no se vuelve a abrir una transacción por él: la verificación no se pisa nunca (la base
 * lo impide), así que recordarla en memoria es siempre correcto. Cada instancia recuerda lo suyo; la composición crea una
 * sola por proceso. La primera llamada de un proceso sí lee el certificado (para enterarse), y solo escribe si falta.
 */

export type TxDeVerificacion = Readonly<{
  certificados: Pick<RepositorioDeCertificados, "obtener" | "anotarVerificacion">;
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
  /** Los certificados (`empresa|id`) que ya se sabe verificados. Crece de a un texto corto por certificado. */
  const yaVerificados = new Set<string>();
  return {
    async anotar(empresa, certificado) {
      const clave = `${empresa}|${certificado}`;
      if (yaVerificados.has(clave)) return ok({ cambio: false });
      const ahora = reloj.ahora();
      const r = await transacciones.ejecutar(
        { contexto: contextoDeSistema(empresa, ahora) },
        async (
          tx,
        ): Promise<Resultado<Readonly<{ cambio: boolean; verificado: boolean }>, never>> => {
          const id = certificadoId(certificado);
          const actual = await tx.certificados.obtener(empresa, id);
          // Ya verificado: nada que escribir (y se recuerda). Que no exista, o ya no sea el vigente: tampoco.
          if (actual?.autorizacionVerificadaEn != null) {
            return ok({ cambio: false, verificado: true });
          }
          if (actual === null || actual.estado !== "VIGENTE") {
            return ok({ cambio: false, verificado: false });
          }
          const anotado = await tx.certificados.anotarVerificacion(empresa, id, ahora);
          if (anotado === null) return ok({ cambio: false, verificado: false });
          await tx.auditoria.registrar({
            empresaId: empresa,
            actorPersonaId: null,
            accion: "CERTIFICADO_AUTORIZACION_VERIFICADA",
            entidad: "certificado_arca",
            entidadId: anotado.id,
            antes: { autorizacion: "SIN_VERIFICAR" },
            despues: { autorizacion: "VERIFICADA", verificadaEn: ahora.toISOString() },
          });
          return ok({ cambio: true, verificado: true });
        },
      );
      // Recién con la transacción confirmada (si se reintenta, el trabajo corre de nuevo).
      if (r.ok && r.valor.verificado) yaVerificados.add(clave);
      return r.ok ? ok({ cambio: r.valor.cambio }) : r;
    },
  };
}
