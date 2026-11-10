import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { GrupoConOpciones } from "../dominio/cotizar";
import type {
  CopiaDeOpcionesId,
  GrupoDeEleccionesId,
  OpcionId,
  ProductoId,
  VersionDeOpcionId,
} from "../dominio/identificadores";
import type { LineaDeConsumo } from "../dominio/modelo";
import type { GrupoValido, OpcionValida } from "../dominio/opciones";
import type { CatalogoDb } from "./esquema";
import { aGrupo, aOpcion, FORMA_DE_UUID, type FilaDeOpcionVigente } from "./filas";

export type CopiaRegistrada = Readonly<{
  id: CopiaDeOpcionesId;
  productoOrigenId: string;
  productoDestinoId: string;
}>;

export type NuevaVersion = Readonly<{
  opcionId: OpcionId;
  numero: number;
  nombre: string;
  recargo: string;
  factorDeTamano: string;
  cargadaPor: PersonaId | null;
  /** `ahora` del contexto: lo fija quien llama, nunca el reloj de la base. */
  creadaEn: Date;
}>;

export interface RepositorioDeOpciones {
  /** Todos los grupos del producto (activos o no) con sus opciones y la versión vigente de cada una, en orden. */
  gruposDelProducto(empresa: EmpresaId, producto: string): Promise<GrupoConOpciones[]>;
  /** Lo que consume cada versión (vigente o vieja), por id de versión. */
  consumoDeVersiones(
    empresa: EmpresaId,
    versiones: readonly string[],
  ): Promise<Map<string, LineaDeConsumo[]>>;
  /** Crea el grupo; sin `id` lo genera la base. Devuelve el id. */
  insertarGrupo(
    empresa: EmpresaId,
    producto: ProductoId,
    grupo: Omit<GrupoValido, "id" | "opciones"> & Readonly<{ id?: string }>,
  ): Promise<string>;
  /** Lo que se puede cambiar de un grupo ya creado (la clase y el producto no cambian). */
  actualizarGrupo(empresa: EmpresaId, grupo: GrupoValido): Promise<void>;
  /** Desactiva un grupo (lo que el conjunto final ya no nombra); nada se borra. */
  desactivarGrupo(empresa: EmpresaId, id: GrupoDeEleccionesId): Promise<void>;
  /** Crea la opción (sin su versión); sin `id` lo genera la base. Devuelve el id. */
  insertarOpcion(
    empresa: EmpresaId,
    producto: ProductoId,
    grupo: GrupoDeEleccionesId,
    opcion: Pick<OpcionValida, "nombreClave" | "orden"> & Readonly<{ id?: string }>,
  ): Promise<OpcionId>;
  actualizarOpcion(empresa: EmpresaId, id: OpcionId, orden: number, activa: boolean): Promise<void>;
  /** Inserta una versión nueva (solo inserción) y devuelve su id, que genera la base. */
  insertarVersion(empresa: EmpresaId, nueva: NuevaVersion): Promise<VersionDeOpcionId>;
  insertarConsumo(
    empresa: EmpresaId,
    version: VersionDeOpcionId,
    lineas: readonly LineaDeConsumo[],
  ): Promise<void>;
  obtenerCopia(empresa: EmpresaId, id: string): Promise<CopiaRegistrada | null>;
  /** `true` si registró la copia, `false` si ya existía una con ese id. */
  registrarCopia(
    empresa: EmpresaId,
    id: CopiaDeOpcionesId,
    origen: ProductoId,
    destino: ProductoId,
    creadaPor: PersonaId | null,
  ): Promise<boolean>;
}

export function crearRepositorioDeOpciones(db: Kysely<CatalogoDb>): RepositorioDeOpciones {
  return {
    async gruposDelProducto(empresa, producto) {
      if (!FORMA_DE_UUID.test(producto)) return [];
      const grupos = await db
        .selectFrom("grupo_de_elecciones")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("producto_id", "=", producto)
        .orderBy("orden")
        .orderBy("id")
        .execute();
      const filas = await sql<FilaDeOpcionVigente>`
        select o.id, o.grupo_id, o.orden, o.activa, v.id as version_id, v.numero, v.nombre,
               v.recargo::text as recargo, v.factor_de_tamano::text as factor_de_tamano
          from opcion o
          join lateral (
            select x.* from version_de_opcion x
             where x.empresa_id = o.empresa_id and x.opcion_id = o.id
             order by x.numero desc limit 1
          ) v on true
         where o.empresa_id = ${empresa}::uuid and o.producto_id = ${producto}::uuid
         order by o.orden, o.id`.execute(db);
      return grupos.map((g) => ({
        grupo: aGrupo(g),
        opciones: filas.rows.filter((o) => o.grupo_id === g.id).map(aOpcion),
      }));
    },

    async consumoDeVersiones(empresa, versiones) {
      const porVersion = new Map<string, LineaDeConsumo[]>();
      if (versiones.length === 0) return porVersion;
      const filas = await db
        .selectFrom("consumo_de_opcion")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("version_de_opcion_id", "in", [...versiones])
        .orderBy("version_de_opcion_id")
        .orderBy("numero")
        .execute();
      for (const f of filas) {
        const lineas = porVersion.get(f.version_de_opcion_id) ?? [];
        lineas.push({
          insumoId: f.insumo_id as ProductoId,
          cantidad: f.cantidad,
          escalaConTamano: f.escala_con_tamano,
        });
        porVersion.set(f.version_de_opcion_id, lineas);
      }
      return porVersion;
    },

    async insertarGrupo(empresa, producto, g) {
      const fila = await db
        .insertInto("grupo_de_elecciones")
        .values({
          ...(g.id === undefined ? {} : { id: g.id }),
          empresa_id: empresa,
          producto_id: producto,
          clase: g.clase,
          es_tamano: g.esTamano,
          nombre: g.nombre,
          nombre_clave: g.nombreClave,
          es_obligatorio: g.esObligatorio,
          admite_varias: g.admiteVarias,
          se_muestra_en_carta: g.seMuestraEnCarta,
          orden: g.orden,
          activo: g.activo,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id;
    },

    async desactivarGrupo(empresa, id) {
      await db
        .updateTable("grupo_de_elecciones")
        .set({ activo: false })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .execute();
    },

    async actualizarGrupo(empresa, g) {
      await db
        .updateTable("grupo_de_elecciones")
        .set({
          es_tamano: g.esTamano,
          nombre: g.nombre,
          nombre_clave: g.nombreClave,
          es_obligatorio: g.esObligatorio,
          admite_varias: g.admiteVarias,
          se_muestra_en_carta: g.seMuestraEnCarta,
          orden: g.orden,
          activo: g.activo,
        })
        .where("empresa_id", "=", empresa)
        .where("id", "=", g.id)
        .execute();
    },

    async insertarOpcion(empresa, producto, grupo, o) {
      const fila = await db
        .insertInto("opcion")
        .values({
          ...(o.id === undefined ? {} : { id: o.id }),
          empresa_id: empresa,
          producto_id: producto,
          grupo_id: grupo,
          nombre_clave: o.nombreClave,
          orden: o.orden,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id as OpcionId;
    },

    async actualizarOpcion(empresa, id, orden, activa) {
      await db
        .updateTable("opcion")
        .set({ orden, activa })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .execute();
    },

    async insertarVersion(empresa, n) {
      const fila = await db
        .insertInto("version_de_opcion")
        .values({
          empresa_id: empresa,
          opcion_id: n.opcionId,
          numero: n.numero,
          nombre: n.nombre,
          recargo: n.recargo,
          factor_de_tamano: n.factorDeTamano,
          cargada_por: n.cargadaPor,
          creado_en: n.creadaEn,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return fila.id as VersionDeOpcionId;
    },

    async insertarConsumo(empresa, version, lineas) {
      if (lineas.length === 0) return;
      await db
        .insertInto("consumo_de_opcion")
        .values(
          lineas.map((l, indice) => ({
            empresa_id: empresa,
            version_de_opcion_id: version,
            numero: indice + 1,
            insumo_id: l.insumoId,
            cantidad: l.cantidad,
            escala_con_tamano: l.escalaConTamano,
          })),
        )
        .execute();
    },

    async obtenerCopia(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const f = await db
        .selectFrom("copia_de_opciones")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined
        ? null
        : {
            id: f.id as CopiaDeOpcionesId,
            productoOrigenId: f.producto_origen_id,
            productoDestinoId: f.producto_destino_id,
          };
    },

    async registrarCopia(empresa, id, origen, destino, creadaPor) {
      const f = await db
        .insertInto("copia_de_opciones")
        .values({
          id,
          empresa_id: empresa,
          producto_origen_id: origen,
          producto_destino_id: destino,
          creado_por: creadaPor,
        })
        .onConflict((oc) => oc.columns(["empresa_id", "id"]).doNothing())
        .returning("id")
        .executeTakeFirst();
      return f !== undefined;
    },
  };
}
