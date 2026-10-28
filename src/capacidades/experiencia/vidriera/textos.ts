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
    letraEtiqueta: t("vidriera.letra.etiqueta"),
    letraGrupo: t("vidriera.letra.grupo"),
    letraNormal: t("vidriera.letra.normal"),
    letraGrande: t("vidriera.letra.grande"),
    letraMuyGrande: t("vidriera.letra.muy_grande"),
    buscarEtiqueta: t("vidriera.buscar.etiqueta"),
    buscarUnResultado: t("vidriera.buscar.un_resultado"),
    // Los marcadores se dejan a la vista: el dato lo pone la pantalla, no el vocabulario.
    buscarResultados: t("vidriera.buscar.resultados"),
    buscarSinResultados: t("vidriera.buscar.sin_resultados"),
    buscarLimpiar: t("vidriera.buscar.limpiar"),
    indiceTitulo: t("vidriera.indice.titulo"),
    indiceIr: t("vidriera.indice.ir"),
    agotado: t("vidriera.producto.agotado"),
    precios: t("vidriera.producto.precios"),
    cerrar: t("vidriera.producto.cerrar"),
    volver: t("vidriera.producto.volver"),
    verTodaLaVidriera: t("vidriera.producto.ver_toda"),
    compartir: t("vidriera.producto.compartir"),
    enlaceCopiado: t("vidriera.producto.enlace_copiado"),
    enlaceNoCopiado: t("vidriera.producto.enlace_no_copiado"),
    productoNoEsta: t("vidriera.producto.no_esta"),
    precioConIva: t("vidriera.pie.iva"),
  };
}
