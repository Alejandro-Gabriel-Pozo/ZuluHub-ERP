import { type Kysely } from "kysely";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import { insertarIdempotente } from "../../catalogo/publico";
import { cuentaId, esUuid, lineaId, type CuentaId, type LineaId } from "../dominio/identificadores";
import type { VentasDb } from "./esquema";
import type { AltaDeLinea, Linea, OpcionDeLinea } from "./modelo-de-cuentas";

/**
 * Persistencia de las líneas de una cuenta y la foto de sus opciones (E4 §3.3 y §3.4). Todo corre dentro de la transacción del caso de uso,
 * filtra SIEMPRE por la empresa (y la RLS lo repite) y no usa caché. Un id que no es un uuid no puede ser el de nada: «no existe».
 */
export interface RepositorioDeLineas {
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

export function crearRepositorioDeLineas(db: Kysely<VentasDb>): RepositorioDeLineas {
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
        "variante_version_de_opcion_id",
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
    varianteVersionDeOpcionId: f.variante_version_de_opcion_id,
    precioId: f.precio_id,
    origenDelPrecio: f.origen_del_precio as "SUCURSAL" | "EMPRESA" | "ABIERTO",
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
          variante_version_de_opcion_id: alta.varianteVersionDeOpcionId,
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
