import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearCantidad } from "../../patrones/formato-fiscal";
import { costoRedondeado } from "../produccion/modelo-de-orden";
import { cantidadConUnidad, textoDeLaUnidad } from "../produccion/modelo-de-ordenes";

/**
 * El modelo de vista del formulario de la receta (maqueta aprobada `receta.html`, 15/11/2026, funciones `vEditar` y de confirmar): de lo que entrega la composición, lo que se arma y NADA más.
 * Puro: sin React ni servidor. Una receta nueva elige el producto; una existente lo trae fijo. Cada ingrediente es una línea con su bruto (en la unidad del ingrediente, que NO se elige) y su
 * merma; los ingredientes se eligen de una lista completa (la hoja con buscador es de otro tramo). Las cantidades son TEXTO decimal: nada pasa por `Number` (ADR-006); el costo se muestra a
 * 2 decimales con la primitiva de dinero. Los textos salen del catálogo (ya aprobados); sin «Nueva receta» fuera de su pantalla ni textos por iniciativa propia.
 */

type IngredienteOfrecido = Readonly<{
  productoId: string;
  nombre: string;
  unidadId: string;
}>;

/** Una línea de la receta que ya existe: con su nombre y su unidad, porque el ingrediente pudo dejar de ofrecerse (se desactivó) y la versión nueva lo conserva igual. */
type LineaExistente = Readonly<{
  ingredienteId: string;
  nombre: string;
  unidadId: string;
  /** Texto decimal del servidor («2.5000»). */
  bruto: string;
  /** Texto decimal del servidor («0.0000» = sin merma). */
  merma: string;
}>;

export type EntradaDelFormulario = Readonly<{
  /** Al editar, el producto de la receta; al crear, `null` (se elige). */
  producto: Readonly<{ id: string; nombre: string }> | null;
  /** Al crear, los productos activos que se pueden elaborar y no tienen receta. */
  productos: readonly Readonly<{ productoId: string; nombre: string }>[];
  /** Al crear, el producto que pide la dirección (`?producto=`); vale solo si es uno de los que se ofrecen. */
  productoElegido: string;
  ingredientes: readonly IngredienteOfrecido[];
  rinde: string;
  pasos: string | null;
  lineas: readonly LineaExistente[];
  /** La última versión que existe (0 si el producto nunca tuvo receta): la que la persona está viendo. */
  version: number;
}>;

type Opcion = Readonly<{ valor: string; etiqueta: string }>;

export type LineaDelFormulario = Readonly<{
  clave: string;
  ingredienteId: string;
  bruto: string;
  merma: string;
}>;

export type TextosDelFormulario = Readonly<{
  producto: string;
  sinElegir: string;
  rinde: string;
  ingredientes: string;
  bruto: string;
  merma: string;
  neto: string;
  pasos: string;
  agregar: string;
  quitar: string;
  guardar: string;
  guardarComoVersion: string;
  volverAEditar: string;
  cancelar: string;
  costoAntes: string;
  costoAhora: string;
  diferencia: string;
  sinCosto: string;
}>;

export type FormularioArmado = Readonly<{
  modo: "NUEVA" | "EDITAR";
  /** El título de la pantalla: «Nueva receta» o el nombre del producto. */
  titulo: string;
  /** Al crear, las opciones del selector «Producto»; al editar, `null` (no se cambia). */
  productos: readonly Opcion[] | null;
  productoInicial: string;
  /** Los ingredientes que se pueden agregar, con la unidad entre paréntesis para distinguirlos. */
  ofrecidos: readonly Opcion[];
  /** Nombre y unidad de cada ingrediente que puede haber en una línea (los ofrecidos y los de la receta que ya existe), por su id. */
  catalogo: Readonly<
    Record<string, Readonly<{ nombre: string; unidad: string; unidadId: string }>>
  >;
  rinde: string;
  pasos: string;
  lineas: readonly LineaDelFormulario[];
  /** Cuántas claves de línea ya se usaron: la próxima línea nueva es `l<siguiente>`. */
  siguienteLinea: number;
  /** El número que va a tener la versión que se guarda («Guardar como versión 3»). */
  versionNueva: number;
  textos: TextosDelFormulario;
}>;

/** «2.5000» pasa a «2.5» y «10.0000» a «10»: el texto canónico que espera el campo numérico (sin ceros de relleno). Una merma de cero es «sin merma» (vacío). */
export function sinCerosDeRelleno(valor: string): string {
  return valor.includes(".") ? valor.replace(/0+$/, "").replace(/\.$/, "") : valor;
}
const mermaParaElCampo = (merma: string): string => {
  const limpia = sinCerosDeRelleno(merma);
  return limpia === "0" ? "" : limpia;
};

const CLAVES_DE_TEXTOS = {
  producto: "catalogo.opciones.producto",
  sinElegir: "catalogo.dato.sin_elegir",
  rinde: "receta.ficha.rinde",
  ingredientes: "receta.ficha.ingredientes",
  bruto: "receta.ficha.bruto",
  merma: "receta.ficha.merma",
  neto: "receta.ficha.neto",
  pasos: "receta.ficha.pasos",
  agregar: "compras.ficha.agregar",
  quitar: "catalogo.accion.quitar",
  guardar: "catalogo.accion.guardar",
  guardarComoVersion: "receta.edicion.guardar_como_version",
  volverAEditar: "receta.edicion.volver_a_editar",
  cancelar: "catalogo.accion.cancelar",
  costoAntes: "receta.edicion.costo_antes",
  costoAhora: "receta.edicion.costo_ahora",
  diferencia: "receta.edicion.diferencia",
  sinCosto: "stock.accion.sin_costo",
} as const satisfies Readonly<Record<keyof TextosDelFormulario, ClaveDeTexto>>;

export function textosDelFormulario(
  versionNueva: number,
  d: DiccionarioResuelto = {},
): TextosDelFormulario {
  return {
    ...(Object.fromEntries(
      Object.entries(CLAVES_DE_TEXTOS).map(([nombre, clave]) => [nombre, texto(d, clave)]),
    ) as TextosDelFormulario),
    guardarComoVersion: texto(d, "receta.edicion.guardar_como_version", {
      numero: String(versionNueva),
    }),
  };
}

export function armarElFormulario(
  entrada: EntradaDelFormulario,
  d: DiccionarioResuelto = {},
): FormularioArmado {
  const catalogo: Record<string, { nombre: string; unidad: string; unidadId: string }> = {};
  for (const i of entrada.ingredientes) {
    catalogo[i.productoId] = {
      nombre: i.nombre,
      unidad: textoDeLaUnidad(i.unidadId, d),
      unidadId: i.unidadId,
    };
  }
  // La receta que ya existe manda: conserva la unidad con que se guardó cada línea.
  for (const l of entrada.lineas) {
    catalogo[l.ingredienteId] = {
      nombre: l.nombre,
      unidad: textoDeLaUnidad(l.unidadId, d),
      unidadId: l.unidadId,
    };
  }
  const nueva = entrada.producto === null;
  return {
    modo: nueva ? "NUEVA" : "EDITAR",
    titulo: nueva ? texto(d, "receta.lista.nueva_receta") : entrada.producto.nombre,
    productos: nueva
      ? entrada.productos.map((p) => ({ valor: p.productoId, etiqueta: p.nombre }))
      : null,
    productoInicial: entrada.productos.some((p) => p.productoId === entrada.productoElegido)
      ? entrada.productoElegido
      : "",
    ofrecidos: entrada.ingredientes.map((i) => ({
      valor: i.productoId,
      etiqueta: `${i.nombre} (${textoDeLaUnidad(i.unidadId, d)})`,
    })),
    catalogo,
    rinde: sinCerosDeRelleno(entrada.rinde),
    pasos: entrada.pasos ?? "",
    lineas: entrada.lineas.map((l, i) => ({
      clave: `l${String(i)}`,
      ingredienteId: l.ingredienteId,
      bruto: sinCerosDeRelleno(l.bruto),
      merma: mermaParaElCampo(l.merma),
    })),
    siguienteLinea: entrada.lineas.length,
    versionNueva: entrada.version + 1,
    textos: textosDelFormulario(entrada.version + 1, d),
  };
}

/** Las unidades que el servidor fija para guardar (el navegador no las elige): una por ingrediente que puede haber en una línea. */
export const unidadesDelFormulario = (
  formulario: FormularioArmado,
): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(formulario.catalogo).map(([id, c]) => [id, c.unidadId]));

// ---------------------------------------------------------------------------------------------------------------
// La confirmación («Guardar como versión N»): la receta final y, con `costos.ver`, el costo antes, ahora y la diferencia, todo calculado por el servidor.

/** Lo que calculó el servidor (`verLaConfirmacionDeLaReceta`); el modelo no repite ninguna cuenta. */
export type VistaDeLaConfirmacion = Readonly<{
  netos: Readonly<Record<string, string>>;
  costos?:
    | Readonly<{
        ahora: string | null;
        antes?: string | null | undefined;
        diferencia?: string | null | undefined;
      }>
    | undefined;
}>;

export type ConfirmacionArmada = Readonly<{
  rinde: Readonly<{ rotulo: string; valor: string }>;
  ingredientes: Readonly<{ rotulo: string }>;
  filas: readonly Readonly<{ clave: string; nombre: string; detalle: string }>[];
  pasos: Readonly<{ rotulo: string; texto: string }> | null;
  costos: readonly Readonly<{ rotulo: string; valor: string; fuerte: boolean }>[];
}>;

/** ¿La merma tipeada es distinta de cero? Es texto decimal: sin pasar por `Number`. En blanco o «0» es sin merma. */
const hayMerma = (merma: string): boolean => /[1-9]/.test(merma);

const costoODiferencia = (valor: string | null, sinCosto: string): string =>
  valor === null
    ? sinCosto
    : valor.startsWith("-")
      ? `-${costoRedondeado(valor.slice(1))}`
      : costoRedondeado(valor);

export function armarLaConfirmacion(
  estado: Readonly<{ rinde: string; pasos: string; lineas: readonly LineaDelFormulario[] }>,
  formulario: Pick<FormularioArmado, "catalogo" | "textos">,
  vista: VistaDeLaConfirmacion | null,
): ConfirmacionArmada {
  const { textos } = formulario;
  const costos: { rotulo: string; valor: string; fuerte: boolean }[] = [];
  if (vista?.costos !== undefined) {
    const c = vista.costos;
    if (c.antes !== undefined) {
      costos.push({
        rotulo: textos.costoAntes,
        valor: costoODiferencia(c.antes, textos.sinCosto),
        fuerte: false,
      });
    }
    costos.push({
      rotulo: textos.costoAhora,
      valor: costoODiferencia(c.ahora, textos.sinCosto),
      fuerte: true,
    });
    if (c.diferencia !== undefined) {
      costos.push({
        rotulo: textos.diferencia,
        valor: costoODiferencia(c.diferencia, textos.sinCosto),
        fuerte: false,
      });
    }
  }
  return {
    rinde: { rotulo: textos.rinde, valor: formatearCantidad(estado.rinde) },
    ingredientes: { rotulo: textos.ingredientes },
    filas: estado.lineas.map((l) => {
      const ingrediente = formulario.catalogo[l.ingredienteId];
      const unidadId = ingrediente?.unidadId ?? "";
      const partes = [`${textos.bruto} ${cantidadConUnidad(l.bruto, unidadId)}`];
      if (hayMerma(l.merma)) {
        partes.push(`${textos.merma} ${formatearCantidad(l.merma)} %`);
        const neto = vista?.netos[l.ingredienteId];
        if (neto !== undefined) partes.push(`${textos.neto} ${cantidadConUnidad(neto, unidadId)}`);
      }
      return { clave: l.clave, nombre: ingrediente?.nombre ?? "", detalle: partes.join(" · ") };
    }),
    pasos: estado.pasos.trim() === "" ? null : { rotulo: textos.pasos, texto: estado.pasos.trim() },
    costos,
  };
}
