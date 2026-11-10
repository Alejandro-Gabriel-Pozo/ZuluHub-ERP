import type { Kysely } from "kysely";
import type { CatalogoDb } from "./esquema";
import { crearRepositorioDeOpciones, type RepositorioDeOpciones } from "./repositorio-de-opciones";
import { crearRepositorioDePrecios, type RepositorioDePrecios } from "./repositorio-de-precios";
import {
  crearRepositorioDeProductos,
  type RepositorioDeProductos,
} from "./repositorio-de-productos";

/** Los tres repositorios del catálogo, armados sobre la MISMA conexión de la transacción. */
export type RepositoriosDeCatalogo = Readonly<{
  productos: RepositorioDeProductos;
  opciones: RepositorioDeOpciones;
  precios: RepositorioDePrecios;
}>;

export function crearRepositoriosDeCatalogo(db: {
  withTables<T extends object>(): Kysely<T & CatalogoDb>;
}): RepositoriosDeCatalogo {
  const conexion = db.withTables<CatalogoDb>();
  return {
    productos: crearRepositorioDeProductos(conexion),
    opciones: crearRepositorioDeOpciones(conexion),
    precios: crearRepositorioDePrecios(conexion),
  };
}
