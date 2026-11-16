import type { ErrorPublico } from "../../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { RUTA_DE_PRODUCTOS } from "./filtros-de-productos";
import { valorInicialDelCampo } from "./modelo-de-precios-de-producto";

/**
 * El modelo de vista de las opciones de un producto (A13, tramo Opciones; maqueta aprobada `productos.html`, funciones `vOpciones`, `vGrupo` y `vCopia`): de lo que entrega la
 * composición, lo que se ve y en qué orden, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`, con su fuente en `catalogo-catalogo.ts`); no se
 * arma ningún texto nuevo, solo se eligen los aprobados. Los recargos son TEXTO decimal de punta a punta (ADR-006): se formatean con funciones de cadena, nunca con `Number`.
 *
 * Qué se ve (maqueta): por cada grupo, su nombre, «Incluida» o «Adicional», «(obligatorio)» u «(opcional)» (con « · no figura en la carta» si no se muestra en la carta) y sus opciones
 * con « + $ recargo» cuando lo llevan. Los enlaces de escribir («Editar», «Agregar grupo», «Copiar de otro producto») llegan solo si la persona puede: sin ellos no se muestran
 * (nace cerrado).
 */

export const rutaDeLasOpciones = (id: string): string => `${RUTA_DE_PRODUCTOS}/${id}/opciones`;
export const rutaDeUnGrupoNuevo = (id: string): string => `${rutaDeLasOpciones(id)}/nuevo`;
export const rutaDeUnGrupo = (id: string, grupoId: string): string =>
  `${rutaDeLasOpciones(id)}/${grupoId}`;
export const rutaDelConsumo = (id: string, grupoId: string): string =>
  `${rutaDeUnGrupo(id, grupoId)}/consumo`;
export const rutaDeLaVariante = (id: string): string => `${rutaDeLasOpciones(id)}/variante`;
export const rutaDeLaCopia = (id: string): string => `${rutaDeLasOpciones(id)}/copiar`;

/** Los grupos como los entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type GrupoDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  clase: "INCLUIDA" | "ADICIONAL" | "VARIANTE";
  /** Solo de la variante: si es la medida. */
  esTamano: boolean;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  opciones: readonly Readonly<{ id: string; nombre: string; recargo: string }>[];
}>;

export type OpcionesDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupos: readonly GrupoDeLaPantalla[];
  variante: GrupoDeLaPantalla | null;
  claveDelCambio: string;
}>;

export type GrupoParaEditarDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupo: GrupoDeLaPantalla | null;
  claveDelCambio: string;
}>;

export type CopiaDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  candidatos: readonly Readonly<{ id: string; nombre: string }>[];
  claveDeLaCopia: string;
}>;

/** Un recargo es «cero» si no tiene ningún dígito distinto de 0 (`0.00`, `0.000000`): la maqueta no muestra « + $ 0,00». */
const llevaRecargo = (recargo: string): boolean => /[1-9]/.test(recargo);

const claseDe = (c: GrupoDeLaPantalla["clase"], d: DiccionarioResuelto): string =>
  texto(d, c === "ADICIONAL" ? "catalogo.opciones.adicional" : "catalogo.opciones.incluida");

/** La tarjeta de la variante: su nombre, «Es la medida» si lo es y sus opciones (sin recargo: el precio de cada medida es propio). */
const tarjetaDeLaVariante = (v: GrupoDeLaPantalla, d: DiccionarioResuelto) => ({
  id: v.id,
  nombre: v.nombre,
  esLaMedida: v.esTamano ? texto(d, "catalogo.opciones.es_la_medida") : null,
  opciones: v.opciones.map((o) => o.nombre),
});

export type OpcionesArmadas = Readonly<{
  id: string;
  titulo: string;
  /** «Variantes»: la variante del producto (una sola) con «Editar», o «Agregar variante» si no tiene. */
  variantes: Readonly<{
    titulo: string;
    tarjeta: ReturnType<typeof tarjetaDeLaVariante> | null;
    editar: Readonly<{ href: string; texto: string }> | null;
    agregar: Readonly<{ href: string; texto: string }> | null;
  }>;
  grupos: Readonly<{
    titulo: string;
    tarjetas: readonly Readonly<{
      id: string;
      nombre: string;
      clase: string;
      /** «(obligatorio)» u «(opcional)», con « · no figura en la carta» si no figura en la carta. */
      reglas: string;
      /** Cada opción con su recargo: «Queso extra + $ 500,00». */
      opciones: readonly string[];
      /** «Editar»: solo si la persona puede editar. */
      editar: Readonly<{ href: string; texto: string }> | null;
      /** «Qué consume»: solo si la persona puede editar. */
      consumo: Readonly<{ href: string; texto: string }> | null;
    }>[];
  }>;
  agregar: Readonly<{ href: string; texto: string }> | null;
  copiar: Readonly<{ href: string; texto: string }> | null;
}>;

export function armarLasOpciones(
  o: OpcionesDeLaPantalla,
  puedeEditar: boolean,
  d: DiccionarioResuelto = {},
): OpcionesArmadas {
  const enlace = (href: string, clave: Parameters<typeof texto>[1]) =>
    puedeEditar ? { href, texto: texto(d, clave) } : null;
  return {
    id: o.id,
    titulo: o.nombre,
    variantes: {
      titulo: texto(d, "catalogo.opciones.variantes"),
      tarjeta: o.variante === null ? null : tarjetaDeLaVariante(o.variante, d),
      editar: o.variante === null ? null : enlace(rutaDeLaVariante(o.id), "catalogo.accion.editar"),
      agregar:
        o.variante === null
          ? enlace(rutaDeLaVariante(o.id), "catalogo.opciones.agregar_variante")
          : null,
    },
    grupos: {
      titulo: texto(d, "catalogo.opciones.grupos"),
      tarjetas: o.grupos.map((g) => ({
        id: g.id,
        nombre: g.nombre,
        clase: claseDe(g.clase, d),
        reglas: `${texto(d, g.esObligatorio ? "catalogo.campo.obligatorio" : "catalogo.campo.opcional")}${
          g.seMuestraEnCarta ? "" : ` ${texto(d, "catalogo.lista.no_figura_en_la_carta")}`
        }`,
        opciones: g.opciones.map(
          (op) =>
            `${op.nombre}${llevaRecargo(op.recargo) ? ` + ${formatearImporte(op.recargo)}` : ""}`,
        ),
        editar: enlace(rutaDeUnGrupo(o.id, g.id), "catalogo.accion.editar"),
        consumo: enlace(rutaDelConsumo(o.id, g.id), "catalogo.consumo.que_consume"),
      })),
    },
    agregar: enlace(rutaDeUnGrupoNuevo(o.id), "catalogo.opciones.agregar_grupo"),
    copiar: enlace(rutaDeLaCopia(o.id), "catalogo.opciones.copiar_de_otro"),
  };
}

export type FilaDeOpcionArmada = Readonly<{
  /** La clave de la fila en el formulario: `e<i>` (ya existía) o `n<j>` (nueva). */
  clave: string;
  nombre: string;
  /** El recargo como texto canónico con dos decimales, o `""` si tiene más decimales que el campo (no se muestra recortado). */
  recargo: string;
}>;

export type GrupoArmado = Readonly<{
  id: string;
  titulo: string;
  /** La variante (la medida): sin recargo, sin reglas de elección y con la casilla «Es la medida». */
  esVariante: boolean;
  esTamano: Readonly<{ etiqueta: string; valor: boolean }>;
  /** Solo cuando el grupo ya existe: «Incluida» o «Adicional» (la clase no se cambia). Un grupo nuevo la elige con la casilla `adicional`. */
  claseGuardada: string | null;
  esNuevo: boolean;
  nombre: Readonly<{ etiqueta: string; valor: string }>;
  adicional: Readonly<{ etiqueta: string; valor: boolean }>;
  obligatorio: Readonly<{ etiqueta: string; valor: boolean }>;
  varias: Readonly<{ etiqueta: string; valor: boolean }>;
  /** La casilla «No figura en la carta»: marcada si el grupo NO se muestra en la carta. */
  fueraDeLaCarta: Readonly<{ etiqueta: string; valor: boolean }>;
  opciones: Readonly<{
    nombreDelCampo: string;
    recargoDelCampo: string;
    filas: readonly FilaDeOpcionArmada[];
    nuevaFila: FilaDeOpcionArmada;
    agregar: string;
    quitar: string;
  }>;
  guardar: string;
}>;

export function armarElGrupo(
  g: GrupoParaEditarDeLaPantalla,
  d: DiccionarioResuelto = {},
  esVariante = false,
): GrupoArmado {
  const guardado = g.grupo;
  const nuevo = esVariante
    ? "catalogo.opciones.agregar_variante"
    : "catalogo.opciones.agregar_grupo";
  return {
    id: g.id,
    esVariante,
    esTamano: {
      etiqueta: texto(d, "catalogo.opciones.es_la_medida"),
      valor: guardado?.esTamano ?? false,
    },
    titulo: texto(d, guardado === null ? nuevo : "catalogo.accion.editar"),
    claseGuardada: guardado === null || esVariante ? null : claseDe(guardado.clase, d),
    esNuevo: guardado === null,
    nombre: { etiqueta: texto(d, "catalogo.dato.nombre"), valor: guardado?.nombre ?? "" },
    adicional: { etiqueta: texto(d, "catalogo.opciones.adicional"), valor: false },
    obligatorio: {
      etiqueta: texto(d, "catalogo.opciones.obligatorio"),
      valor: guardado?.esObligatorio ?? false,
    },
    varias: {
      etiqueta: texto(d, "catalogo.opciones.varias"),
      valor: guardado?.admiteVarias ?? false,
    },
    fueraDeLaCarta: {
      etiqueta: texto(d, "catalogo.opciones.no_figura"),
      valor: guardado === null ? false : !guardado.seMuestraEnCarta,
    },
    opciones: {
      nombreDelCampo: texto(d, "catalogo.dato.nombre"),
      recargoDelCampo: texto(d, "catalogo.opciones.recargo"),
      // Un grupo nuevo arranca con una fila vacía para empezar a escribir.
      filas:
        guardado === null
          ? [{ clave: "n0", nombre: "", recargo: "0.00" }]
          : guardado.opciones.map((o, i) => ({
              clave: `e${String(i)}`,
              nombre: o.nombre,
              recargo: valorInicialDelCampo(o.recargo),
            })),
      nuevaFila: { clave: "n", nombre: "", recargo: "0.00" },
      agregar: texto(d, "catalogo.opciones.agregar_opcion"),
      quitar: texto(d, "catalogo.opciones.quitar"),
    },
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}

/** La variante (la medida) de un producto para editar, con los textos de la maqueta. */
export const armarLaVariante = (
  g: GrupoParaEditarDeLaPantalla,
  d: DiccionarioResuelto = {},
): GrupoArmado => armarElGrupo(g, d, true);

export type CopiaArmada = Readonly<{
  id: string;
  titulo: string;
  /** `null` si no hay de dónde copiar (la pantalla no ofrece el selector). */
  producto: Readonly<{
    etiqueta: string;
    opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
  }> | null;
  copiar: string;
}>;

export function armarLaCopia(c: CopiaDeLaPantalla, d: DiccionarioResuelto = {}): CopiaArmada {
  return {
    id: c.id,
    titulo: texto(d, "catalogo.opciones.copiar_de_otro"),
    producto:
      c.candidatos.length === 0
        ? null
        : {
            etiqueta: texto(d, "catalogo.opciones.producto"),
            opciones: c.candidatos.map((p) => ({ valor: p.id, etiqueta: p.nombre })),
          },
    copiar: texto(d, "catalogo.opciones.copiar"),
  };
}

/** El texto de un error de esta pantalla (el del servidor, ya traducido a su clave). */
export const textoDelError = (error: ErrorPublico, d: DiccionarioResuelto = {}): string =>
  texto(d, error.clave);
