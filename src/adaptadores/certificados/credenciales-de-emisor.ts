import {
  contextoDeSistema,
  dondeSeGuardaLaClave,
  type RepositorioDeCertificados,
} from "../../modulos/fiscal/publico";
import { err, ok } from "../../primitivas/resultado/resultado";
import type { CifradorDeSecretos } from "../../puertos/cifrado-de-secretos";
import type { CredencialesDeEmisor } from "../../puertos/credenciales-de-emisor";
import type { Transacciones } from "../../puertos/transacciones";

/**
 * Las credenciales de un emisor para quien firma el pedido de ticket de acceso a ARCA (spec H7 facturación §B.6.3):
 * el certificado VIGENTE de ese (emisor, ambiente) y su clave privada, descifrada SOLO en memoria (envuelta en un
 * `Secreto`) y atada a su fila. Corre en una transacción corta de solo lectura con contexto de sistema, y nunca
 * dentro de la de otro caso de uso (ADR-007: el pedido a ARCA va afuera). No audita: leer no cambia nada.
 *
 * Los errores nombran qué falta (no hay vigente, venció, la clave no se descifra), nunca la clave ni su cifrado.
 */

export type TxDeCredenciales = Readonly<{
  certificados: Pick<RepositorioDeCertificados, "vigente" | "obtenerClave">;
}>;

export type DependenciasDeCredenciales = Readonly<{
  transacciones: Transacciones<TxDeCredenciales>;
  cifrador: CifradorDeSecretos;
  /** La hora para saber si el certificado venció (la composición pasa el reloj del sistema). */
  reloj: Readonly<{ ahora(): Date }>;
}>;

export function crearCredencialesDeEmisor({
  transacciones,
  cifrador,
  reloj,
}: DependenciasDeCredenciales): CredencialesDeEmisor {
  return {
    obtener(empresa, emisor, ambiente) {
      const ahora = reloj.ahora();
      return transacciones.ejecutar(
        { contexto: contextoDeSistema(empresa, ahora), soloLectura: true },
        async (tx) => {
          const vigente = await tx.certificados.vigente(empresa, emisor, ambiente);
          if (vigente === null || vigente.certificadoPem === null || vigente.venceEn === null) {
            return err("SIN_CERTIFICADO_VIGENTE" as const);
          }
          if (vigente.venceEn.getTime() <= ahora.getTime())
            return err("CERTIFICADO_VENCIDO" as const);
          const guardada = await tx.certificados.obtenerClave(empresa, vigente.id);
          if (guardada === null)
            throw new Error("el certificado vigente existe pero su clave no es visible");
          const clavePrivada = cifrador.descifrar(
            guardada,
            dondeSeGuardaLaClave(empresa, vigente.id),
          );
          if (clavePrivada === null) return err("CLAVE_ILEGIBLE" as const);
          return ok({
            certificadoId: vigente.id,
            certificadoPem: vigente.certificadoPem,
            clavePrivada,
            venceEn: vigente.venceEn,
          });
        },
      );
    },
  };
}
