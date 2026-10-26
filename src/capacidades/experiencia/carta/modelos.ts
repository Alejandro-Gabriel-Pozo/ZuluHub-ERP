/**
 * Modelos de carta (experiencia de la carta, §4). Es código y no datos: un modelo es una definición
 * cerrada de la plataforma, no una plantilla que sube el cliente. De acá sale el tipo `ModeloDeCarta`,
 * así que un modelo mal escrito no compila.
 *
 * v1 (§4.5): Lista (base y reserva de todos), Cuadrícula y Libro. Tablero es «a pedido» y su perilla se
 * declara recién cuando se construya; Carrusel se descartó. Agregar un modelo es agregar una entrada, y
 * la prueba «todo modelo tiene su prueba» (C-16) falla hasta que traiga su e2e y su axe.
 */

type DefinicionDeModelo = Readonly<{
  /** Perilla de plan que lo habilita (`null` = base del extra `vidriera_por_qr`: no se cobra aparte). */
  perilla: string | null;
  /** Sin ninguna foto visible no tiene sentido: el modelo efectivo cae a la Lista. */
  requiereFotos: boolean;
}>;

export const CATALOGO_DE_MODELOS_DE_CARTA = {
  LISTA: { perilla: null, requiereFotos: false },
  CUADRICULA: { perilla: "carta_modelo_cuadricula", requiereFotos: true },
  LIBRO: { perilla: "carta_modelo_libro", requiereFotos: false },
} as const satisfies Readonly<Record<string, DefinicionDeModelo>>;

export type ModeloDeCarta = keyof typeof CATALOGO_DE_MODELOS_DE_CARTA;

/** La reserva de todos los demás: lo que se muestra cuando otro modelo no puede (§4.4). */
export const MODELO_DE_RESERVA: ModeloDeCarta = "LISTA";

/** Estrecha un texto que viene de la base (o de un pedido) a un modelo del catálogo. */
export function esModeloDeCarta(valor: string): valor is ModeloDeCarta {
  return Object.hasOwn(CATALOGO_DE_MODELOS_DE_CARTA, valor);
}

/** Todo lo que decide el modelo efectivo, como dato: sin reloj, sin azar y sin leer el pedido. */
export type EntradaDelModeloEfectivo = Readonly<{
  /** Lo que guardó el gerente para esta carta; vacío si nunca eligió. Puede ser un texto viejo o desconocido. */
  elegido: string;
  /** Claves de las perillas de la empresa que valen hoy (encendidas o con límite mayor que cero). */
  perillasEncendidas: readonly string[];
  /** Cuántos productos de la carta tienen una foto que se puede mostrar. */
  fotosVisibles: number;
  /** El pedido trae `Save-Data: on`. */
  ahorroDeDatos: boolean;
}>;

/**
 * El modelo con el que se dibuja la carta en el servidor (§4.4). Siempre devuelve un modelo del catálogo:
 * bajar de plan, borrar fotos o una elección desconocida nunca dejan la carta «no disponible», la
 * dejan en Lista.
 */
export function modeloEfectivo(entrada: EntradaDelModeloEfectivo): ModeloDeCarta {
  const { elegido, perillasEncendidas, fotosVisibles, ahorroDeDatos } = entrada;
  if (!esModeloDeCarta(elegido)) return MODELO_DE_RESERVA;
  const { perilla, requiereFotos } = CATALOGO_DE_MODELOS_DE_CARTA[elegido];
  // Stryker disable next-line ConditionalExpression: la Lista es la reserva; cualquier camino que le toque da Lista
  const sinPerilla = perilla === null;
  if (!sinPerilla && !perillasEncendidas.includes(perilla)) return MODELO_DE_RESERVA;
  // `!(x > 0)` y no `x <= 0`: un NaN llegado por error también cuenta como «ninguna foto».
  if (requiereFotos && !(fotosVisibles > 0)) return MODELO_DE_RESERVA;
  if (ahorroDeDatos) return MODELO_DE_RESERVA;
  return elegido;
}
