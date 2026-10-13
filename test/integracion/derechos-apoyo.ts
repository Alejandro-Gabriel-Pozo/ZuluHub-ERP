import {
  crearLecturaDeDerechosDeUso,
  type CatalogosDeDerechos,
} from "../../src/adaptadores/postgres/derechos-de-uso";
import {
  crearTransacciones,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import type { ContextoDePlataforma, ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearLecturaDePlanes,
  type LecturaDePlanes,
  type PlanesDb,
} from "../../src/modulos/planes/publico";
import { empresaId, marcaComercialId } from "../../src/primitivas/identificadores/marca";
import type { LecturaDeDerechosDeUso } from "../../src/puertos/derechos-de-uso";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";
import type { BaseDePruebas } from "./global";
import { plataformaEn } from "./soporte-datos";

/**
 * Apoyo de las pruebas de derechos de uso (M4): arma las transacciones con lo que armaría la composición
 * (la lectura de planes y el adaptador de derechos sobre la conexión de la transacción) sobre los roles
 * REALES de la aplicación y de la plataforma. El escenario se prepara con el cliente del dueño
 * (`marcas-apoyo.ts`).
 */

export type TxDeDerechos<M extends string, P extends string> = Readonly<{
  derechos: LecturaDeDerechosDeUso<M, P>;
  planes: LecturaDePlanes;
}>;

/**
 * `ajustarPlanes` envuelve la lectura de planes que usa el adaptador (para poner una barrera entre dos
 * lecturas o contar consultas); sin él, es exactamente lo que armaría la composición.
 */
export function crearEntornoDeDerechos<M extends string, P extends string>(
  base: BaseDePruebas,
  catalogos: CatalogosDeDerechos<M, P>,
  ajustarPlanes: (planes: LecturaDePlanes) => LecturaDePlanes = (planes) => planes,
  maximoDeConexiones = 6,
): TransaccionesDePostgres<TxDeDerechos<M, P>> {
  return crearTransacciones<TxDeDerechos<M, P>>({
    urls: { OPERATIVO: base.app, PLATAFORMA: base.plataforma },
    clave: base.clave,
    armar: (db) => {
      const planes = ajustarPlanes(crearLecturaDePlanes(db.withTables<PlanesDb>()));
      return { planes, derechos: crearLecturaDeDerechosDeUso(planes, catalogos) };
    },
    maximoDeConexiones,
  });
}

/** El contexto de una empresa con el `ahora` dado (las pruebas de planes viven del reloj real de la base). */
export const contextoDeEmpresa = (
  empresa: string,
  ahora: Date,
  marca: string = MARCA_PRINCIPAL_DE_PRUEBA,
): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId: empresaId(empresa),
  personaId: null,
  marcaDeEntrada: marcaComercialId(marca),
  ahora,
});

export const contextoDePlataforma = (ahora: Date): ContextoDePlataforma => plataformaEn(ahora);
