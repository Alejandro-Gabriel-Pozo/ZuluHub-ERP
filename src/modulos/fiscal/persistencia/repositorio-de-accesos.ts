import { sql, type Kysely } from "kysely";
import { empresaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import type { DondeSeGuarda, TextoCifrado } from "../../../puertos/cifrado-de-secretos";
import { certificadoId, type CertificadoId } from "../dominio/identificadores";
import { aBytes } from "./repositorio-de-certificados";
import { deLaLista, exigir } from "./repositorios";
import type { FiscalDb } from "./tablas";

/**
 * Repositorio de la credencial de acceso a ARCA (`acceso_arca`; spec H7 facturación §B.6, §B.8.5). Salió de
 * `repositorio-de-certificados.ts` sin cambiar una línea de lógica (partir el archivo de más de 400 líneas) y
 * sigue las mismas reglas: es, con ese archivo, el único que selecciona las columnas cifradas (`credencial_*`);
 * de la credencial se muestra que hay, no cuál es; lo cifrado sale solo por `obtenerCredencial`, para el adaptador
 * de ARCA. Todo filtra por empresa. Chequeo: `test/arquitectura/columnas-cifradas.test.ts`.
 */

export const dondeSeGuardaLaCredencial = (
  empresa: EmpresaId,
  certificado: CertificadoId,
  servicio: ServicioDeArca,
): DondeSeGuarda => ({
  empresaId: empresa,
  tabla: "acceso_arca",
  filaId: `${certificado}:${servicio}`,
  columna: "credencial_cifrada",
});

/** El servicio de ARCA al que sirve la credencial. Hoy solo la factura electrónica. */
export type ServicioDeArca = "wsfe";

/** Lo que se sabe de la credencial de acceso sin mostrarla. */
export type AccesoGuardado = Readonly<{
  empresaId: EmpresaId;
  certificadoId: CertificadoId;
  servicio: ServicioDeArca;
  tieneCredencial: boolean;
  generadoEn: Date | null;
  expiraEn: Date | null;
  /** Hasta cuándo alguien tiene tomada la renovación (nadie más la pide antes). */
  renovandoHasta: Date | null;
  version: number;
}>;

export type CredencialDeAcceso = Readonly<{
  credencial: TextoCifrado;
  generadoEn: Date;
  expiraEn: Date;
}>;

export interface RepositorioDeAccesos {
  /** Crea la fila vacía del certificado y servicio si no existe (idempotente) y la devuelve, sin credencial. */
  asegurar(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
  ): Promise<AccesoGuardado>;
  obtener(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
  ): Promise<AccesoGuardado | null>;
  /** La credencial CIFRADA guardada, para el adaptador de ARCA; `null` si no hay. Es lo único que la devuelve. */
  obtenerCredencial(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
  ): Promise<CredencialDeAcceso | null>;
  /**
   * Toma la renovación hasta `hasta` si nadie la tiene (o la de otro ya venció, `renovandoHasta <= ahora`).
   * Es un compare-and-set sobre la fila: de dos que la piden a la vez, UNA gana (`true`) y la otra se
   * reprograma (`false`). Así ARCA recibe un solo pedido de credencial por vez (si ya emitió una vigente,
   * rechaza otra). `hasta` tiene que ser posterior a `ahora`. Lanza `RangeError` si no lo es.
   */
  tomarRenovacion(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
    ahora: Date,
    hasta: Date,
  ): Promise<boolean>;
  /**
   * Guarda la credencial nueva (pisa la anterior: es un caché, no historia) y suelta la renovación. `null` si la
   * fila no existe.
   */
  guardarCredencial(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
    credencial: CredencialDeAcceso,
  ): Promise<AccesoGuardado | null>;
}

// =================================================================================================
// Credencial de acceso
// =================================================================================================

type FilaDeAcceso = Readonly<{
  empresa_id: string;
  certificado_id: string;
  servicio: string;
  tiene_credencial: boolean;
  generado_en: Date | null;
  expira_en: Date | null;
  renovando_hasta: Date | null;
  version: number;
}>;

/** Sin los bytes: de la credencial se sabe si hay, no cuál es. */
const COLUMNAS_DE_ACCESO = [
  "empresa_id",
  "certificado_id",
  "servicio",
  sql<boolean>`credencial_cifrada is not null`.as("tiene_credencial"),
  "generado_en",
  "expira_en",
  "renovando_hasta",
  "version",
] as const;

const SERVICIOS: readonly ServicioDeArca[] = ["wsfe"];

/** Lo que se muestra de la fila: que hay credencial, no la credencial. */
function aAcceso(fila: FilaDeAcceso): AccesoGuardado {
  return {
    empresaId: empresaId(fila.empresa_id),
    certificadoId: certificadoId(fila.certificado_id),
    servicio: deLaLista(SERVICIOS, fila.servicio, "servicio de ARCA"),
    tieneCredencial: fila.tiene_credencial,
    generadoEn: fila.generado_en,
    expiraEn: fila.expira_en,
    renovandoHasta: fila.renovando_hasta,
    version: fila.version,
  };
}

export function crearRepositorioDeAccesos(db: Kysely<FiscalDb>): RepositorioDeAccesos {
  const seleccionar = () => db.selectFrom("acceso_arca").select(COLUMNAS_DE_ACCESO);

  async function obtener(
    empresa: EmpresaId,
    certificado: CertificadoId,
    servicio: ServicioDeArca,
  ): Promise<AccesoGuardado | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("certificado_id", "=", certificado)
      .where("servicio", "=", servicio)
      .executeTakeFirst();
    return fila === undefined ? null : aAcceso(fila);
  }

  return {
    obtener,

    async asegurar(empresa, certificado, servicio) {
      await db
        .insertInto("acceso_arca")
        .values({ empresa_id: empresa, certificado_id: certificado, servicio })
        .onConflict((oc) => oc.columns(["empresa_id", "certificado_id", "servicio"]).doNothing())
        .execute();
      return exigir(await obtener(empresa, certificado, servicio), "acceso de ARCA");
    },

    async obtenerCredencial(empresa, certificado, servicio) {
      const fila = await db
        .selectFrom("acceso_arca")
        .select([
          "credencial_cifrada",
          "credencial_nonce",
          "credencial_etiqueta",
          "credencial_kid",
          "generado_en",
          "expira_en",
        ])
        .where("empresa_id", "=", empresa)
        .where("certificado_id", "=", certificado)
        .where("servicio", "=", servicio)
        .executeTakeFirst();
      if (fila === undefined || fila.credencial_cifrada === null) return null;
      return {
        credencial: {
          cifrado: fila.credencial_cifrada,
          nonce: exigir(fila.credencial_nonce, "credencial_nonce"),
          etiqueta: exigir(fila.credencial_etiqueta, "credencial_etiqueta"),
          kid: exigir(fila.credencial_kid, "credencial_kid"),
        },
        generadoEn: exigir(fila.generado_en, "generado_en"),
        expiraEn: exigir(fila.expira_en, "expira_en"),
      };
    },

    async tomarRenovacion(empresa, certificado, servicio, ahora, hasta) {
      if (hasta.getTime() <= ahora.getTime()) {
        throw new RangeError("la renovación se toma hasta un instante posterior a ahora");
      }
      const tomada = await db
        .updateTable("acceso_arca")
        .set({ renovando_hasta: hasta })
        .where("empresa_id", "=", empresa)
        .where("certificado_id", "=", certificado)
        .where("servicio", "=", servicio)
        .where((eb) =>
          eb.or([eb("renovando_hasta", "is", null), eb("renovando_hasta", "<=", ahora)]),
        )
        .returning("certificado_id")
        .executeTakeFirst();
      return tomada !== undefined;
    },

    async guardarCredencial(empresa, certificado, servicio, credencial) {
      const guardada = await db
        .updateTable("acceso_arca")
        .set({
          credencial_cifrada: aBytes(credencial.credencial.cifrado),
          credencial_nonce: aBytes(credencial.credencial.nonce),
          credencial_etiqueta: aBytes(credencial.credencial.etiqueta),
          credencial_kid: credencial.credencial.kid,
          generado_en: credencial.generadoEn,
          expira_en: credencial.expiraEn,
          renovando_hasta: null,
        })
        .where("empresa_id", "=", empresa)
        .where("certificado_id", "=", certificado)
        .where("servicio", "=", servicio)
        .returning(COLUMNAS_DE_ACCESO)
        .executeTakeFirst();
      return guardada === undefined ? null : aAcceso(guardada);
    },
  };
}
