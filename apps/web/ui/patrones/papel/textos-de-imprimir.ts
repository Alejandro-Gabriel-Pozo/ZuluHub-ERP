import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { rotuloDelAncho, type PapelParaImprimir } from "./hoja-del-papel";

/**
 * Los textos del botón «Imprimir» (S-2; maqueta aprobada `imprimir.html`, 09/11/2026): de la clave del catálogo (`comandas.texto.imprimir_*`) al texto resuelto, y NADA más. Puro: sin React ni servidor.
 * No se arma ningún texto nuevo, solo se eligen los aprobados. La hoja de prueba de una impresora usa únicamente el nombre y el ancho («58 mm» u «80 mm»), sin palabras nuevas.
 * Chequeo: `test/web/impresoras-modelo.test.ts`.
 */
export function armarLosTextosDeImprimir(d: DiccionarioResuelto = {}) {
  return {
    imprimir: texto(d, "comandas.texto.imprimir_imprimir"),
    imprimiendo: texto(d, "comandas.texto.imprimir_imprimiendo"),
    impresa: texto(d, "comandas.texto.imprimir_impresa"),
    noSePudo: texto(d, "comandas.texto.imprimir_no_se_pudo_imprimir"),
    reintentar: texto(d, "comandas.texto.imprimir_reintentar"),
    verEnPantalla: texto(d, "comandas.texto.imprimir_ver_en_pantalla"),
    sinImpresora: texto(d, "comandas.texto.imprimir_no_hay_impresora_para_la_comanda_de_cocina"),
  } as const;
}

/** La hoja fija de «Imprimir prueba»: el nombre de la impresora y su ancho de papel. Sin trabajo registrado: es solo del navegador. */
export const hojaDePrueba = (nombre: string, anchoMm: number): PapelParaImprimir => ({
  ancho: anchoMm,
  lineas: [
    { texto: nombre, estilo: "NEGRITA" },
    { texto: rotuloDelAncho(anchoMm), estilo: "NORMAL" },
  ],
});
