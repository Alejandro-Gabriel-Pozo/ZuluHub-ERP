import type { Kysely } from "kysely";
import type { CatalogoDb } from "./esquema";
import { crearRepositorioDeUnidades, type RepositorioDeUnidades } from "./repositorio-de-unidades";
import {
  crearRepositorioDeClasificacion,
  type RepositorioDeClasificacion,
} from "./repositorio-de-clasificacion";
import { crearLectorDeCarta, type LectorDeCarta } from "./lector-de-carta";
import { crearRepositorioDeCartas, type RepositorioDeCartas } from "./repositorio-de-cartas";
import {
  crearRepositorioDeDisponibilidad,
  type RepositorioDeDisponibilidad,
} from "./repositorio-de-disponibilidad";
import { crearRepositorioDeOpciones, type RepositorioDeOpciones } from "./repositorio-de-opciones";
import { crearRepositorioDePrecios, type RepositorioDePrecios } from "./repositorio-de-precios";
import {
  crearRepositorioDePresentaciones,
  type RepositorioDePresentaciones,
} from "./repositorio-de-presentaciones";
import {
  crearRepositorioDeSecciones,
  type RepositorioDeSecciones,
} from "./repositorio-de-secciones";
import {
  crearRepositorioDeProductos,
  type RepositorioDeProductos,
} from "./repositorio-de-productos";

/** Los repositorios del catálogo, armados sobre la MISMA conexión de la transacción. */
export type RepositoriosDeCatalogo = Readonly<{
  productos: RepositorioDeProductos;
  opciones: RepositorioDeOpciones;
  precios: RepositorioDePrecios;
  presentacionesDeProducto: RepositorioDePresentaciones;
  cartasPublicas: RepositorioDeCartas;
  disponibilidadDeProductos: RepositorioDeDisponibilidad;
  seccionesDeCarta: RepositorioDeSecciones;
  clasificacion: RepositorioDeClasificacion;
  unidades: RepositorioDeUnidades;
  lectorDeCarta: LectorDeCarta;
}>;

export function crearRepositoriosDeCatalogo(db: {
  withTables<T extends object>(): Kysely<T & CatalogoDb>;
}): RepositoriosDeCatalogo {
  const conexion = db.withTables<CatalogoDb>();
  return {
    productos: crearRepositorioDeProductos(conexion),
    opciones: crearRepositorioDeOpciones(conexion),
    precios: crearRepositorioDePrecios(conexion),
    presentacionesDeProducto: crearRepositorioDePresentaciones(conexion),
    cartasPublicas: crearRepositorioDeCartas(conexion),
    disponibilidadDeProductos: crearRepositorioDeDisponibilidad(conexion),
    seccionesDeCarta: crearRepositorioDeSecciones(conexion),
    clasificacion: crearRepositorioDeClasificacion(conexion),
    unidades: crearRepositorioDeUnidades(conexion),
    lectorDeCarta: crearLectorDeCarta(conexion),
  };
}
