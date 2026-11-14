import { filaConPrecio } from "./fila-con-precio";
import { ErrorDeValor } from "../../../primitivas/cantidad/errores";
import { cantidadATexto, type Cantidad } from "../../../primitivas/cantidad/cantidad";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { precioDeVentaDesdeTexto, sumarPrecios } from "../../../primitivas/dinero/precio-de-venta";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { convertirCantidad } from "../../../primitivas/unidades/convertir-cantidad";
import { esMultiploDelPaso, esUnidad, leerCantidad } from "./forma-de-venta";
import type { ClaseDeUso } from "./clases";
import type { FilaDePrecio, Grupo, Opcion, Producto } from "./modelo";
import type { OpcionId, PrecioDeVentaId, ProductoId, VersionDeOpcionId } from "./identificadores";

/**
 * `cotizarParaVender` (E2 mínimo §3.6): la parte PURA. El caso de uso lee lo que hace falta (producto, grupos, opciones vigentes y las
 * filas de `precio_vigente`) y esto decide: valida la cantidad y la elección y hace LA cuenta del precio —`precioUnitario = precioBase +
 * Σ recargos`, exacta, sin `number` ni redondeo—, la misma que usará la carta pública: nunca habrá dos cuentas (el error de Motor2).
 */
export type ErrorDeCotizacion =
  | "PRODUCTO_NO_ENCONTRADO"
  | "PRODUCTO_INACTIVO"
  | "PRODUCTO_NO_VENDIBLE"
  /** Carta real T8: el producto está oculto en esa sucursal (por la empresa o por el local): no se carga una línea NUEVA; las ya cargadas se cobran con su precio. */
  | "PRODUCTO_OCULTO"
  | "PRODUCTO_SIN_ALICUOTA"
  | "CLASIFICACION_INCONSISTENTE"
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "CANTIDAD_INVALIDA"
  | "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO"
  | "CONVERSION_NO_EXACTA"
  | "OPCION_REPETIDA"
  | "VARIANTE_SIN_PRECIO"
  | "PRECIO_EN_OTRA_FORMA_DE_VENTA"
  | "PRECIO_FUERA_DE_RANGO"
  | Readonly<{ error: "OPCION_INVALIDA"; opcionId: string }>
  | Readonly<{ error: "OPCIONES_INCOMPLETAS"; grupoId: string }>
  | Readonly<{ error: "OPCIONES_DE_MAS"; grupoId: string }>;

/** El producto está para venderse: activo, de clase que vende y con alícuota (una alta rápida «Falta completar» no se vende). */
export function comprobarQueSeVende(producto: Producto): Resultado<null, ErrorDeCotizacion> {
  if (!producto.activo) return err("PRODUCTO_INACTIVO");
  if (producto.claseDeUso !== "VENDIBLE" && producto.claseDeUso !== "REVENTA") {
    return err("PRODUCTO_NO_VENDIBLE");
  }
  if (producto.alicuota === null || producto.faltaCompletar) return err("PRODUCTO_SIN_ALICUOTA");
  return ok(null);
}

/** Cantidad de texto decimal exacto > 0, múltiplo del paso del producto, que convierte exacta a su unidad base. */
export function comprobarCantidad(
  producto: Producto,
  texto: string,
): Resultado<Cantidad, ErrorDeCotizacion> {
  const cantidad = leerCantidad(texto);
  const paso = leerCantidad(producto.pasoMinimo);
  if (cantidad === null || cantidad.unidades <= 0n || paso === null)
    return err("CANTIDAD_INVALIDA");
  if (!esMultiploDelPaso(cantidad, paso)) return err("CANTIDAD_NO_ES_MULTIPLO_DEL_PASO");
  if (!esUnidad(producto.unidadDeVentaId) || !esUnidad(producto.unidadBaseId)) {
    return err("CONVERSION_NO_EXACTA");
  }
  const enBase = convertirCantidad(cantidad, producto.unidadDeVentaId, producto.unidadBaseId);
  return enBase.ok ? ok(cantidad) : err("CONVERSION_NO_EXACTA");
}

export type GrupoConOpciones = Readonly<{ grupo: Grupo; opciones: readonly Opcion[] }>;
export type Elegida = Readonly<{ grupo: Grupo; opcion: Opcion }>;

/**
 * Cada opción pedida es activa y de un grupo activo de ESTE producto (82: las de un grupo que no se muestra en la carta se aceptan);
 * sin repetir; por grupo al menos una si es obligatorio y no más de una si no admite varias. Con variante activa, exactamente una de ella.
 */
export function elegirOpciones(
  grupos: readonly GrupoConOpciones[],
  opcionIds: readonly string[],
): Resultado<readonly Elegida[], ErrorDeCotizacion> {
  if (new Set(opcionIds).size !== opcionIds.length) return err("OPCION_REPETIDA");
  const elegidas: Elegida[] = [];
  for (const id of opcionIds) {
    let hallada: Elegida | null = null;
    for (const { grupo, opciones } of grupos) {
      const opcion = opciones.find((o) => o.id === id);
      if (opcion !== undefined && grupo.activo && opcion.activa) hallada = { grupo, opcion };
    }
    if (hallada === null) return err({ error: "OPCION_INVALIDA", opcionId: id });
    elegidas.push(hallada);
  }
  for (const { grupo } of grupos) {
    if (!grupo.activo) continue;
    const cuantas = elegidas.filter((e) => e.grupo.id === grupo.id).length;
    if (grupo.esObligatorio && cuantas === 0) {
      return err({ error: "OPCIONES_INCOMPLETAS", grupoId: grupo.id });
    }
    if (!grupo.admiteVarias && cuantas > 1)
      return err({ error: "OPCIONES_DE_MAS", grupoId: grupo.id });
  }
  return ok(elegidas);
}

export type OrigenDelPrecio = "SUCURSAL" | "EMPRESA" | "ABIERTO";
export type OrigenDelRecargo = "SUCURSAL" | "EMPRESA";

export type VarianteCotizada = Readonly<{
  opcionId: OpcionId;
  versionDeOpcionId: VersionDeOpcionId;
  grupoId: string;
  nombreDeGrupo: string;
  nombre: string;
  esTamano: boolean;
  factorDeTamano: string;
}>;

export type OpcionCotizada = Readonly<{
  opcionId: OpcionId;
  versionDeOpcionId: VersionDeOpcionId;
  grupoId: string;
  nombreDeGrupo: string;
  clase: "INCLUIDA" | "ADICIONAL";
  nombre: string;
  recargo: string;
  origenDelRecargo: OrigenDelRecargo;
  seMuestraEnCarta: boolean;
}>;

/**
 * El camino de clasificación comercial de un producto, del departamento hasta su nodo, con el nombre de cada uno AL VENDER (A2b, decisión 60): lo que el renglón de venta
 * copia para que renombrar, mover o reclasificar después no cambie lo vendido. `null` = el producto estaba «Sin elegir».
 */
export type ClasificacionDelRenglon = Readonly<{
  departamentoId: string;
  camino: readonly Readonly<{ id: string; nombre: string }>[];
}>;

/** Lo que cotizar devuelve (§3.6): todo dinero como texto decimal exacto; lo que ventas congela en la línea sale de acá. */
export type InstantaneaDeProducto = Readonly<{
  productoId: ProductoId;
  sucursalId: SucursalId;
  descripcion: string;
  nombreDeCocina: string | null;
  claseDeUso: ClaseDeUso;
  unidadBaseId: string;
  unidadDeVentaId: string;
  pasoMinimo: string;
  cantidad: string;
  alicuota: string;
  origenDelPrecio: OrigenDelPrecio;
  precioId: PrecioDeVentaId | null;
  moneda: "ARS";
  precioBase: string | null;
  variante: VarianteCotizada | null;
  opciones: readonly OpcionCotizada[];
  precioUnitario: string | null;
  emisorExclusivoId: null;
}>;

/**
 * Arma la instantánea. `precioBase` es lo que devolvió `precio_vigente` para el producto (sin variante) o para la opción de la variante
 * (con variante); `recargosDeSucursal`, por opción elegida, lo que devolvió para esa sucursal (solo cuenta si es de la sucursal y no nulo).
 * Un producto en precio abierto se vende: `precioBase` y `precioUnitario` nulos, y los recargos se devuelven igual (Q7).
 */
export function armarInstantanea(
  datos: Readonly<{
    producto: Producto;
    sucursalId: SucursalId;
    cantidad: Cantidad;
    elegidas: readonly Elegida[];
    precioBase: FilaDePrecio | null;
    recargosDeSucursal: ReadonlyMap<string, FilaDePrecio | null>;
  }>,
): Resultado<InstantaneaDeProducto, ErrorDeCotizacion> {
  const { producto, elegidas, precioBase } = datos;
  if (producto.alicuota === null) return err("PRODUCTO_SIN_ALICUOTA");
  const eleccionDeVariante = elegidas.find((e) => e.grupo.clase === "VARIANTE") ?? null;
  if (eleccionDeVariante !== null && precioBase === null) return err("VARIANTE_SIN_PRECIO");
  if (
    precioBase !== null &&
    (precioBase.unidadId !== producto.unidadDeVentaId ||
      precioBase.pasoMinimo !== producto.pasoMinimo)
  ) {
    return err("PRECIO_EN_OTRA_FORMA_DE_VENTA");
  }
  let origen: OrigenDelPrecio = "ABIERTO";
  if (filaConPrecio(precioBase)) origen = precioBase.sucursalId === null ? "EMPRESA" : "SUCURSAL";

  const opciones: OpcionCotizada[] = [];
  const recargos: ReturnType<typeof precioDeVentaDesdeTexto>[] = [];
  for (const { grupo, opcion } of elegidas) {
    if (grupo.clase === "VARIANTE") continue;
    const propia = datos.recargosDeSucursal.get(opcion.id) ?? null;
    const dePropia = filaConPrecio(propia) && propia.sucursalId !== null;
    const texto = dePropia ? propia.precio : opcion.recargo;
    const recargo = precioDeVentaDesdeTexto(texto);
    recargos.push(recargo);
    opciones.push({
      opcionId: opcion.id,
      versionDeOpcionId: opcion.versionId,
      grupoId: grupo.id,
      nombreDeGrupo: grupo.nombre,
      clase: grupo.clase === "INCLUIDA" ? "INCLUIDA" : "ADICIONAL",
      nombre: opcion.nombre,
      recargo: recargo.ok ? precioUnitarioATexto(recargo.valor) : texto,
      origenDelRecargo: dePropia ? "SUCURSAL" : "EMPRESA",
      seMuestraEnCarta: grupo.seMuestraEnCarta,
    });
  }
  let precioBaseTexto: string | null = null;
  let precioUnitario: string | null = null;
  if (origen !== "ABIERTO" && filaConPrecio(precioBase)) {
    const base = precioDeVentaDesdeTexto(precioBase.precio);
    if (!base.ok) return err("PRECIO_FUERA_DE_RANGO");
    const lista = [];
    for (const r of recargos) {
      if (!r.ok) return err("PRECIO_FUERA_DE_RANGO");
      lista.push(r.valor);
    }
    try {
      precioUnitario = precioUnitarioATexto(sumarPrecios(base.valor, lista));
    } catch (error) {
      if (error instanceof ErrorDeValor) return err("PRECIO_FUERA_DE_RANGO");
      throw error;
    }
    precioBaseTexto = precioUnitarioATexto(base.valor);
  }
  return ok({
    productoId: producto.id,
    sucursalId: datos.sucursalId,
    descripcion: producto.nombre,
    nombreDeCocina: producto.nombreDeCocina,
    claseDeUso: producto.claseDeUso,
    unidadBaseId: producto.unidadBaseId,
    unidadDeVentaId: producto.unidadDeVentaId,
    pasoMinimo: producto.pasoMinimo,
    cantidad: cantidadATexto(datos.cantidad),
    alicuota: producto.alicuota,
    origenDelPrecio: origen,
    precioId: precioBase === null ? null : precioBase.id,
    moneda: "ARS",
    precioBase: precioBaseTexto,
    variante:
      eleccionDeVariante === null
        ? null
        : {
            opcionId: eleccionDeVariante.opcion.id,
            versionDeOpcionId: eleccionDeVariante.opcion.versionId,
            grupoId: eleccionDeVariante.grupo.id,
            nombreDeGrupo: eleccionDeVariante.grupo.nombre,
            nombre: eleccionDeVariante.opcion.nombre,
            esTamano: eleccionDeVariante.grupo.esTamano,
            factorDeTamano: eleccionDeVariante.opcion.factorDeTamano,
          },
    opciones,
    precioUnitario,
    emisorExclusivoId: null,
  });
}

/**
 * ¿El producto tiene precio para mostrarse en la carta pública? (decisión 175: sin precio, no se muestra; en el mostrador sí se vende).
 * Recibe lo que resolvió `precio_vigente` —la misma lectura que cotizar— para el producto (una sola fila) o para cada tamaño: con
 * variante, el producto se muestra si al menos un tamaño resuelve a un precio. Así carta y caja no pueden discrepar.
 */
export function tienePrecioParaLaCarta(resueltas: readonly (FilaDePrecio | null)[]): boolean {
  return resueltas.some(filaConPrecio);
}
