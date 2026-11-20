import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de la pantalla «Carta en línea» (C1; maqueta aprobada `carta-en-linea.html`, filas 60 y 70 de `decisiones-del-dueno-2026-11.md`): de lo que entrega la composición, lo que se ve
 * y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.carta.*`, con su fuente en `catalogo-catalogo.ts`); no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 * Reglas (cada una con su prueba en `test/web/carta-en-linea-modelo.test.ts`):
 *  - **Lo que cambia algo sale solo si la persona puede** (`ofertaDeLaCartaEnLinea`, solo una ayuda: el guard decide): sin permiso los botones salen apagados. Todo lo que no sea exactamente `true` cierra.
 *  - **«Poner en línea» sale apagado sin ningún producto que salga** (maqueta, «Supuestos»: el contador explica; la regla la vuelve a decidir el servidor). Sin carta guardada no hay estado ni botón.
 *  - **Los motivos de que un producto no salga se muestran con su cantidad, solo los que tienen alguno** (maqueta: «Sin precio», «Sin sección», «Desactivado», «Oculto»).
 *  - **«No disponible»** se dice bajo la dirección cuando la carta está fuera de línea (lo que ve quien abre la dirección).
 */

/** La pantalla y su única dirección. SUPUESTO (DEC-0547): la maqueta no fija la ruta; sigue el patrón de `/catalogo/secciones`. Revertir: cambiar esta constante y la carpeta de la página. */
export const RUTA_DE_LA_CARTA_EN_LINEA = "/catalogo/carta-en-linea";

/** Lo que entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type CartaEnLineaDeLaPantalla = Readonly<{
  carta: Readonly<{
    id: string;
    nombre: string;
    rubro: string | null;
    lugar: string | null;
    estado: "EN_LINEA" | "FUERA_DE_LINEA";
    version: number;
  }> | null;
  direccion: string | null;
  qrSvg: string | null;
  salen: number;
  faltan: Readonly<{
    sinPrecio: number;
    sinSeccion: number;
    desactivados: number;
    ocultos: number;
  }>;
}>;

export type OfertaDeLaCarta = Readonly<{ guardar: boolean; poner: boolean; sacar: boolean }>;

export type CartaEnLineaArmada = Readonly<{
  /** «En línea» / «Fuera de línea»; `null` si la sucursal todavía no tiene carta. */
  estado: Readonly<{ enLinea: boolean; texto: string }> | null;
  /** «Poner en línea» / «Sacar de línea»; `null` sin carta. */
  alternar: Readonly<{
    estadoPedido: "EN_LINEA" | "FUERA_DE_LINEA";
    texto: string;
    apagado: boolean;
  }> | null;
  /** «Salen 12 productos» / «Sale 1 producto». */
  contador: string;
  motivos: readonly Readonly<{ texto: string; cantidad: number }>[];
  formulario: Readonly<{
    nombre: Readonly<{ etiqueta: string; valorInicial: string }>;
    rubro: Readonly<{ etiqueta: string; valorInicial: string }>;
    lugar: Readonly<{ etiqueta: string; valorInicial: string }>;
    guardar: string;
    puedeGuardar: boolean;
  }>;
  /** La dirección y el QR; `null` mientras no hay carta guardada. */
  direccion: Readonly<{
    titulo: string;
    valor: string;
    copiar: string;
    copiado: string;
    descargar: string;
    qrSvg: string | null;
    /** «No disponible»: lo que ve quien abre la dirección mientras la carta está fuera de línea; `null` en línea. */
    noDisponible: string | null;
  }> | null;
}>;

const puede = (valor: boolean | undefined): boolean => valor === true;

export function armarLaCartaEnLinea(
  dato: CartaEnLineaDeLaPantalla,
  oferta: OfertaDeLaCarta,
  d: DiccionarioResuelto = {},
): CartaEnLineaArmada {
  const { carta } = dato;
  const enLinea = carta?.estado === "EN_LINEA";
  const motivos = [
    { texto: texto(d, "catalogo.precio.sin_precio"), cantidad: dato.faltan.sinPrecio },
    { texto: texto(d, "catalogo.carta.sin_seccion"), cantidad: dato.faltan.sinSeccion },
    { texto: texto(d, "catalogo.estado.desactivado"), cantidad: dato.faltan.desactivados },
    { texto: texto(d, "catalogo.carta.oculto"), cantidad: dato.faltan.ocultos },
  ].filter((m) => m.cantidad > 0);
  return {
    estado:
      carta === null
        ? null
        : {
            enLinea,
            texto: texto(d, enLinea ? "catalogo.carta.en_linea" : "catalogo.carta.fuera_de_linea"),
          },
    alternar:
      carta === null
        ? null
        : {
            estadoPedido: enLinea ? "FUERA_DE_LINEA" : "EN_LINEA",
            texto: texto(d, enLinea ? "catalogo.carta.sacar" : "catalogo.carta.poner"),
            apagado: enLinea ? !puede(oferta.sacar) : !puede(oferta.poner) || dato.salen === 0,
          },
    contador:
      dato.salen === 1
        ? texto(d, "catalogo.carta.sale_uno")
        : texto(d, "catalogo.carta.salen", { cantidad: String(dato.salen) }),
    motivos,
    formulario: {
      nombre: { etiqueta: texto(d, "catalogo.dato.nombre"), valorInicial: carta?.nombre ?? "" },
      rubro: { etiqueta: texto(d, "catalogo.carta.rubro"), valorInicial: carta?.rubro ?? "" },
      lugar: { etiqueta: texto(d, "catalogo.carta.lugar"), valorInicial: carta?.lugar ?? "" },
      guardar: texto(d, "catalogo.accion.guardar"),
      puedeGuardar: puede(oferta.guardar),
    },
    direccion:
      carta === null || dato.direccion === null
        ? null
        : {
            titulo: texto(d, "catalogo.carta.direccion"),
            valor: dato.direccion,
            copiar: texto(d, "catalogo.accion.copiar"),
            copiado: texto(d, "vidriera.producto.enlace_copiado"),
            descargar: texto(d, "catalogo.carta.descargar_qr"),
            qrSvg: dato.qrSvg,
            noDisponible: enLinea ? null : texto(d, "catalogo.carta.no_disponible"),
          },
  };
}
