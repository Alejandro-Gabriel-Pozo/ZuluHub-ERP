import type { AlcanceDelHost } from "../capacidades/experiencia/puerta";
import type { PartesDeDireccion } from "../capacidades/activos/direccion-externa";
import type { CaraDeVidriera } from "../capacidades/experiencia/vidriera/caras";
import type { ModeloDeVidriera } from "../capacidades/experiencia/vidriera/modelos";
import type { LetraBase } from "../capacidades/experiencia/vidriera/letra";
import type { ProductoParaPrecios } from "../capacidades/experiencia/vidriera/precios";

/**
 * Puerto `VidrieraPublica` (experiencia de la carta, C-2): la lectura PÚBLICA de una carta por su código
 * DENTRO DE UNA MARCA. Es de solo lectura y sin sesión: el comensal no define nada ([01] §5). La marca es la
 * de la puerta resuelta para el host del pedido (S2): el código solo no alcanza, porque un mismo código leído
 * desde el dominio de otra marca devolvería la carta ajena. Devuelve `null` si el código no existe en esa
 * marca o la carta no está disponible, sin distinguir los casos (la respuesta neutra no es un oráculo,
 * [CAT] §B.4 bis).
 *
 * En C-2 solo existe el modelo Lista (§4.5): el modelo elegido y las perillas de plan entran al puerto con
 * la Cuadrícula (C-5), que es quien las necesita para `modeloEfectivo`.
 *
 * Todo el dinero llega como TEXTO decimal (`numeric(18,6)`, IVA incluido): nunca `number` (ADR-006). Los
 * ids son internos del servidor; la pantalla nunca los ve (la dirección de un producto sale de
 * `direccionDeProducto`, §3.3).
 */

/** Una foto que se puede mostrar. La dirección es SIEMPRE una ruta del host de la carta (§5.7.3). */
export type FotoPublicada = Readonly<{
  direccion: string;
  /** Texto alternativo del comerciante; `null` si no cargó (la pantalla arma «Foto de {nombre}»). */
  alt: string | null;
  ancho: number;
  alto: number;
  /** Solo `VISIBLE` se emite (C-10): una oculta o rota no deja ni la dirección en el HTML. */
  estado: "VISIBLE" | "OCULTA" | "ROTA";
}>;

export type ProductoPublicado = Readonly<{
  id: string;
  nombre: string;
  /** Descripción propia, 0 a 300 caracteres de texto plano; `null` si no tiene. */
  descripcion: string | null;
  agotado: boolean;
  foto: FotoPublicada | null;
}> &
  ProductoParaPrecios;

export type SeccionPublicada = Readonly<{
  id: string;
  nombre: string;
  /** En el orden de la carta. */
  productos: readonly ProductoPublicado[];
}>;

/**
 * Lo que la carta ELIGIÓ para su aspecto (identidad de la carta, 0077), sin resolver: los colores van tal cual se guardaron y el ajuste por contraste (7:1) lo
 * calcula quien arma la vista con la primitiva de la sesión C5. Vacío = «usa lo de la empresa»: `cara` nula rige `DIA`, `colorPropio` nulo rige `colorDeLaEmpresa`,
 * y este nulo rige el color de la marca; `logo` nulo rige el logo de la empresa (y sin ese, la inicial).
 */
export type IdentidadPublicada = Readonly<{
  modelo: ModeloDeVidriera;
  cara: CaraDeVidriera | null;
  colorPropio: string | null;
  colorDeLaEmpresa: string | null;
  logo: PartesDeDireccion | null;
}>;

export type VidrieraPublicada = Readonly<{
  id: string;
  codigo: string;
  nombre: string;
  /** El rubro tal como se lee en la cabecera («Cafetería»); `null` si el comerciante no lo cargó (la pantalla no pinta esa línea). */
  rubro: string | null;
  /** Dónde está el local («Av. Belgrano 412»); `null` si el comerciante no lo cargó. */
  lugar: string | null;
  /**
   * La tercera línea de la portada (texto libre del comerciante); `null` si no cargó ninguno. SIEMPRE viaja: si se muestra o no es de la pantalla (solo con el
   * modelo Libro), no una regla del servidor.
   */
  mensajeDePortada: string | null;
  identidad: IdentidadPublicada;
  /**
   * Las perillas de MODELO de carta (`vidriera_modelo_libro`…) que el plan de la empresa tiene encendidas HOY (mismos derechos de uso que `vidriera_por_qr`, leídos en la misma foto de cada visita).
   * Con `identidad.modelo` y la foto de las fotos visibles, es lo que necesita `modeloEfectivo`. El dominio que arma la carta no conoce planes: lo deja vacío y lo completa el adaptador.
   */
  perillasDeModelo: readonly string[];
  /** Las cuentas del proveedor de imágenes que la empresa de la carta declaró y tiene activas (0102): con ellas se valida el logo al traerlo. */
  cuentasDeImagen: readonly string[];
  /**
   * Perilla `letra_base` (D10): `NORMAL` (18 px) o `GRANDE` (≈ 22 px). El comensal parte de este valor y
   * el control «Letra» se suma encima; no hay otra forma de fijar un tamaño.
   */
  letraBase: LetraBase;
  secciones: readonly SeccionPublicada[];
}>;

/** Una carta en la lista de la raíz de un host dedicado: lo mismo que ya muestra su cabecera, y la dirección sale de su código. */
export type CartaDeLaLista = Readonly<{
  codigo: string;
  nombre: string;
  rubro: string | null;
  lugar: string | null;
}>;

/** Cuántas cartas como máximo trae la lista de la raíz (un local por carta; más de esto no es una lista que se lea). UN solo lugar. */
export const TOPE_DE_CARTAS_DE_LA_RAIZ = 20;

export interface VidrieraPublica {
  /**
   * `host` es el alcance de la puerta resuelta (S2, H-DOM-1), nunca un dato del cliente: la marca y el dueño del host. Si el dueño es una EMPRESA (host dedicado),
   * solo se sirve la carta de ESA empresa; si es la marca (host compartido), la de cualquiera de sus empresas.
   */
  porCodigo(host: AlcanceDelHost, codigo: string): Promise<VidrieraPublicada | null>;
  /**
   * Las cartas que se sirven en la raíz del host (0096): SOLO si el dueño del host es una EMPRESA (host dedicado), las suyas en línea y que de verdad se sirven (cada una se confirma con
   * la misma lectura por código); si el dueño es la marca (host compartido), SIEMPRE vacío: el host compartido no sirve para recorrer cartas ajenas. Ordenadas por nombre, hasta
   * `TOPE_DE_CARTAS_DE_LA_RAIZ`. Un fallo de la base se lanza, nunca se disfraza de lista vacía.
   */
  listarDelHost(host: AlcanceDelHost): Promise<readonly CartaDeLaLista[]>;
}
