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
 * con « + $ recargo» cuando lo llevan. Los botones de escribir («Editar», «Agregar grupo», «Copiar de otro producto») SIEMPRE se dibujan; sin permiso van apagados (`apagado`), no
 * ausentes (la maqueta los apaga con `dis()`). Apagar no es autorizar: el servidor decide al guardar.
 */

export const rutaDeLasOpciones = (id: string): string => `${RUTA_DE_PRODUCTOS}/${id}/opciones`;
export const rutaDeUnGrupoNuevo = (id: string): string => `${rutaDeLasOpciones(id)}/nuevo`;
export const rutaDeUnGrupo = (id: string, grupoId: string): string =>
  `${rutaDeLasOpciones(id)}/${grupoId}`;
/** La solapa con la hoja de «Copiar de otro producto» abierta; `origen` es el producto que se está mirando (sin él, el servidor toma el primero). */
export const rutaDeLaCopia = (id: string, origen: string | null = null): string =>
  `${rutaDeLasOpciones(id)}?copiar=${origen === null ? "1" : encodeURIComponent(origen)}`;

/** Los grupos como los entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type GrupoDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  clase: "INCLUIDA" | "ADICIONAL";
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
  claveDelCambio: string;
}>;

export type GrupoParaEditarDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupo: GrupoDeLaPantalla | null;
  claveDelCambio: string;
}>;

/** Lo que la hoja de copia muestra de lo que se traería: un grupo con sus opciones (el recargo, en texto decimal, o `null` si no lleva). */
type GrupoDeVistaPreviaDeLaPantalla = Readonly<{
  nombre: string;
  clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
  opciones: readonly Readonly<{ nombre: string; recargo: string | null }>[];
}>;

export type CopiaDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  candidatos: readonly Readonly<{ id: string; nombre: string }>[];
  origen: string | null;
  vistaPrevia: readonly GrupoDeVistaPreviaDeLaPantalla[];
  claveDeLaCopia: string;
}>;

/** Un recargo es «cero» si no tiene ningún dígito distinto de 0 (`0.00`, `0.000000`): la maqueta no muestra « + $ 0,00». */
const llevaRecargo = (recargo: string): boolean => /[1-9]/.test(recargo);

const claseDe = (c: GrupoDeLaPantalla["clase"], d: DiccionarioResuelto): string =>
  texto(d, c === "ADICIONAL" ? "catalogo.opciones.adicional" : "catalogo.opciones.incluida");

/** Un botón que lleva a otra pantalla; `apagado` si la persona no puede editar (se ve igual, no se puede tocar). */
export type BotonDeNavegacion = Readonly<{ href: string; texto: string; apagado: boolean }>;

export type OpcionesArmadas = Readonly<{
  id: string;
  titulo: string;
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
      editar: BotonDeNavegacion;
    }>[];
  }>;
  agregar: BotonDeNavegacion;
  copiar: BotonDeNavegacion;
}>;

export function armarLasOpciones(
  o: OpcionesDeLaPantalla,
  puedeEditar: boolean,
  d: DiccionarioResuelto = {},
): OpcionesArmadas {
  const boton = (href: string, clave: Parameters<typeof texto>[1]): BotonDeNavegacion => ({
    href,
    texto: texto(d, clave),
    apagado: !puedeEditar,
  });
  return {
    id: o.id,
    titulo: o.nombre,
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
        editar: boton(rutaDeUnGrupo(o.id, g.id), "catalogo.accion.editar"),
      })),
    },
    agregar: boton(rutaDeUnGrupoNuevo(o.id), "catalogo.opciones.agregar_grupo"),
    copiar: boton(rutaDeLaCopia(o.id), "catalogo.opciones.copiar_de_otro"),
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
  /** «Agregar grupo» o «Editar»: es el título de la pantalla (lo pone la página con `conTitulo`). */
  titulo: string;
  esNuevo: boolean;
  nombre: Readonly<{ etiqueta: string; valor: string }>;
  /** Los dos botones de opción «Incluida» / «Adicional»: un grupo nuevo nace en «Incluida»; al editar se ve con su valor y apagado (la clase no se cambia después de crear el grupo). */
  clase: Readonly<{
    valor: "INCLUIDA" | "ADICIONAL";
    opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
    apagado: boolean;
  }>;
  obligatorio: Readonly<{ etiqueta: string; valor: boolean }>;
  varias: Readonly<{ etiqueta: string; valor: boolean }>;
  /** La casilla «No figura en la carta»: marcada si el grupo NO se muestra en la carta. */
  fueraDeLaCarta: Readonly<{ etiqueta: string; valor: boolean }>;
  opciones: Readonly<{
    /** El rótulo «Nombre» de las filas: se ve solo sobre la primera; en las demás queda para el lector de pantalla. */
    nombreDelCampo: string;
    recargoDelCampo: string;
    filas: readonly FilaDeOpcionArmada[];
    nuevaFila: FilaDeOpcionArmada;
    agregar: string;
  }>;
  guardar: string;
}>;

export function armarElGrupo(
  g: GrupoParaEditarDeLaPantalla,
  d: DiccionarioResuelto = {},
): GrupoArmado {
  const guardado = g.grupo;
  return {
    id: g.id,
    titulo: texto(
      d,
      guardado === null ? "catalogo.opciones.agregar_grupo" : "catalogo.accion.editar",
    ),
    esNuevo: guardado === null,
    nombre: { etiqueta: texto(d, "catalogo.dato.nombre"), valor: guardado?.nombre ?? "" },
    clase: {
      valor: guardado?.clase ?? "INCLUIDA",
      opciones: [
        { valor: "INCLUIDA", etiqueta: texto(d, "catalogo.opciones.incluida") },
        { valor: "ADICIONAL", etiqueta: texto(d, "catalogo.opciones.adicional") },
      ],
      apagado: guardado !== null,
    },
    // Maqueta (`nuevo-grupo`): un grupo nuevo nace obligatorio.
    obligatorio: {
      etiqueta: texto(d, "catalogo.opciones.obligatorio"),
      valor: guardado?.esObligatorio ?? true,
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
      // Maqueta (`nuevo-grupo`): un grupo nuevo arranca con dos filas vacías.
      filas:
        guardado === null
          ? [
              { clave: "n0", nombre: "", recargo: "0.00" },
              { clave: "n1", nombre: "", recargo: "0.00" },
            ]
          : guardado.opciones.map((o, i) => ({
              clave: `e${String(i)}`,
              nombre: o.nombre,
              recargo: valorInicialDelCampo(o.recargo),
            })),
      nuevaFila: { clave: "n", nombre: "", recargo: "0.00" },
      agregar: texto(d, "catalogo.opciones.agregar_opcion"),
    },
    guardar: texto(d, "catalogo.accion.guardar"),
  };
}

/** Un bloque de la vista previa de la hoja de copia: su título («Variantes» o «Grupos de opciones») y una línea por grupo («Guarnición: Papas fritas · Ensalada + $ 500,00»). */
type BloqueDeVistaPrevia = Readonly<{ titulo: string; lineas: readonly string[] }>;

export type CopiaArmada = Readonly<{
  id: string;
  /** El título de la hoja y su nombre accesible. */
  titulo: string;
  /** `null` si no hay de dónde copiar: la hoja se abre con el selector vacío y «Copiar» apagado. */
  producto: Readonly<{
    etiqueta: string;
    valor: string;
    opciones: readonly Readonly<{ valor: string; etiqueta: string }>[];
  }>;
  /** Lo que se va a traer, ya en texto: primero «Variantes» (si trae) y después «Grupos de opciones». Vacío = nada para traer. */
  vistaPrevia: readonly BloqueDeVistaPrevia[];
  cancelar: string;
  copiar: string;
  /** «Copiar» sale apagado si no hay nada para traer o si la persona no puede editar. */
  copiarApagado: boolean;
  /** Adónde vuelve cerrar la hoja (la solapa, sin `copiar`). */
  hrefDeCierre: string;
  cerrar: string;
}>;

const opcionDeVistaPrevia = (op: Readonly<{ nombre: string; recargo: string | null }>): string =>
  `${op.nombre}${op.recargo === null ? "" : ` + ${formatearImporte(op.recargo)}`}`;

/** La vista previa en el formato de la maqueta (`loQueSeCopia`): `nombre: opción · opción`; en los grupos, con ` + $ recargo` cuando lo llevan. */
function bloquesDeLaVistaPrevia(
  grupos: readonly GrupoDeVistaPreviaDeLaPantalla[],
  d: DiccionarioResuelto,
): readonly BloqueDeVistaPrevia[] {
  const variantes = grupos.filter((g) => g.clase === "VARIANTE");
  const comunes = grupos.filter((g) => g.clase !== "VARIANTE");
  return [
    {
      titulo: texto(d, "catalogo.opciones.variantes"),
      lineas: variantes.map((g) => `${g.nombre}: ${g.opciones.map((o) => o.nombre).join(" · ")}`),
    },
    {
      titulo: texto(d, "catalogo.opciones.grupos"),
      lineas: comunes.map((g) => `${g.nombre}: ${g.opciones.map(opcionDeVistaPrevia).join(" · ")}`),
    },
  ].filter((b) => b.lineas.length > 0);
}

export function armarLaCopia(
  c: CopiaDeLaPantalla,
  puedeEditar: boolean,
  d: DiccionarioResuelto = {},
): CopiaArmada {
  const vistaPrevia = bloquesDeLaVistaPrevia(c.vistaPrevia, d);
  return {
    id: c.id,
    titulo: texto(d, "catalogo.opciones.copiar_de_otro"),
    producto: {
      etiqueta: texto(d, "catalogo.opciones.producto"),
      valor: c.origen ?? "",
      opciones: c.candidatos.map((p) => ({ valor: p.id, etiqueta: p.nombre })),
    },
    vistaPrevia,
    cancelar: texto(d, "catalogo.accion.cancelar"),
    copiar: texto(d, "catalogo.opciones.copiar"),
    copiarApagado: !puedeEditar || vistaPrevia.length === 0,
    hrefDeCierre: rutaDeLasOpciones(c.id),
    cerrar: texto(d, "vidriera.producto.cerrar"),
  };
}

/** El texto de un error de esta pantalla (el del servidor, ya traducido a su clave). */
export const textoDelError = (error: ErrorPublico, d: DiccionarioResuelto = {}): string =>
  texto(d, error.clave);
