import { randomUUID } from "node:crypto";
import type pg from "pg";
import { productoDeBase, type ClaseDeUsoDePrueba } from "./catalogo-apoyo";
import type { Mundo } from "./fiscal-apoyo";
import type { Intento } from "./sesiones";

/**
 * Apoyo de las pruebas de la migración 0030 (E5 stock). Los depósitos, artículos y niveles se arman con SQL del DUEÑO de la base (que evade
 * RLS: es solo para dejar listo el escenario); el libro se escribe con el rol real de la aplicación, a través de un `Ejecutor` (una sesión
 * de prueba con su savepoint por sentencia, o el dueño dentro de una transacción). Lo que se prueba pasa siempre por la base, nunca por
 * estos atajos.
 */

/** Una sentencia que devuelve su resultado sin lanzar: `SesionDePrueba.intentar` o `intentoDelDueno`. */
export type Ejecutor = (texto: string, parametros?: unknown[]) => Promise<Intento>;

const HUELLA = "a".repeat(64);
/** Un instante de la jornada del 2026-11-09 en Argentina (12:00 local), con corte 00:00. */
const AHORA = "2026-11-09T15:00:00Z";
export const claveNueva = (): string => `clave-${randomUUID()}`;

type MundoDeStock = Pick<Mundo, "empresa" | "sucursal" | "persona">;

const nombreAlAzar = (prefijo: string): string =>
  `${prefijo} ${randomUUID()
    .slice(0, 8)
    .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x")}`;

export async function sucursalDeBase(
  c: pg.Client,
  empresa: string,
  datos: Readonly<{ corte?: string }> = {},
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "insert into sucursal (empresa_id, nombre, hora_de_corte) values ($1, $2, $3) returning id",
    [empresa, nombreAlAzar("Sucursal"), datos.corte ?? "00:00"],
  );
  return rows[0]?.id as string;
}

export async function depositoDeBase(
  c: pg.Client,
  m: Pick<MundoDeStock, "empresa" | "sucursal">,
  datos: Partial<{
    id: string;
    sucursal: string;
    nombre: string;
    uso: "NORMAL" | "CUARENTENA" | "RECHAZO";
    deVenta: boolean;
    activo: boolean;
  }> = {},
): Promise<string> {
  const id = datos.id ?? randomUUID();
  const nombre = datos.nombre ?? nombreAlAzar("Deposito");
  await c.query(
    `insert into deposito (id, empresa_id, sucursal_id, nombre, nombre_clave, uso, de_venta)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      m.empresa,
      datos.sucursal ?? m.sucursal,
      nombre,
      nombre.toLowerCase(),
      datos.uso ?? "NORMAL",
      datos.deVenta ?? false,
    ],
  );
  if (datos.activo === false)
    await c.query("update deposito set activo = false where id = $1", [id]);
  return id;
}

/** Un producto controlado: el producto (materia prima por defecto) y su artículo de stock, en la unidad base del producto. */
export async function articuloDeBase(
  c: pg.Client,
  m: Pick<MundoDeStock, "empresa">,
  datos: Partial<{
    id: string;
    clase: ClaseDeUsoDePrueba;
    unidadBase: string;
    dimension: string;
    activo: boolean;
  }> = {},
): Promise<{ producto: string; articulo: string }> {
  const dimension = datos.dimension ?? "CONTEO";
  const unidad = datos.unidadBase ?? "UNIDAD";
  const producto = await productoDeBase(c, m.empresa, {
    clase: datos.clase ?? "MATERIA_PRIMA",
    unidadBase: unidad,
    dimension,
  });
  const articulo = datos.id ?? randomUUID();
  await c.query(
    `insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, $4, $5)`,
    [articulo, m.empresa, producto, unidad, dimension],
  );
  if (datos.activo === false) {
    await c.query("update articulo_de_stock set activo = false where id = $1", [articulo]);
  }
  return { producto, articulo };
}

/** El nivel de un control guardado por la empresa (o por una sucursal), como lo dejaría la configuración. */
export async function nivelDeBase(
  c: pg.Client,
  empresa: string,
  nivel: "PERMITIR" | "AVISAR" | "BLOQUEAR",
  sucursal: string | null = null,
): Promise<void> {
  await c.query(
    `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, 'stock.existencia_negativa', $3)`,
    [empresa, sucursal, nivel],
  );
}

export async function existenciaDe(
  c: pg.Client,
  deposito: string,
  articulo: string,
): Promise<string> {
  const { rows } = await c.query<{ existencia: string }>(
    "select existencia::text as existencia from saldo_de_stock where deposito_id = $1 and articulo_id = $2",
    [deposito, articulo],
  );
  return rows[0]?.existencia ?? "0";
}

// ---- el libro ----------------------------------------------------------------------------------------------------------------

type RenglonDePrueba = Readonly<{
  articulo: string;
  /** Con signo, como se guarda (la salida resta). */
  cantidad: string;
  deposito?: string;
  composicion?: string | null;
  confirmoNegativo?: boolean;
}>;

export type MovimientoDePrueba = Readonly<{
  id?: string;
  clase: string;
  motivo: string;
  deposito: string;
  renglones: readonly RenglonDePrueba[];
  detalle?: string | null;
  origen?: Readonly<{ tipo: string; id: string }> | null;
  anulaA?: string | null;
  conteo?: string | null;
  clave?: string;
  huella?: string;
  hechoEn?: string;
  /** Solo la salida por venta la manda (la del ticket). */
  fechaDeNegocio?: string | null;
  accion?: string;
  /** Con la persona del contexto de la sesión (la política de alta lo exige). */
  persona: string;
}>;

type Escrito = Readonly<{
  id: string;
  /** El primer intento que falló (la cabecera o un renglón), o el último si todos pasaron. */
  resultado: Intento;
}>;

/** Inserta la cabecera y sus renglones, en ese orden, y se detiene en la primera sentencia que la base rechaza. */
export async function escribirMovimiento(
  e: Ejecutor,
  empresa: string,
  mov: MovimientoDePrueba,
): Promise<Escrito> {
  const id = mov.id ?? randomUUID();
  let resultado = await e(
    `insert into movimiento_de_stock (id, empresa_id, clase, motivo, detalle, origen_tipo, origen_id, deposito_id, accion, anula_a,
                                      conteo_id, clave_idempotencia, huella, hecho_en, fecha_negocio, registrado_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz, $15::date, $16)`,
    [
      id,
      empresa,
      mov.clase,
      mov.motivo,
      mov.detalle ?? null,
      mov.origen?.tipo ?? "MANUAL",
      mov.origen?.id ?? null,
      mov.deposito,
      mov.accion ?? "stock.registrar_entrada",
      mov.anulaA ?? null,
      mov.conteo ?? null,
      mov.clave ?? claveNueva(),
      mov.huella ?? HUELLA,
      mov.hechoEn ?? AHORA,
      mov.fechaDeNegocio ?? null,
      mov.persona,
    ],
  );
  if (!resultado.ok) return { id, resultado };
  let numero = 0;
  for (const r of mov.renglones) {
    numero += 1;
    resultado = await e(
      `insert into renglon_de_movimiento (empresa_id, movimiento_id, numero, deposito_id, articulo_id, cantidad, composicion_id, confirmo_negativo)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        empresa,
        id,
        numero,
        r.deposito ?? mov.deposito,
        r.articulo,
        r.cantidad,
        r.composicion ?? null,
        r.confirmoNegativo ?? false,
      ],
    );
    if (!resultado.ok) return { id, resultado };
  }
  return { id, resultado };
}

export const entrada = (
  m: MundoDeStock,
  deposito: string,
  articulo: string,
  cantidad: string,
  extra: Partial<MovimientoDePrueba> = {},
): MovimientoDePrueba => ({
  clase: "ENTRADA",
  motivo: "COMPRA",
  deposito,
  persona: m.persona,
  renglones: [{ articulo, cantidad }],
  ...extra,
});

/** La cantidad se pasa en positivo: el renglón de una salida resta. */
export const salida = (
  m: MundoDeStock,
  deposito: string,
  articulo: string,
  cantidad: string,
  extra: Partial<MovimientoDePrueba> = {},
): MovimientoDePrueba => ({
  clase: "SALIDA",
  motivo: "MERMA",
  deposito,
  persona: m.persona,
  accion: "stock.registrar_salida",
  renglones: [{ articulo, cantidad: `-${cantidad}` }],
  ...extra,
});

export const transferencia = (
  m: MundoDeStock,
  origen: string,
  destino: string,
  articulo: string,
  cantidad: string,
  extra: Partial<MovimientoDePrueba> = {},
): MovimientoDePrueba => ({
  clase: "TRANSFERENCIA",
  motivo: "TRANSFERENCIA",
  deposito: origen,
  persona: m.persona,
  accion: "stock.transferir",
  renglones: [
    { articulo, cantidad: `-${cantidad}`, deposito: origen },
    { articulo, cantidad, deposito: destino },
  ],
  ...extra,
});

/** El espejo exacto de un movimiento con sus renglones: mismos depósitos y artículos con la cantidad opuesta. */
export const espejoDe = (
  m: MundoDeStock,
  original: Readonly<{ id: string; deposito: string; renglones: readonly RenglonDePrueba[] }>,
  extra: Partial<MovimientoDePrueba> = {},
): MovimientoDePrueba => ({
  clase: "ANULACION",
  motivo: "ANULACION",
  deposito: original.deposito,
  persona: m.persona,
  accion: "stock.anular",
  anulaA: original.id,
  detalle: "Se cargó por error",
  renglones: original.renglones.map((r) => ({
    ...r,
    cantidad: r.cantidad.startsWith("-") ? r.cantidad.slice(1) : `-${r.cantidad}`,
  })),
  ...extra,
});
