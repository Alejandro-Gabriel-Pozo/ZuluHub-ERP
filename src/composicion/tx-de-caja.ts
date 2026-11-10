import { crearLecturaDeDerechosDeUso } from "../adaptadores/postgres/derechos-de-uso";
import type { ConfiguracionDeTransacciones } from "../adaptadores/postgres/transacciones";
import { CATALOGO_DE_MODULOS } from "../capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../capacidades/planes/perillas";
import {
  crearRepositorioDeCajas,
  crearRepositorioDeCuentasDeCobro,
  crearRepositorioDeMediosDePago,
  type CajaDb,
  type RepositorioDeCajas,
  type RepositorioDeCuentasDeCobro,
  type RepositorioDeMediosDePago,
} from "../modulos/caja/publico";
import { crearLecturaDePlanes, type PlanesDb } from "../modulos/planes/publico";
import type { LecturaDeDerechosDeUso } from "../puertos/derechos-de-uso";

/**
 * Lo de caja (E3) que lleva la `Tx` compuesta de la puerta de la aplicación (`TxDeApp`): sus tres repositorios de configuración y los
 * derechos de uso del plan (el límite de cajas por sucursal), todos sobre la MISMA conexión de la transacción. Vive en su archivo para que
 * `conexiones.ts` no pase el tope de líneas; los tramos siguientes de caja suman acá sus repositorios de sesión, movimiento y cobro.
 */
export type PiezasDeCajaEnTx = Readonly<{
  /** Caja (E3): las cajas, los medios de pago y las cuentas de cobro de la empresa. */
  cajas: RepositorioDeCajas;
  mediosDePago: RepositorioDeMediosDePago;
  cuentasDeCobro: RepositorioDeCuentasDeCobro;
  /** Lo que el plan de la empresa le deja usar (el límite de cajas por sucursal), leído en esta transacción y sin caché. */
  derechos: LecturaDeDerechosDeUso;
}>;

export function armarPiezasDeCajaEnTx(
  db: Parameters<ConfiguracionDeTransacciones<unknown>["armar"]>[0],
): PiezasDeCajaEnTx {
  return {
    cajas: crearRepositorioDeCajas(db.withTables<CajaDb>()),
    mediosDePago: crearRepositorioDeMediosDePago(db.withTables<CajaDb>()),
    cuentasDeCobro: crearRepositorioDeCuentasDeCobro(db.withTables<CajaDb>()),
    derechos: crearLecturaDeDerechosDeUso(crearLecturaDePlanes(db.withTables<PlanesDb>()), {
      catalogoDeModulos: CATALOGO_DE_MODULOS,
      catalogoDePerillas: CATALOGO_DE_PERILLAS,
    }),
  };
}
