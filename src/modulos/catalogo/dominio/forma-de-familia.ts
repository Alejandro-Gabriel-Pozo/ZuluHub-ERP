import { precioDeVentaDesdeTexto } from "../../../primitivas/dinero/precio-de-venta";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";

/**
 * FORMA DE SALIR DE UNA FAMILIA EN LA CARTA (A8, `familias-especificacion.md` §6; maqueta aprobada `familias.html`, DDD 70): una función PURA, sin base ni reloj. La carta
 * pública y la ficha de la familia la IMPORTAN: la regla vive una sola vez. Decide solo la forma (tabla, lista, una línea o sueltos); qué miembros están vigentes en una
 * sucursal (activo, no oculto, con precio) lo informa quien llama con los mismos datos que usa la carta. Todo nace cerrado: ante lo que no se pueda leer, sale SUELTO.
 */

/** Hasta cuántas medidas distintas caben como columnas de una tabla; con más, lista (MIG §12.23.A2, `vidriera-lectura-de-productos.md` reglas 3 y 4). */
export const MAXIMO_DE_COLUMNAS_DE_TABLA = 3;

export type MedidaDeMiembro = Readonly<{
  /** El nombre de la medida («Chico»); se compara por su clave (sin mayúsculas), nunca contra una lista de nombres. */
  nombre: string;
  /** El lugar de la medida en el producto (el `orden` de su opción): define el orden de las columnas. */
  orden: number;
  /** Texto decimal exacto, o `null` si la medida no tiene precio (no se ofrece). */
  precio: string | null;
}>;

export type MiembroParaForma = Readonly<{
  productoId: string;
  seccionId: string;
  activo: boolean;
  /** Oculto en la sucursal de la carta (la regla única `ocultoPor` ya resuelta por quien llama). */
  oculto: boolean;
  /** Las medidas del producto; vacío si no tiene medidas. */
  medidas: readonly MedidaDeMiembro[];
  /** El precio del producto sin medidas (texto decimal) o `null`. Se ignora si tiene medidas. */
  precio: string | null;
}>;

export type EntradaDeForma = Readonly<{
  familiaActiva: boolean;
  agruparEnCarta: boolean;
  /** En el orden de la familia (el de alta). El resultado conserva ese orden. */
  miembros: readonly MiembroParaForma[];
}>;

export type MotivoDeSueltos =
  | "FAMILIA_APAGADA"
  | "CARTA_APAGADA"
  | "MENOS_DE_DOS"
  | "SECCIONES_DISTINTAS"
  | "PRECIOS_DISTINTOS"
  | "ALGUNO_SIN_MEDIDAS";

export type FormaDeFamilia =
  | Readonly<{ forma: "SUELTOS"; motivo: MotivoDeSueltos; productos: readonly string[] }>
  | Readonly<{ forma: "LINEA"; precio: string; productos: readonly string[] }>
  | Readonly<{
      forma: "TABLA" | "LISTA";
      /** Las medidas de todos los miembros vigentes, por orden y sin repetir (por clave). */
      medidas: readonly string[];
      productos: readonly string[];
    }>;

/** El precio en su forma canónica, o `null` si no hay o no se puede leer (nunca se adivina). */
function canonico(precio: string | null): string | null {
  if (precio === null) return null;
  const leido = precioDeVentaDesdeTexto(precio);
  return leido.ok ? precioUnitarioATexto(leido.valor) : null;
}

type Vigente = Readonly<{
  productoId: string;
  seccionId: string;
  medidas: readonly Readonly<{ nombre: string; clave: string; orden: number }>[];
  precio: string | null;
}>;

/**
 * Un miembro es vigente si está activo, no oculto y tiene precio (el del producto, o el de al menos una medida). Las medidas sin precio no se ofrecen.
 */
function vigente(m: MiembroParaForma): Vigente | null {
  if (!m.activo || m.oculto) return null;
  if (m.medidas.length === 0) {
    const precio = canonico(m.precio);
    return precio === null
      ? null
      : { productoId: m.productoId, seccionId: m.seccionId, medidas: [], precio };
  }
  const medidas = m.medidas.flatMap((medida) =>
    canonico(medida.precio) === null
      ? []
      : [{ nombre: medida.nombre, clave: claveDeNombre(medida.nombre), orden: medida.orden }],
  );
  return medidas.length === 0
    ? null
    : { productoId: m.productoId, seccionId: m.seccionId, medidas, precio: null };
}

/** Las medidas de todos, sin repetir por clave, ordenadas por el menor `orden` con que aparecen (empate: la primera que se vio). */
function columnas(miembros: readonly Vigente[]): readonly string[] {
  const porClave = new Map<string, { nombre: string; orden: number }>();
  for (const miembro of miembros) {
    for (const medida of miembro.medidas) {
      const previa = porClave.get(medida.clave);
      if (previa === undefined)
        porClave.set(medida.clave, { nombre: medida.nombre, orden: medida.orden });
      else if (medida.orden < previa.orden) previa.orden = medida.orden;
    }
  }
  // `sort` es estable: con el mismo `orden` queda primero la medida que se vio primero.
  return [...porClave.values()].sort((a, b) => a.orden - b.orden).map((m) => m.nombre);
}

export function formaDeFamilia(entrada: EntradaDeForma): FormaDeFamilia {
  const vigentes = entrada.miembros.flatMap((m) => {
    const v = vigente(m);
    return v === null ? [] : [v];
  });
  const productos = vigentes.map((v) => v.productoId);
  const sueltos = (motivo: MotivoDeSueltos): FormaDeFamilia => ({
    forma: "SUELTOS",
    motivo,
    productos,
  });

  if (!entrada.familiaActiva) return sueltos("FAMILIA_APAGADA");
  if (!entrada.agruparEnCarta) return sueltos("CARTA_APAGADA");
  if (vigentes.length < 2) return sueltos("MENOS_DE_DOS");
  const secciones = new Set(vigentes.map((v) => v.seccionId));
  if (secciones.size > 1) return sueltos("SECCIONES_DISTINTAS");

  const conMedidas = vigentes.filter((v) => v.medidas.length > 0).length;
  if (conMedidas === 0) {
    const precios = new Set(vigentes.map((v) => v.precio));
    // Stryker disable next-line OptionalChaining: con 2 o más vigentes hay un primero; el `?.` solo satisface al compilador.
    const unico = vigentes[0]?.precio ?? null;
    // Stryker disable next-line ConditionalExpression: un vigente sin medidas siempre tiene precio, así que `unico` no es nulo; la guarda solo acota el tipo.
    return precios.size === 1 && unico !== null
      ? { forma: "LINEA", precio: unico, productos }
      : sueltos("PRECIOS_DISTINTOS");
  }
  if (conMedidas !== vigentes.length) return sueltos("ALGUNO_SIN_MEDIDAS");
  const medidas = columnas(vigentes);
  return {
    forma: medidas.length > MAXIMO_DE_COLUMNAS_DE_TABLA ? "LISTA" : "TABLA",
    medidas,
    productos,
  };
}
