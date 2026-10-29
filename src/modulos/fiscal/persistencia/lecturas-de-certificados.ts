import { sql, type Kysely } from "kysely";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { AMBIENTES, type Ambiente } from "../dominio/comprobante-nuevo";
import type { EmisorId } from "../dominio/identificadores";
import {
  COLUMNAS_DE_CERTIFICADO,
  aCertificado,
  type CertificadoGuardado,
} from "./repositorio-de-certificados";
import type { FiscalDb } from "./tablas";

/**
 * Lecturas de certificados para las pantallas del facturador (spec H7 facturación §B.6.1; D-42, 2026-10-29). Solo leen:
 * no hay ninguna escritura acá, y el tipo que reciben las consultas (`Pick` de estas funciones) no ofrece otra cosa.
 * Viven aparte del repositorio de certificados (que es de quien cifra, activa y descarta) por la misma razón que las
 * lecturas de comprobantes: mirar no es operar. Las mismas columnas que el repositorio: ninguna `clave_*`, así que la
 * clave privada (ni cifrada) no puede salir por acá.
 *
 * Todo filtra por empresa aunque la RLS ya lo imponga.
 */
export interface LecturasDeCertificados {
  /**
   * Lo que cuenta hoy de ese emisor en CADA ambiente (primero homologación, después producción), SIN clave y en UNA
   * lectura: el certificado `VIGENTE` si lo hay; si no, el último pedido `PEDIDO_GENERADO`; si no hay ninguno de los
   * dos, `null` (falta cargar). Un reemplazado o un descartado no cuentan.
   */
  actualesDelEmisor(
    empresa: EmpresaId,
    emisor: EmisorId,
  ): Promise<readonly Readonly<{ ambiente: Ambiente; certificado: CertificadoGuardado | null }>[]>;
}

export function crearLecturasDeCertificados(db: Kysely<FiscalDb>): LecturasDeCertificados {
  return {
    async actualesDelEmisor(empresa, emisor) {
      // Una sola sentencia: dos lecturas seguidas podrían ver un pedido que se carga justo en el medio como «nada», y la
      // de un ambiente y la del otro, dos momentos distintos.
      const filas = await db
        .selectFrom("certificado_arca")
        .select(COLUMNAS_DE_CERTIFICADO)
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "in", ["VIGENTE", "PEDIDO_GENERADO"])
        .orderBy(sql`estado = 'VIGENTE'`, "desc")
        .orderBy("creado_en", "desc")
        .orderBy("id")
        .execute();
      return AMBIENTES.map((ambiente) => {
        // Las filas ya vienen ordenadas: la primera de cada ambiente es la que cuenta.
        const fila = filas.find((f) => f.ambiente === ambiente);
        return { ambiente, certificado: fila === undefined ? null : aCertificado(fila) };
      });
    },
  };
}
