/**
 * Proveedores de imagen permitidos para las fotos por dirección externa (carta, §5.7.1): una lista
 * CERRADA, escrita en código. El host es un literal de acá: nunca sale de lo que pega el comerciante,
 * así que el servidor no puede ser llevado a pedir otro sitio. Sumar un proveedor es agregar una fila
 * (con sus pruebas) y enseñar a `leerDireccionPegada` su forma de ruta; ni la guarda de red ni el
 * traedor cambian.
 */

/** Los anchos que pedimos al proveedor (la transformación fija el recorte 4:3). */
export const VARIANTES_DE_FOTO = [480, 1200] as const;
export type VarianteDeFoto = (typeof VARIANTES_DE_FOTO)[number];

export interface DefinicionDeProveedor {
  /** Host exacto, en minúsculas, sin puerto ni punto final. Lo único que se pide. */
  readonly host: string;
  /** Tipo de recurso de la ruta (`image`: nunca `video` ni `raw`). */
  readonly recurso: string;
  /** Tipo de entrega de la ruta (`upload`: nunca `fetch`, `private` ni `authenticated`). */
  readonly entrega: string;
  readonly largoMaximoDeCuenta: number;
  readonly largoMaximoDelId: number;
  /** Extensiones aceptadas al pegar, en minúsculas. */
  readonly extensiones: readonly string[];
  /** La transformación que pedimos nosotros; se descartan las que traía lo pegado. */
  readonly transformacion: (variante: VarianteDeFoto) => string;
}

export const PROVEEDORES_DE_IMAGEN = {
  CLOUDINARY: {
    host: "res.cloudinary.com",
    recurso: "image",
    entrega: "upload",
    largoMaximoDeCuenta: 64,
    largoMaximoDelId: 200,
    extensiones: ["jpg", "jpeg", "png", "webp"],
    // `q_80` fijo y no `q_auto`: los bytes son estables y la huella sirve (§5.7.1).
    transformacion: (variante) => `c_fill,ar_4:3,w_${variante},f_webp,q_80`,
  },
} as const satisfies Record<string, DefinicionDeProveedor>;

export type IdDeProveedor = keyof typeof PROVEEDORES_DE_IMAGEN;
