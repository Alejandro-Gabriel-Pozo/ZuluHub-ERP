import type { Kysely } from "kysely";
import type { VentasDb } from "../../ventas/publico";
import type { ComandasDb } from "./esquema";
import { crearRepositorioDeEnvios, type RepositorioDeEnvios } from "./repositorio-de-envios";
import {
  crearRepositorioDeImpresion,
  type RepositorioDeImpresion,
} from "./repositorio-de-impresion";

/** Los repositorios de comandas, armados sobre la MISMA conexión de la transacción (la composición los suma a la `Tx` compuesta). */
export type RepositoriosDeComandas = Readonly<{
  envios: RepositorioDeEnvios;
  impresion: RepositorioDeImpresion;
}>;

export function crearRepositoriosDeComandas(db: {
  withTables<T extends object>(): Kysely<T & ComandasDb & VentasDb>;
}): RepositoriosDeComandas {
  const conexion = db.withTables<ComandasDb & VentasDb>();
  return {
    envios: crearRepositorioDeEnvios(conexion),
    impresion: crearRepositorioDeImpresion(conexion),
  };
}
