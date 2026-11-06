import { sql, type Kysely } from "kysely";
import { empresaId, type EmpresaId } from "../../../primitivas/identificadores/marca";
import { TIPOS_DE_COMPROBANTE, type TipoDeComprobante } from "../dominio/comprobante-emitido";
import { AMBIENTES, type Ambiente } from "../dominio/comprobante-nuevo";
import {
  emisorId,
  puntoDeVentaId,
  solicitudId,
  type EmisorId,
  type PuntoDeVentaId,
} from "../dominio/identificadores";
import type { Serie, SerieLibre } from "../dominio/numeracion";
import { exigir, deLaLista, type ResultadoDeAlta } from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

/** Repositorio de las series de comprobantes. Salió de `repositorios.ts` al partirlo (sin cambiar una línea de lógica); las reglas comunes de los repositorios fiscales están en `repositorios.ts`. */

// =================================================================================================
// Series de comprobantes (solo persistencia: reservar, cerrar y reconciliar son casos de uso, T6)
// =================================================================================================

type FilaDeSerie = Readonly<{
  empresa_id: string;
  punto_de_venta_id: string;
  emisor_id: string;
  tipo_comprobante: string;
  ultimo_numero: string;
  estado: string;
  numero_en_curso: string | null;
  solicitud_en_curso: string | null;
  en_curso_hasta: Date | null;
  motivo_bloqueo: string | null;
  version: number;
  ambiente: string;
}>;

const COLUMNAS_DE_SERIE = [
  "empresa_id",
  "punto_de_venta_id",
  "emisor_id",
  "tipo_comprobante",
  "ultimo_numero",
  "estado",
  "numero_en_curso",
  "solicitud_en_curso",
  "en_curso_hasta",
  "motivo_bloqueo",
  "version",
  "ambiente",
] as const;

function aSerie(fila: FilaDeSerie): Serie {
  const identidad = {
    ambiente: deLaLista(AMBIENTES, fila.ambiente, "ambiente de serie"),
    empresaId: empresaId(fila.empresa_id),
    puntoDeVentaId: puntoDeVentaId(fila.punto_de_venta_id),
    emisorId: emisorId(fila.emisor_id),
    tipo: deLaLista(TIPOS_DE_COMPROBANTE, fila.tipo_comprobante, "tipo de comprobante"),
    version: fila.version,
  };
  // `bigint` llega como texto desde `pg`.
  const ultimoNumero = BigInt(fila.ultimo_numero);
  switch (fila.estado) {
    case "LIBRE":
      return { ...identidad, estado: "LIBRE", ultimoNumero };
    case "EN_CURSO":
      return {
        ...identidad,
        estado: "EN_CURSO",
        ultimoNumero,
        numeroEnCurso: BigInt(exigir(fila.numero_en_curso, "numero_en_curso")),
        solicitud: solicitudId(exigir(fila.solicitud_en_curso, "solicitud_en_curso")),
        enCursoHasta: exigir(fila.en_curso_hasta, "en_curso_hasta"),
      };
    case "BLOQUEADA":
      return {
        ...identidad,
        estado: "BLOQUEADA",
        ultimoNumero,
        motivoBloqueo: exigir(fila.motivo_bloqueo, "motivo_bloqueo"),
      };
    default:
      throw new RangeError(`estado de serie desconocido en la base: ${fila.estado}`);
  }
}

/**
 * Una serie tal como la guarda y la lee el repositorio: la del dominio, con su ambiente. Las consultas
 * (que no importan el dominio, ADR-005) la leen con este nombre.
 */
export type SerieGuardada = Serie;

export interface RepositorioDeSeries {
  /**
   * La serie de `(punto de venta, tipo, ambiente)`. El ambiente es obligatorio: quien numera dice en
   * cuál, y una lectura que cayera en «el ambiente de hoy» podría mirar la serie equivocada después de
   * un cambio de ambiente.
   */
  obtener(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
    tipo: TipoDeComprobante,
    ambiente: Ambiente,
  ): Promise<Serie | null>;
  /** Las series del punto de venta en ese ambiente (por defecto, el que tiene ahora), por tipo. */
  delPuntoDeVenta(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
    ambiente?: Ambiente,
  ): Promise<Serie[]>;
  /**
   * Crea la serie `LIBRE` de (punto de venta, tipo, `serie.ambiente`) con el último número que informó
   * el servicio de emisión (`iniciarSerie`). Una serie nace en el ambiente de su punto de venta: pedir
   * otro es `serie_ambiente_invalido` (`SERIE_AMBIENTE_INVALIDO`), error de la base. Idempotente por
   * su clave: repetir devuelve la que existe (`creado: false`) SIN pisar su último número.
   */
  crear(serie: SerieLibre): Promise<ResultadoDeAlta<Serie>>;
  /**
   * Guarda el estado que calculó el dominio (`reservarNumero`, `cerrarSerie`, `reconciliarSerie`,
   * `resincronizarSerie`) si la versión coincide; si no, `null`. La serie que se guarda es la de
   * `serie.ambiente`. Los disparadores de la base repiten las reglas de la numeración (`ultimo_numero`
   * solo sube de a uno cerrando su reserva, o saltando al salir de `BLOQUEADA`, que solo sale hacia
   * `LIBRE`): una transición que el dominio no hubiera permitido sale como error de la base.
   */
  guardar(serie: Serie): Promise<Serie | null>;
  /**
   * Las series de la empresa con una reserva vencida (`EN_CURSO` y `en_curso_hasta <= ahora`), de
   * cualquier ambiente, las más viejas primero, hasta `limite`. Es lo que la reconciliación tiene que
   * resolver.
   */
  enCursoVencidas(empresa: EmpresaId, ahora: Date, limite: number): Promise<Serie[]>;
  /**
   * ¿Alguna serie del emisor (de cualquier ambiente) tiene `ultimo_numero > 0` o no está `LIBRE`? Es el
   * contexto de `corregirCuit` (`tieneNumerosUsados`). Sirve a la plataforma: las series enteras son
   * legibles.
   */
  hayNumerosUsadosDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<boolean>;
  /** Lo mismo para las series de un punto de venta: es el contexto de `editarPuntoDeVenta`. */
  hayNumerosUsadosDelPuntoDeVenta(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
  ): Promise<boolean>;
}

export function crearRepositorioDeSeries(db: Kysely<FiscalDb>): RepositorioDeSeries {
  const seleccionar = () => db.selectFrom("serie_comprobante").select(COLUMNAS_DE_SERIE);

  /** El ambiente que el punto de venta tiene ahora, como subconsulta (para no leerlo aparte). */
  const ambienteDelPuntoDeVenta = (empresa: EmpresaId, puntoDeVenta: PuntoDeVentaId) =>
    sql<string>`(select p.ambiente from punto_de_venta p where p.id = ${puntoDeVenta} and p.empresa_id = ${empresa})`;

  async function obtener(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
    tipo: TipoDeComprobante,
    ambiente: Ambiente,
  ): Promise<Serie | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("punto_de_venta_id", "=", puntoDeVenta)
      .where("tipo_comprobante", "=", tipo)
      .where("ambiente", "=", ambiente)
      .executeTakeFirst();
    return fila === undefined ? null : aSerie(fila);
  }

  // Una serie «usada» ya no permite cambiar el CUIT del emisor ni el número del punto de venta
  // (`serieUsada` del dominio, repetido en SQL). Cuenta las de todos los ambientes: lo emitido en
  // producción no se olvida porque el punto de venta esté en homologación.
  const hayUsadas = async (
    cual: { empresa: EmpresaId } & ({ emisor: EmisorId } | { puntoDeVenta: PuntoDeVentaId }),
  ) => {
    let consulta = db
      .selectFrom("serie_comprobante")
      .select("tipo_comprobante")
      .where("empresa_id", "=", cual.empresa)
      .where(sql<boolean>`(ultimo_numero > 0 or estado <> 'LIBRE')`)
      .limit(1);
    consulta =
      "emisor" in cual
        ? consulta.where("emisor_id", "=", cual.emisor)
        : consulta.where("punto_de_venta_id", "=", cual.puntoDeVenta);
    return (await consulta.executeTakeFirst()) !== undefined;
  };

  return {
    obtener,

    async delPuntoDeVenta(empresa, puntoDeVenta, ambiente) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("punto_de_venta_id", "=", puntoDeVenta)
        .where("ambiente", "=", ambiente ?? ambienteDelPuntoDeVenta(empresa, puntoDeVenta))
        .orderBy("tipo_comprobante")
        .execute();
      return filas.map(aSerie);
    },

    async crear(serie) {
      // Si el punto de venta no existe (o no es de esta empresa) la base lo rechaza con la clave foránea.
      // Antes de insertar: el disparador de alta mira el ambiente ANTES de que `ON CONFLICT` descubra que la
      // serie ya existe, así que repetir el alta de una serie de otro ambiente (por ejemplo, la de homologación
      // con el punto de venta ya en producción) fallaría en vez de ser «ya estaba».
      const yaExistia = await obtener(
        serie.empresaId,
        serie.puntoDeVentaId,
        serie.tipo,
        serie.ambiente,
      );
      if (yaExistia !== null) return { creado: false, valor: yaExistia };
      const nueva = await db
        .insertInto("serie_comprobante")
        .values({
          empresa_id: serie.empresaId,
          punto_de_venta_id: serie.puntoDeVentaId,
          emisor_id: serie.emisorId,
          tipo_comprobante: serie.tipo,
          ultimo_numero: serie.ultimoNumero.toString(),
          ambiente: serie.ambiente,
        })
        .onConflict((oc) =>
          oc
            .columns(["empresa_id", "punto_de_venta_id", "tipo_comprobante", "ambiente"])
            .doNothing(),
        )
        .returning(COLUMNAS_DE_SERIE)
        .executeTakeFirst();
      if (nueva !== undefined) return { creado: true, valor: aSerie(nueva) };
      const existente = await obtener(
        serie.empresaId,
        serie.puntoDeVentaId,
        serie.tipo,
        serie.ambiente,
      );
      if (existente === null) throw new Error("el alta de la serie no insertó y tampoco existe");
      return { creado: false, valor: existente };
    },

    async guardar(serie) {
      const enCurso = serie.estado === "EN_CURSO" ? serie : null;
      const actualizada = await db
        .updateTable("serie_comprobante")
        .set({
          estado: serie.estado,
          ultimo_numero: serie.ultimoNumero.toString(),
          numero_en_curso: enCurso === null ? null : enCurso.numeroEnCurso.toString(),
          solicitud_en_curso: enCurso === null ? null : enCurso.solicitud,
          en_curso_hasta: enCurso === null ? null : enCurso.enCursoHasta,
          motivo_bloqueo: serie.estado === "BLOQUEADA" ? serie.motivoBloqueo : null,
        })
        .where("empresa_id", "=", serie.empresaId)
        .where("punto_de_venta_id", "=", serie.puntoDeVentaId)
        .where("tipo_comprobante", "=", serie.tipo)
        .where("ambiente", "=", serie.ambiente)
        .where("version", "=", serie.version)
        .returning(COLUMNAS_DE_SERIE)
        .executeTakeFirst();
      return actualizada === undefined ? null : aSerie(actualizada);
    },

    async enCursoVencidas(empresa, ahora, limite) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "EN_CURSO")
        .where("en_curso_hasta", "<=", ahora)
        .orderBy("en_curso_hasta")
        .orderBy("punto_de_venta_id")
        .orderBy("tipo_comprobante")
        .orderBy("ambiente")
        .limit(limite)
        .execute();
      return filas.map(aSerie);
    },

    hayNumerosUsadosDelEmisor: (empresa, emisor) => hayUsadas({ empresa, emisor }),
    hayNumerosUsadosDelPuntoDeVenta: (empresa, puntoDeVenta) =>
      hayUsadas({ empresa, puntoDeVenta }),
  };
}
