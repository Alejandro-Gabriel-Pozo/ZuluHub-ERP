import type { EmpresaId } from "../primitivas/identificadores/marca";
import type { Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "./transacciones";

/**
 * Que ARCA aceptó a un certificado para actuar por la empresa (D-42, 2026-10-29; spec H7 fiscal §B.9 y H7 facturación
 * §B.6.2). Al cargar un certificado NO se puede saber si la persona que lo sacó tiene la autorización de la empresa
 * (eso vive en ARCA): el certificado queda «autorización sin verificar» y la primera llamada exitosa a un servicio de ARCA
 * con su ticket lo anota. Se anota UNA vez y no se pisa.
 */
export interface VerificacionDeAutorizacion {
  /**
   * Anota la verificación del certificado `VIGENTE`. `cambio: true` solo para quien la anotó; si ya estaba anotada, o el
   * certificado ya no es el vigente (lo reemplazaron mientras se llamaba a ARCA), no escribe nada y devuelve
   * `cambio: false`: repetir, o dos llamadas a la vez, producen UN solo cambio.
   */
  anotar(
    empresa: EmpresaId,
    certificado: string,
  ): Promise<Resultado<Readonly<{ cambio: boolean }>, ErrorDePersistencia>>;
}
