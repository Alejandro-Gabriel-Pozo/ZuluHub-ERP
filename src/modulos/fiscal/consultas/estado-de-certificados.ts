import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { CertificadoGuardado } from "../persistencia/repositorio-de-certificados";
import type { RepositorioDeEmisores } from "../persistencia/repositorios";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * El estado de los certificados de ARCA de un emisor, por ambiente (spec H7 facturación §B.6.1; D-42, 2026-10-29): lo que
 * la pantalla de configuración fiscal necesita para decir si falta cargar, si hay un pedido esperando el certificado, o
 * si hay uno vigente (hasta cuándo, si ya venció y si ARCA ya aceptó su autorización). Es de SOLO LECTURA: por tipos no
 * hay auditoría ni trabajos, y ninguna columna cifrada, ni el PEM, ni la huella, ni el pedido salen (solo lo que se puede
 * mostrar).
 *
 * Exige `certificados.gestionar` (gerente: D-43, la configuración fiscal es solo del gerente) al guard dentro de su
 * transacción (`read committed`, solo lectura). Ese permiso ya existe; no se creó uno nuevo para mirar.
 */

/** Si ARCA ya aceptó al certificado para actuar por la empresa: se sabe recién con la primera llamada exitosa. */
export type AutorizacionDelCertificado =
  Readonly<{ estado: "SIN_VERIFICAR" }> | Readonly<{ estado: "VERIFICADA"; en: Date }>;

export type SituacionDelCertificado =
  | Readonly<{ ambiente: CertificadoGuardado["ambiente"]; situacion: "FALTA_CARGAR" }>
  | Readonly<{
      ambiente: CertificadoGuardado["ambiente"];
      situacion: "PEDIDO_GENERADO";
      certificadoId: CertificadoGuardado["id"];
      alias: string;
      cuitTitular: CertificadoGuardado["cuitTitular"];
      creadoEn: Date;
    }>
  | Readonly<{
      ambiente: CertificadoGuardado["ambiente"];
      situacion: "VIGENTE";
      certificadoId: CertificadoGuardado["id"];
      alias: string;
      cuitTitular: CertificadoGuardado["cuitTitular"];
      venceEn: Date;
      /** Se calcula con la hora del contexto (`venceEn <= ahora`), no se guarda. */
      vencido: boolean;
      autorizacion: AutorizacionDelCertificado;
    }>;

export type EntradaDeEstadoDeCertificados = Readonly<{
  emisorId: Parameters<RepositorioDeEmisores["obtener"]>[1];
}>;

/** El emisor de otra empresa es indistinguible de uno que no existe. */
export type ErrorAlVerElEstadoDeCertificados =
  MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | ErrorDePersistencia;

export function armarEstadoDeCertificados({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function estadoDeCertificados(
    contexto: ContextoOperativo,
    entrada: EntradaDeEstadoDeCertificados,
  ): Promise<Resultado<readonly SituacionDelCertificado[], ErrorAlVerElEstadoDeCertificados>> {
    const { empresaId, ahora } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<readonly SituacionDelCertificado[], MotivoDeRechazo | "EMISOR_NO_ENCONTRADO">
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.estadoDeCertificados.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        if ((await tx.emisores.obtener(empresaId, entrada.emisorId)) === null) {
          return err("EMISOR_NO_ENCONTRADO");
        }
        const situaciones: SituacionDelCertificado[] = [];
        for (const {
          ambiente,
          certificado: c,
        } of await tx.lecturasDeCertificados.actualesDelEmisor(empresaId, entrada.emisorId)) {
          if (c === null) {
            situaciones.push({ ambiente, situacion: "FALTA_CARGAR" });
          } else if (c.estado === "VIGENTE") {
            // La base lo impide (`certificado_cargado_ck`): un vigente siempre tiene vencimiento.
            if (c.venceEn === null) throw new Error("un certificado vigente sin vencimiento");
            situaciones.push({
              ambiente,
              situacion: "VIGENTE",
              certificadoId: c.id,
              alias: c.alias,
              cuitTitular: c.cuitTitular,
              venceEn: c.venceEn,
              vencido: c.venceEn.getTime() <= ahora.getTime(),
              autorizacion:
                c.autorizacionVerificadaEn === null
                  ? { estado: "SIN_VERIFICAR" }
                  : { estado: "VERIFICADA", en: c.autorizacionVerificadaEn },
            });
          } else {
            situaciones.push({
              ambiente,
              situacion: "PEDIDO_GENERADO",
              certificadoId: c.id,
              alias: c.alias,
              cuitTitular: c.cuitTitular,
              creadoEn: c.creadoEn,
            });
          }
        }
        return ok(situaciones);
      },
    );
  };
}
