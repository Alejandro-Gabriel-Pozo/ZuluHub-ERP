import type {
  CertificadoParaMostrar,
  PedidoPendienteParaMostrar,
} from "../ui/plantillas/configuracion-fiscal/modelo-de-certificado";
import { hoyEnArgentina } from "./entrada-del-listado";

/** Lo que entrega `estadoDeCertificados` de cada ambiente, con la forma que la pantalla lee (sin importar la composición). */
type CertificadoDelServidor =
  | Readonly<{ ambiente: "HOMOLOGACION" | "PRODUCCION"; situacion: "FALTA_CARGAR" }>
  | Readonly<{
      ambiente: "HOMOLOGACION" | "PRODUCCION";
      situacion: "PEDIDO_GENERADO";
      certificadoId: string;
      alias: string;
      cuitTitular: string;
    }>
  | Readonly<{
      ambiente: "HOMOLOGACION" | "PRODUCCION";
      situacion: "VIGENTE";
      alias: string;
      cuitTitular: string;
      /** Un instante ISO 8601 en UTC. */
      venceEn: string;
      vencido: boolean;
      pedidoPendiente: PedidoPendienteParaMostrar | null;
    }>;

/**
 * Del estado del servidor a lo que muestra la pantalla: el vencimiento (un instante) pasa a FECHA CIVIL de Argentina (dueño, 2026-11-03:
 * solo la fecha), con la misma utilidad que usa el listado (`hoyEnArgentina`: nunca la zona del servidor ni la del navegador). Un
 * vencimiento a las 00:30 de Argentina cae en el día anterior en UTC. Chequeo: `test/web/certificado-de-arca-pantallas.test.ts`.
 */
export function aCertificadoParaMostrar(c: CertificadoDelServidor): CertificadoParaMostrar {
  if (c.situacion !== "VIGENTE") return c;
  return {
    ambiente: c.ambiente,
    situacion: "VIGENTE",
    alias: c.alias,
    cuitTitular: c.cuitTitular,
    vence: hoyEnArgentina(new Date(c.venceEn)),
    vencido: c.vencido,
    pedidoPendiente:
      c.pedidoPendiente === null
        ? null
        : {
            certificadoId: c.pedidoPendiente.certificadoId,
            alias: c.pedidoPendiente.alias,
            cuitTitular: c.pedidoPendiente.cuitTitular,
          },
  };
}
