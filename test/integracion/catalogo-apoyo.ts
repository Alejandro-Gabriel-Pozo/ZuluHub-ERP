import { randomUUID } from "node:crypto";
import type pg from "pg";

/**
 * Apoyo de las pruebas de integración del catálogo (E2): armar con SQL directo del dueño de la base (que evade RLS: es solo para montar
 * el escenario) los productos, grupos, opciones y precios que cada prueba necesita. Lo que se prueba pasa siempre por el rol real o por
 * los casos de uso, nunca por estos atajos.
 */

export type ClaseDeUsoDePrueba = "MATERIA_PRIMA" | "INSUMO" | "REVENTA" | "ELABORADO" | "VENDIBLE";

export const nombreAlAzarDeProducto = (prefijo = "Producto"): string =>
  `${prefijo} ${randomUUID()
    .slice(0, 8)
    .replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "x")}`;

export type DatosDeProducto = Readonly<{
  id?: string;
  nombre?: string;
  clase?: ClaseDeUsoDePrueba;
  unidadBase?: string;
  dimension?: string;
  unidadDeVenta?: string;
  paso?: string;
  alicuota?: string | null;
  faltaCompletar?: boolean;
  activo?: boolean;
  persona?: string | null;
}>;

/** Un producto con lo mínimo para su clase: los que venden llevan alícuota 21; los demás, ninguna. */
export async function productoDeBase(
  c: pg.Client,
  empresa: string,
  datos: DatosDeProducto = {},
): Promise<string> {
  const clase = datos.clase ?? "VENDIBLE";
  const vende = clase === "VENDIBLE" || clase === "REVENTA";
  const id = datos.id ?? randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto();
  const unidadBase = datos.unidadBase ?? "UNIDAD";
  await c.query(
    `insert into producto (id, empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension,
                           unidad_de_venta_id, paso_minimo, alicuota_iva, falta_completar, activo, creado_por)
     values ($1, $2, $3, $4, 'BIEN', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      empresa,
      nombre,
      nombre.normalize("NFC").toLowerCase(),
      clase,
      unidadBase,
      datos.dimension ?? "CONTEO",
      datos.unidadDeVenta ?? unidadBase,
      datos.paso ?? "1",
      datos.alicuota === undefined ? (vende ? "21" : null) : datos.alicuota,
      datos.faltaCompletar ?? false,
      datos.activo ?? true,
      datos.persona ?? null,
    ],
  );
  return id;
}

export async function grupoDeBase(
  c: pg.Client,
  empresa: string,
  producto: string,
  datos: Partial<{
    id: string;
    clase: "VARIANTE" | "INCLUIDA" | "ADICIONAL";
    nombre: string;
    esTamano: boolean;
    esObligatorio: boolean;
    admiteVarias: boolean;
    seMuestraEnCarta: boolean;
    orden: number;
    activo: boolean;
  }> = {},
): Promise<string> {
  const clase = datos.clase ?? "ADICIONAL";
  const id = datos.id ?? randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto("Grupo");
  await c.query(
    `insert into grupo_de_elecciones (id, empresa_id, producto_id, clase, es_tamano, nombre, nombre_clave, es_obligatorio,
                                      admite_varias, se_muestra_en_carta, orden, activo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      empresa,
      producto,
      clase,
      datos.esTamano ?? false,
      nombre,
      nombre.toLowerCase(),
      datos.esObligatorio ?? clase === "VARIANTE",
      datos.admiteVarias ?? false,
      datos.seMuestraEnCarta ?? clase !== "INCLUIDA",
      datos.orden ?? 0,
      datos.activo ?? true,
    ],
  );
  return id;
}

/** Una opción con su versión 1 (nombre, recargo y factor). Devuelve la opción y su versión. */
export async function opcionDeBase(
  c: pg.Client,
  empresa: string,
  producto: string,
  grupo: string,
  datos: Partial<{
    id: string;
    nombre: string;
    recargo: string;
    factor: string;
    persona: string | null;
  }> = {},
): Promise<{ opcion: string; version: string }> {
  const opcion = datos.id ?? randomUUID();
  const version = randomUUID();
  const nombre = datos.nombre ?? nombreAlAzarDeProducto("Opcion");
  await c.query(
    `insert into opcion (id, empresa_id, producto_id, grupo_id, nombre_clave, orden) values ($1, $2, $3, $4, $5, 0)`,
    [opcion, empresa, producto, grupo, nombre.toLowerCase()],
  );
  await c.query(
    `insert into version_de_opcion (id, empresa_id, opcion_id, numero, nombre, recargo, factor_de_tamano, cargada_por, creado_en)
     values ($1, $2, $3, 1, $4, $5, $6, $7, now())`,
    [
      version,
      empresa,
      opcion,
      nombre,
      datos.recargo ?? "0",
      datos.factor ?? "1",
      datos.persona ?? null,
    ],
  );
  return { opcion, version };
}

/** Una fila de precio con la forma de venta que hoy tiene el producto. `desde` en ISO. */
export async function precioDeBase(
  c: pg.Client,
  datos: Readonly<{
    empresa: string;
    producto: string;
    opcion?: string | null;
    sucursal?: string | null;
    precio: string | null;
    desde: string;
    id?: string;
    persona?: string | null;
  }>,
): Promise<string> {
  const id = datos.id ?? randomUUID();
  await c.query(
    `insert into precio_de_venta (id, empresa_id, producto_id, opcion_id, sucursal_id, precio, unidad_id, paso_minimo, vigente_desde, cargado_por)
     select $1, $2, p.id, $3, $4, $5, p.unidad_de_venta_id, p.paso_minimo, $6, $7
       from producto p where p.id = $8 and p.empresa_id = $2`,
    [
      id,
      datos.empresa,
      datos.opcion ?? null,
      datos.sucursal ?? null,
      datos.precio,
      datos.desde,
      datos.persona ?? null,
      datos.producto,
    ],
  );
  return id;
}
