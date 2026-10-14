import "server-only";

import type {
  CartaPublica,
  CartaPublicada,
  FotoPublicada,
} from "../../../src/puertos/carta-publica";
import {
  CARTAS_DE_EJEMPLO,
  type CartaDeEjemplo,
  type ProductoDeEjemplo,
} from "../../../test/fixtures/cartas";

/**
 * Falso del puerto `CartaPublica` (C-2): sirve las cuatro cartas de ejemplo de `test/fixtures/cartas`, que son
 * datos INVENTADOS (ningún nombre, precio ni foto es de un cliente). Vive acá y no en `test/` porque la página
 * lo necesita para compilar y mostrarse antes de que exista el adaptador real; C-3 lo reemplaza en
 * `carta.ts` por el que lee la base por la puerta pública, y este archivo se borra.
 *
 * Lo que las cartas de ejemplo no traen (el lugar, la perilla de letra y las fotos) se completa acá con datos
 * igual de inventados: la hostería parte con la letra GRANDE para poder ver la perilla del comerciante.
 */

const RUBROS: Readonly<Record<CartaDeEjemplo["rubro"], string>> = {
  CAFETERIA: "Cafetería",
  PANADERIA: "Panadería",
  HOSTERIA: "Hostería",
  BARBERIA: "Barbería",
};

const COMPLEMENTOS: Readonly<Record<string, Pick<CartaPublicada, "lugar" | "letraBase">>> = {
  "ejemplo-cafeteria": {
    lugar: "Av. Belgrano 412 · todos los días de 7 a 21",
    letraBase: "NORMAL",
  },
  "ejemplo-panaderia": { lugar: "25 de Mayo 90 · lunes a sábado de 7 a 20", letraBase: "NORMAL" },
  "ejemplo-hosteria": { lugar: "Ruta 40, km 12 · cenas de 20 a 23", letraBase: "GRANDE" },
  "ejemplo-barberia": { lugar: "San Martín 230 · de martes a sábado", letraBase: "NORMAL" },
};

/** Un tono estable por nombre, para que cada foto de ejemplo sea de un color distinto. */
function tonoDe(nombre: string): number {
  let tono = 0;
  for (const caracter of nombre) tono = (tono * 31 + (caracter.codePointAt(0) ?? 0)) % 360;
  return tono;
}

/** Una "foto" de ejemplo: un bloque de color como SVG en línea (no hay archivos ni pedidos de red). */
function bloqueDeColor(producto: ProductoDeEjemplo, ancho: number, alto: number): string {
  const tono = tonoDe(producto.nombre);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${ancho} ${alto}'>` +
    `<rect width='${ancho}' height='${alto}' fill='hsl(${tono} 38% 46%)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function conFotoDeEjemplo(producto: ProductoDeEjemplo): ProductoDeEjemplo {
  const foto = producto.foto;
  if (foto === null) return producto;
  const reemplazo: FotoPublicada = {
    ...foto,
    direccion: bloqueDeColor(producto, foto.ancho, foto.alto),
  };
  return { ...producto, foto: reemplazo };
}

function comoCartaPublicada(carta: CartaDeEjemplo): CartaPublicada {
  const complemento = COMPLEMENTOS[carta.codigo] ?? { lugar: null, letraBase: "NORMAL" as const };
  return {
    id: carta.id,
    codigo: carta.codigo,
    nombre: carta.nombre,
    rubro: RUBROS[carta.rubro],
    ...complemento,
    secciones: carta.secciones.map((s) => ({ ...s, productos: s.productos.map(conFotoDeEjemplo) })),
  };
}

export const cartaPublicaFalsa: CartaPublica = {
  porCodigo(codigo) {
    const carta = CARTAS_DE_EJEMPLO.find((c) => c.codigo === codigo);
    return Promise.resolve(carta === undefined ? null : comoCartaPublicada(carta));
  },
};
