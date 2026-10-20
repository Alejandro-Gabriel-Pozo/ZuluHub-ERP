/**
 * El QR del alta del segundo factor llega como SVG ya dibujado por el servidor (h5-p8 §2.4 ter). La web no pinta
 * HTML crudo (R-W8): acá se lo reconoce con una forma CERRADA y se devuelven solo los dos datos que hacen falta (el
 * lado y el trazo) para dibujarlo con elementos propios. Cualquier otra cosa (una etiqueta de más, un atributo
 * distinto, un trazo con caracteres raros) da `null`: la pantalla muestra solo la clave en texto, nunca un dibujo
 * dudoso.
 */

export type DibujoDeQr = Readonly<{ lado: number; trazo: string }>;

const LADO_MAXIMO = 200;

const FORMA =
  /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d{1,3}) (\d{1,3})" shape-rendering="crispEdges" role="img" aria-label="[A-Za-zÁÉÍÓÚáéíóúñÑ ]{1,80}"><rect width="(\d{1,3})" height="(\d{1,3})" fill="#ffffff"\/><path d="([Mhvz0-9 -]{1,40000})" fill="#000000"\/><\/svg>$/;

export function dibujoDeQr(svg: string): DibujoDeQr | null {
  const partes = FORMA.exec(svg);
  if (partes === null) return null;
  const [, ancho, alto, anchoRect, altoRect, trazo] = partes;
  if (ancho === undefined || trazo === undefined) return null;
  if (ancho !== alto || ancho !== anchoRect || ancho !== altoRect) return null;
  const lado = Number(ancho);
  if (lado < 1 || lado > LADO_MAXIMO) return null;
  return { lado, trazo };
}
