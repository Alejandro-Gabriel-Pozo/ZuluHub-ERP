import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeWeb } from "./accion-de-web";
import {
  entradaDeCargarCertificado,
  entradaDeEmisor,
  entradaDeGenerarPedidoDeCertificado,
} from "./entradas-de-configuracion-fiscal";
import type { Web } from "./web";

/**
 * El tercer tema de la pantalla de Configuración fiscal (D-43): el certificado de ARCA, solo el gerente (`certificados.gestionar`).
 * Se puede MIRAR su estado por ambiente, generar el pedido (el CSR en PEM, público: es lo que el gerente sube a ARCA) y cargar el
 * certificado que ARCA devolvió. Mismas reglas que `configuracion-fiscal-web.ts`:
 *  - **El servidor decide quién y dónde.** La empresa y la persona salen del `contexto`; cada caso de uso exige SU acción al guard
 *    dentro de su transacción. Lo único que se toma del navegador es la forma del pedido (Zod, en `entradas-de-configuracion-fiscal.ts`).
 *  - **Repetir no duplica.** El `id` del pedido y el `certificadoId` son la clave de idempotencia: repetir devuelve lo mismo con
 *    `yaExistia` o `yaEstaba`, sin generar otra clave ni escribir ni auditar.
 *  - **Nada secreto.** Nunca sale la clave privada, ni lo cifrado, ni la huella, ni el PEM del certificado: del pedido sale su CSR
 *    (público) y de la carga, solo cuándo vence. El estado dice lo que ya decía.
 *  - **Todo resultado sale por `aRespuestaFiscal`** (ADR-016). Los errores del certificado sin texto aprobado por el dueño salen
 *    como error inesperado con referencia: ver `FISCAL_POR_ERROR_DE_TEXTO` en `errores-fiscales.ts`.
 * Los instantes salen como texto ISO 8601 en UTC.
 */

export type DependenciasDeCertificadoDeArcaWeb = Readonly<{
  consultas: () => ReturnType<Web["consultasDeFacturacion"]>;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo que necesitan las dos acciones del certificado (generar el pedido y cargarlo). */
export type DependenciasDeAccionesDeCertificadoDeArcaWeb = Readonly<{
  casosDeUso: () => ReturnType<Web["casosDeUsoDeCertificados"]>;
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

/**
 * Generar el pedido de un certificado (`certificados.gestionar`). `crudo`: `{ id, emisorId, ambiente, alias, cuitTitular, organizacion }`;
 * `id` lo genera la pantalla y es la clave de idempotencia. Devuelve el pedido (CSR) en PEM, que es público; la clave privada se genera
 * y se guarda cifrada en el servidor y nunca sale. Repetir el mismo pedido devuelve el mismo (`yaExistia: true`) sin otra clave.
 */
export function generarPedidoDeCertificado(
  d: DependenciasDeAccionesDeCertificadoDeArcaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ certificadoId: string; pedidoPem: string; yaExistia: boolean }>>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeGenerarPedidoDeCertificado,
    (entrada) => d.casosDeUso().generarPedidoDeCertificado(contexto, entrada),
    // Lista blanca, campo por campo.
    (s) => ({ certificadoId: s.certificadoId, pedidoPem: s.pedidoPem, yaExistia: s.yaExistia }),
  );
}

/**
 * Cargar el certificado que ARCA devolvió contra su pedido (`certificados.gestionar`). `crudo`: `{ certificadoId, certificadoPem }`,
 * con el certificado en PEM pegado o subido. Sale solo cuándo vence; repetir el mismo certificado devuelve `yaEstaba: true` sin escribir.
 */
export function cargarCertificado(
  d: DependenciasDeAccionesDeCertificadoDeArcaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ venceEn: string; yaEstaba: boolean }>>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeCargarCertificado,
    (entrada) => d.casosDeUso().cargarCertificado(contexto, entrada),
    // Lista blanca: ni el certificado que reemplazó ni la huella.
    (s) => ({ venceEn: iso(s.vence), yaEstaba: s.yaEstaba }),
  );
}
