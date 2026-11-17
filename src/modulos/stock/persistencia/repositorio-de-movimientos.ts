import { sql, type Kysely } from "kysely";
import type { EmpresaId, PersonaId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeMovimiento } from "../dominio/movimiento";
import type { StockDb } from "./esquema";
import { aMovimiento, aRenglon, esUuid } from "./filas";
import { crearLecturasDelLibro, type LecturasDelLibro } from "./lecturas-del-libro";
import {
  claseDeMovimientoGuardada,
  type Movimiento,
  type MotivoGuardado,
  type RenglonGuardado,
} from "./modelo";

export type AltaDeMovimiento = Readonly<{
  clase: ClaseDeMovimiento;
  motivo: string;
  detalle: string | null;
  /** `MANUAL` sin identificador, o el origen de otro módulo (`EJEMPLAR_DE_TICKET`, `RECEPCION`) con el suyo. */
  origenTipo: string;
  origenId: string | null;
  /** El depósito del acto (el de origen en una transferencia). */
  depositoId: string;
  /** La autorización que lo causó (`stock.registrar_entrada`...). */
  accion: string;
  anulaA: string | null;
  conteoId: string | null;
  clave: string;
  /** sha256 hex del contenido canónico (`huellaDeComando`). */
  huella: string;
  hechoEn: Date;
  /** `YYYY-MM-DD`. SOLO la salida por venta la manda (la del ticket); en las demás va `null` y la fija la base. */
  fechaDeNegocio: string | null;
  registradoPor: PersonaId;
}>;

export type AltaDeRenglon = Readonly<{
  depositoId: string;
  articuloId: string;
  /** Con signo, texto decimal exacto, en la unidad de stock. */
  cantidad: string;
  composicionId: string | null;
  confirmoNegativo: boolean;
}>;

export type ParDeSaldo = Readonly<{ depositoId: string; articuloId: string }>;

/** La llave con que `leerSaldos` indexa lo que devuelve. */
export const llaveDeSaldo = (depositoId: string, articuloId: string): string =>
  `${depositoId}|${articuloId}`;

/** La escritura del libro y la lectura de un movimiento, sus renglones y los saldos que toca. */
export interface MovimientosYSaldos {
  /**
   * Escribe la cabecera y sus renglones (numerados desde 1 en el orden recibido: quien llama los ordena en el orden canónico de bloqueos)
   * en la transacción en curso. Un renglón aplica su cantidad al saldo (disparador); el movimiento se verifica entero al confirmar. Una clave
   * ya usada, un anulado dos veces o una clase fuera de regla salen como errores de la base (`ERRORES_DE_STOCK_POR_RESTRICCION`).
   */
  registrar(
    empresa: EmpresaId,
    alta: AltaDeMovimiento,
    renglones: readonly AltaDeRenglon[],
  ): Promise<Movimiento>;
  obtener(empresa: EmpresaId, id: string): Promise<Movimiento | null>;
  /** El movimiento con esa clave de idempotencia (la clave es única por empresa). */
  porClave(empresa: EmpresaId, clave: string): Promise<Movimiento | null>;
  /** La ENTRADA o la SALIDA de ese origen (el único de origen la garantiza única), o `null`. */
  porOrigen(
    empresa: EmpresaId,
    clase: "ENTRADA" | "SALIDA",
    origenTipo: string,
    origenId: string,
  ): Promise<Movimiento | null>;
  /** Todos los movimientos de un origen (la salida, su anulación...), del más viejo al más nuevo. */
  delOrigen(empresa: EmpresaId, origenTipo: string, origenId: string): Promise<Movimiento[]>;
  /** La anulación de este movimiento, si la hay (una sola: `anula_a` es único). */
  anulacionDe(empresa: EmpresaId, movimientoId: string): Promise<Movimiento | null>;
  renglonesDe(empresa: EmpresaId, movimientoId: string): Promise<RenglonGuardado[]>;
  /** Los motivos sembrados (tabla global). */
  motivos(): Promise<MotivoGuardado[]>;
  /**
   * La existencia de cada par (los que nunca se movieron no figuran: valen 0). Con `bloquear`, `SELECT … FOR UPDATE` en el orden canónico
   * `(depósito, artículo)`: quien lo usa antes de decidir sobre el saldo toma los bloqueos en el mismo orden que el resto.
   */
  leerSaldos(
    empresa: EmpresaId,
    pares: readonly ParDeSaldo[],
    bloquear: boolean,
  ): Promise<Map<string, string>>;
  /**
   * ¿El artículo tiene existencia DISTINTA DE CERO (también negativa) en algún depósito del alcance? `sucursal` nula = toda la empresa; con una sucursal,
   * solo los depósitos de ese local. Lo usa el catálogo (por el puerto de la composición) para no ocultar ni desactivar un producto con existencia.
   */
  conExistenciaDelArticulo(
    empresa: EmpresaId,
    articuloId: string,
    sucursal: string | null,
  ): Promise<boolean>;
}

/** El libro de movimientos: escritura y lectura de movimientos y saldos más las lecturas de las consultas (`lecturas-del-libro.ts`). */
export type RepositorioDeMovimientos = MovimientosYSaldos & LecturasDelLibro;

export function crearRepositorioDeMovimientos(db: Kysely<StockDb>): RepositorioDeMovimientos {
  return { ...crearMovimientosYSaldos(db), ...crearLecturasDelLibro(db) };
}

function crearMovimientosYSaldos(db: Kysely<StockDb>): MovimientosYSaldos {
  /** Las columnas de la cabecera; la fecha de negocio (`date`) se lee como texto. */
  const cabecera = () =>
    db
      .selectFrom("movimiento_de_stock")
      .select([
        "id",
        "empresa_id",
        "clase",
        "motivo",
        "detalle",
        "origen_tipo",
        "origen_id",
        "deposito_id",
        "accion",
        "anula_a",
        "conteo_id",
        "clave_idempotencia",
        "huella",
        "hecho_en",
        "registrado_en",
        sql<string>`fecha_negocio::text`.as("fecha_negocio"),
        "registrado_por",
      ]);
  const unoOCero = async (consulta: ReturnType<typeof cabecera>): Promise<Movimiento | null> => {
    const fila = await consulta.executeTakeFirst();
    return fila === undefined ? null : aMovimiento(fila);
  };

  return {
    async registrar(empresa, alta, renglones) {
      const alta_ = () =>
        db.insertInto("movimiento_de_stock").values({
          empresa_id: empresa,
          clase: alta.clase,
          motivo: alta.motivo,
          detalle: alta.detalle,
          origen_tipo: alta.origenTipo,
          origen_id: alta.origenId,
          deposito_id: alta.depositoId,
          accion: alta.accion,
          anula_a: alta.anulaA,
          conteo_id: alta.conteoId,
          clave_idempotencia: alta.clave,
          huella: alta.huella,
          hecho_en: alta.hechoEn,
          fecha_negocio:
            alta.fechaDeNegocio === null ? null : sql<string>`${alta.fechaDeNegocio}::date`,
          registrado_por: alta.registradoPor,
        });
      // `ON CONFLICT DO NOTHING` sin objetivo: bajo serializable, un choque (misma clave, mismo ejemplar, ya anulado) con una fila que esta
      // transacción todavía no ve aborta por serialización y el adaptador repite el pedido, que ya la ve y contesta «ya existía». Sin esto,
      // dos pedidos iguales a la vez devolvían un error de unicidad en vez de repetirse. Si el choque es con una fila ya visible no inserta
      // nada y se repite sin `ON CONFLICT` para que la base lance la restricción tal cual (la traduce el caso de uso).
      const insertada =
        (await alta_()
          .onConflict((oc) => oc.doNothing())
          .returning("id")
          .executeTakeFirst()) ?? (await alta_().returning("id").executeTakeFirstOrThrow());
      if (renglones.length > 0) {
        await db
          .insertInto("renglon_de_movimiento")
          .values(
            renglones.map((r, indice) => ({
              empresa_id: empresa,
              movimiento_id: insertada.id,
              numero: indice + 1,
              deposito_id: r.depositoId,
              articulo_id: r.articuloId,
              cantidad: r.cantidad,
              composicion_id: r.composicionId,
              confirmo_negativo: r.confirmoNegativo,
            })),
          )
          .execute();
      }
      const guardado = await unoOCero(
        cabecera().where("empresa_id", "=", empresa).where("id", "=", insertada.id),
      );
      if (guardado === null) throw new Error("el movimiento recién escrito no es visible");
      return guardado;
    },
    obtener(empresa, id) {
      if (!esUuid(id)) return Promise.resolve(null);
      return unoOCero(cabecera().where("empresa_id", "=", empresa).where("id", "=", id));
    },
    porClave(empresa, clave) {
      return unoOCero(
        cabecera().where("empresa_id", "=", empresa).where("clave_idempotencia", "=", clave),
      );
    },
    porOrigen(empresa, clase, origenTipo, origenId) {
      if (!esUuid(origenId)) return Promise.resolve(null);
      return unoOCero(
        cabecera()
          .where("empresa_id", "=", empresa)
          .where("clase", "=", clase)
          .where("origen_tipo", "=", origenTipo)
          .where("origen_id", "=", origenId),
      );
    },
    async delOrigen(empresa, origenTipo, origenId) {
      if (!esUuid(origenId)) return [];
      const filas = await cabecera()
        .where("empresa_id", "=", empresa)
        .where("origen_tipo", "=", origenTipo)
        .where("origen_id", "=", origenId)
        .orderBy("registrado_en")
        .orderBy("id")
        .execute();
      return filas.map(aMovimiento);
    },
    anulacionDe(empresa, movimientoId) {
      if (!esUuid(movimientoId)) return Promise.resolve(null);
      return unoOCero(
        cabecera().where("empresa_id", "=", empresa).where("anula_a", "=", movimientoId),
      );
    },
    async renglonesDe(empresa, movimientoId) {
      if (!esUuid(movimientoId)) return [];
      const filas = await db
        .selectFrom("renglon_de_movimiento")
        .select([
          "numero",
          "deposito_id",
          "articulo_id",
          "cantidad",
          "composicion_id",
          "confirmo_negativo",
        ])
        .where("empresa_id", "=", empresa)
        .where("movimiento_id", "=", movimientoId)
        .orderBy("numero")
        .execute();
      return filas.map(aRenglon);
    },
    async motivos() {
      const filas = await db
        .selectFrom("motivo_de_movimiento")
        .selectAll()
        .orderBy("clase")
        .orderBy("codigo")
        .execute();
      return filas.map((f) => ({
        clase: claseDeMovimientoGuardada(f.clase),
        codigo: f.codigo,
        entraConCosto: f.entra_con_costo,
        entregaMercaderia: f.entrega_mercaderia,
      }));
    },
    async leerSaldos(empresa, pares, bloquear) {
      const saldos = new Map<string, string>();
      const unicos = [
        ...new Map(pares.map((p) => [llaveDeSaldo(p.depositoId, p.articuloId), p])).values(),
      ].filter((p) => esUuid(p.depositoId) && esUuid(p.articuloId));
      if (unicos.length === 0) return saldos;
      const tuplas = unicos.map((p) => sql`(${p.depositoId}::uuid, ${p.articuloId}::uuid)`);
      const { rows } = await sql<{ deposito_id: string; articulo_id: string; existencia: string }>`
        select deposito_id, articulo_id, existencia::text as existencia
          from saldo_de_stock
         where empresa_id = ${empresa} and (deposito_id, articulo_id) in (${sql.join(tuplas)})
         order by deposito_id, articulo_id
         ${bloquear ? sql`for update` : sql``}`.execute(db);
      for (const f of rows) saldos.set(llaveDeSaldo(f.deposito_id, f.articulo_id), f.existencia);
      return saldos;
    },
    async conExistenciaDelArticulo(empresa, articuloId, sucursal) {
      if (!esUuid(articuloId) || (sucursal !== null && !esUuid(sucursal))) return false;
      const { rows } = await sql<{ uno: number }>`
        select 1 as uno
          from saldo_de_stock s
          join deposito d on d.id = s.deposito_id and d.empresa_id = s.empresa_id
         where s.empresa_id = ${empresa} and s.articulo_id = ${articuloId}::uuid and s.existencia <> 0
           ${sucursal === null ? sql`` : sql`and d.sucursal_id = ${sucursal}::uuid`}
         limit 1`.execute(db);
      return rows.length > 0;
    },
  };
}
