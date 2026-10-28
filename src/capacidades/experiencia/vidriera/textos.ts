import { texto } from "../../vocabulario/vocabulario";
import type { DiccionarioResuelto } from "../../vocabulario/vocabulario";

/**
 * Los textos de la carta pública, ya resueltos para pintar (capa 5 recibe texto, no claves: [01] §3.2). Son
 * cadenas planas para poder cruzar del servidor al navegador; los que llevan un marcador (`{cantidad}`,
 * `{texto}`) lo completa la pantalla con el dato, como TEXTO.
 */
export type TextosDeVidriera = Readonly<{
  letraEtiqueta: string;
  letraGrupo: string;
  letraNormal: string;
  letraGrande: string;
  letraMuyGrande: string;
  buscarEtiqueta: string;
  buscarUnResultado: string;
  /** Con el marcador `{cantidad}`. */
  buscarResultados: string;
  /** Con el marcador `{texto}`. */
  buscarSinResultados: string;
  buscarLimpiar: string;
  indiceTitulo: string;
  indiceIr: string;
  agotado: string;
  precios: string;
  cerrar: string;
  volver: string;
  verTodaLaVidriera: string;
  compartir: string;
  enlaceCopiado: string;
  enlaceNoCopiado: string;
  productoNoEsta: string;
  precioConIva: string;
}>;

export function textosDeVidriera(diccionario: DiccionarioResuelto): TextosDeVidriera {
  const t = (clave: Parameters<typeof texto>[1]) => texto(diccionario, clave);
  return {
    letraEtiqueta: t("carta.letra.etiqueta"),
    letraGrupo: t("carta.letra.grupo"),
    letraNormal: t("carta.letra.normal"),
    letraGrande: t("carta.letra.grande"),
    letraMuyGrande: t("carta.letra.muy_grande"),
    buscarEtiqueta: t("carta.buscar.etiqueta"),
    buscarUnResultado: t("carta.buscar.un_resultado"),
    // Los marcadores se dejan a la vista: el dato lo pone la pantalla, no el vocabulario.
    buscarResultados: t("carta.buscar.resultados"),
    buscarSinResultados: t("carta.buscar.sin_resultados"),
    buscarLimpiar: t("carta.buscar.limpiar"),
    indiceTitulo: t("carta.indice.titulo"),
    indiceIr: t("carta.indice.ir"),
    agotado: t("carta.producto.agotado"),
    precios: t("carta.producto.precios"),
    cerrar: t("carta.producto.cerrar"),
    volver: t("carta.producto.volver"),
    verTodaLaVidriera: t("carta.producto.ver_toda"),
    compartir: t("carta.producto.compartir"),
    enlaceCopiado: t("carta.producto.enlace_copiado"),
    enlaceNoCopiado: t("carta.producto.enlace_no_copiado"),
    productoNoEsta: t("carta.producto.no_esta"),
    precioConIva: t("carta.pie.iva"),
  };
}
