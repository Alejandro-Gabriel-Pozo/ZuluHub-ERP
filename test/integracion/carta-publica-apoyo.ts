import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import type {
  AlcanceDeExistencia,
  ExistenciasDelProducto,
} from "../../src/modulos/catalogo/publico";
import { crearEmpresaActiva, type crearEntornoDePrueba } from "./entorno";
import { crearPersonaDeBase, sucursalDe } from "./fixtures-identidad";
import { productoDeBase } from "./catalogo-apoyo";

/**
 * Apoyo de las pruebas de la carta pública (0043): armar con SQL del dueño de la base (que evade RLS: solo monta el escenario) una empresa con dos sucursales
 * y un producto, y un código de carta con la forma real (22 caracteres base64url). Lo que se prueba pasa por el rol real, nunca por estos atajos.
 */

export type EmpresaDeCarta = Readonly<{
  empresa: string;
  /** La sucursal de la empresa de prueba («Casa central»). */
  s1: string;
  s2: string;
  persona: string;
  producto: string;
}>;

/** Un código con la forma del real: 16 bytes al azar en base64url (22 caracteres). */
export const codigoAlAzar = (): string => randomBytes(16).toString("base64url");

export async function empresaDeCarta(
  entorno: ReturnType<typeof crearEntornoDePrueba>,
  dueno: pg.Client,
): Promise<EmpresaDeCarta> {
  const e = await crearEmpresaActiva(entorno);
  const s1 = await sucursalDe(dueno, e.empresa);
  const { rows } = await dueno.query<{ id: string }>(
    "insert into sucursal (empresa_id, nombre) values ($1, 'Varvarco') returning id",
    [e.empresa],
  );
  const persona = await crearPersonaDeBase(dueno);
  const producto = await productoDeBase(dueno, e.empresa);
  return { empresa: e.empresa, s1, s2: rows[0]?.id as string, persona: persona.id, producto };
}

/** Una carta de la empresa montada por el dueño de la base. */
export async function cartaDeBase(
  dueno: pg.Client,
  empresa: string,
  sucursal: string,
  datos: Partial<{ id: string; codigo: string; nombre: string; estado: string }> = {},
): Promise<{ id: string; codigo: string }> {
  const id = datos.id ?? randomUUID();
  const codigo = datos.codigo ?? codigoAlAzar();
  await dueno.query(
    `insert into carta_publica (id, empresa_id, sucursal_id, codigo, nombre, estado) values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      empresa,
      sucursal,
      codigo,
      datos.nombre ?? "Parador El Ensayo",
      datos.estado ?? "EN_LINEA",
    ],
  );
  return { id, codigo };
}

/** Una fila de disponibilidad montada por el dueño (`sucursal` nula = toda la empresa). */
export async function disponibilidadDeBase(
  dueno: pg.Client,
  empresa: string,
  producto: string,
  sucursal: string | null,
  oculto: boolean,
): Promise<void> {
  await dueno.query(
    `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en)
     values ($1, $2, $3, $4, '2026-11-12T12:00:00Z')`,
    [empresa, producto, sucursal, oculto],
  );
}

/** Lee como el rol público: una transacción con `app.codigo_de_carta` fijado (o sin fijar, con `null`), como la haría la lectura de la carta (T3). */
export async function comoPublico<T extends Record<string, unknown>>(
  cadena: string,
  codigo: string | null,
  consulta: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const c = new pg.Client({ connectionString: cadena });
  await c.connect();
  try {
    await c.query("begin read only isolation level repeatable read");
    if (codigo !== null)
      await c.query("select set_config('app.codigo_de_carta', $1, true)", [codigo]);
    const { rows } = await c.query<T>(consulta, parametros);
    await c.query("commit");
    return rows;
  } finally {
    await c.end();
  }
}

/**
 * Un stock FALSO para las pruebas del catálogo (el real es T9): la prueba dice qué producto tiene existencia o un conteo abierto con cargas, y dónde. La
 * existencia de la EMPRESA es la de cualquiera de sus locales distinta de cero; la de un local, la de ese local.
 */
export type StockFalso = ExistenciasDelProducto &
  Readonly<{
    fijarExistencia: (producto: string, sucursal: string, cantidad: number) => void;
    abrirConteoConCargas: (producto: string, sucursal: string, abierto?: boolean) => void;
    limpiar: () => void;
  }>;

export function crearStockFalso(): StockFalso {
  const existencias = new Map<string, number>();
  const conteos = new Set<string>();
  const llave = (producto: string, sucursal: string) => `${producto}|${sucursal}`;
  const hay = (alcance: AlcanceDeExistencia, producto: string, en: (s: string) => boolean) =>
    [...existencias.keys(), ...conteos].some((k) => {
      const [p, s] = k.split("|") as [string, string];
      return p === producto && (alcance.tipo === "EMPRESA" || alcance.sucursalId === s) && en(k);
    });
  return {
    fijarExistencia: (producto, sucursal, cantidad) =>
      void existencias.set(llave(producto, sucursal), cantidad),
    abrirConteoConCargas: (producto, sucursal, abierto = true) => {
      if (abierto) conteos.add(llave(producto, sucursal));
      else conteos.delete(llave(producto, sucursal));
    },
    limpiar: () => {
      existencias.clear();
      conteos.clear();
    },
    conExistencia: (_tx, _contexto, producto, alcance) =>
      Promise.resolve(hay(alcance, producto, (k) => (existencias.get(k) ?? 0) !== 0)),
    conConteoAbiertoConCargas: (_tx, _contexto, producto, alcance) =>
      Promise.resolve(hay(alcance, producto, (k) => conteos.has(k))),
  };
}
