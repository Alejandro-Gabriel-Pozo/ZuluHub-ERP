import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { CLAVE_DE_TEXTO_DE_UNIDAD } from "../../../../../src/capacidades/vocabulario/unidades-de-medida";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { normalizarParaBuscar } from "../../../../../src/capacidades/experiencia/vidriera/busqueda";
import { cantidadDesdeTexto } from "../../../../../src/primitivas/cantidad/cantidad";
import { ErrorDeValor } from "../../../../../src/primitivas/cantidad/errores";
import { formatearImporte } from "../../patrones/formato-fiscal";

/**
 * El modelo de vista de la VENTA RÁPIDA del mostrador (maqueta `venta-rapida-v4.html`): de lo que entrega el servidor (`cargarVentaRapida`), lo que se ve en cada tarjeta, cómo se arma una cantidad y
 * cómo se junta una línea con otra. Puro: sin React ni servidor. Los textos salen del catálogo (`ventas.*`, cada uno con su fuente en `catalogo-ventas.ts`); acá no se arma ningún texto nuevo.
 *
 * Lo que NO hace, a propósito: **ningún importe**. El precio de una tarjeta o de una medida se muestra tal como lo trae el servidor; el importe de cada línea y el TOTAL salen siempre de la
 * cotización del servidor (`cotizarElCarrito`), nunca de una cuenta hecha acá. Las cantidades se manejan como ENTEROS de diezmilésimos (la escala de la base: 4 decimales), nunca como `number`
 * con coma: `0,1 + 0,2` no existe. Lo que acá se rechaza (cantidad no válida) es una ayuda de pantalla: el servidor vuelve a validar todo.
 */

/** La escala de la cantidad: 4 decimales (`numeric(18,4)`). Una unidad entera son 10.000 diezmilésimos. */
export const DIEZMILESIMOS_POR_UNIDAD = 10_000;
/** El máximo que acepta el servidor (`vender-y-cobrar`): 9999 unidades. */
export const MAXIMO_DE_DIEZMILESIMOS = 9999 * DIEZMILESIMOS_POR_UNIDAD;

type PrecioDeLaVenta =
  | Readonly<{ tipo: "BASE"; importe: string }>
  | Readonly<{ tipo: "SEGUN_MEDIDA" }>
  | Readonly<{ tipo: "SIN_PRECIO" }>;

type OpcionDeLaVenta = Readonly<{ id: string; nombre: string; recargo: string }>;

type GrupoDeLaVenta = Readonly<{
  id: string;
  clase: "INCLUIDA" | "ADICIONAL";
  nombre: string;
  obligatorio: boolean;
  admiteVarias: boolean;
  opciones: readonly OpcionDeLaVenta[];
}>;

/** Un producto como lo entrega `cargarVentaRapida` (la misma forma, sin importar de dónde venga). */
export type ProductoDeLaVenta = Readonly<{
  id: string;
  nombre: string;
  codigo: string | null;
  codigoDeBarras: string | null;
  seccionId: string | null;
  unidadDeVentaId: string;
  pasoMinimo: string;
  porcionesOfrecidas: readonly number[];
  precio: PrecioDeLaVenta;
  variante: Readonly<{
    grupoId: string;
    nombre: string;
    esTamano: boolean;
    opciones: readonly Readonly<{ id: string; nombre: string; precio: string }>[];
  }> | null;
  grupos: readonly GrupoDeLaVenta[];
}>;

export type SeccionDeLaVenta = Readonly<{ id: string; nombre: string }>;

// ─── Cantidad ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Un texto decimal canónico («1», «0.5», «1.2500») a diezmilésimos enteros; `null` si no es una cantidad válida. La regla de forma (solo dígitos y un punto, hasta 4 decimales, sin signo) es la de la
 * primitiva `cantidad` (una regla, un lugar); acá solo se pasa a un entero chico, sin coma flotante.
 */
export function aDiezmilesimos(texto: string): number | null {
  try {
    const unidades = cantidadDesdeTexto(texto).unidades;
    return unidades > BigInt(MAXIMO_DE_DIEZMILESIMOS) ? null : Number(unidades);
  } catch (error) {
    if (error instanceof ErrorDeValor) return null;
    throw error;
  }
}

/** Diezmilésimos a texto decimal canónico sin ceros de más: `15000` → `"1.5"`, `20000` → `"2"`. Es lo que viaja al servidor. */
export function deDiezmilesimos(valor: number): string {
  const entera = Math.floor(valor / DIEZMILESIMOS_POR_UNIDAD);
  const resto = valor % DIEZMILESIMOS_POR_UNIDAD;
  if (resto === 0) return String(entera);
  return `${entera}.${String(resto).padStart(4, "0").replace(/0+$/, "")}`;
}

export type FormaDeCantidad =
  /** Un entero: por unidad, paso 1. */
  | Readonly<{ tipo: "UNIDAD"; paso: number }>
  /** El entero más fracciones de a 1/n (n = 2, 4, 8): paso = la más fina. */
  | Readonly<{ tipo: "FRACCIONES"; paso: number; porciones: readonly number[] }>
  /** Un decimal en la unidad de venta del producto (peso, volumen…), con coma. */
  | Readonly<{ tipo: "MEDIDA"; paso: number; unidadDeVentaId: string }>;

/**
 * Cómo se carga la cantidad de un producto, según su forma de venta (decisiones 162 y 166): con porciones ofrecidas, por fracciones; con la unidad «Unidad» y paso 1, un entero; el resto
 * (peso, volumen…), un decimal en su unidad. Un paso que no se puede leer cierra: el producto no se puede agregar (`null`).
 */
export function formaDeCantidad(producto: ProductoDeLaVenta): FormaDeCantidad | null {
  const paso = aDiezmilesimos(producto.pasoMinimo);
  // Stryker disable next-line ConditionalExpression: `null <= 0` es verdadero en JavaScript: sin la comparación con `null` el resultado es el mismo (el tipo la exige).
  if (paso === null || paso <= 0) return null;
  if (producto.porcionesOfrecidas.length > 0) {
    return { tipo: "FRACCIONES", paso, porciones: producto.porcionesOfrecidas };
  }
  if (producto.unidadDeVentaId === "UNIDAD" && paso === DIEZMILESIMOS_POR_UNIDAD) {
    return { tipo: "UNIDAD", paso };
  }
  return { tipo: "MEDIDA", paso, unidadDeVentaId: producto.unidadDeVentaId };
}

/** ¿Es una cantidad que el servidor aceptaría? Mayor que cero, hasta 9999 y múltiplo exacto del paso. */
export function esCantidadValida(valor: number, paso: number): boolean {
  return (
    Number.isInteger(valor) &&
    valor > 0 &&
    valor <= MAXIMO_DE_DIEZMILESIMOS &&
    // Stryker disable next-line EqualityOperator: con paso 0 el resto es `NaN` y `NaN === 0` es falso: da lo mismo `>` que `>=`.
    paso > 0 &&
    valor % paso === 0
  );
}

/** Suma dos cantidades sin pasarse del máximo (juntar dos líneas iguales o sumar una fracción). */
export const sumarCantidades = (a: number, b: number): number =>
  Math.min(a + b, MAXIMO_DE_DIEZMILESIMOS);

const FRACCIONES: Readonly<Record<number, ClaveDeTexto>> = {
  1250: "ventas.cantidad.fraccion_1_8",
  2500: "ventas.cantidad.fraccion_1_4",
  3750: "ventas.cantidad.fraccion_3_8",
  5000: "ventas.cantidad.fraccion_1_2",
  6250: "ventas.cantidad.fraccion_5_8",
  7500: "ventas.cantidad.fraccion_3_4",
  8750: "ventas.cantidad.fraccion_7_8",
};

/** El rótulo de una fracción de entero (en diezmilésimos: `5000` es ½), o `null` si no es una de las ofrecidas (¼ ½ ¾ ⅛ ⅜ ⅝ ⅞). */
export function rotuloDeFraccion(diezmilesimos: number): string | null {
  return Object.hasOwn(FRACCIONES, diezmilesimos)
    ? texto({}, FRACCIONES[diezmilesimos] as ClaveDeTexto)
    : null;
}

/** Los botones de fracción de un producto: una por porción ofrecida (2 → ½, 4 → ¼, 8 → ⅛), de la mayor a la menor. */
export function fraccionesOfrecidas(
  porciones: readonly number[],
): readonly Readonly<{ valor: number; rotulo: string }>[] {
  return [...porciones]
    .sort((a, b) => a - b)
    .flatMap((n) => {
      const valor = DIEZMILESIMOS_POR_UNIDAD / n;
      const rotulo = rotuloDeFraccion(valor);
      return rotulo === null ? [] : [{ valor, rotulo }];
    });
}

/**
 * La cantidad como se lee: «2», «1,5» (peso), «1 ½» o «½» (fracciones). Por fracciones usa los rótulos de las fracciones; si el resto no es una fracción con rótulo, el decimal con coma (nunca se
 * inventa una fracción).
 */
export function cantidadParaLeer(valor: number, forma: FormaDeCantidad | null): string {
  const entera = Math.floor(valor / DIEZMILESIMOS_POR_UNIDAD);
  const resto = valor % DIEZMILESIMOS_POR_UNIDAD;
  if (forma?.tipo === "FRACCIONES") {
    const rotulo = rotuloDeFraccion(resto);
    if (rotulo !== null) return entera === 0 ? rotulo : `${entera} ${rotulo}`;
  }
  return deDiezmilesimos(valor).replace(".", ",");
}

/** El nombre de la unidad de venta (para peso, volumen…): el texto ya aprobado de la unidad, o `null` si el código no es una unidad conocida. */
export function nombreDeLaUnidad(codigo: string): string | null {
  const claves: Readonly<Record<string, ClaveDeTexto>> = CLAVE_DE_TEXTO_DE_UNIDAD;
  return Object.hasOwn(claves, codigo) ? texto({}, claves[codigo] as ClaveDeTexto) : null;
}

// ─── Lo que se ve de cada producto ──────────────────────────────────────────────────────────────────────

export type TextosDeLaVenta = Readonly<{
  buscar: string;
  todo: string;
  secciones: string;
  incluido: string;
  obligatorio: string;
  opcional: string;
  sinResultadosAyuda: string;
  borrarBusqueda: string;
  verCuenta: string;
  total: string;
  conOpciones: string;
  agregar: string;
  agregado: string;
  cantidad: string;
  quitar: string;
  cancelar: string;
  cantidadNoValida: string;
  cuentaVacia: string;
  cuentaVaciaAyuda: string;
  pieIva: string;
  medida: string;
  borrar: string;
  segunMedida: string;
  sinPrecio: string;
  sinElegir: string;
  noPermitido: string;
  cerrar: string;
}>;

/**
 * Los textos de la pantalla ya resueltos. Reutiliza los aprobados que ya tienen clave en otro módulo cuando son el mismo texto y la misma función: «Según medida», «Sin precio», «Sin elegir» y «Cerrar».
 */
export function textosDeLaVenta(): TextosDeLaVenta {
  return {
    buscar: texto({}, "ventas.venta.buscar"),
    todo: texto({}, "ventas.venta.todo"),
    secciones: texto({}, "catalogo.seccion.titulo"),
    incluido: texto({}, "ventas.venta.incluido"),
    obligatorio: texto({}, "catalogo.campo.obligatorio"),
    opcional: texto({}, "catalogo.campo.opcional"),
    sinResultadosAyuda: texto({}, "ventas.venta.sin_resultados_ayuda"),
    borrarBusqueda: texto({}, "ventas.venta.borrar_busqueda"),
    verCuenta: texto({}, "ventas.venta.ver_cuenta"),
    total: texto({}, "ventas.venta.total"),
    conOpciones: texto({}, "ventas.venta.con_opciones"),
    agregar: texto({}, "ventas.venta.agregar"),
    agregado: texto({}, "ventas.venta.agregado"),
    cantidad: texto({}, "ventas.venta.cantidad"),
    quitar: texto({}, "ventas.venta.quitar"),
    cancelar: texto({}, "ventas.venta.cancelar"),
    cantidadNoValida: texto({}, "ventas.venta.cantidad_no_valida"),
    cuentaVacia: texto({}, "ventas.venta.cuenta_vacia"),
    cuentaVaciaAyuda: texto({}, "ventas.venta.cuenta_vacia_ayuda"),
    pieIva: texto({}, "ventas.venta.pie_iva"),
    medida: texto({}, "ventas.venta.medida"),
    borrar: texto({}, "ventas.cantidad.borrar"),
    segunMedida: texto({}, "catalogo.precio.segun_medida"),
    sinPrecio: texto({}, "catalogo.precio.sin_precio"),
    sinElegir: texto({}, "catalogo.dato.sin_elegir"),
    noPermitido: texto({}, "ventas.error.accion_no_permitida"),
    cerrar: texto({}, "vidriera.producto.cerrar"),
  };
}

/**
 * «No encontré productos con «…»»: el texto buscado se inserta como texto. Es una función aparte de `textosDeLaVenta` a propósito: los textos viajan del servidor al navegador como datos y una función
 * no puede cruzar esa frontera (Next lo rechaza; lo atrapa el recorrido de la app real).
 */
export const textoSinResultados = (busqueda: string): string =>
  texto({}, "ventas.venta.sin_resultados", { busqueda });

/** El precio que se ve en la tarjeta: el de lista (formateado, tal cual lo trae el servidor), «Según medida» o «Sin precio». */
export function precioDeLaTarjeta(producto: ProductoDeLaVenta, textos: TextosDeLaVenta): string {
  if (producto.precio.tipo === "BASE") return formatearImporte(producto.precio.importe);
  return producto.precio.tipo === "SEGUN_MEDIDA" ? textos.segunMedida : textos.sinPrecio;
}

/**
 * ¿Se puede agregar a la cuenta? Solo con precio del catálogo (de lista o por medida) y una forma de cantidad legible. Un producto sin precio (precio abierto, decisión 179) todavía no se
 * ofrece en esta pantalla: el campo para escribir el precio no tiene texto aprobado (queda como pregunta), y lo que no se declara no se habilita.
 */
export function sePuedeAgregar(producto: ProductoDeLaVenta): boolean {
  return producto.precio.tipo !== "SIN_PRECIO" && formaDeCantidad(producto) !== null;
}

/** ¿El producto tiene medidas u opciones? Si sí, la tarjeta dice «Con opciones». */
export const tieneOpciones = (producto: ProductoDeLaVenta): boolean =>
  producto.variante !== null || producto.grupos.length > 0;

// ─── Búsqueda y secciones ───────────────────────────────────────────────────────────────────────────────

export type GrupoDeSeccion = Readonly<{
  seccion: SeccionDeLaVenta | null;
  productos: readonly ProductoDeLaVenta[];
}>;

/**
 * Los productos que se ven: los que responden a la búsqueda (cada palabra, en cualquier orden y sin importar tildes ni mayúsculas) y a la sección elegida, agrupados por sección en el orden del
 * servidor; los que no tienen sección van al final sin título. Una búsqueda vacía muestra todo. Las secciones sin productos no salen.
 */
export function productosVisibles(
  productos: readonly ProductoDeLaVenta[],
  secciones: readonly SeccionDeLaVenta[],
  busqueda: string,
  seccionId: string | null,
): readonly GrupoDeSeccion[] {
  const palabras = normalizarParaBuscar(busqueda).split(" ");
  const responde = (p: ProductoDeLaVenta) => {
    const donde = normalizarParaBuscar(`${p.nombre} ${p.codigo ?? ""} ${p.codigoDeBarras ?? ""}`);
    return palabras.every((palabra) => donde.includes(palabra));
  };
  const grupos: GrupoDeSeccion[] = secciones.map((seccion) => ({
    seccion,
    productos: productos.filter(
      (p) =>
        p.seccionId === seccion.id &&
        (seccionId === null || seccionId === seccion.id) &&
        responde(p),
    ),
  }));
  const conocidas = new Set<string | null>(secciones.map((s) => s.id));
  const sinSeccion = productos.filter(
    (p) => !conocidas.has(p.seccionId) && seccionId === null && responde(p),
  );
  return [...grupos, { seccion: null, productos: sinSeccion }].filter(
    (g) => g.productos.length > 0,
  );
}
