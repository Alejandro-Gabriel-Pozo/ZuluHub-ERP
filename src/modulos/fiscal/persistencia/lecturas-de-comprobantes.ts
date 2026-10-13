import { sql, type Kysely } from "kysely";
import { importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { moneda } from "../../../primitivas/dinero/moneda";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { TIPOS_DE_COMPROBANTE, type TipoDeComprobante } from "../dominio/comprobante-emitido";
import { AMBIENTES, type Ambiente } from "../dominio/comprobante-nuevo";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  type EstadoDeComprobanteArca,
} from "../dominio/estados-de-comprobante";
import { comprobanteId, type ComprobanteId } from "../dominio/identificadores";
import { deLaLista } from "./repositorios";
import type { FiscalDb } from "./tablas";

/**
 * Lecturas de comprobantes para las pantallas del facturador (spec H7 facturación §B.4.9, tramo F6): el listado
 * paginado y las notas que citan a un comprobante. Solo leen: no hay ninguna escritura acá, y el tipo que
 * reciben los casos de uso (`Pick` de estas funciones) no ofrece otra cosa.
 *
 *  - Todo filtra por empresa aunque la RLS ya lo imponga.
 *  - El listado se pagina por clave `(creado_en, id)` sin `OFFSET`: el orden es el del índice
 *    `comprobante_listado_ix` (`creado_en` descendente, `id` ascendente) y la página siguiente arranca DESPUÉS
 *    de la última fila de la anterior, así que un comprobante nuevo no corre ni repite filas ya vistas.
 *  - `creado_en` viaja como TEXTO con sus seis decimales (`pg` lo devolvería como un `Date` de milisegundos y la
 *    clave de la página siguiente saltearía o repetiría las filas que difieren en microsegundos).
 *  - La «fecha» de un comprobante es la de su emisión; mientras no tiene (todavía sin numerar), el día de su
 *    creación en Argentina (`ZONA_DE_ARGENTINA`): ARCA es argentina y la fecha de un comprobante es civil.
 */

/** La zona con la que se pasa un instante a día civil cuando el comprobante todavía no tiene fecha de emisión. */
export const ZONA_DE_ARGENTINA = "America/Argentina/Buenos_Aires";

/** La clave de paginación: el `creado_en` de la última fila vista (con microsegundos) y su `id`. */
export type ClaveDeListado = Readonly<{ creadoEn: string; id: ComprobanteId }>;

export type FiltroDeListado = Readonly<{
  /** `null`: todos los estados menos `DESCARTADO`. */
  estado: EstadoDeComprobanteArca | null;
  tipo: TipoDeComprobante | null;
  ambiente: Ambiente | null;
  /** Primer día (inclusive) y último (inclusive) de la «fecha» del comprobante. */
  desde: FechaCivil | null;
  hasta: FechaCivil | null;
  /**
   * La búsqueda de texto: el fragmento del nombre del receptor (sin distinguir mayúsculas) y, si el texto
   * puede ser un documento, su prefijo de solo dígitos. Basta que coincida uno de los dos.
   */
  texto: Readonly<{ nombre: string; documento: string | null }> | null;
  despuesDe: ClaveDeListado | null;
  limite: number;
}>;

/** Un comprobante como lo muestra una fila del listado. */
export type FilaDeListado = Readonly<{
  id: ComprobanteId;
  tipo: TipoDeComprobante;
  puntoDeVentaNumero: number;
  /** Solo un `AUTORIZADO` tiene número. */
  numero: bigint | null;
  fecha: FechaCivil;
  receptorNombre: string | null;
  total: Importe;
  estado: EstadoDeComprobanteArca;
  ambiente: Ambiente;
  /** Ver `ClaveDeListado`. */
  creadoEn: string;
}>;

export type PaginaDeFilas = Readonly<{ filas: readonly FilaDeListado[]; hayMas: boolean }>;

/** Una nota (o factura) que cita a otro comprobante como su asociado. */
export type NotaQueCita = Readonly<{
  id: ComprobanteId;
  tipo: TipoDeComprobante;
  puntoDeVentaNumero: number;
  numero: bigint | null;
  fecha: FechaCivil;
  total: Importe;
  estado: EstadoDeComprobanteArca;
}>;

export interface LecturasDeComprobantes {
  /** Una página del listado de la empresa, los más nuevos primero; `hayMas` si queda algo después de ella. */
  listar(empresa: EmpresaId, filtro: FiltroDeListado): Promise<PaginaDeFilas>;
  /**
   * Los comprobantes de la empresa que citan a `id` como su asociado (las notas), del más viejo al más nuevo.
   * Los `DESCARTADO` no cuentan: nunca existieron para ARCA.
   */
  notasQueCitan(empresa: EmpresaId, id: ComprobanteId): Promise<readonly NotaQueCita[]>;
}

const FECHA_DEL_LISTADO = sql<string>`coalesce(fecha_emision, (creado_en at time zone ${ZONA_DE_ARGENTINA})::date)`;
// `to_char(...)` y no un `date` crudo: `pg` lo devolvería como un `Date` a la medianoche local.
const FECHA_COMO_TEXTO = sql<string>`to_char(${FECHA_DEL_LISTADO}, 'YYYY-MM-DD')`.as("fecha");
const CREADO_EN_COMO_TEXTO =
  sql<string>`to_char(creado_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
    "creado_en_texto",
  );

type FilaCruda = Readonly<{
  id: string;
  tipo_comprobante: string;
  punto_de_venta_numero: number;
  numero: string | null;
  fecha: string;
  receptor_nombre: string | null;
  moneda: string;
  total: string;
  estado: string;
  ambiente: string;
  creado_en_texto: string;
}>;

function fechaDeLaBase(texto: string): FechaCivil {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new RangeError(`fecha inválida en la base: ${texto}`);
  return r.valor;
}

function aFila(f: FilaCruda): FilaDeListado {
  return {
    id: comprobanteId(f.id),
    tipo: deLaLista(TIPOS_DE_COMPROBANTE, f.tipo_comprobante, "tipo de comprobante"),
    puntoDeVentaNumero: f.punto_de_venta_numero,
    numero: f.numero === null ? null : BigInt(f.numero),
    fecha: fechaDeLaBase(f.fecha),
    receptorNombre: f.receptor_nombre,
    total: importeDesdeTexto(moneda(f.moneda), f.total),
    estado: deLaLista(ESTADOS_DE_COMPROBANTE_ARCA, f.estado, "estado de comprobante"),
    ambiente: deLaLista(AMBIENTES, f.ambiente, "ambiente"),
    creadoEn: f.creado_en_texto,
  };
}

export function crearLecturasDeComprobantes(db: Kysely<FiscalDb>): LecturasDeComprobantes {
  const resumen = () =>
    db
      .selectFrom("comprobante")
      .select([
        "id",
        "tipo_comprobante",
        "punto_de_venta_numero",
        "numero",
        FECHA_COMO_TEXTO,
        "receptor_nombre",
        "moneda",
        "total",
        "estado",
        "ambiente",
        CREADO_EN_COMO_TEXTO,
      ]);

  return {
    async listar(empresa, filtro) {
      let consulta = resumen().where("empresa_id", "=", empresa);
      consulta =
        filtro.estado === null
          ? consulta.where("estado", "<>", "DESCARTADO")
          : consulta.where("estado", "=", filtro.estado);
      if (filtro.tipo !== null) consulta = consulta.where("tipo_comprobante", "=", filtro.tipo);
      if (filtro.ambiente !== null) consulta = consulta.where("ambiente", "=", filtro.ambiente);
      if (filtro.desde !== null) {
        consulta = consulta.where(sql<boolean>`${FECHA_DEL_LISTADO} >= ${filtro.desde}::date`);
      }
      if (filtro.hasta !== null) {
        consulta = consulta.where(sql<boolean>`${FECHA_DEL_LISTADO} <= ${filtro.hasta}::date`);
      }
      if (filtro.texto !== null) {
        const { nombre, documento } = filtro.texto;
        // `position` y no `LIKE`: el texto del usuario puede traer `%`, `_` o `\` y no hay nada que escapar.
        const porNombre = sql<boolean>`position(lower(${nombre}) in lower(receptor_nombre)) > 0`;
        consulta = consulta.where((eb) =>
          documento === null
            ? porNombre
            : eb.or([porNombre, sql<boolean>`receptor_documento_numero like ${`${documento}%`}`]),
        );
      }
      if (filtro.despuesDe !== null) {
        const { creadoEn, id } = filtro.despuesDe;
        consulta = consulta.where((eb) =>
          eb.or([
            sql<boolean>`creado_en < ${creadoEn}::timestamptz`,
            eb.and([sql<boolean>`creado_en = ${creadoEn}::timestamptz`, eb("id", ">", id)]),
          ]),
        );
      }
      // Una fila de más para saber si hay otra página sin contarlas.
      const filas = await consulta
        .orderBy("creado_en", "desc")
        .orderBy("id")
        .limit(filtro.limite + 1)
        .execute();
      return {
        filas: filas.slice(0, filtro.limite).map(aFila),
        hayMas: filas.length > filtro.limite,
      };
    },

    async notasQueCitan(empresa, id) {
      const filas = await db
        .selectFrom("comprobante")
        .select([
          "id",
          "tipo_comprobante",
          "punto_de_venta_numero",
          "numero",
          FECHA_COMO_TEXTO,
          "moneda",
          "total",
          "estado",
        ])
        .where("empresa_id", "=", empresa)
        .where("comprobante_asociado_id", "=", id)
        .where("estado", "<>", "DESCARTADO")
        .orderBy("creado_en")
        .orderBy("id")
        .execute();
      return filas.map((f) => ({
        id: comprobanteId(f.id),
        tipo: deLaLista(TIPOS_DE_COMPROBANTE, f.tipo_comprobante, "tipo de comprobante"),
        puntoDeVentaNumero: f.punto_de_venta_numero,
        numero: f.numero === null ? null : BigInt(f.numero),
        fecha: fechaDeLaBase(f.fecha),
        total: importeDesdeTexto(moneda(f.moneda), f.total),
        estado: deLaLista(ESTADOS_DE_COMPROBANTE_ARCA, f.estado, "estado de comprobante"),
      }));
    },
  };
}
