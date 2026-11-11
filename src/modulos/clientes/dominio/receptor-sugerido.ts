import type { DocumentoDeParte } from "./documento";
import type { NaturalezaDeParte } from "./estados";

/**
 * Los datos de una parte con los que se arma el receptor de una factura A (E9 §3.11: «`datosDeReceptorSugeridos`, pura; E1 y E4 arman con ella el
 * receptor»). Es una SUGERENCIA para precargar la pantalla; la validación del receptor es del módulo fiscal. El documento sale solo si ARCA lo admite
 * como receptor (CUIT, CUIL, CDI, DNI o pasaporte): un documento extranjero no tiene código de ARCA y queda sin documento. Sin nombre (una parte
 * anonimizada) no hay sugerencia.
 */
export type DatosParaReceptor = Readonly<{
  naturaleza: NaturalezaDeParte;
  nombre: string | null;
  apellido: string | null;
  documento: DocumentoDeParte | null;
  condicionIva: string | null;
}>;

export type ReceptorSugerido = Readonly<{
  /** Una persona, «nombre apellido»; una empresa, su razón social. */
  nombre: string;
  documento: Readonly<{
    tipo: "CUIT" | "CUIL" | "CDI" | "DNI" | "PASAPORTE";
    numero: string;
  }> | null;
  condicionIva: string | null;
}>;

export function datosDeReceptorSugeridos(parte: DatosParaReceptor): ReceptorSugerido | null {
  if (parte.nombre === null) return null;
  const nombre =
    parte.naturaleza === "HUMANA" && parte.apellido !== null
      ? `${parte.nombre} ${parte.apellido}`
      : parte.nombre;
  const doc = parte.documento;
  return {
    nombre,
    documento:
      doc === null || doc.tipo === "ID_EXTRANJERO" ? null : { tipo: doc.tipo, numero: doc.numero },
    condicionIva: parte.condicionIva,
  };
}
