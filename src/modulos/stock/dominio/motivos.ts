import {
  ORIGEN_EJEMPLAR_DE_TICKET,
  ORIGEN_TRANSFORMACION,
  type ClaseDeMovimiento,
} from "./movimiento";

/**
 * Los motivos de movimiento sembrados (E5 §3.1, tabla `motivo_de_movimiento`: global, solo inserción). La CLASE es cerrada y el MOTIVO
 * es abierto: lo que sume E9 es un `INSERT` más en su migración y una línea acá. Es la copia en código de la tabla; una prueba de
 * integración las compara. Los motivos y sus textos son los de `stock.html` (D125, aprobados el 09/11/2026).
 *
 * Las dos banderas, con el significado y los valores del diseño de datos (`catalogo-y-stock-diseno-de-datos.md`, DDL de
 * `motivo_de_movimiento`, que la spec §3.1 nombra sin detallar): `entraConCosto` = quien registra la entrada declara su costo (o que no
 * lo tiene: «sin costo»); solo compra y carga inicial. `entregaMercaderia` = la salida entrega mercadería a un uso (venta, consumo
 * interno); descartarla (merma, rotura, vencimiento) no. Ambas tienen el mismo CHECK que la base: costo solo en entradas, entrega solo
 * en salidas.
 */
export type MotivoSembrado = Readonly<{
  clase: ClaseDeMovimiento;
  codigo: string;
  entraConCosto: boolean;
  entregaMercaderia: boolean;
}>;

const motivo = (
  clase: ClaseDeMovimiento,
  codigo: string,
  banderas: Partial<Pick<MotivoSembrado, "entraConCosto" | "entregaMercaderia">> = {},
): MotivoSembrado => ({
  clase,
  codigo,
  entraConCosto: banderas.entraConCosto ?? false,
  entregaMercaderia: banderas.entregaMercaderia ?? false,
});

export const MOTIVOS_DE_MOVIMIENTO: readonly MotivoSembrado[] = [
  motivo("ENTRADA", "COMPRA", { entraConCosto: true }),
  motivo("ENTRADA", "CARGA_INICIAL", { entraConCosto: true }),
  motivo("ENTRADA", "DEVOLUCION_DE_CLIENTE"),
  motivo("ENTRADA", "OTRA_ENTRADA"),
  motivo("SALIDA", "VENTA", { entregaMercaderia: true }),
  motivo("SALIDA", "CONSUMO_INTERNO", { entregaMercaderia: true }),
  motivo("SALIDA", "MERMA"),
  motivo("SALIDA", "ROTURA"),
  motivo("SALIDA", "VENCIMIENTO"),
  motivo("SALIDA", "OTRA_SALIDA"),
  motivo("TRANSFERENCIA", "TRANSFERENCIA"),
  motivo("AJUSTE", "CORRECCION"),
  motivo("AJUSTE_POR_CONTEO", "CONTEO"),
  motivo("ANULACION", "ANULACION"),
  // E6 (0032): la producción en lote. Solo los escribe la orden de producción (origen `TRANSFORMACION`), nunca una persona.
  motivo("ENTRADA", "PRODUCTO_DE_TRANSFORMACION", { entraConCosto: true }),
  motivo("SALIDA", "CONSUMO_DE_TRANSFORMACION", { entregaMercaderia: true }),
];

export const MOTIVO_DE_VENTA = "VENTA";
export const MOTIVO_PRODUCTO_DE_TRANSFORMACION = "PRODUCTO_DE_TRANSFORMACION";
export const MOTIVO_CONSUMO_DE_TRANSFORMACION = "CONSUMO_DE_TRANSFORMACION";

const esMotivoDeTransformacion = (codigo: string): boolean =>
  codigo === MOTIVO_PRODUCTO_DE_TRANSFORMACION || codigo === MOTIVO_CONSUMO_DE_TRANSFORMACION;
export const MOTIVO_DE_VENCIMIENTO = "VENCIMIENTO";

export const buscarMotivo = (clase: string, codigo: string): MotivoSembrado | null =>
  MOTIVOS_DE_MOVIMIENTO.find((m) => m.clase === clase && m.codigo === codigo) ?? null;

/**
 * ¿Lo puede elegir una persona en `registrarEntrada` o `registrarSalida`? Solo entradas y salidas sembradas, y `VENTA` no: la salida
 * por venta entra únicamente por el puerto de ventas (E5 §3.2). Lista de permitidos: lo que no está sembrado no pasa.
 */
export function motivoManualPermitido(clase: ClaseDeMovimiento, codigo: string): boolean {
  if (clase !== "ENTRADA" && clase !== "SALIDA") return false;
  return (
    buscarMotivo(clase, codigo) !== null &&
    codigo !== MOTIVO_DE_VENTA &&
    !esMotivoDeTransformacion(codigo)
  );
}

/** S-7: dar de baja por vencimiento exige además `stock.ajustar` (D118 lo reserva a administración). */
export const motivoExigeAjustar = (codigo: string): boolean => codigo === MOTIVO_DE_VENCIMIENTO;

/**
 * La regla `motivo = 'VENTA'` ⇔ salida con origen `EJEMPLAR_DE_TICKET` (CHECK del libro, E5 §3.1): ni una venta sin ejemplar ni una
 * salida de un ejemplar con otro motivo. Una anulación puede llevar el origen del ejemplar que revierte: no es una salida. Previene una
 * salida por venta que el único de origen no sostiene.
 */
export const origenCoherenteConElMotivo = (
  clase: ClaseDeMovimiento,
  codigo: string,
  origenTipo: string,
): boolean =>
  (codigo === MOTIVO_DE_VENTA) ===
    (clase === "SALIDA" && origenTipo === ORIGEN_EJEMPLAR_DE_TICKET) &&
  // E6: los motivos de la producción van con el origen de la orden, y ese origen solo con ellos (una anulación puede llevarlo).
  esMotivoDeTransformacion(codigo) ===
    ((clase === "ENTRADA" || clase === "SALIDA") && origenTipo === ORIGEN_TRANSFORMACION);
