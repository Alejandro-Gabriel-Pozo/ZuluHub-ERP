import { armarCambiarFormaDeVenta } from "./cambiar-forma-de-venta";
import { armarCambiarPrecio } from "./cambiar-precio";
import type { DependenciasDeCatalogo } from "./contrato";
import {
  armarCrearNodoDeClasificacion,
  armarDesactivarNodoDeClasificacion,
  armarMoverNodoDeClasificacion,
  armarReactivarNodoDeClasificacion,
  armarRenombrarNodoDeClasificacion,
} from "./clasificacion";
import { armarCopiarOpciones } from "./copiar-opciones";
import { armarCrearProducto, armarCrearProductoRapido } from "./crear-producto";
import type { DECLARACIONES } from "./declaraciones";
import { armarEditarOpciones } from "./editar-opciones";
import {
  armarDesactivarProducto,
  armarEditarProducto,
  armarReactivarProducto,
} from "./editar-producto";
import { armarGuardarCartaPublica } from "./guardar-carta-publica";
import { armarGuardarConsumoDeGrupo } from "./guardar-consumo";
import { armarOcultarProducto } from "./ocultar-producto";
import { armarReordenarSeccionesDeCarta } from "./reordenar-secciones";
import { armarCrearPresentacion, armarEditarPresentacion } from "./presentaciones";
import {
  armarCrearSeccionDeCarta,
  armarDesactivarSeccionDeCarta,
  armarEditarSeccionDeCarta,
  armarReactivarSeccionDeCarta,
} from "./secciones";

/**
 * Los casos de uso del catálogo (E2 mínimo), listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que
 * declara `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeCatalogo(dependencias: DependenciasDeCatalogo) {
  return {
    crearProducto: armarCrearProducto(dependencias),
    crearProductoRapido: armarCrearProductoRapido(dependencias),
    editarProducto: armarEditarProducto(dependencias),
    desactivarProducto: armarDesactivarProducto(dependencias),
    reactivarProducto: armarReactivarProducto(dependencias),
    cambiarFormaDeVenta: armarCambiarFormaDeVenta(dependencias),
    cambiarPrecio: armarCambiarPrecio(dependencias),
    editarOpciones: armarEditarOpciones(dependencias),
    guardarConsumoDeGrupo: armarGuardarConsumoDeGrupo(dependencias),
    copiarOpciones: armarCopiarOpciones(dependencias),
    crearPresentacion: armarCrearPresentacion(dependencias),
    editarPresentacion: armarEditarPresentacion(dependencias),
    crearSeccionDeCarta: armarCrearSeccionDeCarta(dependencias),
    editarSeccionDeCarta: armarEditarSeccionDeCarta(dependencias),
    desactivarSeccionDeCarta: armarDesactivarSeccionDeCarta(dependencias),
    reactivarSeccionDeCarta: armarReactivarSeccionDeCarta(dependencias),
    reordenarSeccionesDeCarta: armarReordenarSeccionesDeCarta(dependencias),
    crearNodoDeClasificacion: armarCrearNodoDeClasificacion(dependencias),
    renombrarNodoDeClasificacion: armarRenombrarNodoDeClasificacion(dependencias),
    moverNodoDeClasificacion: armarMoverNodoDeClasificacion(dependencias),
    desactivarNodoDeClasificacion: armarDesactivarNodoDeClasificacion(dependencias),
    reactivarNodoDeClasificacion: armarReactivarNodoDeClasificacion(dependencias),
    guardarCartaPublica: armarGuardarCartaPublica(dependencias),
    ocultarProducto: armarOcultarProducto(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCatalogo = ReturnType<typeof crearCasosDeUsoDeCatalogo>;
