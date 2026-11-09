import { armarCambiarFormaDeVenta } from "./cambiar-forma-de-venta";
import { armarCambiarPrecio } from "./cambiar-precio";
import type { DependenciasDeCatalogo } from "./contrato";
import { armarCopiarOpciones } from "./copiar-opciones";
import { armarCrearProducto, armarCrearProductoRapido } from "./crear-producto";
import type { DECLARACIONES } from "./declaraciones";
import { armarEditarOpciones } from "./editar-opciones";
import {
  armarDesactivarProducto,
  armarEditarProducto,
  armarReactivarProducto,
} from "./editar-producto";
import { armarGuardarConsumoDeGrupo } from "./guardar-consumo";
import {
  armarCrearSeccionDeCarta,
  armarDesactivarSeccionDeCarta,
  armarEditarSeccionDeCarta,
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
    crearSeccionDeCarta: armarCrearSeccionDeCarta(dependencias),
    editarSeccionDeCarta: armarEditarSeccionDeCarta(dependencias),
    desactivarSeccionDeCarta: armarDesactivarSeccionDeCarta(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCatalogo = ReturnType<typeof crearCasosDeUsoDeCatalogo>;
