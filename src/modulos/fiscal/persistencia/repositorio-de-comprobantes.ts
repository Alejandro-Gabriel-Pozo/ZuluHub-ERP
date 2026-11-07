import { sql, type Kysely } from "kysely";
import { cantidadATexto } from "../../../primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../../primitivas/cantidad/porcentaje";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { precioUnitarioATexto } from "../../../primitivas/dinero/precio-unitario";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import { type EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok } from "../../../primitivas/resultado/resultado";
import { TIPOS_DE_COMPROBANTE, claseDeComprobante } from "../dominio/comprobante-emitido";
import { comprobanteId, type ComprobanteId } from "../dominio/identificadores";
import { type FilaDeComprobante } from "./fila-de-comprobante";
import { deLaLista, exigir } from "./ayudas-de-repositorio";
import type { FiscalDb } from "./tablas";

import {
  COLUMNAS_DE_COMPROBANTE,
  aComprobante,
  aFechaOpcional,
  fechaDeLaBase,
  valoresDelComprobante,
} from "./mapeo-de-comprobantes";
import type {
  AltaDeComprobante,
  AsociadoGuardado,
  ComprobanteGuardado,
  RepositorioDeComprobantes,
} from "./tipos-de-comprobantes";

export type {
  AltaDeComprobante,
  AsociadoGuardado,
  CambioDeComprobante,
  ComprobanteGuardado,
  DatosFiscalesDeLaFoto,
  EmisorCongelado,
  ErrorDeAltaDeComprobante,
  ImportesGuardados,
  RenglonGuardado,
  RepositorioDeComprobantes,
  ResueltoPor,
} from "./tipos-de-comprobantes";

/**
 * Repositorio de comprobantes (spec H7 facturación §B.8, tramo F3): el comprobante fiscal con sus
 * renglones y su desglose por alícuota. Mismas reglas que los demás repositorios fiscales:
 *
 *  - Todo filtra por empresa aunque la RLS ya lo imponga.
 *  - El alta es idempotente y entera: el comprobante, sus renglones y su desglose entran juntos en la
 *    transacción de quien llama (la base comprueba al confirmar que suman, `comprobante_cuadra`). Repetir
 *    el alta de lo mismo devuelve el comprobante que ya existe (`creado: false`) sin escribir un renglón
 *    más; es el caso de uso quien compara la `huella` y decide si lo repetido es lo mismo.
 *  - El contenido no se modifica nunca (ni el dueño de la base puede): solo avanza el estado, con
 *    `transicionar`, que es `UPDATE ... WHERE version = <la que se leyó>` y devuelve el comprobante nuevo o
 *    `null` si no lo tocó (otra transacción cambió antes, o no es de la empresa).
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones las traduce
 *    a `ErrorDePersistencia` (la traducción a motivos de negocio está en `traducir.ts`).
 *  - Dinero y cantidades viajan como `Importe`, `Cantidad` y `PrecioUnitario` del dominio y se escriben y
 *    leen como texto decimal (`numeric` exacto): nunca pasan por `number`.
 */

// =================================================================================================
// El repositorio
// =================================================================================================

export function crearRepositorioDeComprobantes(db: Kysely<FiscalDb>): RepositorioDeComprobantes {
  const seleccionar = () => db.selectFrom("comprobante").select(COLUMNAS_DE_COMPROBANTE);

  async function armar(fila: FilaDeComprobante): Promise<ComprobanteGuardado> {
    // Una consulta por vez: la conexión de la transacción es una sola (`pg` ya no admite pedir otra mientras corre una).
    const renglones = await db
      .selectFrom("comprobante_linea")
      .select([
        "posicion",
        "descripcion",
        "cantidad",
        "precio_unitario",
        "descuento",
        "alicuota",
        "importe",
      ])
      .where("empresa_id", "=", fila.empresa_id)
      .where("comprobante_id", "=", fila.id)
      .orderBy("posicion")
      .execute();
    const desglose = await db
      .selectFrom("comprobante_alicuota")
      .select(["alicuota", "total", "neto", "iva"])
      .where("empresa_id", "=", fila.empresa_id)
      .where("comprobante_id", "=", fila.id)
      .execute();
    const asociado =
      fila.comprobante_asociado_id === null
        ? null
        : await db
            .selectFrom("comprobante")
            .select([
              "id",
              "tipo_comprobante",
              "punto_de_venta_numero",
              "emisor_cuit",
              "numero",
              aFechaOpcional("fecha_emision"),
            ])
            .where("empresa_id", "=", fila.empresa_id)
            .where("id", "=", fila.comprobante_asociado_id)
            .executeTakeFirst();
    let aso: AsociadoGuardado | null = null;
    if (fila.comprobante_asociado_id !== null) {
      // La base garantiza que el asociado existe y está `AUTORIZADO` (con número y fecha).
      if (asociado === null || asociado === undefined) {
        throw new RangeError("el comprobante asociado no se pudo leer");
      }
      aso = {
        id: comprobanteId(asociado.id),
        tipo: deLaLista(TIPOS_DE_COMPROBANTE, asociado.tipo_comprobante, "tipo de comprobante"),
        puntoDeVenta: asociado.punto_de_venta_numero,
        numero: BigInt(exigir(asociado.numero, "numero del asociado")),
        cuit: asociado.emisor_cuit as Cuit,
        fecha: fechaDeLaBase(
          exigir(asociado.fecha_emision, "fecha del asociado"),
          "fecha del asociado",
        ),
      };
    }
    return aComprobante(fila, renglones, desglose, aso);
  }

  async function obtener(
    empresa: EmpresaId,
    id: ComprobanteId,
  ): Promise<ComprobanteGuardado | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : armar(fila);
  }

  /** El comprobante que ya existe para esta alta (ver `crear`), o `null` si no hay ninguno visible. */
  async function existenteDe(
    alta: AltaDeComprobante,
  ): Promise<ComprobanteGuardado | "ID_EN_USO" | null> {
    const c = alta.contenido;
    const clase = claseDeComprobante(c.tipo);
    const porId = await obtener(c.empresaId, alta.id);
    if (porId !== null) {
      const mismaIdentidad =
        porId.origen.tipo === c.origen.tipo &&
        porId.origen.id === c.origen.id &&
        porId.emisorId === c.emisorId &&
        porId.clase === clase;
      return mismaIdentidad ? porId : "ID_EN_USO";
    }
    const porOrigen = seleccionar()
      .where("empresa_id", "=", c.empresaId)
      .where("origen_id", "=", c.origen.id);
    const fila =
      c.origen.tipo === "MANUAL"
        ? await porOrigen.where("origen_tipo", "=", "MANUAL").executeTakeFirst()
        : await porOrigen
            .where("origen_tipo", "=", c.origen.tipo)
            .where("emisor_id", "=", c.emisorId)
            .where("clase", "=", clase)
            .where("estado", "not in", ["RECHAZADO", "DESCARTADO"])
            .executeTakeFirst();
    return fila === undefined ? null : armar(fila);
  }

  return {
    obtener,

    async delOrigen(empresa, origenTipo, origen) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("origen_tipo", "=", origenTipo)
        .where("origen_id", "=", origen)
        .orderBy("creado_en", "desc")
        .orderBy("id")
        .execute();
      const armados: ComprobanteGuardado[] = [];
      for (const fila of filas) armados.push(await armar(fila));
      return armados;
    },

    async crear(alta) {
      const c = alta.contenido;
      const valores = valoresDelComprobante(alta);
      // Sin objetivo de conflicto: el `id`, la identidad vigente y la clave manual son únicas distintas y
      // cualquiera de las tres significa «ya estaba»; abajo se busca cuál. Por eso no hace falta serializar las
      // altas (como en los otros repositorios, que absorben solo el conflicto del `id`): la perdedora de la carrera
      // espera a que la ganadora confirme, no inserta y la encuentra (bajo SERIALIZABLE, además, el adaptador
      // repite el trabajo ante el 40001). Lo comprueba `facturacion-persistencia-concurrencia.test.ts`.
      const nuevo = await db
        .insertInto("comprobante")
        .values(valores)
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (nuevo === undefined) {
        const existente = await existenteDe(alta);
        if (existente === null || existente === "ID_EN_USO") return err("ID_EN_USO");
        return ok({ creado: false, valor: existente });
      }
      await db
        .insertInto("comprobante_linea")
        .values(
          c.renglones.map((r, i) => ({
            empresa_id: c.empresaId,
            comprobante_id: alta.id,
            posicion: i + 1,
            descripcion: r.descripcion,
            cantidad: cantidadATexto(r.cantidad),
            precio_unitario: precioUnitarioATexto(r.precioUnitario),
            descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
            alicuota: r.alicuota,
            importe: importeATexto(r.importe),
          })),
        )
        .execute();
      if (c.desglose.length > 0) {
        await db
          .insertInto("comprobante_alicuota")
          .values(
            c.desglose.map((d) => ({
              empresa_id: c.empresaId,
              comprobante_id: alta.id,
              alicuota: d.alicuota,
              total: importeATexto(d.total),
              neto: importeATexto(d.neto),
              iva: importeATexto(d.iva),
            })),
          )
          .execute();
      }
      const guardado = await obtener(c.empresaId, alta.id);
      if (guardado === null) throw new Error("el comprobante recién creado no se pudo leer");
      return ok({ creado: true, valor: guardado });
    },

    async transicionar(empresa, id, versionEsperada, cambio) {
      const cambios = (() => {
        switch (cambio.a) {
          case "EN_VALIDACION":
            return {
              estado: cambio.a,
              envios: sql<number>`envios + 1`,
              numero_reservado: cambio.numeroReservado.toString(),
              fecha_emision: cambio.fechaEmision,
            };
          case "AUTORIZADO":
            return {
              estado: cambio.a,
              // El número autorizado es el reservado: lo copia la base, no se elige.
              numero: sql<string>`numero_reservado`,
              cae: cambio.cae,
              cae_vence: cambio.caeVence,
              autorizado_en: cambio.autorizadoEn,
              resuelto_por: cambio.resueltoPor,
            };
          case "PENDIENTE":
            return { estado: cambio.a, numero_reservado: null, fecha_emision: null };
          case "DESCARTADO":
            return { estado: cambio.a, motivo_descarte: cambio.motivo };
          case "RECHAZADO":
          case "INCIERTO":
          case "CONFLICTO":
            return { estado: cambio.a };
        }
      })();
      const actualizado = await db
        .updateTable("comprobante")
        .set(cambios)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("version", "=", versionEsperada)
        .returning("id")
        .executeTakeFirst();
      return actualizado === undefined ? null : obtener(empresa, id);
    },

    async enVueloVencidos(empresa, ahora, limite) {
      const ids = await db
        .selectFrom("comprobante")
        .innerJoin("serie_comprobante", (unir) =>
          unir
            .onRef("serie_comprobante.empresa_id", "=", "comprobante.empresa_id")
            .onRef("serie_comprobante.punto_de_venta_id", "=", "comprobante.punto_de_venta_id")
            .onRef("serie_comprobante.tipo_comprobante", "=", "comprobante.tipo_comprobante")
            .onRef("serie_comprobante.ambiente", "=", "comprobante.ambiente"),
        )
        .select("comprobante.id")
        .where("comprobante.empresa_id", "=", empresa)
        .where("comprobante.estado", "in", ["EN_VALIDACION", "INCIERTO"])
        .where("serie_comprobante.estado", "=", "EN_CURSO")
        .where("serie_comprobante.en_curso_hasta", "<=", ahora)
        .orderBy("serie_comprobante.en_curso_hasta")
        .orderBy("comprobante.id")
        .limit(limite)
        .execute();
      const encontrados: ComprobanteGuardado[] = [];
      for (const f of ids) {
        const c = await obtener(empresa, comprobanteId(f.id));
        if (c !== null) encontrados.push(c);
      }
      return encontrados;
    },

    async pendientes(empresa, filtro, limite) {
      let consulta = db
        .selectFrom("comprobante")
        .select("id")
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "PENDIENTE");
      if (filtro.serie !== undefined) {
        consulta = consulta
          .where("punto_de_venta_id", "=", filtro.serie.puntoDeVentaId)
          .where("tipo_comprobante", "=", filtro.serie.tipo)
          .where("ambiente", "=", filtro.serie.ambiente);
      }
      if (filtro.creadosAntesDe !== undefined) {
        consulta = consulta.where("creado_en", "<", filtro.creadosAntesDe);
      }
      const filas = await consulta.orderBy("creado_en").orderBy("id").limit(limite).execute();
      return filas.map((f) => comprobanteId(f.id));
    },
  };
}
