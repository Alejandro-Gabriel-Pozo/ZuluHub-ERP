import type { LetraBase } from "../capacidades/experiencia/carta/letra";
import type { ProductoParaPrecios } from "../capacidades/experiencia/carta/precios";

/**
 * Puerto `CartaPublica` (experiencia de la carta, C-2): la lectura PÚBLICA de una carta por su código
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

export type CartaPublicada = Readonly<{
  id: string;
  codigo: string;
  nombre: string;
  /** El rubro tal como se lee en la cabecera («Cafetería»). */
  rubro: string;
  /** Dónde está el local («Av. Belgrano 412»); `null` si el comerciante no lo cargó. */
  lugar: string | null;
  /**
   * Perilla `letra_base` (D10): `NORMAL` (18 px) o `GRANDE` (≈ 22 px). El comensal parte de este valor y
   * el control «Letra» se suma encima; no hay otra forma de fijar un tamaño.
   */
  letraBase: LetraBase;
  secciones: readonly SeccionPublicada[];
}>;

export interface CartaPublica {
  porCodigo(marcaId: string, codigo: string): Promise<CartaPublicada | null>;
}
