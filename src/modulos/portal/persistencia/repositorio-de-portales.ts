import type { Kysely, Selectable } from "kysely";
import type { PartesDeDireccion } from "../../../capacidades/activos/direccion-externa";
import { PROVEEDORES_DE_IMAGEN } from "../../../capacidades/activos/proveedores-de-imagen";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import {
  centesimasDesdeTexto,
  textoDesdeCentesimas,
  type DatosDelPortal,
  type Imagen,
  type Portal,
  type Tarjeta,
  type Zona,
} from "../dominio/portal";
import type { TablasDePortal } from "./esquema";

export type PortalDb = TablasDePortal;

export type AltaDePortal = Readonly<{
  id: string;
  /** Lo generó el puerto de azar; no cambia nunca. */
  codigo: string;
  datos: DatosDelPortal;
  creadoPor: PersonaId | null;
}>;

/**
 * El portal de la empresa (0078): UNO por empresa, con sus tarjetas (variante A) y zonas (variante B). Todo filtra por empresa y corre en la transacción de quien llama
 * (que es quien autoriza y audita). Nada se borra: lo que ya no se muestra se oculta (`visible = false`). El código, la empresa y la sucursal de una tarjeta no cambian:
 * no hay forma de pasarlos a un cambio y la base lo impone con disparadores.
 */
export interface RepositorioDePortales {
  /** El portal de la empresa con sus tarjetas y zonas, o `null` si todavía no lo creó. */
  delaEmpresa(empresa: EmpresaId): Promise<Portal | null>;
  /** Como `delaEmpresa`, tomando la fila del portal (`FOR UPDATE`): dos ediciones del mismo portal se turnan. */
  bloquearDeLaEmpresa(empresa: EmpresaId): Promise<Portal | null>;
  /** Alta idempotente por `id`: `false` si el `id` ya estaba. Si el choque es contra OTRA restricción (la empresa ya tiene portal, el código ya existe) la base la lanza tal cual. */
  insertar(empresa: EmpresaId, alta: AltaDePortal): Promise<boolean>;
  /** `false` si la versión ya no es la esperada. Sube la versión aunque no cambie ningún dato propio: es la versión de TODO el portal (datos, tarjetas y zonas). */
  actualizar(
    empresa: EmpresaId,
    id: string,
    versionEsperada: number,
    datos: DatosDelPortal,
  ): Promise<boolean>;
  insertarTarjeta(empresa: EmpresaId, portal: string, tarjeta: Tarjeta): Promise<void>;
  actualizarTarjeta(empresa: EmpresaId, portal: string, tarjeta: Tarjeta): Promise<void>;
  insertarZona(empresa: EmpresaId, portal: string, zona: Zona): Promise<void>;
  actualizarZona(empresa: EmpresaId, portal: string, zona: Zona): Promise<void>;
}

const IMAGEN_VACIA = {
  imagen_proveedor: null,
  imagen_cuenta: null,
  imagen_id_publico: null,
  imagen_version: null,
  imagen_extension: null,
} as const;

const columnasDeImagen = (i: Imagen | null) =>
  i === null
    ? IMAGEN_VACIA
    : {
        imagen_proveedor: i.proveedor,
        imagen_cuenta: i.cuenta,
        imagen_id_publico: i.idPublico,
        imagen_version: i.version,
        imagen_extension: i.extension,
      };

const columnasDeFoto = (i: Imagen | null) => ({
  foto_proveedor: i?.proveedor ?? null,
  foto_cuenta: i?.cuenta ?? null,
  foto_id_publico: i?.idPublico ?? null,
  foto_version: i?.version ?? null,
  foto_extension: i?.extension ?? null,
});

/** Lo que la base guarda y el dominio no conoce es una falla, no un dato: nunca se sirve a ciegas. */
function proveedorDe(texto: string): PartesDeDireccion["proveedor"] {
  const id = (Object.keys(PROVEEDORES_DE_IMAGEN) as (keyof typeof PROVEEDORES_DE_IMAGEN)[]).find(
    (p) => p === texto,
  );
  if (id === undefined) throw new RangeError(`proveedor de imagen inválido en la base: ${texto}`);
  return id;
}

/** Las cinco partes juntas o ninguna (lo impone el CHECK `imagen_externa_valida`). */
export function imagenDeLaFila(
  p: Readonly<{
    proveedor: string | null;
    cuenta: string | null;
    idPublico: string | null;
    version: string | null;
    extension: string | null;
  }>,
): Imagen | null {
  if (p.proveedor === null) return null;
  if (p.cuenta === null || p.idPublico === null || p.version === null || p.extension === null)
    throw new RangeError("imagen incompleta en la base");
  return {
    proveedor: proveedorDe(p.proveedor),
    cuenta: p.cuenta,
    idPublico: p.idPublico,
    version: p.version,
    extension: p.extension,
  };
}

const centesimas = (texto: string): number => {
  const c = centesimasDesdeTexto(texto);
  if (c === null) throw new RangeError(`porcentaje inválido en la base: ${texto}`);
  return c;
};

/** Las filas que lee la puerta pública no traen fechas ni versión (0078: columnas otorgadas). */
type SinAuditoria<T> = Omit<
  Selectable<T>,
  "creado_por" | "creado_en" | "actualizado_en" | "version"
>;

export const aZona = (f: SinAuditoria<PortalDb["portal_zona"]>): Zona => ({
  id: f.id,
  sucursalId: f.sucursal_id,
  x: centesimas(f.x),
  y: centesimas(f.y),
  ancho: centesimas(f.ancho),
  alto: centesimas(f.alto),
  visible: f.visible,
});

export const aTarjeta = (f: SinAuditoria<PortalDb["portal_tarjeta"]>): Tarjeta => ({
  sucursalId: f.sucursal_id,
  orden: f.orden,
  visible: f.visible,
  nombre: f.nombre,
  telefono: f.telefono,
  foto: imagenDeLaFila({
    proveedor: f.foto_proveedor,
    cuenta: f.foto_cuenta,
    idPublico: f.foto_id_publico,
    version: f.foto_version,
    extension: f.foto_extension,
  }),
});

const variante = (texto: string): DatosDelPortal["variante"] => {
  if (texto === "A" || texto === "B") return texto;
  throw new RangeError(`variante de portal inválida en la base: ${texto}`);
};

export const aDatosDelPortal = (
  f: SinAuditoria<PortalDb["portal_de_empresa"]>,
): DatosDelPortal => ({
  variante: variante(f.variante),
  lineaSuperior: f.linea_superior,
  titulo: f.titulo,
  colorEncabezado: f.color_encabezado,
  colorPagina: f.color_pagina,
  colorDetras: f.color_detras,
  logoVisible: f.logo_visible,
  imagen: imagenDeLaFila({
    proveedor: f.imagen_proveedor,
    cuenta: f.imagen_cuenta,
    idPublico: f.imagen_id_publico,
    version: f.imagen_version,
    extension: f.imagen_extension,
  }),
});

export function crearRepositorioDePortales(db: Kysely<PortalDb>): RepositorioDePortales {
  async function leer(empresa: EmpresaId, bloquear: boolean): Promise<Portal | null> {
    let consulta = db.selectFrom("portal_de_empresa").selectAll().where("empresa_id", "=", empresa);
    if (bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    if (fila === undefined) return null;
    const tarjetas = await db
      .selectFrom("portal_tarjeta")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("portal_id", "=", fila.id)
      .orderBy("orden")
      .orderBy("sucursal_id")
      .execute();
    const zonas = await db
      .selectFrom("portal_zona")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("portal_id", "=", fila.id)
      .orderBy("id")
      .execute();
    return {
      id: fila.id,
      empresaId: fila.empresa_id,
      codigo: fila.codigo,
      version: fila.version,
      datos: aDatosDelPortal(fila),
      tarjetas: tarjetas.map(aTarjeta),
      zonas: zonas.map(aZona),
    };
  }
  const columnasDelPortal = (d: DatosDelPortal) => ({
    variante: d.variante,
    linea_superior: d.lineaSuperior,
    titulo: d.titulo,
    color_encabezado: d.colorEncabezado,
    color_pagina: d.colorPagina,
    color_detras: d.colorDetras,
    logo_visible: d.logoVisible,
    ...columnasDeImagen(d.imagen),
  });
  const columnasDeLaTarjeta = (t: Tarjeta) => ({
    orden: t.orden,
    visible: t.visible,
    nombre: t.nombre,
    telefono: t.telefono,
    ...columnasDeFoto(t.foto),
  });
  const columnasDeLaZona = (z: Zona) => ({
    sucursal_id: z.sucursalId,
    x: textoDesdeCentesimas(z.x),
    y: textoDesdeCentesimas(z.y),
    ancho: textoDesdeCentesimas(z.ancho),
    alto: textoDesdeCentesimas(z.alto),
    visible: z.visible,
  });
  return {
    delaEmpresa: (empresa) => leer(empresa, false),
    bloquearDeLaEmpresa: (empresa) => leer(empresa, true),
    async insertar(empresa, alta) {
      const fila = await db
        .insertInto("portal_de_empresa")
        .values({
          id: alta.id,
          empresa_id: empresa,
          codigo: alta.codigo,
          ...columnasDelPortal(alta.datos),
          creado_por: alta.creadoPor,
        })
        // Solo el `id` repetido es «ya estaba»: cualquier otra unicidad (empresa, código) la lanza la base y la traduce el caso de uso.
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async actualizar(empresa, id, versionEsperada, datos) {
      const fila = await db
        .updateTable("portal_de_empresa")
        .set(columnasDelPortal(datos))
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },
    async insertarTarjeta(empresa, portal, t) {
      await db
        .insertInto("portal_tarjeta")
        .values({
          portal_id: portal,
          sucursal_id: t.sucursalId,
          empresa_id: empresa,
          ...columnasDeLaTarjeta(t),
        })
        .execute();
    },
    async actualizarTarjeta(empresa, portal, t) {
      await db
        .updateTable("portal_tarjeta")
        .set(columnasDeLaTarjeta(t))
        .where("empresa_id", "=", empresa)
        .where("portal_id", "=", portal)
        .where("sucursal_id", "=", t.sucursalId)
        .execute();
    },
    async insertarZona(empresa, portal, z) {
      await db
        .insertInto("portal_zona")
        .values({ id: z.id, empresa_id: empresa, portal_id: portal, ...columnasDeLaZona(z) })
        .execute();
    },
    async actualizarZona(empresa, portal, z) {
      await db
        .updateTable("portal_zona")
        .set(columnasDeLaZona(z))
        .where("empresa_id", "=", empresa)
        .where("portal_id", "=", portal)
        .where("id", "=", z.id)
        .execute();
    },
  };
}
