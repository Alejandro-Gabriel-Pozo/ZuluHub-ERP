import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { UNIDADES, type CodigoDeUnidad } from "../../../primitivas/unidades/unidades";
import type { PapelEnMm } from "./impresion";
import type { RolDeRenglon, TipoDeEnvio } from "./envio";

/**
 * LO QUE DICE EL PAPEL (E7 §3.5 «Documentos imprimibles»). Funciones puras que arman el MODELO del papel (líneas de texto con un estilo y el ancho
 * 58/80 mm): el servidor lo devuelve y el navegador lo imprime con el diálogo del sistema (PP-1). Salen SIEMPRE de las fotos guardadas del envío,
 * nunca del catálogo vivo (la reimpresión sale idéntica, D87) y la comanda nunca lleva precios. La fecha y la hora llegan ya formateadas como texto
 * (zona de la sucursal): este archivo no calcula zonas. Previene: una reimpresión que cambia de contenido, un precio en la cocina, y la fracción «½» que
 * una térmica no dibuja (decisión 181: se escribe «1/2»).
 *
 * Textos del papel: los aprobados de E7 §10 («Papel» y «Orden de salida»: COMANDA · COCINA · ANULACIÓN · NO PREPARAR · Tomó · Copia · Envío N · Piden
 * que salga · Quedan · Motivo; fuente `salon.html:312-337` y `imprimir.html:299`, aprobados 09/11/2026; «Copia» en lugar de «REIMPRESIÓN» por la D120)
 * y «no preparar todavía» de E7 §3.5 (rol `ESPERA`). Un cambio de texto es un cambio de esta constante, con su prueba.
 */
export const TEXTOS_DEL_PAPEL = {
  comanda: "COMANDA · COCINA",
  anulacion: "ANULACIÓN · NO PREPARAR",
  copia: "Copia",
  envio: "Envío",
  pidenQueSalga: "Piden que salga",
  tomo: "Tomó",
  quedan: "Quedan",
  motivo: "Motivo",
  noPrepararTodavia: "no preparar todavía",
  ticket: "Ticket N.º",
  total: "Total",
} as const;

export type EstiloDeLinea = "NORMAL" | "GRANDE" | "NEGRITA" | "SEPARADOR";
export type LineaDePapel = Readonly<{ texto: string; estilo: EstiloDeLinea }>;
export type ModeloDePapel = Readonly<{ ancho: PapelEnMm; lineas: readonly LineaDePapel[] }>;

/** Columnas de texto normal por ancho de papel (fuente de impresora térmica estándar). */
export function columnasDelPapel(ancho: PapelEnMm): number {
  return ancho === 58 ? 32 : 48;
}

// ---------------------------------------------------------------------------------------------
// La cantidad en el papel (decisión 181)
// ---------------------------------------------------------------------------------------------
export type ErrorDeCantidadParaPapel = "CANTIDAD_NO_IMPRIMIBLE";

/** La abreviatura de cada unidad en el papel; el `satisfies` exige una por cada unidad conocida (una nueva sin abreviatura no compila). */
const ABREVIATURA_DE_UNIDAD = {
  UNIDAD: "u",
  GRAMO: "g",
  KILOGRAMO: "kg",
  TONELADA: "t",
  MILILITRO: "ml",
  LITRO: "l",
  METRO_CUBICO: "m³",
  MILIMETRO: "mm",
  CENTIMETRO: "cm",
  METRO: "m",
  CENTIMETRO_CUADRADO: "cm²",
  METRO_CUADRADO: "m²",
  MINUTO: "min",
  HORA: "h",
} as const satisfies Record<CodigoDeUnidad, string>;

const ESCALA = 10_000n; // la cantidad tiene 4 decimales
const DENOMINADORES_IMPRIMIBLES = new Set([1n, 2n, 4n, 8n]);

function mcd(a: bigint, b: bigint): bigint {
  return b === 0n ? a : mcd(b, a % b);
}

function leer(texto: string): Cantidad | null {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/**
 * Una sola función para escribir la cantidad en el papel. Por unidad: entero y fracción reducida con barra («1/2», «3/4», «1 1/2», «1/8», «2»; nunca
 * «½»); la fracción es una parte de la unidad del tamaño elegido. Por peso, volumen y demás: el número con coma y la unidad («350 g»), sin fracciones.
 * Solo cantidades positivas y múltiplo exacto del paso congelado; un denominador que no sea 2, 4 u 8 no se imprime como fracción (un tercio no existe).
 */
export function cantidadParaPapel(
  cantidad: string,
  datos: Readonly<{ unidadDeVenta: string; paso: string }>,
): Resultado<string, ErrorDeCantidadParaPapel> {
  const c = leer(cantidad);
  const paso = leer(datos.paso);
  if (c === null || paso === null || c.unidades <= 0n || paso.unidades <= 0n) {
    return err("CANTIDAD_NO_IMPRIMIBLE");
  }
  if (c.unidades % paso.unidades !== 0n) return err("CANTIDAD_NO_IMPRIMIBLE");
  if (!Object.hasOwn(UNIDADES, datos.unidadDeVenta)) return err("CANTIDAD_NO_IMPRIMIBLE");
  const codigo = datos.unidadDeVenta as CodigoDeUnidad;
  const entera = c.unidades / ESCALA;
  const resto = c.unidades % ESCALA;
  if (codigo !== "UNIDAD") {
    const decimales = resto.toString().padStart(4, "0").replace(/0+$/, "");
    const numero = decimales === "" ? `${entera}` : `${entera},${decimales}`;
    return ok(`${numero} ${ABREVIATURA_DE_UNIDAD[codigo]}`);
  }
  if (resto === 0n) return ok(`${entera}`);
  const divisor = mcd(resto, ESCALA);
  const numerador = resto / divisor;
  const denominador = ESCALA / divisor;
  if (!DENOMINADORES_IMPRIMIBLES.has(denominador)) return err("CANTIDAD_NO_IMPRIMIBLE");
  return ok(
    entera === 0n ? `${numerador}/${denominador}` : `${entera} ${numerador}/${denominador}`,
  );
}

// ---------------------------------------------------------------------------------------------
// Armado del modelo
// ---------------------------------------------------------------------------------------------
/** Un renglón de detalle: sangrado de dos espacios, partido por palabras dentro del ancho que queda. */
function sangrado(texto: string, columnas: number): LineaDePapel[] {
  return envolver(texto, columnas - 2, "NORMAL").map((l) => ({ ...l, texto: `  ${l.texto}` }));
}

const SEPARADOR: LineaDePapel = { texto: "", estilo: "SEPARADOR" };

/** Parte un texto en renglones de a lo sumo `columnas` caracteres, por palabras (una palabra más larga se corta). Previene: texto cortado por el papel. */
function envolver(texto: string, columnas: number, estilo: EstiloDeLinea): LineaDePapel[] {
  const ancho = estilo === "GRANDE" ? Math.max(1, Math.floor(columnas / 2)) : columnas;
  const lineas: string[] = [];
  for (const palabra of texto.split(" ")) {
    // Los espacios de más dejan palabras vacías, que no dan ningún trozo. Una palabra más larga que el ancho se corta en trozos de a `ancho`; cada trozo se pega al renglón anterior solo si entra con su espacio.
    for (let desde = 0; desde < palabra.length; desde += ancho) {
      const trozo = palabra.slice(desde, desde + ancho);
      const previo = lineas.at(-1);
      if (previo !== undefined && previo.length + 1 + trozo.length <= ancho) {
        lineas[lineas.length - 1] = `${previo} ${trozo}`;
      } else {
        lineas.push(trozo);
      }
    }
  }
  return lineas.map((t) => ({ texto: t, estilo }));
}

export type RenglonDelPapel = Readonly<{
  /** Cantidad del renglón, texto decimal exacto (múltiplo del paso). */
  cantidad: string;
  unidadDeVenta: string;
  paso: string;
  /** Foto del nombre de cocina (o del producto) al enviar. */
  nombreDeCocina: string;
  /** Variante y opciones, también las ocultas de la carta (foto). */
  detalle: readonly string[];
  rol: RolDeRenglon;
}>;

export type EnvioParaElPapel = Readonly<{
  numero: number;
  tipo: TipoDeEnvio;
  /** «Mesa 5»: la foto del rótulo. */
  rotulo: string;
  /** Fecha y hora DEL ENVÍO (la original, también en la copia), ya formateadas por quien llama. */
  enviadoEn: string;
  /** Nombre de quien tomó el pedido. */
  tomadoPor: string;
}>;

function cantidadVisible(
  r: Pick<RenglonDelPapel, "cantidad" | "unidadDeVenta" | "paso">,
): Resultado<string, ErrorDeCantidadParaPapel> {
  return cantidadParaPapel(r.cantidad, { unidadDeVenta: r.unidadDeVenta, paso: r.paso });
}

/** La comanda de un envío: mesa en grande, número y hora del envío, quién tomó el pedido y los renglones. Sin precios, nunca. */
export function documentoDeComanda(
  envio: EnvioParaElPapel,
  renglones: readonly RenglonDelPapel[],
  opciones: Readonly<{ copia: boolean; ancho: PapelEnMm }>,
): Resultado<ModeloDePapel, ErrorDeCantidadParaPapel> {
  const columnas = columnasDelPapel(opciones.ancho);
  const lineas: LineaDePapel[] = [];
  if (opciones.copia) lineas.push({ texto: TEXTOS_DEL_PAPEL.copia, estilo: "NEGRITA" });
  lineas.push({ texto: TEXTOS_DEL_PAPEL.comanda, estilo: "NEGRITA" });
  lineas.push(...envolver(envio.rotulo, columnas, "GRANDE"));
  lineas.push({ texto: `${TEXTOS_DEL_PAPEL.envio} ${envio.numero}`, estilo: "NEGRITA" });
  if (envio.tipo === "SALIDA_PEDIDA") {
    lineas.push({ texto: TEXTOS_DEL_PAPEL.pidenQueSalga, estilo: "NEGRITA" });
  }
  lineas.push(...envolver(envio.enviadoEn, columnas, "NORMAL"));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.tomo}: ${envio.tomadoPor}`, columnas, "NORMAL"));
  lineas.push(SEPARADOR);
  for (const r of renglones) {
    const cantidad = cantidadVisible(r);
    if (!cantidad.ok) return cantidad;
    lineas.push(...envolver(`${cantidad.valor} ${r.nombreDeCocina}`, columnas, "NEGRITA"));
    for (const d of r.detalle) lineas.push(...sangrado(d, columnas));
    if (r.rol === "ESPERA") {
      lineas.push(...sangrado(TEXTOS_DEL_PAPEL.noPrepararTodavia, columnas));
    }
  }
  return ok({ ancho: opciones.ancho, lineas });
}

export type AvisoParaElPapel = Readonly<{
  rotulo: string;
  /** Número del envío en que salió el ítem. */
  envioNumero: number;
  /** Fecha y hora del envío ORIGINAL del ítem, ya formateadas. */
  enviadoEn: string;
  anuladoPor: string;
  cantidadAnulada: string;
  /** Lo que sigue vigente de esa línea; cero si se anuló entera. */
  quedan: string;
  unidadDeVenta: string;
  paso: string;
  nombreDeCocina: string;
  detalle: readonly string[];
  motivo: string;
}>;

/** El aviso «ANULACIÓN · NO PREPARAR»: cantidad anulada, cuánto queda y el motivo. Sin precios. */
export function documentoDeAnulacion(
  aviso: AvisoParaElPapel,
  opciones: Readonly<{ copia: boolean; ancho: PapelEnMm }>,
): Resultado<ModeloDePapel, ErrorDeCantidadParaPapel> {
  const columnas = columnasDelPapel(opciones.ancho);
  const anulada = cantidadVisible({
    cantidad: aviso.cantidadAnulada,
    unidadDeVenta: aviso.unidadDeVenta,
    paso: aviso.paso,
  });
  if (!anulada.ok) return anulada;
  const queda = leer(aviso.quedan);
  if (queda === null) return err("CANTIDAD_NO_IMPRIMIBLE");
  const quedan: Resultado<string, ErrorDeCantidadParaPapel> =
    queda.unidades === 0n
      ? ok("0")
      : cantidadVisible({
          cantidad: aviso.quedan,
          unidadDeVenta: aviso.unidadDeVenta,
          paso: aviso.paso,
        });
  if (!quedan.ok) return quedan;
  const lineas: LineaDePapel[] = [];
  if (opciones.copia) lineas.push({ texto: TEXTOS_DEL_PAPEL.copia, estilo: "NEGRITA" });
  lineas.push({ texto: TEXTOS_DEL_PAPEL.anulacion, estilo: "NEGRITA" });
  lineas.push(...envolver(aviso.rotulo, columnas, "GRANDE"));
  lineas.push({ texto: `${TEXTOS_DEL_PAPEL.envio} ${aviso.envioNumero}`, estilo: "NEGRITA" });
  lineas.push(...envolver(aviso.enviadoEn, columnas, "NORMAL"));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.tomo}: ${aviso.anuladoPor}`, columnas, "NORMAL"));
  lineas.push(SEPARADOR);
  lineas.push(...envolver(`${anulada.valor} ${aviso.nombreDeCocina}`, columnas, "NEGRITA"));
  for (const d of aviso.detalle) lineas.push(...sangrado(d, columnas));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.quedan}: ${quedan.valor}`, columnas, "NORMAL"));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.motivo}: ${aviso.motivo}`, columnas, "NORMAL"));
  return ok({ ancho: opciones.ancho, lineas });
}

export type FichaParaElPapel = Readonly<{
  numero: number;
  /** Fecha del ticket, ya formateada. */
  fecha: string;
  lineas: readonly Readonly<{ cantidad: string; descripcion: string; importe: string }>[];
  total: string;
}>;

/** El ticket del cliente: lo que ya muestra la ficha de ventas, en el modelo de papel (descripción a la izquierda, importe a la derecha). */
export function documentoDeTicket(
  ficha: FichaParaElPapel,
  opciones: Readonly<{ ancho: PapelEnMm }>,
): ModeloDePapel {
  const columnas = columnasDelPapel(opciones.ancho);
  const dosColumnas = (izquierda: string, derecha: string): LineaDePapel[] => {
    const lugar = columnas - derecha.length - 1;
    // La descripción siempre trae al menos la cantidad: con lugar 0 o negativo nunca entra y se parte.
    if (izquierda.length <= lugar) {
      return [{ texto: `${izquierda.padEnd(lugar)} ${derecha}`, estilo: "NORMAL" }];
    }
    return [...envolver(izquierda, columnas, "NORMAL"), ...envolver(derecha, columnas, "NORMAL")];
  };
  const lineas: LineaDePapel[] = [
    { texto: `${TEXTOS_DEL_PAPEL.ticket} ${ficha.numero}`, estilo: "NEGRITA" },
    ...envolver(ficha.fecha, columnas, "NORMAL"),
    SEPARADOR,
  ];
  for (const l of ficha.lineas) {
    lineas.push(...dosColumnas(`${l.cantidad} ${l.descripcion}`, l.importe));
  }
  lineas.push(SEPARADOR);
  for (const l of dosColumnas(TEXTOS_DEL_PAPEL.total, ficha.total)) {
    lineas.push({ ...l, estilo: "NEGRITA" });
  }
  return { ancho: opciones.ancho, lineas };
}
