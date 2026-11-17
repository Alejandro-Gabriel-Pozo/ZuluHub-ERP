import jsQR from "jsqr";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Lo que las pruebas del PDF necesitan para leerlo como lo lee un lector real (pdf.js): el texto de cada página con su posición, el tamaño y
 * el QR decodificado desde la hoja DIBUJADA (no desde los datos con que se armó). Solo pruebas.
 */

/** Un trozo de texto de la página: `y` crece hacia ARRIBA (como en el PDF) y `x`, `y` son la esquina inferior izquierda, en puntos. */
type TrozoDeTexto = Readonly<{
  texto: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}>;
export type PaginaLeida = Readonly<{
  /** Los trozos de texto, en el orden en que están en el PDF. */
  trozos: readonly TrozoDeTexto[];
  /** Todo el texto de la página, con los blancos normalizados. */
  texto: string;
  ancho: number;
  alto: number;
}>;

/** Lo que se usa de la fábrica de lienzos de pdf.js (su tipo es `object`). */
type FabricaDeLienzos = Readonly<{
  create: (
    ancho: number,
    alto: number,
  ) => {
    canvas: { width: number; height: number };
    context: {
      fillStyle: string;
      fillRect: (x: number, y: number, ancho: number, alto: number) => void;
      getImageData: (
        x: number,
        y: number,
        ancho: number,
        alto: number,
      ) => { data: Uint8ClampedArray; width: number; height: number };
    };
  };
}>;

export const normalizar = (texto: string): string => texto.replace(/\s+/g, " ").trim();

export async function leerElPdf(bytes: Uint8Array): Promise<readonly PaginaLeida[]> {
  // pdf.js se queda con el arreglo que recibe: se le da una copia.
  const tarea = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const documento = await tarea.promise;
  const paginas: PaginaLeida[] = [];
  for (let n = 1; n <= documento.numPages; n += 1) {
    const pagina = await documento.getPage(n);
    const contenido = await pagina.getTextContent();
    const [, , ancho, alto] = pagina.view as [number, number, number, number];
    const trozos: TrozoDeTexto[] = [];
    for (const item of contenido.items) {
      if (!("str" in item) || item.str === "") continue;
      // `transform` es la matriz del texto (a b c d e f): `e` y `f` son la posición.
      const [x = 0, y = 0] = (item.transform as number[]).slice(4);
      trozos.push({ texto: item.str, x, y, ancho: item.width, alto: item.height });
    }
    paginas.push({ trozos, texto: normalizar(trozos.map((t) => t.texto).join(" ")), ancho, alto });
  }
  await tarea.destroy();
  return paginas;
}

/** La fecha de creación de los metadatos del PDF, como la guarda el documento (`D:AAAAMMDDhhmmssZ`). */
export async function fechaDeCreacionDelPdf(bytes: Uint8Array): Promise<string | undefined> {
  const tarea = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const documento = await tarea.promise;
  const { info } = await documento.getMetadata();
  await tarea.destroy();
  return (info as { CreationDate?: string }).CreationDate;
}

/** La página dibujada como imagen (escala 1 = 72 puntos por pulgada). */
async function dibujarLaPagina(bytes: Uint8Array, numero: number, escala: number) {
  const tarea = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const documento = await tarea.promise;
  const pagina = await documento.getPage(numero);
  const vista = pagina.getViewport({ scale: escala });
  // El lienzo lo da el propio pdf.js (en Node usa su dibujante nativo opcional): este archivo no depende de otra librería.
  const { canvas, context } = (documento.canvasFactory as FabricaDeLienzos).create(
    Math.ceil(vista.width),
    Math.ceil(vista.height),
  );
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pagina.render({ canvasContext: context as never, viewport: vista, canvas }).promise;
  const imagen = context.getImageData(0, 0, canvas.width, canvas.height);
  await tarea.destroy();
  return { imagen };
}

/** El texto del código QR que se lee en la página dibujada (busca en la página entera); `null` si no se lee ninguno. */
export async function decodificarElQr(
  bytes: Uint8Array,
  numero: number,
  escala = 4,
): Promise<string | null> {
  const { imagen } = await dibujarLaPagina(bytes, numero, escala);
  return jsQR(imagen.data, imagen.width, imagen.height)?.data ?? null;
}

/**
 * El texto del QR que dibuja la pantalla: el SVG (`<rect>` de fondo y un `<path>` con tramos `M x y h w v1 h-w z`) se pinta módulo a módulo
 * y se lee con el mismo decodificador. Así el QR del PDF y el de la pantalla se comparan por lo que dicen, no por cómo se dibujan.
 */
export function decodificarElSvgDelQr(svg: string, aumento = 8): string | null {
  const lado = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  if (!Number.isInteger(lado)) throw new Error("el SVG del QR no tiene viewBox");
  const px = lado * aumento;
  const datos = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const tramo of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, ancho] = [Number(tramo[1]), Number(tramo[2]), Number(tramo[3])];
    for (let fila = y * aumento; fila < (y + 1) * aumento; fila += 1) {
      for (let columna = x * aumento; columna < (x + ancho) * aumento; columna += 1) {
        const desde = (fila * px + columna) * 4;
        datos.fill(0, desde, desde + 3);
      }
    }
  }
  return jsQR(datos, px, px)?.data ?? null;
}
