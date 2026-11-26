import { cantidadDesdeTexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { cantidadParaMostrar } from "../../../primitivas/cantidad/cantidad-para-mostrar";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  columnasDelPapel,
  envolver,
  SEPARADOR,
  sangrado,
  type LineaDePapel,
  type ModeloDePapel,
  type PapelEnMm,
} from "../../../primitivas/papel/modelo-de-papel";
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
 * y «Sale después» (`salida.html`, aprobado) para el rol `ESPERA`. Un cambio de texto es un cambio de esta constante, con su prueba.
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
  saleDespues: "Sale después",
} as const;

// El modelo de papel y su maquetado son de `primitivas/papel` (los comparte el ticket de ventas); se reexportan con los mismos nombres.
export {
  columnasDelPapel,
  type EstiloDeLinea,
  type LineaDePapel,
  type ModeloDePapel,
} from "../../../primitivas/papel/modelo-de-papel";

// ---------------------------------------------------------------------------------------------
// La cantidad en el papel (decisión 181)
// ---------------------------------------------------------------------------------------------
export type ErrorDeCantidadParaPapel = "CANTIDAD_NO_IMPRIMIBLE";

function leer(texto: string): Cantidad | null {
  try {
    return cantidadDesdeTexto(texto);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/**
 * La cantidad en el papel de COMANDA: la regla única de `primitivas/cantidad/cantidad-para-mostrar.ts` (decisión 181) en su variante ASCII, con barra
 * («1/2», «3/4», «1 1/2», «1/8», «2», «350 g»; nunca «½» en la cocina, D181) y con el paso congelado del renglón obligatorio.
 */
export function cantidadParaPapel(
  cantidad: string,
  datos: Readonly<{ unidadDeVenta: string; paso: string }>,
): Resultado<string, ErrorDeCantidadParaPapel> {
  const r = cantidadParaMostrar(
    cantidad,
    { unidadDeVenta: datos.unidadDeVenta, paso: datos.paso },
    { fraccionEnAscii: true },
  );
  return r.ok ? r : err("CANTIDAD_NO_IMPRIMIBLE");
}

// ---------------------------------------------------------------------------------------------
// Armado del modelo
// ---------------------------------------------------------------------------------------------
export type RenglonDelPapel = Readonly<{
  /** Cantidad del renglón, texto decimal exacto (múltiplo del paso). */
  cantidad: string;
  unidadDeVenta: string;
  paso: string;
  /** Foto del nombre de cocina (o del producto) al enviar. */
  nombreDeCocina: string;
  /** Variante y opciones, también las ocultas de la carta (foto). */
  detalle: readonly string[];
  /** La foto de la nota libre del plato («sin cebolla», SAL-G): sale bajo el plato, sin precio ni formato; ausente = sin nota. */
  nota?: string | null | undefined;
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
    if (r.nota !== undefined && r.nota !== null) lineas.push(...sangrado(r.nota, columnas));
    if (r.rol === "ESPERA") {
      lineas.push(...sangrado(TEXTOS_DEL_PAPEL.saleDespues, columnas));
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
  /** La nota libre del plato que se anula (la de la foto del envío): la cocina ve lo mismo que había preparado. */
  nota?: string | null | undefined;
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
  if (aviso.nota !== undefined && aviso.nota !== null)
    lineas.push(...sangrado(aviso.nota, columnas));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.quedan}: ${quedan.valor}`, columnas, "NORMAL"));
  lineas.push(...envolver(`${TEXTOS_DEL_PAPEL.motivo}: ${aviso.motivo}`, columnas, "NORMAL"));
  return ok({ ancho: opciones.ancho, lineas });
}
