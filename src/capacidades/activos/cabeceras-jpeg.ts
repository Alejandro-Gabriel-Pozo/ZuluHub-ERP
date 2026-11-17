import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { empiezaCon, FIRMA_JPEG, vistaDe } from "./bytes-de-imagen";
import type { CabeceraJpeg, ErrorDeCabecera } from "./tipos-de-cabecera";

// --- JPEG -------------------------------------------------------------------------------------------

/** Un segmento del JPEG: `[inicio, fin)` incluye el marcador `FF xx`, el largo y, en el SOS, el escaneo. */
export type SegmentoDeJpeg = Readonly<{ marcador: number; inicio: number; fin: number }>;

export type AnalisisDeJpeg = Readonly<{
  cabecera: CabeceraJpeg;
  /** Todos los segmentos después del SOI, el último es el EOI. */
  segmentos: readonly SegmentoDeJpeg[];
}>;

/** Marcadores de comienzo de cuadro (SOF): C0 a CF salvo DHT (C4), JPG (C8) y DAC (CC). */
const esSof = (marcador: number): boolean =>
  marcador >= 0xc0 &&
  marcador <= 0xcf &&
  marcador !== 0xc4 &&
  marcador !== 0xc8 &&
  marcador !== 0xcc;

const SOF0 = 0xc0; // base secuencial
const SOF2 = 0xc2; // progresivo
const SOS = 0xda;
const EOI = 0xd9;

/**
 * Recorre TODA la estructura de marcadores del JPEG, incluidos los datos de los escaneos, hasta el EOI:
 * un segmento de metadatos escondido entre dos escaneos también aparece. Admite solo SOF0 y SOF2 de 8
 * bits y un único cuadro (dos SOF serían medidas ambiguas). Los bytes después del EOI no son parte de
 * la imagen y se ignoran. Cada segmento con largo declara `largo >= 2` y tiene que entrar en los bytes.
 */
export function analizarJpeg(bytes: Uint8Array): Resultado<AnalisisDeJpeg, ErrorDeCabecera> {
  if (!empiezaCon(bytes, 0, FIRMA_JPEG)) return err("FORMATO_NO_RECONOCIDO");
  const v = vistaDe(bytes);
  const segmentos: SegmentoDeJpeg[] = [];
  type Medidas = Readonly<{ ancho: number; alto: number }>;
  let cuadro: Medidas | null = null;
  let imagen: Medidas | null = null; // las medidas, una vez que hubo un escaneo
  let pos = 2; // el SOI ocupa los bytes 0 y 1; la firma garantiza un FF en el 2
  for (;;) {
    if (pos >= bytes.length) return err("TRUNCADO");
    if (v.getUint8(pos) !== 0xff) return err("CABECERA_INVALIDA");
    // Cualquier cantidad de FF de relleno puede preceder al marcador: el segmento empieza en el último.
    let inicio = pos;
    while (inicio + 1 < bytes.length && v.getUint8(inicio + 1) === 0xff) inicio++;
    if (inicio + 1 >= bytes.length) return err("TRUNCADO");
    const marcador = v.getUint8(inicio + 1);

    if (marcador === EOI) {
      // Sin ningún escaneo no hay imagen.
      if (imagen === null) return err("CABECERA_INVALIDA");
      segmentos.push({ marcador, inicio, fin: inicio + 2 });
      return ok({ cabecera: { formato: "jpeg", ...imagen, animado: false }, segmentos });
    }
    // 00 (relleno de datos), 01 (TEM), RSTn (D0-D7) y SOI (D8): sin largo y fuera de lugar acá.
    if (marcador <= 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) return err("CABECERA_INVALIDA");

    if (inicio + 4 > bytes.length) return err("TRUNCADO");
    const largo = v.getUint16(inicio + 2);
    if (largo < 2) return err("CABECERA_INVALIDA");
    const fin = inicio + 2 + largo;
    if (fin > bytes.length) return err("TRUNCADO");

    if (esSof(marcador)) {
      if (marcador !== SOF0 && marcador !== SOF2) return err("VARIANTE_NO_ADMITIDA");
      // 8 bytes fijos (largo, precisión, alto, ancho y cantidad de componentes) y 3 por componente, al menos 1.
      if (cuadro !== null || largo < 11) return err("CABECERA_INVALIDA");
      const componentes = v.getUint8(inicio + 9);
      const alto = v.getUint16(inicio + 5);
      const ancho = v.getUint16(inicio + 7);
      if (
        v.getUint8(inicio + 4) !== 8 || // precisión
        largo !== 8 + 3 * componentes ||
        ancho === 0 ||
        alto === 0
      ) {
        return err("CABECERA_INVALIDA");
      }
      cuadro = { ancho, alto };
    }

    if (marcador !== SOS) {
      segmentos.push({ marcador, inicio, fin });
      pos = fin;
      continue;
    }

    // SOS: tras su encabezado vienen los datos entropía; terminan en el próximo marcador que no sea
    // un FF 00 (byte relleno), un RSTn ni un FF de relleno.
    if (cuadro === null) return err("CABECERA_INVALIDA");
    imagen = cuadro;
    let desde = fin;
    for (;;) {
      const ff = bytes.indexOf(0xff, desde);
      if (ff === -1 || ff + 1 >= bytes.length) return err("TRUNCADO");
      const siguiente = v.getUint8(ff + 1);
      if (siguiente === 0x00 || (siguiente >= 0xd0 && siguiente <= 0xd7)) {
        desde = ff + 2;
      } else if (siguiente === 0xff) {
        desde = ff + 1;
      } else {
        pos = ff;
        break;
      }
    }
    segmentos.push({ marcador, inicio, fin: pos });
  }
}

export function leerJpeg(bytes: Uint8Array): Resultado<CabeceraJpeg, ErrorDeCabecera> {
  const analisis = analizarJpeg(bytes);
  return analisis.ok ? ok(analisis.valor.cabecera) : analisis;
}
