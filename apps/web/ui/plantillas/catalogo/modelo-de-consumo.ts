import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de lo que consume cada opción de un grupo (A13, tramo Consumo; maqueta aprobada `productos.html`, función `vConsumo`, «Qué consume»): de lo que entrega la composición, lo
 * que se ve y en qué orden, y NADA más. Puro: sin React ni servidor. Los textos salen del catálogo (`catalogo.*`); no se arma ningún texto nuevo. Las cantidades son TEXTO decimal (ADR-006).
 *
 * Qué se ve (maqueta): una tarjeta por opción con sus líneas «Insumo · Cantidad (unidad) · Escala con la medida (solo si el producto tiene medida) · Quitar» y «Agregar insumo».
 */

export { rutaDelConsumo } from "./modelo-de-opciones";

/** El consumo como lo entrega la composición (la misma forma, sin importar de dónde venga; la UI no importa los módulos). */
export type ConsumoDeLaPantalla = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupo: Readonly<{ id: string; nombre: string }>;
  tieneMedida: boolean;
  opciones: readonly Readonly<{
    id: string;
    nombre: string;
    lineas: readonly Readonly<{ insumoId: string; cantidad: string; escalaConTamano: boolean }>[];
  }>[];
  insumos: readonly Readonly<{ id: string; nombre: string; unidad: string }>[];
}>;

/** La cantidad guardada (`1.5000`) como la muestra el campo: sin ceros de más (`1.5`, `2`). */
export function cantidadParaElCampo(cantidad: string): string {
  if (!/^[0-9]+(?:\.[0-9]*)?$/.test(cantidad)) return "";
  return cantidad.includes(".") ? cantidad.replace(/0+$/, "").replace(/\.$/, "") : cantidad;
}

export type LineaArmada = Readonly<{
  /** La clave de la línea en el formulario (`l<n>`): única dentro de la opción. */
  clave: string;
  insumoId: string;
  cantidad: string;
  escala: boolean;
}>;

export type ConsumoArmado = Readonly<{
  id: string;
  titulo: string;
  tieneMedida: boolean;
  insumos: readonly Readonly<{ valor: string; etiqueta: string }>[];
  /** El símbolo de la unidad de cada insumo, por id: «Cantidad (g)». */
  unidades: Readonly<Record<string, string>>;
  opciones: readonly Readonly<{ indice: number; nombre: string; filas: readonly LineaArmada[] }>[];
  /** Cuántas claves de línea ya se usaron en todo el formulario: la próxima línea nueva es `l<siguiente>`. */
  siguienteLinea: number;
  textos: Readonly<{
    insumo: string;
    cantidad: string;
    escala: string;
    agregar: string;
    quitar: string;
    guardar: string;
  }>;
}>;

export function armarElConsumo(c: ConsumoDeLaPantalla, d: DiccionarioResuelto = {}): ConsumoArmado {
  // Un insumo que una línea ya consume y no figura entre los que se ofrecen se sigue viendo (con su identificador): guardar no lo pierde en silencio.
  const conocidos = new Set(c.insumos.map((i) => i.id));
  const faltantes = [
    ...new Set(
      c.opciones.flatMap((o) => o.lineas.map((l) => l.insumoId)).filter((id) => !conocidos.has(id)),
    ),
  ];
  let linea = 0;
  return {
    id: c.id,
    titulo: `${texto(d, "catalogo.consumo.que_consume")} · ${c.grupo.nombre}`,
    tieneMedida: c.tieneMedida,
    insumos: [
      ...c.insumos.map((i) => ({ valor: i.id, etiqueta: i.nombre })),
      ...faltantes.map((id) => ({ valor: id, etiqueta: id })),
    ],
    unidades: Object.fromEntries(c.insumos.map((i) => [i.id, i.unidad])),
    opciones: c.opciones.map((o, indice) => ({
      indice,
      nombre: o.nombre,
      filas: o.lineas.map((l) => ({
        clave: `l${String(linea++)}`,
        insumoId: l.insumoId,
        cantidad: cantidadParaElCampo(l.cantidad),
        escala: l.escalaConTamano,
      })),
    })),
    siguienteLinea: linea,
    textos: {
      insumo: texto(d, "catalogo.consumo.insumo"),
      cantidad: texto(d, "catalogo.consumo.cantidad"),
      escala: texto(d, "catalogo.consumo.escala"),
      agregar: texto(d, "catalogo.consumo.agregar_insumo"),
      quitar: texto(d, "catalogo.opciones.quitar"),
      guardar: texto(d, "catalogo.accion.guardar"),
    },
  };
}
