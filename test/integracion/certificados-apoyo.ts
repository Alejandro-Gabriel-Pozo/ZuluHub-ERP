import { randomBytes, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type pg from "pg";
import {
  crearAlmacenDeTickets,
  type TxDeTickets,
} from "../../src/adaptadores/certificados/almacen-de-tickets";
import {
  crearCredencialesDeEmisor,
  type TxDeCredenciales,
} from "../../src/adaptadores/certificados/credenciales-de-emisor";
import { crearGeneradorDeCredenciales } from "../../src/adaptadores/certificados/generador-pkijs";
import { crearLectorDeCertificados } from "../../src/adaptadores/certificados/lector-x509";
import { crearCifradorAesGcm, type ClaveMaestra } from "../../src/adaptadores/cifrado/aes-gcm";
import {
  crearAuditoriaDePostgres,
  type AuditoriaDb,
} from "../../src/adaptadores/postgres/auditoria";
import {
  crearAutorizacionDePostgres,
  type AutorizacionDb,
} from "../../src/adaptadores/postgres/autorizacion";
import {
  crearTransacciones,
  type SinTablas,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import type { ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import { crearRepositorioDeEmpresas, type EmpresasDb } from "../../src/modulos/empresas/publico";
import {
  crearCasosDeUsoDeCertificados,
  crearRepositorioDeAccesos,
  crearRepositorioDeCertificados,
  crearRepositorioDeEmisores,
  type CasosDeUsoDeCertificados,
  type EntradaDeGenerarPedido,
  type FiscalDb,
  type RepositorioDeAccesos,
  type RepositorioDeCertificados,
  type TxDeCertificados,
} from "../../src/modulos/fiscal/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../../src/modulos/tenants/publico";
import { emisorId } from "../../src/primitivas/identificadores/marca";
import type { CifradorDeSecretos } from "../../src/puertos/cifrado-de-secretos";
import type { GeneradorDeCredenciales } from "../../src/puertos/generador-de-credenciales";
import {
  crearAutoridadIntermedia,
  crearAutoridadRaiz,
  emitirCertificado,
  type Autoridad,
  type OpcionesDeEmision,
} from "../utilidades/certificados-de-prueba";
import { crearEscenarioDeCasos, type EscenarioDeCasos } from "./facturacion-casos-apoyo";
import { REGLAS_CON_FACTURACION, conFacturacion } from "./fiscal-numeracion-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Apoyo de las pruebas de los certificados (F7) contra una base real: la transacción que recibe cada caso de uso, la
 * credencial y el almacén de tickets es la que armaría la composición (repositorios fiscales, empresas y tenants,
 * auditoría y la autorización con `facturacion` activada), más el `db` crudo para mirar. Los servicios son los REALES
 * (AES-256-GCM, pkijs y node:crypto), con claves y autoridades que nacen en la propia prueba (nunca claves reales); el
 * generador es un espía que guarda lo que generó para que las pruebas puedan buscar esa clave en cualquier lado.
 */

export type TxDeCertificadosDePrueba = TxDeCertificados &
  TxDeCredenciales &
  TxDeTickets &
  Readonly<{
    db: Kysely<SinTablas>;
    certificados: RepositorioDeCertificados;
    accesos: RepositorioDeAccesos;
  }>;

export function crearEntornoDeCertificados(
  base: BaseDePruebas,
  maximoDeConexiones = 8,
  ajustar: (tx: TxDeCertificadosDePrueba) => TxDeCertificadosDePrueba = (tx) => tx,
): TransaccionesDePostgres<TxDeCertificadosDePrueba> {
  return crearTransacciones<TxDeCertificadosDePrueba>({
    urls: { OPERATIVO: base.app },
    armar: (db) => {
      const fiscal = db.withTables<FiscalDb>();
      return ajustar({
        db,
        empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
        tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
        emisores: crearRepositorioDeEmisores(fiscal),
        certificados: crearRepositorioDeCertificados(fiscal),
        accesos: crearRepositorioDeAccesos(fiscal),
        auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
        autorizacion: conFacturacion(crearAutorizacionDePostgres(db.withTables<AutorizacionDb>())),
      });
    },
    maximoDeConexiones,
    clave: base.clave,
  });
}

/** Un reloj que la prueba mueve a mano. */
export class RelojDeCertificados {
  constructor(public actual: Date = new Date()) {}
  ahora = (): Date => this.actual;
  avanzar(ms: number): Date {
    this.actual = new Date(this.actual.getTime() + ms);
    return this.actual;
  }
}

export const clavesMaestrasDePrueba = (kid = "prueba-1"): ClaveMaestra => ({
  kid,
  clave: randomBytes(32),
});

/** Todo lo que una prueba de certificados necesita además de la base. */
export type ServiciosDePrueba = Readonly<{
  cifrador: CifradorDeSecretos;
  generador: GeneradorDeCredenciales;
  /** Cada clave privada que generó el generador (en claro): para buscarla en la base, la auditoría y las respuestas. */
  clavesGeneradas: string[];
  lector: ReturnType<typeof crearLectorDeCertificados>;
  /** La cadena de homologación (raíz e intermedia) y una de producción: cada ambiente confía solo en la suya. */
  homologacion: Readonly<{ raiz: Autoridad; intermedia: Autoridad }>;
  produccion: Readonly<{ raiz: Autoridad; intermedia: Autoridad }>;
  maestra: ClaveMaestra;
}>;

export async function crearServicios(
  maestra = clavesMaestrasDePrueba(),
): Promise<ServiciosDePrueba> {
  const real = crearGeneradorDeCredenciales();
  const clavesGeneradas: string[] = [];
  const generador: GeneradorDeCredenciales = {
    async generar(datos) {
      const generada = await real.generar(datos);
      clavesGeneradas.push(generada.clavePrivada.revelar());
      return generada;
    },
  };
  const cadena = async (raiz: string, intermedia: string) => {
    const r = await crearAutoridadRaiz(raiz);
    return { raiz: r, intermedia: await crearAutoridadIntermedia(r, intermedia) };
  };
  const homologacion = await cadena("AC Raiz Test", "Computadores Test");
  const produccion = await cadena("AFIP Root CA 2", "Computadores");
  return {
    cifrador: crearCifradorAesGcm({ activa: maestra }),
    generador,
    clavesGeneradas,
    lector: crearLectorDeCertificados({
      HOMOLOGACION: [homologacion.raiz.certificadoPem, homologacion.intermedia.certificadoPem],
      PRODUCCION: [produccion.raiz.certificadoPem, produccion.intermedia.certificadoPem],
    }),
    homologacion,
    produccion,
    maestra,
  };
}

export function casosDeCertificados(
  transacciones: TransaccionesDePostgres<TxDeCertificadosDePrueba>,
  servicios: ServiciosDePrueba,
  reglas: ReglasDeEmpresa = REGLAS_CON_FACTURACION,
): CasosDeUsoDeCertificados {
  return crearCasosDeUsoDeCertificados({
    transacciones,
    reglas,
    cifrador: servicios.cifrador,
    generador: servicios.generador,
    lector: servicios.lector,
  });
}

export const credencialesDe = (
  transacciones: TransaccionesDePostgres<TxDeCertificadosDePrueba>,
  servicios: Pick<ServiciosDePrueba, "cifrador">,
  reloj: RelojDeCertificados,
) => crearCredencialesDeEmisor({ transacciones, cifrador: servicios.cifrador, reloj });

export const almacenDe = (
  transacciones: TransaccionesDePostgres<TxDeCertificadosDePrueba>,
  servicios: Pick<ServiciosDePrueba, "cifrador">,
  reloj: RelojDeCertificados,
) => crearAlmacenDeTickets({ transacciones, cifrador: servicios.cifrador, reloj });

/** Una empresa con su emisor, un punto de venta, un gerente y NINGÚN certificado. */
export const escenarioDeCertificados = (dueno: pg.Client, base: BaseDePruebas) =>
  crearEscenarioDeCasos(dueno, base, { rol: "GERENTE", sinCertificado: true });

/** El pedido de un certificado de prueba del emisor principal del escenario (con un `id` y un alias nuevos). */
export function pedidoDeCertificado(
  e: Pick<EscenarioDeCasos, "emisor" | "cuit">,
  cambios: Partial<EntradaDeGenerarPedido> = {},
): EntradaDeGenerarPedido {
  return {
    id: randomUUID(),
    emisorId: emisorId(e.emisor),
    ambiente: "HOMOLOGACION",
    alias: `zuluhub${randomBytes(3).toString("hex")}`,
    cuitTitular: e.cuit,
    organizacion: "Panadería Zulú SA",
    ...cambios,
  };
}

/** Lo que haría ARCA: el certificado para ese pedido, de la autoridad de su ambiente. */
export const certificadoDeArca = (
  servicios: ServiciosDePrueba,
  ambiente: "HOMOLOGACION" | "PRODUCCION",
  pedidoPem: string,
  opciones: OpcionesDeEmision = {},
) =>
  emitirCertificado(
    (ambiente === "HOMOLOGACION" ? servicios.homologacion : servicios.produccion).intermedia,
    pedidoPem,
    opciones,
  );
