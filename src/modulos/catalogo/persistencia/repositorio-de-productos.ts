import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeUso } from "../dominio/clases";
import type { ProductoId, SeccionDeCartaId } from "../dominio/identificadores";
import type { Producto } from "../dominio/modelo";
import type { FichaValida } from "../dominio/producto";
import type { CatalogoDb } from "./esquema";
import { aProducto, FORMA_DE_UUID } from "./filas";
import { insertarIdempotente } from "./insertar-idempotente";

export type SeccionDeCarta = Readonly<{
  id: SeccionDeCartaId;
  nombre: string;
  orden: number;
  activa: boolean;
  version: number;
}>;

export type AltaDeProducto = Readonly<{
  id: ProductoId;
  claseDeUso: ClaseDeUso;
  ficha: FichaValida;
  unidadBaseId: string;
  dimension: string;
  unidadDeVentaId: string;
  pasoMinimo: string;
  faltaCompletar: boolean;
  creadoPor: PersonaId | null;
}>;

export type FiltroDeProductos = Readonly<{
  texto?: string | undefined;
  claseDeUso?: ClaseDeUso | undefined;
  faltaCompletar?: boolean | undefined;
  activo?: boolean | undefined;
  /** Paginación por `(nombre_clave, id)`: lo que viene después de este par. */
  despuesDe?: Readonly<{ nombreClave: string; id: string }> | undefined;
  limite: number;
}>;

export type ProductoDeLista = Readonly<{ producto: Producto; nombreClave: string }>;

export interface RepositorioDeProductos {
  /**
   * El producto con `SELECT … FOR UPDATE`: serializa a los comandos de un mismo producto (precio, opciones, consumo, copia, datos) sin
   * reintentos y sin estados a medias; los de productos distintos no se esperan. `null` si no existe o es de otra empresa.
   */
  bloquear(empresa: EmpresaId, id: string): Promise<Producto | null>;
  obtener(empresa: EmpresaId, id: string): Promise<Producto | null>;
  /**
   * `INSERT … ON CONFLICT (id) DO NOTHING`: `true` si insertó, `false` si ya había un producto con ese id (visible o no). Un nombre, código
   * o código de barras repetido NO es un conflicto del id: sale como error de unicidad.
   */
  insertar(empresa: EmpresaId, alta: AltaDeProducto): Promise<boolean>;
  actualizarFicha(
    empresa: EmpresaId,
    id: ProductoId,
    versionEsperada: number,
    ficha: FichaValida,
  ): Promise<Producto | null>;
  cambiarActivo(empresa: EmpresaId, id: ProductoId, activo: boolean): Promise<Producto | null>;
  cambiarFormaDeVenta(
    empresa: EmpresaId,
    id: ProductoId,
    unidadDeVentaId: string,
    pasoMinimo: string,
  ): Promise<Producto | null>;
  /** Sube la versión del conjunto de opciones (y, por el disparador, la del producto). */
  subirVersionDeOpciones(empresa: EmpresaId, id: ProductoId): Promise<Producto | null>;
  listar(empresa: EmpresaId, filtro: FiltroDeProductos): Promise<ProductoDeLista[]>;
  /** Productos activos con opciones para copiar (distintos de `excepto`). */
  conOpciones(empresa: EmpresaId, excepto: ProductoId): Promise<Producto[]>;
  /** Insumos elegibles: materia prima, insumo y reventa, activos. */
  insumosElegibles(
    empresa: EmpresaId,
    texto: string | undefined,
    limite: number,
  ): Promise<Producto[]>;

  obtenerSeccion(empresa: EmpresaId, id: string): Promise<SeccionDeCarta | null>;
  insertarSeccion(
    empresa: EmpresaId,
    id: SeccionDeCartaId,
    nombre: string,
    nombreClave: string,
    orden: number,
  ): Promise<boolean>;
  actualizarSeccion(
    empresa: EmpresaId,
    id: SeccionDeCartaId,
    versionEsperada: number,
    cambios: Readonly<{ nombre: string; nombreClave: string; orden: number }>,
  ): Promise<SeccionDeCarta | null>;
  desactivarSeccion(empresa: EmpresaId, id: SeccionDeCartaId): Promise<SeccionDeCarta | null>;
  listarSecciones(empresa: EmpresaId): Promise<SeccionDeCarta[]>;
}

function aSeccion(f: {
  id: string;
  nombre: string;
  orden: number;
  activa: boolean;
  version: number;
}): SeccionDeCarta {
  return {
    id: f.id as SeccionDeCartaId,
    nombre: f.nombre,
    orden: f.orden,
    activa: f.activa,
    version: f.version,
  };
}

/** Escapa `%`, `_` y `\` de lo que se busca con `LIKE`: el texto es del usuario. */
const comoPrefijo = (texto: string): string => `${texto.replace(/[\\%_]/g, "\\$&")}%`;

export function crearRepositorioDeProductos(db: Kysely<CatalogoDb>): RepositorioDeProductos {
  const comunes = (f: FichaValida) => ({
    nombre: f.nombre,
    nombre_clave: f.nombreClave,
    nombre_de_cocina: f.nombreDeCocina,
    descripcion_en_carta: f.descripcionEnCarta,
    codigo: f.codigo,
    codigo_de_barras: f.codigoDeBarras,
    alicuota_iva: f.alicuota,
    seccion_de_carta_id: f.seccionDeCartaId,
  });
  return {
    async bloquear(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .forUpdate()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async obtener(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async insertar(empresa, alta) {
      const f = alta.ficha;
      const alta_ = () =>
        db.insertInto("producto").values({
          id: alta.id,
          empresa_id: empresa,
          ...comunes(f),
          tipo: "BIEN",
          clase_de_uso: alta.claseDeUso,
          unidad_base_id: alta.unidadBaseId,
          dimension: alta.dimension,
          unidad_de_venta_id: alta.unidadDeVentaId,
          paso_minimo: alta.pasoMinimo,
          falta_completar: alta.faltaCompletar,
          creado_por: alta.creadoPor,
        });
      const fila = await insertarIdempotente(
        () =>
          alta_()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("producto")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", alta.id)
            .executeTakeFirst()) !== undefined,
        () => alta_().returning("id").executeTakeFirstOrThrow(),
      );
      return fila !== undefined;
    },
    async actualizarFicha(empresa, id, versionEsperada, ficha) {
      const fila = await db
        .updateTable("producto")
        .set({ ...comunes(ficha), falta_completar: false })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async cambiarActivo(empresa, id, activo) {
      const fila = await db
        .updateTable("producto")
        .set({ activo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async cambiarFormaDeVenta(empresa, id, unidadDeVentaId, pasoMinimo) {
      const fila = await db
        .updateTable("producto")
        .set({ unidad_de_venta_id: unidadDeVentaId, paso_minimo: pasoMinimo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async subirVersionDeOpciones(empresa, id) {
      const fila = await db
        .updateTable("producto")
        .set({ version_de_opciones: sql`version_de_opciones + 1` })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return fila === undefined ? null : aProducto(fila);
    },
    async listar(empresa, filtro) {
      let consulta = db.selectFrom("producto").selectAll().where("empresa_id", "=", empresa);
      if (filtro.texto !== undefined && filtro.texto !== "") {
        consulta = consulta.where(
          sql<boolean>`nombre_clave like ${comoPrefijo(filtro.texto.toLowerCase())} escape '\\'`,
        );
      }
      if (filtro.claseDeUso !== undefined)
        consulta = consulta.where("clase_de_uso", "=", filtro.claseDeUso);
      if (filtro.faltaCompletar !== undefined)
        consulta = consulta.where("falta_completar", "=", filtro.faltaCompletar);
      if (filtro.activo !== undefined) consulta = consulta.where("activo", "=", filtro.activo);
      if (filtro.despuesDe !== undefined) {
        const { nombreClave, id } = filtro.despuesDe;
        consulta = consulta.where(sql<boolean>`(nombre_clave, id) > (${nombreClave}, ${id}::uuid)`);
      }
      const filas = await consulta
        .orderBy("nombre_clave")
        .orderBy("id")
        .limit(filtro.limite)
        .execute();
      return filas.map((f) => ({ producto: aProducto(f), nombreClave: f.nombre_clave }));
    },
    async conOpciones(empresa, excepto) {
      const filas = await db
        .selectFrom("producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .where("id", "<>", excepto)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("grupo_de_elecciones")
              .select("id")
              .whereRef("grupo_de_elecciones.producto_id", "=", "producto.id")
              .where("grupo_de_elecciones.empresa_id", "=", empresa),
          ),
        )
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      return filas.map(aProducto);
    },
    async insumosElegibles(empresa, texto, limite) {
      let consulta = db
        .selectFrom("producto")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .where("clase_de_uso", "in", ["MATERIA_PRIMA", "INSUMO", "REVENTA"]);
      if (texto !== undefined && texto !== "") {
        consulta = consulta.where(
          sql<boolean>`nombre_clave like ${comoPrefijo(texto.toLowerCase())} escape '\\'`,
        );
      }
      const filas = await consulta.orderBy("nombre_clave").orderBy("id").limit(limite).execute();
      return filas.map(aProducto);
    },
    async obtenerSeccion(empresa, id) {
      if (!FORMA_DE_UUID.test(id)) return null;
      const f = await db
        .selectFrom("seccion_de_carta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return f === undefined ? null : aSeccion(f);
    },
    async insertarSeccion(empresa, id, nombre, nombreClave, orden) {
      const alta = () =>
        db
          .insertInto("seccion_de_carta")
          .values({ id, empresa_id: empresa, nombre, nombre_clave: nombreClave, orden });
      const f = await insertarIdempotente(
        () =>
          alta()
            .onConflict((oc) => oc.doNothing())
            .returning("id")
            .executeTakeFirst(),
        async () =>
          (await db
            .selectFrom("seccion_de_carta")
            .select("id")
            .where("empresa_id", "=", empresa)
            .where("id", "=", id)
            .executeTakeFirst()) !== undefined,
        () => alta().returning("id").executeTakeFirstOrThrow(),
      );
      return f !== undefined;
    },
    async actualizarSeccion(empresa, id, versionEsperada, cambios) {
      const f = await db
        .updateTable("seccion_de_carta")
        .set({ nombre: cambios.nombre, nombre_clave: cambios.nombreClave, orden: cambios.orden })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returningAll()
        .executeTakeFirst();
      return f === undefined ? null : aSeccion(f);
    },
    async desactivarSeccion(empresa, id) {
      const f = await db
        .updateTable("seccion_de_carta")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();
      return f === undefined ? null : aSeccion(f);
    },
    async listarSecciones(empresa) {
      const filas = await db
        .selectFrom("seccion_de_carta")
        .selectAll()
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("orden")
        .orderBy("nombre_clave")
        .orderBy("id")
        .execute();
      return filas.map(aSeccion);
    },
  };
}
