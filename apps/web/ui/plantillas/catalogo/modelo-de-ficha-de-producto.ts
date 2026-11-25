import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { CLAVE_DE_CLASE, RUTA_DE_PRODUCTOS } from "./filtros-de-productos";
import { cantidadConUnidad } from "../produccion/modelo-de-ordenes";
import { RUTA_DE_SECCIONES } from "./modelo-de-secciones";

/**
 * El modelo de vista de la ficha de datos de un producto (A1, T2a; maqueta aprobada `productos.html`, función `vDatos`): de lo que entrega la composición, los campos que se ven,
 * en el orden de la maqueta, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en `catalogo-catalogo.ts`); no se arma ningún
 * texto nuevo, solo se eligen los aprobados.
 *
 * Qué se ve según la clase (maqueta): el nombre de cocina, la alícuota y la sección solo si el producto se vende. La clase y la unidad se ven pero no se cambian (`editarProducto` no
 * las acepta; en la maqueta salen apagadas). Un valor guardado que el desplegable no ofrece (una alícuota que el producto ya no ofrece, una sección desactivada) se muestra y el campo
 * sale apagado: no se manda y el servidor conserva lo guardado, así que guardar no lo borra en silencio. Un valor que la pantalla no sabe nombrar se dice con el propio valor (nunca se
 * esconde un dato por no saber nombrarlo).
 */

export const rutaDeLaFicha = (id: string): string => `${RUTA_DE_PRODUCTOS}/${id}`;

/** Las seis alícuotas que ofrece el producto (dueño, 12/11/2026), cada una con la clave de su texto. Una prueba compara estas claves con la lista del módulo fiscal. */
export const CLAVE_DE_ALICUOTA: Readonly<Record<string, ClaveDeTexto>> = {
  "21": "catalogo.alicuota.21",
  "10.5": "catalogo.alicuota.10_5",
  "27": "catalogo.alicuota.27",
  "5": "catalogo.alicuota.5",
  "2.5": "catalogo.alicuota.2_5",
  "0": "catalogo.alicuota.0",
};

/** La ficha como la entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type FichaDeLaPantalla = Readonly<{
  id: string;
  version: number;
  nombre: string;
  claseDeUso: string;
  unidadBaseId: string;
  seVende: boolean;
  /** Si la ficha puede ofrecer el tilde «Se controla el stock» (lo calcula la composición con la regla del módulo). */
  admiteControlDeStock: boolean;
  /** Si la clase es de stock propio (elaborado o vendible): el tilde se llama «Se produce en tanda» y su aviso es el de TP-9. */
  admiteStockPropio: boolean;
  nombreDeCocina: string | null;
  codigo: string | null;
  codigoDeBarras: string | null;
  alicuota: string | null;
  seccion: Readonly<{ id: string; nombre: string; activa: boolean }> | null;
  alicuotas: readonly string[];
  secciones: readonly Readonly<{ id: string; nombre: string }>[];
}>;

type Opcion = Readonly<{ valor: string; etiqueta: string }>;

/** Un desplegable: lo guardado, lo que ofrece y si sale apagado (no se manda: el servidor conserva lo guardado). */
type DesplegableArmado = Readonly<{
  etiqueta: string;
  valor: string;
  opciones: readonly Opcion[];
  apagado: boolean;
}>;

export type FichaArmada = Readonly<{
  id: string;
  version: number;
  titulo: string;
  /** Solo se ven. */
  clase: Readonly<{ etiqueta: string; valor: string }>;
  unidad: Readonly<{ etiqueta: string; valor: string }>;
  nombre: Readonly<{ etiqueta: string; valor: string }>;
  /** `null` si la clase no se vende. */
  nombreDeCocina: Readonly<{ etiqueta: string; valor: string }> | null;
  codigo: Readonly<{ etiqueta: string; valor: string }>;
  codigoDeBarras: Readonly<{ etiqueta: string; valor: string }>;
  /** `null` si la clase no se vende. */
  alicuota: DesplegableArmado | null;
  /** `null` si la clase no se vende. */
  seccion: DesplegableArmado | null;
  /** «Secciones», junto al campo de la sección (A8, maqueta `productos-secciones.html`, línea 368); `null` si la clase no se vende (el campo no está). */
  enlaceDeSecciones: Readonly<{ href: string; texto: string }> | null;
  /** Solo si el producto admite el tilde (la clase se controla y está activo): el texto de la casilla; si no, `null`. */
  etiquetaDelControlDeStock: string | null;
  /** Lo que dice el diálogo que confirma el cambio del control de stock; `null` cuando no hay casilla. */
  confirmacionDelControlDeStock: Readonly<{
    titulo: string;
    activar: string;
    apagar: string;
    confirmar: string;
    cancelar: string;
    cerrar: string;
  }> | null;
  textoDeElegir: string;
  guardar: string;
}>;

/** El texto de un valor de una tabla de claves, o el propio valor si la pantalla no lo conoce. */
export const nombrar = (
  tabla: Readonly<Record<string, ClaveDeTexto>>,
  valor: string,
  d: DiccionarioResuelto,
): string => (Object.hasOwn(tabla, valor) ? texto(d, tabla[valor] as ClaveDeTexto) : valor);

/**
 * Un desplegable con lo que ofrece. Si lo guardado no está entre las opciones, se suma como una opción más (con su propio valor como texto) y el desplegable sale apagado:
 * lo guardado sigue a la vista y no se puede reemplazar sin querer. Sin nada guardado, «Sin elegir» (la opción vacía que agrega el selector).
 */
function desplegable(
  etiqueta: string,
  guardado: Opcion | null,
  ofrecidas: readonly Opcion[],
): DesplegableArmado {
  const fuera = guardado !== null && !ofrecidas.some((o) => o.valor === guardado.valor);
  return {
    etiqueta,
    valor: guardado?.valor ?? "",
    opciones: fuera ? [...ofrecidas, guardado] : ofrecidas,
    apagado: fuera,
  };
}

export function armarLaFicha(f: FichaDeLaPantalla, d: DiccionarioResuelto = {}): FichaArmada {
  return {
    id: f.id,
    version: f.version,
    titulo: f.nombre,
    clase: {
      etiqueta: texto(d, "catalogo.lista.que_es"),
      valor: nombrar(CLAVE_DE_CLASE, f.claseDeUso, d),
    },
    unidad: {
      etiqueta: texto(d, "catalogo.dato.unidad"),
      valor: nombrar(CLAVE_DE_TEXTO_DE_UNIDAD, f.unidadBaseId, d),
    },
    nombre: { etiqueta: texto(d, "catalogo.dato.nombre"), valor: f.nombre },
    nombreDeCocina: f.seVende
      ? { etiqueta: texto(d, "catalogo.dato.nombre_de_cocina"), valor: f.nombreDeCocina ?? "" }
      : null,
    codigo: { etiqueta: texto(d, "catalogo.dato.codigo_interno"), valor: f.codigo ?? "" },
    codigoDeBarras: {
      etiqueta: texto(d, "catalogo.dato.codigo_de_barras"),
      valor: f.codigoDeBarras ?? "",
    },
    alicuota: f.seVende
      ? desplegable(
          texto(d, "catalogo.dato.alicuota_de_iva"),
          f.alicuota === null
            ? null
            : { valor: f.alicuota, etiqueta: nombrar(CLAVE_DE_ALICUOTA, f.alicuota, d) },
          f.alicuotas.map((a) => ({ valor: a, etiqueta: nombrar(CLAVE_DE_ALICUOTA, a, d) })),
        )
      : null,
    seccion: f.seVende
      ? desplegable(
          texto(d, "catalogo.dato.seccion_de_la_carta"),
          f.seccion === null ? null : { valor: f.seccion.id, etiqueta: f.seccion.nombre },
          f.secciones.map((s) => ({ valor: s.id, etiqueta: s.nombre })),
        )
      : null,
    enlaceDeSecciones: f.seVende
      ? { href: RUTA_DE_SECCIONES, texto: texto(d, "catalogo.seccion.titulo") }
      : null,
    etiquetaDelControlDeStock: f.admiteControlDeStock
      ? texto(
          d,
          f.admiteStockPropio
            ? "produccion.elaborado.se_produce_en_tanda"
            : "catalogo.dato.se_controla_el_stock",
        )
      : null,
    confirmacionDelControlDeStock: f.admiteControlDeStock
      ? {
          titulo: texto(
            d,
            f.admiteStockPropio
              ? "produccion.elaborado.se_produce_en_tanda"
              : "catalogo.dato.se_controla_el_stock",
          ),
          activar: texto(
            d,
            f.admiteStockPropio
              ? "produccion.elaborado.aviso_al_encender"
              : "catalogo.control_de_stock.activar",
          ),
          apagar: texto(d, "catalogo.control_de_stock.apagar"),
          confirmar: texto(d, "ventas.venta.validar"),
          cancelar: texto(d, "catalogo.accion.cancelar"),
          cerrar: texto(d, "vidriera.producto.cerrar"),
        }
      : null,
    textoDeElegir: texto(d, "catalogo.dato.sin_elegir"),
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}

/**
 * La franja de la ficha de un producto de stock propio (TP-4 y TP-5, aprobados el 25/11/2026): con el control encendido, «Tiene stock propio: {existencia}»; apagado, «No tiene stock propio:
 * descuenta sus ingredientes.». Si está encendido y no se pudo leer la existencia, no hay franja (`null`): nunca un número inventado.
 */
export function armarLaFranjaDeStockPropio(
  controlado: boolean,
  existencia: Readonly<{ existencia: string; unidadId: string }> | null,
  d: DiccionarioResuelto = {},
): string | null {
  if (!controlado) return texto(d, "produccion.elaborado.no_tiene_stock_propio");
  if (existencia === null) return null;
  return texto(d, "produccion.elaborado.tiene_stock_propio", {
    existencia: cantidadConUnidad(existencia.existencia, existencia.unidadId, d),
  });
}
