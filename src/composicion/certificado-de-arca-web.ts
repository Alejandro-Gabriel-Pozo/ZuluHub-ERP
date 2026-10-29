import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeWeb } from "./accion-de-web";
import { entradaDeEmisor } from "./entradas-de-configuracion-fiscal";
import type { Web } from "./web";

/**
 * El tercer tema de la pantalla de Configuración fiscal (D-43): el certificado de ARCA. Hoy solo se MIRA su estado, por ambiente
 * (`certificados.gestionar`, solo el gerente): generar el pedido y cargar el certificado no salen todavía porque faltan las cadenas
 * de confianza de ARCA (D-F7, ver `web.ts`). Nunca lleva la clave, el pedido (CSR), el PEM ni la huella: ni siquiera se leen.
 * Los instantes salen como texto ISO 8601 en UTC. Mismas reglas que `configuracion-fiscal-web.ts`.
 */

export type DependenciasDeCertificadoDeArcaWeb = Readonly<{
  consultas: () => ReturnType<Web["consultasDeFacturacion"]>;
  respuesta: DependenciasDeRespuesta;
}>;

const iso = (instante: Date): string => instante.toISOString();

type PedidoParaLaPantalla = Readonly<{
  certificadoId: string;
  alias: string;
  cuitTitular: string;
  creadoEn: string;
}>;

/** El estado del certificado de un ambiente. Nunca lleva la clave, el pedido (CSR), el PEM ni la huella. */
export type CertificadoParaLaPantalla =
  | Readonly<{ ambiente: "HOMOLOGACION" | "PRODUCCION"; situacion: "FALTA_CARGAR" }>
  | (Readonly<{ ambiente: "HOMOLOGACION" | "PRODUCCION"; situacion: "PEDIDO_GENERADO" }> &
      PedidoParaLaPantalla)
  | Readonly<{
      ambiente: "HOMOLOGACION" | "PRODUCCION";
      situacion: "VIGENTE";
      certificadoId: string;
      alias: string;
      cuitTitular: string;
      venceEn: string;
      vencido: boolean;
      /** `SIN_VERIFICAR` hasta la primera llamada exitosa a ARCA (D-42). */
      autorizacion: Readonly<{ estado: "SIN_VERIFICAR" } | { estado: "VERIFICADA"; en: string }>;
      /** La renovación en curso: el último pedido sin certificado, aunque ya haya uno vigente. */
      pedidoPendiente: PedidoParaLaPantalla | null;
    }>;

/** El estado de los certificados de un emisor, por ambiente (`certificados.gestionar`). `crudo`: `{ emisorId }`. */
export function estadoDeCertificados(
  d: DependenciasDeCertificadoDeArcaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<readonly CertificadoParaLaPantalla[]>> {
  const pedido = (p: {
    certificadoId: string;
    alias: string;
    cuitTitular: string;
    creadoEn: Date;
  }): PedidoParaLaPantalla => ({
    certificadoId: p.certificadoId,
    alias: p.alias,
    cuitTitular: p.cuitTitular,
    creadoEn: iso(p.creadoEn),
  });
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeEmisor,
    (entrada) => d.consultas().estadoDeCertificados(contexto, entrada),
    (situaciones) =>
      situaciones.map((s): CertificadoParaLaPantalla => {
        if (s.situacion === "FALTA_CARGAR") return { ambiente: s.ambiente, situacion: s.situacion };
        if (s.situacion === "PEDIDO_GENERADO") {
          return { ambiente: s.ambiente, situacion: s.situacion, ...pedido(s) };
        }
        return {
          ambiente: s.ambiente,
          situacion: s.situacion,
          certificadoId: s.certificadoId,
          alias: s.alias,
          cuitTitular: s.cuitTitular,
          venceEn: iso(s.venceEn),
          vencido: s.vencido,
          autorizacion:
            s.autorizacion.estado === "SIN_VERIFICAR"
              ? { estado: "SIN_VERIFICAR" }
              : { estado: "VERIFICADA", en: iso(s.autorizacion.en) },
          pedidoPendiente: s.pedidoPendiente === null ? null : pedido(s.pedidoPendiente),
        };
      }),
  );
}
