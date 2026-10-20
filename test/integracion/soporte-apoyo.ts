import type { Kysely, KyselyPlugin } from "kysely";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../../src/adaptadores/postgres/auditoria-de-plataforma";
import {
  crearAutorizacionDePlataformaDePostgres,
  type AutorizacionDePlataformaDb,
} from "../../src/adaptadores/postgres/autorizacion-de-plataforma";
import {
  crearIdempotenciaDePostgres,
  type IdempotenciaDb,
} from "../../src/adaptadores/postgres/idempotencia";
import {
  crearReferenciasDeErrorDePostgres,
  type ReferenciasDeErrorDb,
} from "../../src/adaptadores/postgres/referencias-de-error";
import {
  crearLecturaDeSoporteDePostgres,
  type SoporteDb,
} from "../../src/adaptadores/postgres/soporte-de-plataforma";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { REGLAS_DE_PLATAFORMA } from "../../src/capacidades/permisos/plataforma";
import { CATALOGO_DE_PERILLAS } from "../../src/capacidades/planes/perillas";
import {
  crearCasosDeUsoDeSoporte,
  type CasosDeUsoDeSoporte,
} from "../../src/plataforma/casos-de-uso/soporte";
import type { TxDeExplicar } from "../../src/plataforma/casos-de-uso/explicar-por-que";
import type { TxDeReferencias } from "../../src/plataforma/casos-de-uso/registrar-referencia";
import {
  crearConsultasDePlataforma,
  type ConsultasDePlataforma,
} from "../../src/plataforma/consultas/consultas";
import type { TxDeConsultasDePlataforma } from "../../src/plataforma/consultas/contrato";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de integración de soporte de plataforma (H5 P6): arma las transacciones con lo
 * que armaría la composición real (la lectura de soporte, la autorización, la auditoría, la
 * idempotencia y las referencias de error de plataforma) sobre los roles reales, y con ellas las
 * consultas y los casos de uso de soporte.
 */

export type TxDeSoporte = TxDeConsultasDePlataforma &
  TxDeExplicar &
  TxDeReferencias &
  Readonly<{
    /** Consultas de verificación sin tipar. */
    db: Kysely<SinTablas>;
  }>;

export function crearEntornoDeSoporte(
  base: BaseDePruebas,
  maximoDeConexiones = 5,
  ajustar: (tx: TxDeSoporte) => TxDeSoporte = (tx) => tx,
  /** Un plugin de Kysely que ve cada sentencia que ejecuta la LECTURA de soporte (para contarlas). */
  observarLecturas?: KyselyPlugin,
): TransaccionesDePostgres<TxDeSoporte> {
  return crearTransacciones<TxDeSoporte>({
    urls: {
      OPERATIVO: base.app,
      GRUPO: base.grupo,
      PLATAFORMA: base.plataforma,
      TRABAJOS: base.trabajos,
    },
    armar: (db, contexto) =>
      ajustar({
        db,
        soporte: crearLecturaDeSoporteDePostgres(
          (observarLecturas === undefined
            ? db
            : db.withPlugin(observarLecturas)
          ).withTables<SoporteDb>(),
        ),
        autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
          db.withTables<AutorizacionDePlataformaDb>(),
        ),
        auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
          db.withTables<AuditoriaDePlataformaDb>(),
          contexto,
        ),
        idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
        referenciasDeError: crearReferenciasDeErrorDePostgres(
          db.withTables<ReferenciasDeErrorDb>(),
        ),
      }),
    maximoDeConexiones,
    clave: base.clave,
  });
}

export function crearConsultasDeSoporte(
  entorno: TransaccionesDePostgres<TxDeSoporte>,
): ConsultasDePlataforma {
  return crearConsultasDePlataforma({
    transacciones: entorno,
    reglas: REGLAS_DE_PLATAFORMA,
    catalogoDeEmpresa: CATALOGO_DE_MODULOS,
    catalogoDePerillas: CATALOGO_DE_PERILLAS,
  });
}

export function crearCasosDeSoporte(
  entorno: TransaccionesDePostgres<TxDeSoporte>,
  azar: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(4)),
): CasosDeUsoDeSoporte {
  return crearCasosDeUsoDeSoporte({
    explicar: {
      transacciones: entorno,
      reglas: REGLAS_DE_PLATAFORMA,
      reglasDeEmpresa: REGLAS_DE_EMPRESA,
    },
    referencias: { transacciones: entorno, azar },
  });
}
