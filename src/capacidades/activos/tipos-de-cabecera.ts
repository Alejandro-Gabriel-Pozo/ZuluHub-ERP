/**
 * Los tipos de las cabeceras de imagen (marca e íconos §2.4 T3, y fotos de producto C-1) y los códigos de
 * error de sus lectores (`cabeceras.ts` y un archivo por formato).
 */

/** Por qué una cabecera no se pudo leer. Los códigos son estables: la pantalla los traduce. */
export type ErrorDeCabecera =
  /** La firma del archivo no es la del formato pedido. */
  | "FORMATO_NO_RECONOCIDO"
  /** Faltan bytes, o una longitud declarada se sale de los bytes que hay. */
  | "TRUNCADO"
  /** Los campos son incoherentes entre sí (medida cero, orden de bloques imposible, etc.). */
  | "CABECERA_INVALIDA"
  /** Formato válido, pero una variante que Pedernal no admite (p. ej. JPEG aritmético o sin pérdida). */
  | "VARIANTE_NO_ADMITIDA";

export type FormatoDeImagen = "png" | "webp" | "jpeg" | "ico";

export type CabeceraPng = Readonly<{
  formato: "png";
  ancho: number;
  alto: number;
  /** Tipo de color del IHDR: 0 grises, 2 RGB, 3 paleta, 4 grises con alfa, 6 RGBA. */
  tipoDeColor: number;
  /** Hay un fragmento `tRNS`: transparencia aun con tipo de color 0, 2 o 3. */
  conTrns: boolean;
  /** Hay un fragmento `acTL`: PNG animado (APNG). */
  animado: boolean;
}>;

export type CabeceraWebp = Readonly<{
  formato: "webp";
  ancho: number;
  alto: number;
  conAlfa: boolean;
  animado: boolean;
}>;

export type CabeceraJpeg = Readonly<{
  formato: "jpeg";
  ancho: number;
  alto: number;
  animado: false;
}>;

export type CabeceraIco = Readonly<{
  formato: "ico";
  imagenes: readonly Readonly<{ ancho: number; alto: number }>[];
}>;

/** Las imágenes con medidas propias y sin directorio (todas menos el ICO, que trae varias). */
export type CabeceraPlana = CabeceraPng | CabeceraWebp | CabeceraJpeg;

/**
 * Lo que `detectarFormato` reconoce; `svg` solo para poder rechazarlo con su propio motivo y
 * `desconocido` para todo lo demás (HEIC, GIF, HTML, vacío…).
 */
export type FormatoDetectado = FormatoDeImagen | "svg" | "desconocido";
