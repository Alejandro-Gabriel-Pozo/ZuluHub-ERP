import {
  certificadoId,
  contextoDeSistema,
  dondeSeGuardaLaCredencial,
  type RepositorioDeAccesos,
  type RepositorioDeCertificados,
} from "../../modulos/fiscal/publico";
import { err, ok } from "../../primitivas/resultado/resultado";
import { Secreto } from "../../primitivas/secreto/secreto";
import type { Auditoria } from "../../puertos/auditoria";
import type { AlmacenDeTickets, TicketDeAcceso } from "../../puertos/almacen-de-tickets";
import type { CifradorDeSecretos } from "../../puertos/cifrado-de-secretos";
import type { Transacciones } from "../../puertos/transacciones";

/**
 * El ticket de acceso (TA) de WSAA guardado cifrado en la base (spec H7 facturación §B.5.3 y §B.6.3). Un caché por
 * (certificado, servicio): como a lo sumo un certificado de cada (emisor, ambiente) es el `VIGENTE`, es uno por
 * (emisor, ambiente, servicio). El `token` y la `firma` se cifran JUNTOS, atados a su fila (empresa, tabla,
 * certificado y servicio, columna), y solo viven descifrados en memoria, envueltos en `Secreto`.
 *
 * - `leer` devuelve el ticket del certificado vigente mientras sirva, con 5 minutos de margen antes de `vence`
 *   (ASUMIDO, §B.6.3: un ticket a punto de vencer se renueva antes de que falle un pedido).
 * - `guardar` va en una transacción corta apenas se recibe el ticket (si el proceso muere antes, ARCA no deja pedir
 *   otro por horas). Nunca pisa uno más nuevo: guardar el mismo ticket dos veces, o uno más viejo que el guardado,
 *   no escribe nada (idempotente). Audita `ACCESO_ARCA_RENOVADO` (el hecho: qué certificado, servicio y vencimiento;
 *   nunca el contenido) en la misma transacción.
 */

export type TxDeTickets = Readonly<{
  certificados: Pick<RepositorioDeCertificados, "vigente" | "obtener">;
  accesos: Pick<RepositorioDeAccesos, "asegurar" | "obtenerCredencial" | "guardarCredencial">;
  auditoria: Auditoria;
}>;

export type DependenciasDeTickets = Readonly<{
  transacciones: Transacciones<TxDeTickets>;
  cifrador: CifradorDeSecretos;
  reloj: Readonly<{ ahora(): Date }>;
}>;

/** Cuánto antes de su vencimiento un ticket deja de servir. */
const MARGEN_DEL_TICKET_EN_MS = 5 * 60_000;

/** El token y la firma, en un solo texto para cifrar juntos. */
const empaquetar = (token: Secreto, firma: Secreto): Secreto =>
  new Secreto(JSON.stringify([token.revelar(), firma.revelar()]));

function desempaquetar(secreto: Secreto): Readonly<{ token: Secreto; firma: Secreto }> | null {
  try {
    const partes: unknown = JSON.parse(secreto.revelar());
    if (
      Array.isArray(partes) &&
      partes.length === 2 &&
      typeof partes[0] === "string" &&
      typeof partes[1] === "string"
    ) {
      return { token: new Secreto(partes[0]), firma: new Secreto(partes[1]) };
    }
    return null;
  } catch {
    return null;
  }
}

export function crearAlmacenDeTickets({
  transacciones,
  cifrador,
  reloj,
}: DependenciasDeTickets): AlmacenDeTickets {
  return {
    leer(empresa, emisor, ambiente, servicio) {
      const ahora = reloj.ahora();
      return transacciones.ejecutar(
        { contexto: contextoDeSistema(empresa, ahora), soloLectura: true },
        async (tx) => {
          const vigente = await tx.certificados.vigente(empresa, emisor, ambiente);
          if (vigente === null) return ok(null);
          const guardado = await tx.accesos.obtenerCredencial(empresa, vigente.id, servicio);
          if (guardado === null) return ok(null);
          if (guardado.expiraEn.getTime() - MARGEN_DEL_TICKET_EN_MS <= ahora.getTime()) {
            return ok(null);
          }
          const claro = cifrador.descifrar(
            guardado.credencial,
            dondeSeGuardaLaCredencial(empresa, vigente.id, servicio),
          );
          const partes = claro === null ? null : desempaquetar(claro);
          if (partes === null) return err("TICKET_ILEGIBLE" as const);
          const ticket: TicketDeAcceso = {
            certificadoId: vigente.id,
            token: partes.token,
            firma: partes.firma,
            generadoEn: guardado.generadoEn,
            venceEn: guardado.expiraEn,
          };
          return ok(ticket);
        },
      );
    },

    guardar(empresa, emisor, ambiente, servicio, ticket) {
      const ahora = reloj.ahora();
      return transacciones.ejecutar({ contexto: contextoDeSistema(empresa, ahora) }, async (tx) => {
        const certificado = await tx.certificados.obtener(
          empresa,
          certificadoId(ticket.certificadoId),
        );
        // Un ticket solo lo pide un certificado cargado: el pedido todavía no tiene certificado.
        if (
          certificado === null ||
          certificado.emisorId !== emisor ||
          certificado.ambiente !== ambiente ||
          certificado.certificadoPem === null
        ) {
          return err("CERTIFICADO_NO_ENCONTRADO" as const);
        }
        const acceso = await tx.accesos.asegurar(empresa, certificado.id, servicio);
        // Nunca pisa uno más nuevo; el mismo ticket guardado otra vez tampoco escribe.
        if (
          acceso.generadoEn !== null &&
          acceso.generadoEn.getTime() >= ticket.generadoEn.getTime()
        ) {
          return ok(null);
        }
        const guardado = await tx.accesos.guardarCredencial(empresa, certificado.id, servicio, {
          credencial: cifrador.cifrar(
            empaquetar(ticket.token, ticket.firma),
            dondeSeGuardaLaCredencial(empresa, certificado.id, servicio),
          ),
          generadoEn: ticket.generadoEn,
          expiraEn: ticket.venceEn,
        });
        if (guardado === null) throw new Error("el acceso de ARCA no existe después de asegurarlo");
        await tx.auditoria.registrar({
          empresaId: empresa,
          actorPersonaId: null,
          accion: "ACCESO_ARCA_RENOVADO",
          entidad: "certificado_arca",
          entidadId: certificado.id,
          despues: {
            servicio,
            ambiente,
            generadoEn: ticket.generadoEn.toISOString(),
            vence: ticket.venceEn.toISOString(),
          },
        });
        return ok(null);
      });
    },
  };
}
