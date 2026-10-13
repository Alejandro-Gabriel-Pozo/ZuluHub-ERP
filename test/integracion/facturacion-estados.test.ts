import { randomUUID } from "node:crypto";
import fc from "fast-check";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  ESTADOS_DE_COMPROBANTE_ARCA,
  TRANSICIONES_DE_COMPROBANTE,
  type EstadoDeComprobanteArca,
} from "../../src/modulos/fiscal/dominio/estados-de-comprobante";
import { armarComprobanteNuevo, type ComprobanteNuevo } from "../../src/modulos/fiscal/dominio/comprobante-nuevo";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { importesParaArca } from "../../src/modulos/fiscal/dominio/importes-para-arca";
import { importeATexto } from "../../src/primitivas/dinero/importe";
import { cantidadATexto } from "../../src/primitivas/cantidad/cantidad";
import { porcentajeATexto } from "../../src/primitivas/cantidad/porcentaje";
import { precioUnitarioATexto } from "../../src/primitivas/dinero/precio-unitario";
import { contextoDeEmision, consumidorFinal, emisorInstantaneo, entradaDeFactura, receptorInscripto, renglonArbitrario } from "../utilidades/facturacion";
import "../propiedades/configuracion";
import {
  acepta,
  check,
  clave,
  conAppDe,
  crearSerie,
  denegado,
  sinConfirmar,
  usarSerie,
} from "./fiscal-apoyo";
import {
  asegurarSerie,
  cerrarSerie,
  confirmarDueno,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  entrarEnValidacion,
  insertarComprobante,
  leerComprobante,
  leerSerie,
  marcarAutorizado,
  marcarEstado,
  reservarSerie,
  serieDe,
  viaDueno,
  viaDuenoDirecto,
  viaSesion,
  volverAPendiente,
  type Contenido,
  type Ejecutor,
  type Escenario,
} from "./facturacion-apoyo";
import type { Intento } from "./sesiones";

/**
 * Facturación F2: el ciclo del comprobante frente a ARCA que la base impone (§B.2 y §B.8.4), su coherencia con
 * la serie de numeración, el ambiente, y que la base acepta todo lo que el dominio puro arma.
 *  1. Máquina de estados: los 42 pares de estados contra `TRANSICIONES_DE_COMPROBANTE`, los datos de cada
 *     transición y la inmutabilidad del contenido (también para el dueño).
 *  2. Coherencia con la serie (restricciones diferidas, en los dos sentidos) y los caminos del trabajo de
 *     validación: autoriza, rechaza, queda incierto, se reconcilia, entra en conflicto y se resincroniza.
 *  3. Ambiente: la clave de la serie, el cambio de ambiente del punto de venta y la salida de BLOQUEADA.
 *  4. Base = dominio: todo lo que `armarComprobanteNuevo` produce, la base lo acepta y lo cuadra.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const ESTADOS = ESTADOS_DE_COMPROBANTE_ARCA;

describe.skipIf(base === null)("facturación: estados, serie y ambiente contra una base real", () => {
  let dueno: pg.Client;
  let e: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
  });
  afterAll(async () => {
    await dueno.end();
  });

  const intento = viaDueno;
  const deshacible = <T>(trabajo: () => Promise<T>) => sinConfirmar(dueno, trabajo);

  /** Una transacción del dueño: el cuerpo tiene que salir bien; el resultado es el de la CONFIRMACIÓN. */
  const transaccion = async (cuerpo: (ej: Ejecutor) => Promise<void>): Promise<Intento> => {
    await dueno.query("begin");
    try {
      await cuerpo(intento(dueno));
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
    return confirmarDueno(dueno);
  };

  /** Lleva un comprobante PENDIENTE a ese estado por el camino legal (en la transacción del dueño). */
  const llevarA = async (ej: Ejecutor, id: string, estado: EstadoDeComprobanteArca) => {
    switch (estado) {
      case "PENDIENTE":
        return;
      case "DESCARTADO":
        acepta(await ej("update comprobante set estado = 'DESCARTADO', motivo_descarte = 'prueba' where id = $1", [id]));
        return;
      default:
        acepta(await entrarEnValidacion(ej, id, "1"));
        if (estado === "AUTORIZADO") acepta(await marcarAutorizado(ej, id));
        else if (estado !== "EN_VALIDACION") acepta(await marcarEstado(ej, id, estado));
    }
  };

  /** El UPDATE completo y válido que lleva un comprobante hacia ese estado. */
  const haciaEstado = (id: string, a: EstadoDeComprobanteArca, de: EstadoDeComprobanteArca) => {
    const por = de === "INCIERTO" ? "RECONCILIACION" : "RESPUESTA";
    const set: Record<EstadoDeComprobanteArca, string> = {
      PENDIENTE: "estado = 'PENDIENTE', numero_reservado = null, fecha_emision = null",
      EN_VALIDACION:
        "estado = 'EN_VALIDACION', envios = envios + 1, numero_reservado = 1, fecha_emision = current_date",
      AUTORIZADO: `estado = 'AUTORIZADO', numero = numero_reservado, cae = '12345678901234',
                   cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = '${por}'`,
      DESCARTADO: "estado = 'DESCARTADO', motivo_descarte = 'prueba'",
      RECHAZADO: "estado = 'RECHAZADO'",
      INCIERTO: "estado = 'INCIERTO'",
      CONFLICTO: "estado = 'CONFLICTO'",
    };
    return { texto: `update comprobante set ${set[a]} where id = $1`, parametros: [id] };
  };

  // ===============================================================================================
  // 1. Máquina de estados
  // ===============================================================================================
  describe("máquina de estados", () => {
    it("la base permite exactamente las transiciones del dominio: los 42 pares de estados distintos", async () => {
      const aceptadas = new Set<string>();
      let rechazadas = 0;
      for (const de of ESTADOS) {
        await deshacible(async () => {
          const datos = datosDeComprobante(e);
          acepta(await insertarComprobante(intento(dueno), datos));
          const id = datos["id"] as string;
          await llevarA(intento(dueno), id, de);
          expect((await leerComprobante(dueno, id))?.["estado"]).toBe(de);
          for (const a of ESTADOS) {
            if (a === de) continue;
            await dueno.query("savepoint candidato");
            const u = haciaEstado(id, a, de);
            const r = await intento(dueno)(u.texto, u.parametros);
            const permitida = TRANSICIONES_DE_COMPROBANTE[de].includes(a);
            expect(r.ok, `${de} → ${a}`).toBe(permitida);
            if (!r.ok) {
              // Una transición que no existe la rechaza el disparador con su nombre, no un CHECK cualquiera.
              expect(r.codigo, `${de} → ${a}: ${r.mensaje}`).toBe("23514");
              expect(r.restriccion, `${de} → ${a}`).toBe("comprobante_transicion_invalida");
              rechazadas += 1;
            } else {
              aceptadas.add(`${de}→${a}`);
            }
            await dueno.query("rollback to savepoint candidato");
          }
        });
      }
      expect(rechazadas).toBe(42 - 12);
      const esperadas = ESTADOS.flatMap((de) => TRANSICIONES_DE_COMPROBANTE[de].map((a) => `${de}→${a}`));
      expect([...aceptadas].sort()).toEqual(esperadas.sort());
      expect(esperadas).toHaveLength(12);
    });

    it("AUTORIZADO, RECHAZADO y DESCARTADO no salen; quedarse en el mismo estado sin cambiar nada es inofensivo, y con un cambio se rechaza", async () => {
      for (const estado of ESTADOS) {
        await deshacible(async () => {
          const datos = datosDeComprobante(e);
          acepta(await insertarComprobante(intento(dueno), datos));
          const id = datos["id"] as string;
          await llevarA(intento(dueno), id, estado);
          acepta(await intento(dueno)("update comprobante set estado = estado where id = $1", [id]));
          check(
            await intento(dueno)("update comprobante set envios = envios + 1 where id = $1", [id]),
            "comprobante_transicion_invalida",
          );
          if (estado === "AUTORIZADO") {
            check(
              await intento(dueno)("update comprobante set cae = '99999999999999' where id = $1", [id]),
              "comprobante_transicion_invalida",
            );
          }
        });
      }
    });

    it.each<[string, EstadoDeComprobanteArca, string]>([
      [
        "entrar a EN_VALIDACION sin sumar el envío",
        "PENDIENTE",
        "update comprobante set estado = 'EN_VALIDACION', numero_reservado = 1, fecha_emision = current_date where id = $1",
      ],
      [
        "entrar a EN_VALIDACION sumando dos envíos",
        "PENDIENTE",
        "update comprobante set estado = 'EN_VALIDACION', envios = envios + 2, numero_reservado = 1, fecha_emision = current_date where id = $1",
      ],
      [
        "descartar un PENDIENTE poniéndole número",
        "PENDIENTE",
        "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x', numero_reservado = 1, fecha_emision = current_date where id = $1",
      ],
      [
        "volver a PENDIENTE sumando un envío",
        "EN_VALIDACION",
        "update comprobante set estado = 'PENDIENTE', envios = envios + 1, numero_reservado = null, fecha_emision = null where id = $1",
      ],
      [
        "rechazar cambiando el número reservado",
        "EN_VALIDACION",
        "update comprobante set estado = 'RECHAZADO', numero_reservado = 2 where id = $1",
      ],
      [
        "quedar incierto cambiando la fecha",
        "EN_VALIDACION",
        "update comprobante set estado = 'INCIERTO', fecha_emision = fecha_emision + 1 where id = $1",
      ],
      [
        "descartar un CONFLICTO cambiando el número disputado",
        "CONFLICTO",
        "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x', numero_reservado = 9 where id = $1",
      ],
      [
        "autorizar un INCIERTO con una respuesta del pedido original (solo se reconcilia)",
        "INCIERTO",
        "update comprobante set estado = 'AUTORIZADO', numero = numero_reservado, cae = '12345678901234', cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'RESPUESTA' where id = $1",
      ],
    ])("una transición válida con datos que no corresponden se rechaza: %s", async (_n, desde, sentencia) => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos));
        const id = datos["id"] as string;
        await llevarA(intento(dueno), id, desde);
        check(await intento(dueno)(sentencia, [id]), "comprobante_transicion_invalida");
      });
    });

    it.each<[string, string, string]>([
      [
        "autorizar con un número distinto del reservado",
        "estado = 'AUTORIZADO', numero = 2, cae = '12345678901234', cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar con un CAE de 13 dígitos",
        "estado = 'AUTORIZADO', numero = 1, cae = '1234567890123', cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar con un CAE con letras",
        "estado = 'AUTORIZADO', numero = 1, cae = '1234567890123A', cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar sin CAE (la comparación con NULL del CHECK de la especificación lo dejaba pasar)",
        "estado = 'AUTORIZADO', numero = 1, cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar sin vencimiento del CAE",
        "estado = 'AUTORIZADO', numero = 1, cae = '12345678901234', autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar sin instante",
        "estado = 'AUTORIZADO', numero = 1, cae = '12345678901234', cae_vence = fecha_emision + 10, resuelto_por = 'RESPUESTA'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar sin decir cómo se resolvió",
        "estado = 'AUTORIZADO', numero = 1, cae = '12345678901234', cae_vence = fecha_emision + 10, autorizado_en = now()",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar con un modo de resolución que no existe",
        "estado = 'AUTORIZADO', numero = 1, cae = '12345678901234', cae_vence = fecha_emision + 10, autorizado_en = now(), resuelto_por = 'A MANO'",
        "comprobante_autorizado_ck",
      ],
      [
        "autorizar con un CAE que vence antes de la fecha del comprobante",
        "estado = 'AUTORIZADO', numero = 1, cae = '12345678901234', cae_vence = fecha_emision - 1, autorizado_en = now(), resuelto_por = 'RESPUESTA'",
        "comprobante_cae_vence_ck",
      ],
      ["quedar RECHAZADO con un CAE", "estado = 'RECHAZADO', cae = '12345678901234'", "comprobante_autorizado_ck"],
      ["rechazar sin número reservado", "estado = 'RECHAZADO', numero_reservado = null, fecha_emision = null", "comprobante_transicion_invalida"],
    ])("desde EN_VALIDACION: %s se rechaza", async (_n, set, restriccion) => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos));
        const id = datos["id"] as string;
        await llevarA(intento(dueno), id, "EN_VALIDACION");
        check(await intento(dueno)(`update comprobante set ${set} where id = $1`, [id]), restriccion);
      });
    });

    it.each<[string, string]>([
      ["sin motivo", "estado = 'DESCARTADO'"],
      ["con un motivo en blanco", "estado = 'DESCARTADO', motivo_descarte = '   '"],
      ["con un motivo de 501 caracteres", `estado = 'DESCARTADO', motivo_descarte = '${"x".repeat(501)}'`],
    ])("descartar %s se rechaza", async (_n, set) => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos));
        check(
          await intento(dueno)(`update comprobante set ${set} where id = $1`, [datos["id"]]),
          "comprobante_descarte_ck",
        );
      });
    });

    it("un motivo de descarte fuera de un DESCARTADO no entra (descarte_ck)", async () => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos));
        const id = datos["id"] as string;
        await llevarA(intento(dueno), id, "EN_VALIDACION");
        check(
          await intento(dueno)("update comprobante set estado = 'RECHAZADO', motivo_descarte = 'x' where id = $1", [id]),
          "comprobante_descarte_ck",
        );
      });
    });

    it("el contenido no cambia nunca, en ningún estado, ni para el dueño de la base: cada columna que no es de estado", async () => {
      const columnas = await dueno.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'comprobante' order by ordinal_position`,
      );
      const DE_ESTADO = [
        "estado",
        "envios",
        "numero_reservado",
        "fecha_emision",
        "numero",
        "cae",
        "cae_vence",
        "autorizado_en",
        "resuelto_por",
        "motivo_descarte",
        "actualizado_en",
        "version",
      ];
      const contenido = columnas.rows.filter((c) => !DE_ESTADO.includes(c.column_name));
      // Una columna nueva tiene que decidir a propósito de qué lado está: este número cambia con ella.
      expect(contenido).toHaveLength(42);
      const otroValor = (c: { column_name: string; data_type: string }): string => {
        const n = c.column_name;
        switch (c.data_type) {
          case "uuid":
            return "gen_random_uuid()";
          case "numeric":
          case "integer":
          case "smallint":
          case "bigint":
            return `coalesce(${n}, 0) + 1`;
          case "date":
            return `coalesce(${n}, current_date) + 1`;
          case "timestamp with time zone":
            return `coalesce(${n}, now()) + interval '1 day'`;
          case "character":
            return "'XXX'";
          default:
            return `coalesce(${n}, '') || 'x'`;
        }
      };
      for (const estado of ["PENDIENTE", "AUTORIZADO"] as const) {
        await deshacible(async () => {
          const datos = datosDeComprobante(e);
          acepta(await insertarComprobante(intento(dueno), datos));
          const id = datos["id"] as string;
          await llevarA(intento(dueno), id, estado);
          for (const c of contenido) {
            check(
              await intento(dueno)(`update comprobante set ${c.column_name} = ${otroValor(c)} where id = $1`, [id]),
              "comprobante_inmutable",
            );
          }
        });
      }
    });

    it("la aplicación no puede escribir el contenido (42501 por columna), ni crear un comprobante con estado, envíos, número o CAE, ni borrar", async () => {
      const id = await crearComprobante(dueno, e);
      await conAppDe(base!, e, async (s) => {
        for (const col of [
          "total",
          "iva",
          "neto_gravado",
          "exento",
          "no_gravado",
          "moneda",
          "tipo_comprobante",
          "receptor_nombre",
          "receptor_documento_numero",
          "receptor_condicion_iva",
          "emisor_cuit",
          "emisor_razon_social",
          "punto_de_venta_numero",
          "ambiente",
          "origen_id",
          "huella",
          "creado_por",
          "creado_en",
          "version",
          "comprobante_asociado_id",
        ]) {
          denegado(await s.intentar(`update comprobante set ${col} = ${col} where id = $1`, [id]));
        }
        denegado(await s.intentar("delete from comprobante where id = $1", [id]));
        denegado(await s.intentar("truncate comprobante"));
        // Crear: ni elige el estado ni los datos que fija el trabajo.
        for (const col of ["estado", "envios", "numero_reservado", "fecha_emision", "numero", "cae", "cae_vence", "autorizado_en", "resuelto_por", "motivo_descarte", "creado_en", "actualizado_en", "version"]) {
          const datos = datosDeComprobante(e, { [col]: null });
          const columnas = Object.keys(datos);
          denegado(
            await s.intentar(
              `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
              columnas.map((c) => datos[c]),
            ),
          );
        }
        // Lo que sí mueve el trabajo (sin persona) es el estado.
        acepta(await s.intentar("update comprobante set envios = envios where id = $1", [id]));
      });
    });

    it("el trabajo de sistema (sin persona en el contexto) mueve el estado, y no puede crear (creado_por exige una persona)", async () => {
      const id = await crearComprobante(dueno, e);
      await conAppDe(
        base!,
        e,
        async (s) => {
          // Entrar a validación con el trabajo de sistema: la base no pide persona para los estados.
          acepta(
            await s.intentar(
              "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'lo descartó el sistema' where id = $1",
              [id],
            ),
          );
          const datos = datosDeComprobante(e);
          const r = await insertarComprobante(viaSesion(s), datos);
          expect(r.ok).toBe(false);
        },
        null,
      );
    });
  });

  // ===============================================================================================
  // 2. Coherencia con la serie y el camino del trabajo de validación
  // ===============================================================================================
  describe("coherencia con la serie de numeración", () => {
    /** Un escenario nuevo con su comprobante PENDIENTE ya creado. */
    const nuevo = async (cambios: Contenido = {}) => {
      const x = await crearEscenario(dueno);
      const id = await crearComprobante(dueno, x, cambios);
      return { x, id, serie: serieDe(x) };
    };
    /** TXa del trabajo: asegura la serie, la reserva con la solicitud del comprobante y entra a validación. */
    const reservarYValidar = async (ej: Ejecutor, serie: ReturnType<typeof serieDe>, id: string, ultimo = 0) => {
      acepta(await asegurarSerie(ej, serie, ultimo));
      const r = await reservarSerie(ej, serie, id);
      acepta(r);
      const numero = r.ok ? (r.rows[0]?.["numero"] as string) : "";
      acepta(await entrarEnValidacion(ej, id, numero));
      return numero;
    };

    it("el camino feliz: reserva y validación, después autorización y cierre; los números salen 1, 2, 3 sin huecos", async () => {
      const { x, id: primero, serie } = await nuevo();
      const ids = [primero, await crearComprobante(dueno, x), await crearComprobante(dueno, x)];
      for (const [i, id] of ids.entries()) {
        const n = i + 1;
        acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
        expect((await leerComprobante(dueno, id))?.["estado"]).toBe("EN_VALIDACION");
        expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "EN_CURSO", en_curso: String(n), solicitud: id });
        acepta(
          await transaccion(async (ej) => {
            acepta(await marcarAutorizado(ej, id));
            acepta(await cerrarSerie(ej, serie, true));
          }),
        );
        expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "AUTORIZADO", numero: String(n), resuelto_por: "RESPUESTA" });
        expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: String(n) });
      }
    });

    it("un comprobante que pasa por dos estados en la misma transacción se verifica con su estado FINAL, no con el del primer evento", async () => {
      const { serie, id } = await nuevo();
      acepta(
        await transaccion(async (ej) => {
          await reservarYValidar(ej, serie, id);
          acepta(await marcarAutorizado(ej, id));
          acepta(await cerrarSerie(ej, serie, true));
        }),
      );
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "AUTORIZADO", numero: "1" });
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
    });

    it("EN_VALIDACION sin que la serie tenga SU reserva se rechaza al confirmar (comprobante_sin_reserva)", async () => {
      // Sin ninguna serie.
      const sinSerie = await nuevo();
      check(
        await transaccion(async (ej) => acepta(await entrarEnValidacion(ej, sinSerie.id, "1"))),
        "comprobante_sin_reserva",
      );
      // Con la serie LIBRE (nadie la reservó).
      const libre = await nuevo();
      acepta(await asegurarSerie(viaDuenoDirecto(dueno), libre.serie));
      check(
        await transaccion(async (ej) => acepta(await entrarEnValidacion(ej, libre.id, "1"))),
        "comprobante_sin_reserva",
      );
      // Con la serie reservada por OTRA solicitud.
      const deOtro = await nuevo();
      acepta(await asegurarSerie(viaDuenoDirecto(dueno), deOtro.serie));
      acepta(await reservarSerie(viaDuenoDirecto(dueno), deOtro.serie, randomUUID()));
      check(
        await transaccion(async (ej) => acepta(await entrarEnValidacion(ej, deOtro.id, "1"))),
        "comprobante_sin_reserva",
      );
      // Con su reserva pero declarando otro número que el reservado.
      const otroNumero = await nuevo();
      check(
        await transaccion(async (ej) => {
          acepta(await asegurarSerie(ej, otroNumero.serie));
          acepta(await reservarSerie(ej, otroNumero.serie, otroNumero.id));
          acepta(await entrarEnValidacion(ej, otroNumero.id, "2"));
        }),
        "comprobante_sin_reserva",
      );
      // De otro tipo de comprobante: la serie de FACTURA_A no es la de una FACTURA_B.
      const otroTipo = await nuevo();
      check(
        await transaccion(async (ej) => {
          const otraSerie = serieDe(otroTipo.x, "FACTURA_A");
          acepta(await asegurarSerie(ej, otraSerie));
          acepta(await reservarSerie(ej, otraSerie, otroTipo.id));
          acepta(await entrarEnValidacion(ej, otroTipo.id, "1"));
        }),
        "comprobante_sin_reserva",
      );
    });

    it("la serie de OTRO ambiente no respalda al comprobante: homologación no usa la serie de producción del mismo punto de venta", async () => {
      const { x, id } = await nuevo();
      // El punto de venta pasa a producción y reserva SU serie de producción para este comprobante de homologación.
      acepta(await viaDuenoDirecto(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
      const enProduccion = serieDe(x, "FACTURA_B", "PRODUCCION");
      check(
        await transaccion(async (ej) => {
          acepta(await asegurarSerie(ej, enProduccion));
          acepta(await reservarSerie(ej, enProduccion, id));
          acepta(await entrarEnValidacion(ej, id, "1"));
        }),
        "comprobante_sin_reserva",
      );
    });

    it("AUTORIZADO sin que la serie haya avanzado, o con su reserva todavía abierta, se rechaza (comprobante_sin_reserva)", async () => {
      // La serie cerrada SIN avanzar.
      let n = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, n.serie, n.id))));
      check(
        await transaccion(async (ej) => {
          acepta(await marcarAutorizado(ej, n.id));
          acepta(await cerrarSerie(ej, n.serie, false));
        }),
        "comprobante_sin_reserva",
      );
      // La serie sin cerrar (reserva abierta).
      n = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, n.serie, n.id))));
      check(
        await transaccion(async (ej) => acepta(await marcarAutorizado(ej, n.id))),
        "comprobante_sin_reserva",
      );
      // Sin serie alguna: el dueño tampoco puede inventar un autorizado.
      n = await nuevo();
      check(
        await transaccion(async (ej) => {
          acepta(await entrarEnValidacion(ej, n.id, "1"));
          acepta(await marcarAutorizado(ej, n.id));
        }),
        "comprobante_sin_reserva",
      );
    });

    it("la serie no puede soltar su reserva con un comprobante en vuelo (comprobante_serie_sin_reserva): ni cerrando, ni liberando, ni bloqueando", async () => {
      for (const que of ["avanza", "libera", "bloquea"] as const) {
        const n = await nuevo();
        acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, n.serie, n.id))));
        const r = await transaccion(async (ej) => {
          if (que === "bloquea") {
            acepta(
              await ej(
                `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null,
                        en_curso_hasta = null, motivo_bloqueo = 'desfase' where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
                [n.x.pv],
              ),
            );
          } else {
            acepta(await cerrarSerie(ej, n.serie, que === "avanza"));
          }
        });
        check(r, "comprobante_serie_sin_reserva");
        // Y lo mismo con el comprobante INCIERTO: sigue en vuelo.
        acepta(await transaccion(async (ej) => acepta(await marcarEstado(ej, n.id, "INCIERTO"))));
        check(
          await transaccion(async (ej) => acepta(await cerrarSerie(ej, n.serie, true))),
          "comprobante_serie_sin_reserva",
        );
      }
    });

    it("un solo comprobante en vuelo por serie: otro no puede entrar a validación con la misma serie (comprobante_en_vuelo_uk)", async () => {
      const n = await nuevo();
      const otro = await crearComprobante(dueno, n.x);
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, n.serie, n.id))));
      acepta(
        await transaccion(async (ej) => {
          clave(await entrarEnValidacion(ej, otro, "1"), "comprobante_en_vuelo_uk");
        }),
      );
    });

    it("rechazado: el comprobante queda RECHAZADO y la serie se libera sin avanzar; el siguiente comprobante recibe el MISMO número", async () => {
      const { x, id, serie } = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      acepta(
        await transaccion(async (ej) => {
          acepta(await marcarEstado(ej, id, "RECHAZADO"));
          acepta(await cerrarSerie(ej, serie, false));
        }),
      );
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      const siguiente = await crearComprobante(dueno, x);
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, siguiente))));
      expect(await leerComprobante(dueno, siguiente)).toMatchObject({ numero_reservado: "1", envios: 1 });
      // El rechazado conserva el número que se intentó, para diagnosticar.
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "RECHAZADO", numero_reservado: "1" });
    });

    it("incierto y reconciliado: queda en vuelo sin tocar la serie; la consulta lo autoriza (RECONCILIACION) y la serie avanza una sola vez", async () => {
      const { id, serie } = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      acepta(await transaccion(async (ej) => acepta(await marcarEstado(ej, id, "INCIERTO"))));
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "EN_CURSO", solicitud: id });
      acepta(
        await transaccion(async (ej) => {
          acepta(await marcarAutorizado(ej, id, "RECONCILIACION"));
          acepta(await cerrarSerie(ej, serie, true));
        }),
      );
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "AUTORIZADO", numero: "1", resuelto_por: "RECONCILIACION" });
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: "1" });
    });

    it("incierto que nunca llegó a ARCA (la consulta da «no existe»): vuelve a PENDIENTE, la serie se libera y sale con el MISMO número", async () => {
      const { id, serie } = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      acepta(await transaccion(async (ej) => acepta(await marcarEstado(ej, id, "INCIERTO"))));
      acepta(
        await transaccion(async (ej) => {
          acepta(await volverAPendiente(ej, id));
          acepta(await cerrarSerie(ej, serie, false));
        }),
      );
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "PENDIENTE", numero_reservado: null, fecha_emision: null, envios: 1 });
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "EN_VALIDACION", numero_reservado: "1", envios: 2 });
    });

    it("otro sistema usó el número: CONFLICTO y serie BLOQUEADA; se resincroniza, el comprobante se reintenta y sale con el siguiente", async () => {
      const { id, serie } = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      acepta(
        await transaccion(async (ej) => {
          acepta(await marcarEstado(ej, id, "CONFLICTO"));
          acepta(
            await ej(
              `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null,
                      en_curso_hasta = null, motivo_bloqueo = 'ARCA tiene otro comprobante con el número 1'
                where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
              [serie.pv],
            ),
          );
        }),
      );
      // La serie bloqueada no reserva (0 filas); resincronizar es BLOQUEADA -> LIBRE con el último de ARCA.
      const bloqueada = await transaccion(async (ej) => {
        const r = await reservarSerie(ej, serie, id);
        acepta(r);
        expect(r.ok && r.filas).toBe(0);
      });
      acepta(bloqueada);
      acepta(
        await transaccion(async (ej) => {
          acepta(
            await ej(
              `update serie_comprobante set estado = 'LIBRE', ultimo_numero = 4, motivo_bloqueo = null
                where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`,
              [serie.pv],
            ),
          );
          acepta(await volverAPendiente(ej, id));
        }),
      );
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "EN_VALIDACION", numero_reservado: "5" });
    });

    it("un CONFLICTO se puede descartar (con motivo), y entonces no recibe nada de la serie", async () => {
      const { id, serie } = await nuevo();
      acepta(await transaccion(async (ej) => void (await reservarYValidar(ej, serie, id))));
      acepta(
        await transaccion(async (ej) => {
          acepta(await marcarEstado(ej, id, "CONFLICTO"));
          acepta(await cerrarSerie(ej, serie, false));
        }),
      );
      acepta(
        await transaccion(async (ej) =>
          acepta(await ej("update comprobante set estado = 'DESCARTADO', motivo_descarte = 'ya lo facturó otro sistema' where id = $1", [id])),
        ),
      );
      expect(await leerComprobante(dueno, id)).toMatchObject({ estado: "DESCARTADO", numero_reservado: "1" });
    });
  });

  // ===============================================================================================
  // 3. Ambiente
  // ===============================================================================================
  describe("ambiente: la clave de la serie y el cambio de ambiente del punto de venta", () => {
    it("el ambiente es parte de la clave de la serie: las dos conviven en el mismo punto de venta y tipo; en el mismo ambiente no se repite", async () => {
      const x = await crearEscenario(dueno);
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 7, "HOMOLOGACION");
      await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 0, "PRODUCCION");
      expect(await leerSerie(dueno, serieDe(x, "FACTURA_B", "HOMOLOGACION"))).toMatchObject({ ultimo: "7" });
      expect(await leerSerie(dueno, serieDe(x, "FACTURA_B", "PRODUCCION"))).toMatchObject({ ultimo: "0" });
      await deshacible(async () => {
        clave(
          await intento(dueno)(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 0, 'PRODUCCION')`,
            [x.empresa, x.pv, x.emisor],
          ),
          "serie_pkey",
        );
      });
    });

    it("emitir en homologación no cambia la serie de producción del mismo punto de venta (los números de prueba no corren la serie real)", async () => {
      const x = await crearEscenario(dueno);
      const homologacion = serieDe(x, "FACTURA_B", "HOMOLOGACION");
      const id = await crearComprobante(dueno, x);
      acepta(
        await transaccion(async (ej) => {
          acepta(await asegurarSerie(ej, homologacion));
          const r = await reservarSerie(ej, homologacion, id);
          acepta(r);
          acepta(await entrarEnValidacion(ej, id, "1"));
          acepta(await marcarAutorizado(ej, id));
          acepta(await cerrarSerie(ej, homologacion, true));
        }),
      );
      await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
      const produccion = serieDe(x, "FACTURA_B", "PRODUCCION");
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 0, "PRODUCCION");
      expect(await leerSerie(dueno, produccion)).toMatchObject({ estado: "LIBRE", ultimo: "0" });
      const real = await crearComprobante(dueno, x, { ambiente: "PRODUCCION" });
      acepta(
        await transaccion(async (ej) => {
          const r = await reservarSerie(ej, produccion, real);
          acepta(r);
          expect(r.ok && r.rows[0]?.["numero"]).toBe("1");
          acepta(await entrarEnValidacion(ej, real, "1"));
        }),
      );
      expect(await leerSerie(dueno, homologacion)).toMatchObject({ ultimo: "1" });
    });

    it("una serie sin ambiente no se crea (sin valor por defecto), y su ambiente tiene que ser el de su punto de venta", async () => {
      const x = await crearEscenario(dueno);
      await deshacible(async () => {
        const r = await intento(dueno)(
          `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero)
           values ($1, $2, $3, 'FACTURA_B', 0)`,
          [x.empresa, x.pv, x.emisor],
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.codigo).toBe("23502");
      });
      await deshacible(async () => {
        check(
          await intento(dueno)(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 0, 'PRODUCCION')`,
            [x.empresa, x.pv, x.emisor],
          ),
          "serie_ambiente_invalido",
        );
      });
      // La aplicación, con su rol real, tampoco.
      await conAppDe(base!, x, async (s) => {
        check(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 0, 'PRODUCCION')`,
            [x.empresa, x.pv, x.emisor],
          ),
          "serie_ambiente_invalido",
        );
        acepta(
          await s.intentar(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 0, 'HOMOLOGACION')`,
            [x.empresa, x.pv, x.emisor],
          ),
        );
      });
    });

    it("el ambiente de una serie no cambia (es parte de su identidad) y solo hay dos", async () => {
      const x = await crearEscenario(dueno);
      await crearSerie(dueno, x.empresa, x.pv, x.emisor);
      await deshacible(async () => {
        check(
          await intento(dueno)("update serie_comprobante set ambiente = 'PRODUCCION' where punto_de_venta_id = $1", [x.pv]),
          "serie_inmutable",
        );
        await dueno.query("alter table serie_comprobante disable trigger serie_comprobante_alta");
        check(
          await intento(dueno)(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_A', 0, 'PRUEBAS')`,
            [x.empresa, x.pv, x.emisor],
          ),
          "serie_ambiente_ck",
        );
      });
    });

    it("QF1: una serie BLOQUEADA sale solo hacia LIBRE, sin bajar el último número, y el último puede saltar hacia adelante", async () => {
      const x = await crearEscenario(dueno);
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 5);
      await usarSerie(dueno, x.pv, "BLOQUEADA");
      const parcial = (cambios: string) =>
        `update serie_comprobante set ${cambios} where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B'`;
      await deshacible(async () => {
        // Sin salir, el último número no salta.
        check(await intento(dueno)(parcial("ultimo_numero = 9"), [x.pv]), "serie_numero_invalido");
        // Hacia atrás, nunca.
        check(
          await intento(dueno)(parcial("estado = 'LIBRE', ultimo_numero = 4, motivo_bloqueo = null"), [x.pv]),
          "serie_numero_invalido",
        );
        // A EN_CURSO, tampoco.
        check(await intento(dueno)(parcial("estado = 'EN_CURSO'"), [x.pv]), "serie_transicion_invalida");
        // LIBRE conservando el motivo de bloqueo: lo rechaza el CHECK de la serie.
        check(
          await intento(dueno)(parcial("estado = 'LIBRE', ultimo_numero = 9"), [x.pv]),
          "serie_bloqueo_ck",
        );
        // Con el último de ARCA, igual o mayor: sale.
        acepta(await intento(dueno)(parcial("estado = 'LIBRE', ultimo_numero = 9, motivo_bloqueo = null"), [x.pv]));
        expect(await leerSerie(dueno, serieDe(x))).toMatchObject({ estado: "LIBRE", ultimo: "9" });
      });
      await deshacible(async () => {
        acepta(await intento(dueno)(parcial("estado = 'LIBRE', motivo_bloqueo = null"), [x.pv]));
        expect(await leerSerie(dueno, serieDe(x))).toMatchObject({ estado: "LIBRE", ultimo: "5" });
      });
    });

    it("QF2: el ambiente del punto de venta no cambia con una serie EN_CURSO; con la reserva resuelta, sí", async () => {
      const x = await crearEscenario(dueno);
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 0, "HOMOLOGACION");
      await usarSerie(dueno, x.pv, "EN_CURSO");
      await deshacible(async () => {
        check(
          await intento(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]),
          "punto_de_venta_ambiente_con_serie_en_curso",
        );
      });
      await deshacible(async () => {
        await dueno.query(
          `update serie_comprobante set estado = 'LIBRE', numero_en_curso = null, solicitud_en_curso = null,
                  en_curso_hasta = null where punto_de_venta_id = $1`,
          [x.pv],
        );
        acepta(await intento(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
      });
    });

    it("el cambio de ambiente con series usadas: homologación usada no impide ir a producción; producción usada impide volver; producción sin usar permite volver", async () => {
      const x = await crearEscenario(dueno);
      // Una serie de homologación usada (último 3, LIBRE).
      await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 3, "HOMOLOGACION");
      await deshacible(async () => {
        acepta(await intento(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
        // Producción todavía sin usar: puede volver.
        await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 0, "PRODUCCION");
        acepta(await intento(dueno)("update punto_de_venta set ambiente = 'HOMOLOGACION' where id = $1", [x.pv]));
      });
      await deshacible(async () => {
        acepta(await intento(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
        await crearSerie(dueno, x.empresa, x.pv, x.emisor, "FACTURA_B", 1, "PRODUCCION");
        check(
          await intento(dueno)("update punto_de_venta set ambiente = 'HOMOLOGACION' where id = $1", [x.pv]),
          "punto_de_venta_ambiente_no_vuelve",
        );
      });
    });

    it("el ambiente de un punto de venta es uno de dos, y cambiarlo al mismo valor no hace nada; la aplicación lo cambia con su rol (solo esa columna)", async () => {
      const x = await crearEscenario(dueno);
      await deshacible(async () => {
        check(
          await intento(dueno)("update punto_de_venta set ambiente = 'PRUEBAS' where id = $1", [x.pv]),
          "punto_de_venta_ambiente_ck",
        );
        acepta(await intento(dueno)("update punto_de_venta set ambiente = 'HOMOLOGACION' where id = $1", [x.pv]));
      });
      await conAppDe(base!, x, async (s) => {
        acepta(await s.intentar("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
        denegado(await s.intentar("update punto_de_venta set verificacion_arca = verificacion_arca where id = $1", [x.pv]));
      });
    });
  });

  // ===============================================================================================
  // 4. Base = dominio
  // ===============================================================================================
  describe("la base acepta todo lo que arma el dominio puro", () => {
    /** El comprobante armado por el dominio, como filas de la base. */
    const aFilas = (x: Escenario, c: ComprobanteNuevo) => {
      const importes = importesParaArca(c);
      const datos = datosDeComprobante(x, {
        tipo_comprobante: c.tipo,
        clase: "FACTURA",
        modo_de_precio: c.modoDePrecio,
        concepto: c.concepto,
        total: importeATexto(c.total),
        neto_gravado: importeATexto(importes.neto),
        iva: importeATexto(importes.iva),
        exento: importeATexto(importes.exento),
        no_gravado: importeATexto(importes.noGravado),
        receptor_nombre: c.receptor.nombre,
        receptor_documento_tipo: c.receptor.documento.tipo,
        receptor_documento_numero: c.receptor.documento.tipo === "SIN_IDENTIFICAR" ? null : c.receptor.documento.numero,
        receptor_condicion_iva: c.receptor.condicionIva,
        receptor_domicilio: c.receptor.domicilio,
      });
      const renglones = c.renglones.map((r, i) => ({
        posicion: i + 1,
        descripcion: r.descripcion,
        cantidad: cantidadATexto(r.cantidad),
        precio_unitario: precioUnitarioATexto(r.precioUnitario),
        descuento: r.descuento === null ? null : porcentajeATexto(r.descuento),
        alicuota: r.alicuota,
        importe: importeATexto(r.importe),
      }));
      const desglose = c.desglose.map((d) => ({
        alicuota: d.alicuota,
        total: importeATexto(d.total),
        neto: importeATexto(d.neto),
        iva: importeATexto(d.iva),
      }));
      return { datos, renglones, desglose };
    };
    it("propiedad: facturas A, B y C de renglones al azar (los dos modos de precio) entran a la base y cuadran al confirmar", async () => {
      const eC = await crearEscenario(dueno, { condicionIva: "MONOTRIBUTO", razonSocial: "Kiosco Zulú" });
      const emisorDe = (x: Escenario) => {
        const cuit = cuitDesdeTexto(x.cuit);
        if (!cuit.ok) throw new Error("CUIT de prueba inválido");
        return emisorInstantaneo({
          cuit: cuit.valor,
          razonSocial: x.razonSocial,
          condicionIva: x.condicionIva,
          puntoDeVentaNumero: x.pvNumero,
        });
      };
      // Un emisor responsable inscripto (letras A y B, con alícuotas) o un monotributista (letra C, sin ellas).
      const casos = fc.oneof(
        fc.record({
          x: fc.constant(e),
          renglones: fc.array(renglonArbitrario(), { minLength: 1, maxLength: 5 }),
          modo: fc.constantFrom("IVA_INCLUIDO" as const, "IVA_DISCRIMINADO" as const),
        }),
        fc.record({
          x: fc.constant(eC),
          renglones: fc.array(renglonArbitrario(fc.constant(null)), { minLength: 1, maxLength: 5 }),
          modo: fc.constant("IVA_INCLUIDO" as const),
        }),
      );
      await fc.assert(
        fc.asyncProperty(casos, fc.constantFrom(consumidorFinal, receptorInscripto), async (caso, receptor) => {
          const armada = armarComprobanteNuevo(
            entradaDeFactura(receptor, caso.renglones, { modoDePrecio: caso.modo }),
            contextoDeEmision({ emisor: emisorDe(caso.x) }),
          );
          // Lo que el dominio rechaza (un total en cero o fuera de rango) no le toca a la base.
          fc.pre(armada.ok);
          if (!armada.ok) return;
          const { datos, renglones, desglose } = aFilas(caso.x, armada.valor);
          await dueno.query("begin");
          try {
            acepta(await insertarComprobante(intento(dueno), datos, renglones, desglose));
            await dueno.query("set constraints comprobante_cuadra immediate");
          } finally {
            await dueno.query("rollback");
          }
        }),
        { numRuns: 80 },
      );
    });
  });
});
