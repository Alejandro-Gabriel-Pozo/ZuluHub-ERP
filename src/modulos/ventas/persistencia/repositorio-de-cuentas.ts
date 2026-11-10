import { sql, type Kysely } from "kysely";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { insertarIdempotente } from "../../catalogo/publico";
import type { Ancla } from "../dominio/ancla";
import type { EstadoDeCuenta, EstadoDeLinea } from "../dominio/estados";
import { cuentaId, esUuid, lineaId, type CuentaId, type LineaId } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";

/** Una cuenta tal como está guardada. Los importes y la cantidad son TEXTO decimal exacto (ADR-006). */
export type Cuenta = Readonly<{
  id: CuentaId;
  sucursalId: SucursalId;
  ancla: Ancla | null;
  etiqueta: string | null;
  estado: EstadoDeCuenta;
  totalProvisorio: string;
  ultimaPosicion: number;
  abiertaPor: PersonaId;
  abiertaEn: Date;
  resueltaPor: PersonaId | null;
  resueltaEn: Date | null;
  motivo: string | null;
  version: number;
}>;

export type OpcionDeLinea = Readonly<{
  orden: number;
  opcionId: string;
  versionDeOpcionId: string;
  grupoId: string;
  nombreDeGrupo: string;
  nombre: string;
  clase: "INCLUIDA" | "ADICIONAL";
  recargo: string;
  origenDelRecargo: "SUCURSAL" | "EMPRESA";
}>;

export type Linea = Readonly<{
  id: LineaId;
  cuentaId: CuentaId;
  posicion: number;
  productoId: string;
  descripcion: string;
  varianteOpcionId: string | null;
  varianteNombre: string | null;
  precioId: string;
  origenDelPrecio: "SUCURSAL" | "EMPRESA";
  precioBase: string;
  precioUnitario: string;
  cantidad: string;
  unidadDeVenta: string;
  pasoDeCantidad: string;
  alicuota: string;
  controlaStock: boolean;
  estado: EstadoDeLinea;
  anuladaPor: PersonaId | null;
  anuladaEn: Date | null;
  motivoDeAnulacion: string | null;
  creadaPor: PersonaId;
  creadaEn: Date;
  opciones: readonly OpcionDeLinea[];
}>;

export type AltaDeCuenta = Readonly<{
  id: CuentaId;
  sucursalId: SucursalId;
  ancla: Ancla | null;
  etiqueta: string | null;
  abiertaPor: PersonaId;
  abiertaEn: Date;
}>;

export type AltaDeLinea = Readonly<{
  id: LineaId;
  cuentaId: CuentaId;
  posicion: number;
  productoId: string;
  descripcion: string;
  varianteOpcionId: string | null;
  varianteNombre: string | null;
  precioId: string;
  origenDelPrecio: "SUCURSAL" | "EMPRESA";
  precioBase: string;
  precioUnitario: string;
  cantidad: string;
  unidadDeVenta: string;
  pasoDeCantidad: string;
  alicuota: string;
  controlaStock: boolean;
  creadaPor: PersonaId;
  creadaEn: Date;
  opciones: readonly OpcionDeLinea[];
}>;

/**
 * Persistencia de la cuenta y sus líneas (E4 §3.3 y §3.4). Todo corre dentro de la transacción del caso de uso, filtra SIEMPRE por la
 * empresa (y la RLS lo repite) y no usa caché. Un id que no es un uuid no puede ser el de nada: devuelve «no existe» sin tocar la base.
 */
export interface RepositorioDeCuentas {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING` (sin objetivo: cubre también la única del ancla) y, si no insertó, `true` si la cuenta con ese id ya
   * existía (repetición) o la única que chocó era otra (propaga el error de unicidad tal cual, para que el caso de uso la traduzca).
   */
  insertar(empresa: EmpresaId, alta: AltaDeCuenta): Promise<boolean>;
  obtener(empresa: EmpresaId, id: CuentaId): Promise<Cuenta | null>;
  /** La cuenta ABIERTA de un ancla, si hay. */
  abiertaPorAncla(empresa: EmpresaId, ancla: Ancla): Promise<Cuenta | null>;
  /**
   * Reserva la próxima posición: `UPDATE ... SET ultima_posicion = ultima_posicion + 1 WHERE estado = 'ABIERTA'`. Es el árbitro de
   * agregar contra cerrar y contra otro agregar: devuelve la posición, o `null` si la cuenta ya no está abierta (o no existe).
   */
  reservarPosicion(empresa: EmpresaId, id: CuentaId): Promise<number | null>;
  /** Fija el total provisorio (texto decimal con 2 decimales) de una cuenta abierta. */
  fijarTotal(empresa: EmpresaId, id: CuentaId, total: string): Promise<boolean>;
  /** `ABIERTA → CERRADA`; `false` si ya no estaba abierta (0 filas). */
  cerrar(empresa: EmpresaId, id: CuentaId, persona: PersonaId, ahora: Date): Promise<boolean>;
  /** `ABIERTA → ANULADA` con su motivo; `false` si ya no estaba abierta. */
  anular(
    empresa: EmpresaId,
    id: CuentaId,
    persona: PersonaId,
    ahora: Date,
    motivo: string,
  ): Promise<boolean>;

  insertarLinea(empresa: EmpresaId, alta: AltaDeLinea): Promise<boolean>;
  obtenerLinea(empresa: EmpresaId, id: LineaId): Promise<Linea | null>;
  /** Las líneas de la cuenta (vigentes y anuladas), por posición, con la foto de sus opciones. */
  lineasDeCuenta(empresa: EmpresaId, id: CuentaId): Promise<Linea[]>;
  /** `VIGENTE → ANULADA` con su motivo; `false` si ya estaba anulada (0 filas). */
  anularLinea(
    empresa: EmpresaId,
    id: LineaId,
    persona: PersonaId,
    ahora: Date,
    motivo: string,
  ): Promise<boolean>;
}

type FilaDeCuenta = Readonly<{
  id: string;
  sucursal_id: string;
  ancla_tipo: string | null;
  ancla_id: string | null;
  etiqueta: string | null;
  estado: EstadoDeCuenta;
  total_provisorio: string;
  ultima_posicion: number;
  abierta_por: string;
  abierta_en: Date;
  resuelta_por: string | null;
  resuelta_en: Date | null;
  motivo: string | null;
  version: number;
}>;

function aCuenta(f: FilaDeCuenta): Cuenta {
  return {
    id: cuentaId(f.id),
    sucursalId: sucursalId(f.sucursal_id),
    ancla:
      f.ancla_tipo === null || f.ancla_id === null ? null : { tipo: f.ancla_tipo, id: f.ancla_id },
    etiqueta: f.etiqueta,
    estado: f.estado,
    totalProvisorio: f.total_provisorio,
    ultimaPosicion: f.ultima_posicion,
    abiertaPor: personaId(f.abierta_por),
    abiertaEn: f.abierta_en,
    resueltaPor: f.resuelta_por === null ? null : personaId(f.resuelta_por),
    resueltaEn: f.resuelta_en,
    motivo: f.motivo,
    version: f.version,
  };
}

export function crearRepositorioDeCuentas(db: Kysely<VentasDb>): RepositorioDeCuentas {
  const seleccionarCuenta = () =>
    db
      .selectFrom("cuenta_consumo")
      .select([
        "id",
        "sucursal_id",
        "ancla_tipo",
        "ancla_id",
        "etiqueta",
        "estado",
        "total_provisorio",
        "ultima_posicion",
        "abierta_por",
        "abierta_en",
        "resuelta_por",
        "resuelta_en",
        "motivo",
        "version",
      ]);
  const seleccionarLinea = () =>
    db
      .selectFrom("linea_cuenta")
      .select([
        "id",
        "cuenta_id",
        "posicion",
        "producto_id",
        "descripcion",
        "variante_opcion_id",
        "variante_nombre",
        "precio_id",
        "origen_del_precio",
        "precio_base",
        "precio_unitario",
        "cantidad",
        "unidad_de_venta",
        "paso_de_cantidad",
        "alicuota",
        "controla_stock",
        "estado",
        "anulada_por",
        "anulada_en",
        "motivo_de_anulacion",
        "creada_por",
        "creada_en",
      ]);

  async function opcionesDe(empresa: EmpresaId, lineas: readonly string[]) {
    if (lineas.length === 0) return new Map<string, OpcionDeLinea[]>();
    const filas = await db
      .selectFrom("linea_cuenta_opcion")
      .select([
        "linea_id",
        "orden",
        "opcion_id",
        "version_de_opcion_id",
        "grupo_id",
        "nombre_de_grupo",
        "nombre",
        "clase",
        "recargo",
        "origen_del_recargo",
      ])
      .where("empresa_id", "=", empresa)
      .where("linea_id", "in", [...lineas])
      .orderBy("linea_id")
      .orderBy("orden")
      .execute();
    const porLinea = new Map<string, OpcionDeLinea[]>();
    for (const f of filas) {
      porLinea.set(f.linea_id, [
        ...(porLinea.get(f.linea_id) ?? []),
        {
          orden: f.orden,
          opcionId: f.opcion_id,
          versionDeOpcionId: f.version_de_opcion_id,
          grupoId: f.grupo_id,
          nombreDeGrupo: f.nombre_de_grupo,
          nombre: f.nombre,
          clase: f.clase as "INCLUIDA" | "ADICIONAL",
          recargo: f.recargo,
          origenDelRecargo: f.origen_del_recargo as "SUCURSAL" | "EMPRESA",
        },
      ]);
    }
    return porLinea;
  }

  type FilaDeLinea = Awaited<ReturnType<ReturnType<typeof seleccionarLinea>["execute"]>>[number];
  const aLinea = (f: FilaDeLinea, opciones: readonly OpcionDeLinea[]): Linea => ({
    id: lineaId(f.id),
    cuentaId: cuentaId(f.cuenta_id),
    posicion: f.posicion,
    productoId: f.producto_id,
    descripcion: f.descripcion,
    varianteOpcionId: f.variante_opcion_id,
    varianteNombre: f.variante_nombre,
    precioId: f.precio_id,
    origenDelPrecio: f.origen_del_precio as "SUCURSAL" | "EMPRESA",
    precioBase: f.precio_base,
    precioUnitario: f.precio_unitario,
    cantidad: f.cantidad,
    unidadDeVenta: f.unidad_de_venta,
    pasoDeCantidad: f.paso_de_cantidad,
    alicuota: f.alicuota,
    controlaStock: f.controla_stock,
    estado: f.estado,
    anuladaPor: f.anulada_por === null ? null : personaId(f.anulada_por),
    anuladaEn: f.anulada_en,
    motivoDeAnulacion: f.motivo_de_anulacion,
    creadaPor: personaId(f.creada_por),
    creadaEn: f.creada_en,
    opciones,
  });

  return {
    async insertar(empresa, alta) {
      const armar = () =>
        db.insertInto("cuenta_consumo").values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          ancla_tipo: alta.ancla === null ? null : alta.ancla.tipo,
          ancla_id: alta.ancla === null ? null : alta.ancla.id,
          etiqueta: alta.etiqueta,
          abierta_por: alta.abiertaPor,
          abierta_en: alta.abiertaEn,
        });
      const fila = await insertarIdempotente(
        () =>
          armar()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("cuenta_consumo")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => armar().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },

    async obtener(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionarCuenta()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async abiertaPorAncla(empresa, ancla) {
      if (!esUuid(ancla.id)) return null;
      const fila = await seleccionarCuenta()
        .where("empresa_id", "=", empresa)
        .where("ancla_tipo", "=", ancla.tipo)
        .where("ancla_id", "=", ancla.id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return fila === undefined ? null : aCuenta(fila);
    },

    async reservarPosicion(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await db
        .updateTable("cuenta_consumo")
        .set({ ultima_posicion: sql<number>`ultima_posicion + 1` })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .returning("ultima_posicion")
        .executeTakeFirst();
      return fila === undefined ? null : fila.ultima_posicion;
    },

    async fijarTotal(empresa, id, total) {
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ total_provisorio: total })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cerrar(empresa, id, persona, ahora) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ estado: "CERRADA", resuelta_por: persona, resuelta_en: ahora })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async anular(empresa, id, persona, ahora, motivo) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("cuenta_consumo")
        .set({ estado: "ANULADA", resuelta_por: persona, resuelta_en: ahora, motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "ABIERTA")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async insertarLinea(empresa, alta) {
      const armar = () =>
        db.insertInto("linea_cuenta").values({
          id: alta.id,
          empresa_id: empresa,
          cuenta_id: alta.cuentaId,
          posicion: alta.posicion,
          producto_id: alta.productoId,
          descripcion: alta.descripcion,
          variante_opcion_id: alta.varianteOpcionId,
          variante_nombre: alta.varianteNombre,
          precio_id: alta.precioId,
          origen_del_precio: alta.origenDelPrecio,
          precio_base: alta.precioBase,
          precio_unitario: alta.precioUnitario,
          cantidad: alta.cantidad,
          unidad_de_venta: alta.unidadDeVenta,
          paso_de_cantidad: alta.pasoDeCantidad,
          alicuota: alta.alicuota,
          controla_stock: alta.controlaStock,
          creada_por: alta.creadaPor,
          creada_en: alta.creadaEn,
        });
      const fila = await insertarIdempotente(
        () =>
          armar()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("linea_cuenta")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => armar().returning("id").executeTakeFirstOrThrow(),
      );
      if (fila === undefined) return false;
      if (alta.opciones.length > 0) {
        await db
          .insertInto("linea_cuenta_opcion")
          .values(
            alta.opciones.map((o) => ({
              empresa_id: empresa,
              linea_id: alta.id,
              orden: o.orden,
              opcion_id: o.opcionId,
              version_de_opcion_id: o.versionDeOpcionId,
              grupo_id: o.grupoId,
              nombre_de_grupo: o.nombreDeGrupo,
              nombre: o.nombre,
              clase: o.clase,
              recargo: o.recargo,
              origen_del_recargo: o.origenDelRecargo,
            })),
          )
          .execute();
      }
      return true;
    },

    async obtenerLinea(empresa, id) {
      if (!esUuid(id)) return null;
      const fila = await seleccionarLinea()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      if (fila === undefined) return null;
      return aLinea(fila, (await opcionesDe(empresa, [fila.id])).get(fila.id) ?? []);
    },

    async lineasDeCuenta(empresa, id) {
      if (!esUuid(id)) return [];
      const filas = await seleccionarLinea()
        .where("empresa_id", "=", empresa)
        .where("cuenta_id", "=", id)
        .orderBy("posicion")
        .execute();
      const opciones = await opcionesDe(
        empresa,
        filas.map((f) => f.id),
      );
      return filas.map((f) => aLinea(f, opciones.get(f.id) ?? []));
    },

    async anularLinea(empresa, id, persona, ahora, motivo) {
      if (!esUuid(id)) return false;
      const r = await db
        .updateTable("linea_cuenta")
        .set({
          estado: "ANULADA",
          anulada_por: persona,
          anulada_en: ahora,
          motivo_de_anulacion: motivo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "VIGENTE")
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}
