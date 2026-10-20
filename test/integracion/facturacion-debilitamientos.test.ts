import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitAlAzar, crearBaseAparte } from "./entorno";
import { crearPuntoDeVenta } from "./fiscal-apoyo";
import {
  asegurarSerie,
  cerrarSerie,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  datosDeLetraC,
  entrarEnValidacion,
  insertarComprobante,
  marcarAutorizado,
  marcarEstado,
  RENGLON_DE_100_SIN_ALICUOTA,
  RENGLON_DE_121,
  reservarSerie,
  serieDe,
  viaDueno,
  type Ejecutor,
  type Escenario,
} from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";

/**
 * Facturación F2: los DEBILITAMIENTOS propios del SQL. Cada caso rompe a propósito la migración 0009 de una
 * forma razonable (sacar un índice, un disparador, una validación, una concesión; cambiar un límite o una
 * política) y comprueba que una sonda —la misma que pasa sobre la base real— deja de cumplirse. Una sonda que
 * sigue pasando con la migración rota es una prueba que no muerde.
 *
 * Se rompe y se sondea DENTRO de una transacción de una base descartable propia que se deshace al terminar
 * (el DDL de Postgres es transaccional): una base para todo el archivo en vez de una por caso. Las sondas de
 * privilegios y de políticas miran el catálogo (no cambian de rol: no dependen de que el dueño pueda
 * suplantarlos). Los dos casos de bloqueo necesitan dos conexiones y usan una base propia por caso.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Sonda = (c: pg.Client) => Promise<boolean>;

const TABLAS_NUEVAS = [
  "comprobante",
  "comprobante_linea",
  "comprobante_alicuota",
  "certificado_arca",
  "acceso_arca",
  "intento_arca",
];
const COLUMNAS_DE_CONTENIDO = [
  "total",
  "neto_gravado",
  "iva",
  "exento",
  "no_gravado",
  "moneda",
  "tipo_comprobante",
  "ambiente",
  "origen_id",
  "emisor_cuit",
  "emisor_razon_social",
  "punto_de_venta_numero",
  "receptor_nombre",
  "receptor_documento_numero",
  "receptor_condicion_iva",
  "comprobante_asociado_id",
  "huella",
  "creado_por",
];

describe.skipIf(base === null)("facturación: debilitamientos propios de la migración 0009", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let e: Escenario;
  let otra: Escenario;
  let pendiente: string;

  beforeAll(async () => {
    if (base === null) return;
    aparte = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
    otra = await crearEscenario(dueno);
    pendiente = await crearComprobante(dueno, e);
  });
  afterAll(async () => {
    await dueno.end();
    await aparte.destruir();
  });

  // ---- apoyo ------------------------------------------------------------------------------------------------
  const rechaza = async (
    ej: Ejecutor,
    texto: string,
    parametros: unknown[] = [],
  ): Promise<boolean> => !(await ej(texto, parametros)).ok;
  /** Evalúa las restricciones diferidas ahora; `true` si alguna salta. */
  const saltaAlConfirmar = async (c: pg.Client): Promise<boolean> => {
    await c.query("savepoint diferida");
    try {
      await c.query("set constraints all immediate");
      return false;
    } catch {
      return true;
    } finally {
      await c.query("rollback to savepoint diferida").catch(() => undefined);
    }
  };
  const nuevoDe = async (c: pg.Client, x: Escenario, cambios = {}): Promise<string> => {
    const datos = datosDeComprobante(x, cambios);
    const r = await insertarComprobante(viaDueno(c), datos);
    if (!r.ok) throw new Error(`no se pudo crear: ${r.restriccion ?? ""} ${r.mensaje}`);
    return datos["id"] as string;
  };
  /** Un comprobante AUTORIZADO con el número dado (por el camino legal de los estados, sin la serie). */
  const autorizadoDe = async (
    c: pg.Client,
    x: Escenario,
    numero: string,
    cambios = {},
  ): Promise<string> => {
    const id = await nuevoDe(c, x, cambios);
    const ej = viaDueno(c);
    for (const r of [await entrarEnValidacion(ej, id, numero), await marcarAutorizado(ej, id)]) {
      if (!r.ok) throw new Error(`no se pudo autorizar: ${r.restriccion ?? ""} ${r.mensaje}`);
    }
    return id;
  };

  // ---- las sondas: cada una devuelve true cuando la migración cumple lo que protege --------------------------------
  const SONDAS = {
    /** D2: a lo sumo un comprobante vigente por origen, emisor y clase. */
    identidadUnica: async (c) => {
      const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `t-${randomUUID()}` };
      await nuevoDe(c, e, origen);
      return rechaza(
        viaDueno(c),
        "insert into comprobante (id, empresa_id, emisor_id, punto_de_venta_id, ambiente, origen_tipo, origen_id, clase, tipo_comprobante, concepto, moneda, modo_de_precio, total, neto_gravado, iva, exento, no_gravado, datos_fiscales_id, emisor_cuit, emisor_razon_social, emisor_condicion_iva, emisor_domicilio_fiscal, emisor_inicio_actividades, emisor_iibb_numero, emisor_iibb_condicion, punto_de_venta_numero, punto_de_venta_domicilio, receptor_documento_tipo, receptor_condicion_iva, huella, creado_por) select gen_random_uuid(), empresa_id, emisor_id, punto_de_venta_id, ambiente, origen_tipo, origen_id, clase, tipo_comprobante, concepto, moneda, modo_de_precio, total, neto_gravado, iva, exento, no_gravado, datos_fiscales_id, emisor_cuit, emisor_razon_social, emisor_condicion_iva, emisor_domicilio_fiscal, emisor_inicio_actividades, emisor_iibb_numero, emisor_iibb_condicion, punto_de_venta_numero, punto_de_venta_domicilio, receptor_documento_tipo, receptor_condicion_iva, huella, creado_por from comprobante where origen_id = $1",
        [origen.origen_id],
      );
    },
    /** D2: rechazado o descartado, un origen que no es manual vuelve a quedar libre. */
    rechazadoLiberaElOrigen: async (c) => {
      const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `t-${randomUUID()}` };
      const id = await nuevoDe(c, e, origen);
      const ej = viaDueno(c);
      await entrarEnValidacion(ej, id, "1");
      await marcarEstado(ej, id, "RECHAZADO");
      return (await insertarComprobante(ej, datosDeComprobante(e, origen))).ok;
    },
    /** D2: una clave manual nunca da dos comprobantes, ni después de un rechazo. */
    claveManualNuncaDosVeces: async (c) => {
      const clave = randomUUID();
      const id = await nuevoDe(c, e, { origen_id: clave });
      const ej = viaDueno(c);
      await entrarEnValidacion(ej, id, "1");
      await marcarEstado(ej, id, "RECHAZADO");
      return !(await insertarComprobante(ej, datosDeComprobante(e, { origen_id: clave }))).ok;
    },
    /** D2: la clase es parte de la identidad: la nota del mismo origen convive con su factura. */
    claseEnLaIdentidad: async (c) => {
      const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `t-${randomUUID()}` };
      const factura = await autorizadoDe(c, e, "1", origen);
      return (
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, {
            ...origen,
            clase: "NOTA_CREDITO",
            tipo_comprobante: "NOTA_CREDITO_B",
            comprobante_asociado_id: factura,
            motivo: "x",
          }),
        )
      ).ok;
    },
    /** Un número autorizado por serie, nunca dos. */
    numeroAutorizadoUnico: async (c) => {
      await autorizadoDe(c, e, "1");
      const id = await nuevoDe(c, e);
      const ej = viaDueno(c);
      await entrarEnValidacion(ej, id, "1");
      return !(await marcarAutorizado(ej, id)).ok;
    },
    /** El ambiente es parte de la clave del número: el 1 de homologación y el 1 de producción conviven. */
    numeroPorAmbiente: async (c) => {
      const pv = await crearPuntoDeVenta(c, e, {
        numero: 31,
        domicilio: e.domicilio,
        activo: true,
      });
      await autorizadoDe(c, e, "1", { punto_de_venta_id: pv, punto_de_venta_numero: 31 });
      await c.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [pv]);
      const r = await (async () => {
        try {
          await autorizadoDe(c, e, "1", {
            punto_de_venta_id: pv,
            punto_de_venta_numero: 31,
            ambiente: "PRODUCCION",
          });
          return true;
        } catch {
          return false;
        }
      })();
      return r;
    },
    /** D1: el contenido de un comprobante no cambia nunca. */
    contenidoInmutable: async (c) => {
      const ej = viaDueno(c);
      const id = await autorizadoDe(c, e, "1");
      return (
        (await rechaza(ej, "update comprobante set total = total + 1 where id = $1", [
          pendiente,
        ])) &&
        (await rechaza(ej, "update comprobante set receptor_nombre = 'otro' where id = $1", [
          id,
        ])) &&
        // el contenido tampoco cambia aprovechando un cambio de estado legal
        (await rechaza(
          ej,
          "update comprobante set receptor_nombre = 'otro', estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1",
          [pendiente],
        )) &&
        (await rechaza(ej, "update comprobante set emisor_cuit = $2 where id = $1", [
          id,
          cuitAlAzar(),
        ]))
      );
    },
    /** D1: las transiciones son exactamente las de la tabla; ninguna sale de un estado terminal. */
    transicionesExactas: async (c) => {
      const ej = viaDueno(c);
      const rechazado = await nuevoDe(c, e);
      await entrarEnValidacion(ej, rechazado, "9");
      await marcarEstado(ej, rechazado, "RECHAZADO");
      const descartado = await nuevoDe(c, e);
      await ej(
        "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'x' where id = $1",
        [descartado],
      );
      const autorizado = await autorizadoDe(c, e, "1");
      return (
        (await rechaza(
          ej,
          "update comprobante set estado = 'PENDIENTE', numero_reservado = null, fecha_emision = null where id = $1",
          [rechazado],
        )) &&
        (await marcarAutorizado(ej, rechazado).then((r) => !r.ok)) &&
        (await rechaza(ej, "update comprobante set estado = 'PENDIENTE' where id = $1", [
          descartado,
        ])) &&
        (await rechaza(ej, "update comprobante set estado = 'RECHAZADO' where id = $1", [
          autorizado,
        ]))
      );
    },
    /** D1: los envíos suben de a uno, solo al entrar a validación. */
    enviosDeAUno: async (c) => {
      const ej = viaDueno(c);
      const id = await nuevoDe(c, e);
      const dos = await rechaza(
        ej,
        "update comprobante set estado = 'EN_VALIDACION', envios = envios + 2, numero_reservado = 1, fecha_emision = current_date where id = $1",
        [id],
      );
      await entrarEnValidacion(ej, id, "1");
      const alRechazar = await rechaza(
        ej,
        "update comprobante set estado = 'RECHAZADO', envios = envios + 1 where id = $1",
        [id],
      );
      return dos && alRechazar;
    },
    /** Un INCIERTO solo se resuelve consultando: nunca con una respuesta del pedido original. */
    inciertoSoloPorConsulta: async (c) => {
      const ej = viaDueno(c);
      const id = await nuevoDe(c, e);
      await entrarEnValidacion(ej, id, "1");
      await marcarEstado(ej, id, "INCIERTO");
      return rechaza(
        ej,
        `update comprobante set estado = 'AUTORIZADO', numero = numero_reservado, cae = '12345678901234', cae_vence = fecha_emision + 10,
                autorizado_en = now(), resuelto_por = 'RESPUESTA' where id = $1`,
        [id],
      );
    },
    /** La aplicación no tiene UPDATE sobre el contenido, ni nadie más sobre nada de lo facturado. */
    appNoCambiaElContenido: async (c) => {
      const { rows } = await c.query(
        `select 1 from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'comprobante' and privilege_type = 'UPDATE'
            and grantee in ('pedernal_app', 'pedernal_plataforma', 'pedernal_grupo', 'pedernal_trabajos', 'pedernal_autenticacion', 'pedernal_publico', 'pedernal_captacion', 'PUBLIC')
            and column_name = any ($1)`,
        [COLUMNAS_DE_CONTENIDO],
      );
      return rows.length === 0;
    },
    /** Renglones, desglose e intentos son de solo inserción. */
    soloInsercion: async (c) => {
      const ej = viaDueno(c);
      return (
        (await rechaza(
          ej,
          "update comprobante_linea set importe = importe + 1 where comprobante_id = $1",
          [pendiente],
        )) &&
        (await rechaza(ej, "delete from comprobante_alicuota where comprobante_id = $1", [
          pendiente,
        ]))
      );
    },
    /** Nada de lo facturado se borra. */
    nadaSeBorra: async (c) => {
      const ej = viaDueno(c);
      // sin renglones ni desglose: que no sea una clave foránea la que frene el borrado
      const huerfano = datosDeComprobante(e);
      await insertarComprobante(ej, huerfano, [], []);
      return (
        (await rechaza(ej, "delete from comprobante where id = $1", [huerfano["id"]])) &&
        (await rechaza(
          ej,
          "truncate comprobante, comprobante_linea, comprobante_alicuota, intento_arca",
        ))
      );
    },
    /** Un renglón tardío (otra transacción) no entra a un comprobante PENDIENTE. */
    renglonTardio: async (c) =>
      rechaza(
        viaDueno(c),
        `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
         values ($1, $2, 2, 'tardío', 1, 0, '21', 0.00)`,
        [e.empresa, pendiente],
      ),
    /** D3: EN_VALIDACION exige la reserva de la serie al confirmar. */
    enValidacionExigeReserva: async (c) => {
      const id = await nuevoDe(c, e);
      await entrarEnValidacion(viaDueno(c), id, "1");
      return saltaAlConfirmar(c);
    },
    /** D3: la reserva de la serie tiene que ser la de ESTE comprobante, no la de otro. */
    reservaAjena: async (c) => {
      const x = await crearEscenario(c);
      const serie = serieDe(x);
      const id = await nuevoDe(c, x);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serie);
      await reservarSerie(ej, serie, randomUUID());
      await entrarEnValidacion(ej, id, "1");
      return saltaAlConfirmar(c);
    },
    /** D3: y el número reservado del comprobante es el de la reserva de la serie. */
    reservaConOtroNumero: async (c) => {
      const x = await crearEscenario(c);
      const serie = serieDe(x);
      const id = await nuevoDe(c, x);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serie);
      await reservarSerie(ej, serie, id);
      await entrarEnValidacion(ej, id, "2");
      return saltaAlConfirmar(c);
    },
    /** D3: la serie no suelta su reserva con un comprobante en vuelo. */
    serieNoSueltaLaReserva: async (c) => {
      const x = await crearEscenario(c);
      const serie = serieDe(x);
      const id = await nuevoDe(c, x);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serie);
      await reservarSerie(ej, serie, id);
      await entrarEnValidacion(ej, id, "1");
      await c.query("set constraints all immediate");
      await c.query("set constraints all deferred");
      await cerrarSerie(ej, serie, true);
      return saltaAlConfirmar(c);
    },
    /** D3: un autorizado exige que la serie haya avanzado. */
    autorizadoExigeLaSerieAvanzada: async (c) => {
      const x = await crearEscenario(c);
      const serie = serieDe(x);
      const id = await nuevoDe(c, x);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serie);
      await reservarSerie(ej, serie, id);
      await entrarEnValidacion(ej, id, "1");
      await marcarAutorizado(ej, id);
      await cerrarSerie(ej, serie, false);
      return saltaAlConfirmar(c);
    },
    /** D3: un autorizado exige que la serie haya cerrado su reserva. */
    autorizadoExigeLaReservaCerrada: async (c) => {
      const x = await crearEscenario(c);
      const serie = serieDe(x);
      const id = await nuevoDe(c, x);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serie);
      await reservarSerie(ej, serie, id);
      await entrarEnValidacion(ej, id, "1");
      await marcarAutorizado(ej, id);
      await cerrarSerie(ej, serie, true);
      // la serie vuelve a reservarse con la solicitud de este mismo comprobante, ya autorizado
      await reservarSerie(ej, serie, id);
      return saltaAlConfirmar(c);
    },
    /** D3: un solo comprobante en vuelo por serie, ya en el momento de la sentencia. */
    unEnVueloPorSerie: async (c) => {
      const ej = viaDueno(c);
      const a = await nuevoDe(c, e);
      const b = await nuevoDe(c, e);
      await entrarEnValidacion(ej, a, "1");
      return !(await entrarEnValidacion(ej, b, "1")).ok;
    },
    /** D6: el ambiente es parte de la clave de la serie. */
    serieSeparaPorAmbiente: async (c) => {
      const x = await crearEscenario(c);
      const ej = viaDueno(c);
      await asegurarSerie(ej, serieDe(x, "FACTURA_B", "HOMOLOGACION"));
      await c.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
      return (
        (await asegurarSerie(ej, serieDe(x, "FACTURA_B", "PRODUCCION"))).ok &&
        (await c.query("select 1 from serie_comprobante where punto_de_venta_id = $1", [x.pv]))
          .rowCount === 2
      );
    },
    /** D6: una serie sin ambiente no se crea (sin valor por defecto). */
    serieSinAmbienteNoSeCrea: async (c) => {
      const x = await crearEscenario(c);
      return rechaza(
        viaDueno(c),
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero) values ($1, $2, $3, 'FACTURA_B', 0)`,
        [x.empresa, x.pv, x.emisor],
      );
    },
    /** D6: una serie nace en el ambiente de su punto de venta. */
    serieNaceEnElAmbienteDelPv: async (c) => {
      const x = await crearEscenario(c);
      return rechaza(
        viaDueno(c),
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente) values ($1, $2, $3, 'FACTURA_B', 0, 'PRODUCCION')`,
        [x.empresa, x.pv, x.emisor],
      );
    },
    /** D6: un comprobante nace en el ambiente de su punto de venta. */
    comprobanteNaceEnElAmbienteDelPv: async (c) =>
      !(await insertarComprobante(viaDueno(c), datosDeComprobante(e, { ambiente: "PRODUCCION" })))
        .ok,
    /** D6: el ambiente del punto de venta no cambia con una serie en curso, ni vuelve atrás si ya emitió en producción. */
    ambienteDelPuntoDeVenta: async (c) => {
      const ej = viaDueno(c);
      const x = await crearEscenario(c);
      await c.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente) values ($1, $2, $3, 'FACTURA_B', 0, 'HOMOLOGACION')`,
        [x.empresa, x.pv, x.emisor],
      );
      await c.query(
        `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 1, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes' where punto_de_venta_id = $1`,
        [x.pv],
      );
      const conSerieEnCurso = await rechaza(
        ej,
        "update punto_de_venta set ambiente = 'PRODUCCION' where id = $1",
        [x.pv],
      );
      await c.query(
        `update serie_comprobante set estado = 'LIBRE', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null where punto_de_venta_id = $1`,
        [x.pv],
      );
      await c.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
      await c.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente) values ($1, $2, $3, 'FACTURA_B', 4, 'PRODUCCION')`,
        [x.empresa, x.pv, x.emisor],
      );
      const noVuelve = await rechaza(
        ej,
        "update punto_de_venta set ambiente = 'HOMOLOGACION' where id = $1",
        [x.pv],
      );
      return conSerieEnCurso && noVuelve;
    },
    /** D7: el último número de una serie bloqueada no baja al salir; tampoco salta sin salir. */
    ultimoNumeroNuncaBaja: async (c) => {
      const x = await crearEscenario(c);
      await c.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente) values ($1, $2, $3, 'FACTURA_B', 5, 'HOMOLOGACION')`,
        [x.empresa, x.pv, x.emisor],
      );
      await c.query(
        `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 6, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes' where punto_de_venta_id = $1`,
        [x.pv],
      );
      await c.query(
        `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null, motivo_bloqueo = 'desfase' where punto_de_venta_id = $1`,
        [x.pv],
      );
      const ej = viaDueno(c);
      const haciaAtras = await rechaza(
        ej,
        "update serie_comprobante set estado = 'LIBRE', ultimo_numero = 4, motivo_bloqueo = null where punto_de_venta_id = $1",
        [x.pv],
      );
      const saltoSinSalir = await rechaza(
        ej,
        "update serie_comprobante set ultimo_numero = 9 where punto_de_venta_id = $1",
        [x.pv],
      );
      return haciaAtras && saltoSinSalir;
    },
    /** D4: renglones y desglose suman lo informado (se evalúa al confirmar). */
    renglonesNumeradosDesdeUno: async (c) => {
      await insertarComprobante(viaDueno(c), datosDeComprobante(e), [
        { ...RENGLON_DE_121, posicion: 2 },
      ]);
      return saltaAlConfirmar(c);
    },
    cuadra: async (c) => {
      await insertarComprobante(viaDueno(c), datosDeComprobante(e), [
        { ...RENGLON_DE_121, importe: "120.00" },
      ]);
      return saltaAlConfirmar(c);
    },
    desgloseDeLaMismaAlicuota: async (c) => {
      await insertarComprobante(viaDueno(c), datosDeComprobante(e), undefined, [
        { alicuota: "10.5", total: "121.00", neto: "100.00", iva: "21.00" },
      ]);
      return saltaAlConfirmar(c);
    },
    letraCSumaElTotal: async (c) => {
      const x = await crearEscenario(c, { condicionIva: "MONOTRIBUTO", razonSocial: "Kiosco" });
      await insertarComprobante(
        viaDueno(c),
        datosDeLetraC(x),
        [{ ...RENGLON_DE_100_SIN_ALICUOTA, importe: "99.00" }],
        [],
      );
      return saltaAlConfirmar(c);
    },
    letraCSinAlicuotas: async (c) => {
      const x = await crearEscenario(c, { condicionIva: "MONOTRIBUTO", razonSocial: "Kiosco" });
      await insertarComprobante(
        viaDueno(c),
        datosDeLetraC(x),
        [{ ...RENGLON_DE_100_SIN_ALICUOTA, alicuota: "21" }],
        [],
      );
      return saltaAlConfirmar(c);
    },
    /** D4: los importes cierran (total = neto + IVA + exento + no gravado) y son positivos y acotados. */
    importesCierran: async (c) =>
      !(await insertarComprobante(viaDueno(c), datosDeComprobante(e, { iva: "20.00" }))).ok &&
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, {
            total: "NaN",
            neto_gravado: "NaN",
            iva: "NaN",
            exento: "NaN",
            no_gravado: "NaN",
          }),
        )
      ).ok &&
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, { total: "0.00", neto_gravado: "0.00", iva: "0.00" }),
        )
      ).ok,
    /** El dinero es numeric exacto y la moneda se dice siempre. */
    dineroExactoYMonedaExplicita: async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name in ('comprobante', 'comprobante_linea', 'comprobante_alicuota')
            and column_name in ('total', 'neto_gravado', 'iva', 'exento', 'no_gravado', 'importe', 'neto', 'cantidad', 'precio_unitario', 'descuento')
            and data_type = 'numeric'`,
      );
      const { rows: moneda } = await c.query(
        `select 1 from information_schema.columns where table_name = 'comprobante' and column_name = 'moneda' and column_default is not null`,
      );
      return rows[0]?.n === 12 && moneda.length === 0;
    },
    /** D11: un AUTORIZADO sin CAE no existe (el CHECK escrito sin comparaciones sueltas con NULL). */
    autorizadoExigeCae: async (c) => {
      const ej = viaDueno(c);
      const id = await nuevoDe(c, e);
      await entrarEnValidacion(ej, id, "1");
      return rechaza(
        ej,
        `update comprobante set estado = 'AUTORIZADO', numero = numero_reservado, cae_vence = fecha_emision + 10,
                autorizado_en = now(), resuelto_por = 'RESPUESTA' where id = $1`,
        [id],
      );
    },
    /** D11: servicios exigen las tres fechas. */
    serviciosExigenLasTresFechas: async (c) =>
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, { concepto: "SERVICIOS", servicio_hasta: "2026-10-31" }),
        )
      ).ok,
    /** La foto del emisor coincide con sus datos fiscales confirmados. */
    fotoDelEmisorCoincide: async (c) =>
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, { emisor_razon_social: "Otra SA" }),
        )
      ).ok &&
      !(
        await insertarComprobante(viaDueno(c), datosDeComprobante(e, { emisor_cuit: cuitAlAzar() }))
      ).ok,
    /** Una nota solo sobre un comprobante AUTORIZADO. */
    notaSoloSobreAutorizado: async (c) =>
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, {
            clase: "NOTA_CREDITO",
            tipo_comprobante: "NOTA_CREDITO_B",
            comprobante_asociado_id: pendiente,
            motivo: "x",
          }),
        )
      ).ok,
    /** FK compuesta: un comprobante no apunta al punto de venta de otra empresa. */
    fkCompuestaDelPuntoDeVenta: async (c) =>
      !(
        await insertarComprobante(
          viaDueno(c),
          datosDeComprobante(e, { punto_de_venta_id: otra.pv }),
        )
      ).ok,
    /** RLS activa y forzada en las seis tablas. */
    rlsForzada: async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        `select bool_and(relrowsecurity and relforcerowsecurity) as ok from pg_class where relnamespace = 'public'::regnamespace and relname = any ($1)`,
        [TABLAS_NUEVAS],
      );
      return rows[0]?.ok === true;
    },
    /** Cada política de lectura filtra por la empresa del contexto. */
    lecturaPorEmpresa: async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any ($1) and cmd = 'SELECT'
            and qual like '%app_empresa_id()%'`,
        [TABLAS_NUEVAS],
      );
      return rows[0]?.n === 6;
    },
    /** Cada política de alta o cambio exige empresa_operable. */
    escrituraSoloSiOpera: async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any ($1) and cmd in ('INSERT', 'UPDATE')
            and coalesce(with_check, qual, '') like '%empresa_operable(%'`,
        [TABLAS_NUEVAS],
      );
      return rows[0]?.n === 9;
    },
    /** La plataforma y los demás roles no ven nada de lo facturado. */
    otrosRolesSinAcceso: async (c) => {
      const { rows } = await c.query(
        `select 1 from information_schema.table_privileges
          where table_schema = 'public' and table_name = any ($1)
            and grantee in ('pedernal_plataforma', 'pedernal_grupo', 'pedernal_trabajos', 'pedernal_autenticacion', 'pedernal_publico', 'pedernal_captacion', 'PUBLIC')`,
        [TABLAS_NUEVAS],
      );
      const { rows: politicas } = await c.query(
        `select 1 from pg_policies where schemaname = 'public' and tablename = any ($1) and roles <> array['pedernal_app']::name[]`,
        [TABLAS_NUEVAS],
      );
      return rows.length === 0 && politicas.length === 0;
    },
    /** Toda única de las tablas nuevas lleva la empresa. */
    unicasConEmpresa: async (c) => {
      const { rows } = await c.query(
        `select 1 from pg_indexes where schemaname = 'public' and tablename = any ($1) and indexdef like 'CREATE UNIQUE%'
            and indexname not like '%\\_pkey' and indexdef not like '%(empresa_id%' and indexdef not like '%(id, empresa_id%'`,
        [TABLAS_NUEVAS],
      );
      return rows.length === 0;
    },
    /** A lo sumo un certificado VIGENTE por emisor y ambiente. */
    unVigentePorAmbiente: async (c) => {
      const ej = viaDueno(c);
      const alta = async (ambiente: string) => {
        const id = randomUUID();
        await c.query(
          `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada, clave_nonce, clave_etiqueta, clave_kid, creado_por)
           values ($1, $2, $3, $9, 'abc', $4, 'P', $5, $6, $7, 'k', $8)`,
          [
            id,
            e.empresa,
            e.emisor,
            e.cuit,
            Buffer.alloc(8),
            Buffer.alloc(12),
            Buffer.alloc(16),
            e.persona,
            ambiente,
          ],
        );
        return id;
      };
      const cargar = (id: string) =>
        ej(
          `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM', huella_sha256 = encode(sha256(gen_random_uuid()::text::bytea), 'hex'), vence_en = now() + interval '1 year' where id = $1`,
          [id],
        );
      const homologacion = await alta("HOMOLOGACION");
      const produccion = await alta("PRODUCCION");
      const otraHomologacion = await alta("HOMOLOGACION");
      // uno vigente por ambiente: los dos ambientes conviven, dos del mismo no
      return (
        (await cargar(homologacion)).ok &&
        (await cargar(produccion)).ok &&
        !(await cargar(otraHomologacion)).ok
      );
    },
    /** Un certificado cargado no cambia. */
    certificadoCargadoInmutable: async (c) => {
      const ej = viaDueno(c);
      const id = randomUUID();
      await c.query(
        `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada, clave_nonce, clave_etiqueta, clave_kid, creado_por)
         values ($1, $2, $3, 'PRODUCCION', 'abc', $4, 'P', $5, $6, $7, 'k', $8)`,
        [
          id,
          e.empresa,
          e.emisor,
          e.cuit,
          Buffer.alloc(8),
          Buffer.alloc(12),
          Buffer.alloc(16),
          e.persona,
        ],
      );
      await ej(
        `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM', huella_sha256 = repeat('a', 64), vence_en = now() + interval '1 year' where id = $1`,
        [id],
      );
      return (
        (await rechaza(ej, "update certificado_arca set certificado_pem = 'otro' where id = $1", [
          id,
        ])) &&
        (await rechaza(ej, "update certificado_arca set clave_kid = 'otra' where id = $1", [id]))
      );
    },
    /** El intento contra ARCA coherente: cada operación termina de una de sus maneras. */
    intentoCoherente: async (c) =>
      rechaza(
        viaDueno(c),
        `insert into intento_arca (empresa_id, comprobante_id, operacion, desenlace, iniciado_en, duracion_ms) values ($1, $2, 'AUTORIZAR', 'ENCONTRADO', now(), 1)`,
        [e.empresa, pendiente],
      ),
  } satisfies Record<string, Sonda>;

  // ---- los debilitamientos ---------------------------------------------------------------------------------------

  /** Reemplaza un trozo del cuerpo de una función (CREATE OR REPLACE) dentro de la transacción. */
  const reescribirFuncion = async (
    c: pg.Client,
    nombre: string,
    de: string,
    a: string,
  ): Promise<void> => {
    const { rows } = await c.query<{ def: string }>(
      "select pg_get_functiondef(oid) as def from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace",
      [nombre],
    );
    const def = rows[0]?.def ?? "";
    if (!def.includes(de)) throw new Error(`la función ${nombre} no contiene «${de}»`);
    await c.query(def.replace(de, a));
  };
  const sql = (texto: string) => async (c: pg.Client) => void (await c.query(texto));

  type Caso = Readonly<{
    regla: string;
    nombre: string;
    sonda: keyof typeof SONDAS;
    debilitar: (c: pg.Client) => Promise<void>;
  }>;

  const CASOS: readonly Caso[] = [
    // ---- identidad e idempotencia ---------------------------------------------------------------------------
    {
      regla: "identidad",
      nombre: "quitar comprobante_identidad_uk",
      sonda: "identidadUnica",
      debilitar: sql("drop index comprobante_identidad_uk"),
    },
    {
      regla: "identidad",
      nombre:
        "quitar el WHERE de comprobante_identidad_uk (un rechazado seguiría ocupando el origen)",
      sonda: "rechazadoLiberaElOrigen",
      debilitar: sql(
        "drop index comprobante_identidad_uk; create unique index comprobante_identidad_uk on comprobante (empresa_id, origen_tipo, origen_id, emisor_id, clase)",
      ),
    },
    {
      regla: "identidad",
      nombre:
        "sacar la clase de comprobante_identidad_uk (la nota de un ticket chocaría con su factura)",
      sonda: "claseEnLaIdentidad",
      debilitar: sql(
        "drop index comprobante_identidad_uk; create unique index comprobante_identidad_uk on comprobante (empresa_id, origen_tipo, origen_id, emisor_id) where estado not in ('RECHAZADO', 'DESCARTADO')",
      ),
    },
    {
      regla: "identidad",
      nombre: "quitar comprobante_manual_uk (una clave manual podría repetirse tras un rechazo)",
      sonda: "claveManualNuncaDosVeces",
      debilitar: sql("drop index comprobante_manual_uk"),
    },
    {
      regla: "identidad",
      nombre: "quitar comprobante_numero_uk (dos autorizados con el mismo número)",
      sonda: "numeroAutorizadoUnico",
      debilitar: sql("drop index comprobante_numero_uk"),
    },
    {
      regla: "identidad",
      nombre: "sacar el ambiente de comprobante_numero_uk (homologación y producción chocarían)",
      sonda: "numeroPorAmbiente",
      debilitar: sql(
        "drop index comprobante_numero_uk; create unique index comprobante_numero_uk on comprobante (empresa_id, punto_de_venta_id, tipo_comprobante, numero) where numero is not null",
      ),
    },
    // ---- estados e inmutabilidad ----------------------------------------------------------------------------
    {
      regla: "estados",
      nombre: "quitar el disparador comprobante_cambio (se podría editar lo enviado)",
      sonda: "contenidoInmutable",
      debilitar: sql("drop trigger comprobante_cambio on comprobante"),
    },
    {
      regla: "estados",
      nombre:
        "dejar que el contenido cambie (sin la comparación de las columnas que no son de estado)",
      sonda: "contenidoInmutable",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "IF (to_jsonb(NEW) - v_de_estado) IS DISTINCT FROM (to_jsonb(OLD) - v_de_estado) THEN",
          "IF false THEN",
        ),
    },
    {
      regla: "estados",
      nombre:
        "permitir RECHAZADO → PENDIENTE en el disparador (la transición que la especificación pide probar)",
      sonda: "transicionesExactas",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "OR (OLD.estado = 'CONFLICTO' AND NEW.estado IN ('PENDIENTE', 'DESCARTADO'))",
          "OR (OLD.estado = 'CONFLICTO' AND NEW.estado IN ('PENDIENTE', 'DESCARTADO'))\n    OR (OLD.estado = 'RECHAZADO' AND NEW.estado = 'PENDIENTE')",
        ),
    },
    {
      regla: "estados",
      nombre:
        "permitir RECHAZADO → AUTORIZADO en el disparador (un rechazado terminaría autorizado)",
      sonda: "transicionesExactas",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "OR (OLD.estado = 'INCIERTO' AND NEW.estado IN ('AUTORIZADO', 'PENDIENTE', 'CONFLICTO'))",
          "OR (OLD.estado = 'INCIERTO' AND NEW.estado IN ('AUTORIZADO', 'PENDIENTE', 'CONFLICTO'))\n    OR (OLD.estado = 'RECHAZADO' AND NEW.estado = 'AUTORIZADO')",
        ),
    },
    {
      // Defensa en profundidad: salir de AUTORIZADO lo frenan el disparador Y el CHECK del autorizado; hay que sacar los dos.
      regla: "estados",
      nombre: "permitir salir de AUTORIZADO en el disparador y sacar el CHECK que también lo frena",
      sonda: "transicionesExactas",
      debilitar: async (c) => {
        await reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "OR (OLD.estado = 'INCIERTO' AND NEW.estado IN ('AUTORIZADO', 'PENDIENTE', 'CONFLICTO'))",
          "OR (OLD.estado = 'INCIERTO' AND NEW.estado IN ('AUTORIZADO', 'PENDIENTE', 'CONFLICTO'))\n    OR (OLD.estado = 'AUTORIZADO' AND NEW.estado = 'RECHAZADO')",
        );
        await c.query("alter table comprobante drop constraint comprobante_autorizado_ck");
      },
    },
    {
      regla: "estados",
      nombre: "dejar que los envíos suban como quieran",
      sonda: "enviosDeAUno",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "IF NEW.envios <> OLD.envios + 1 THEN",
          "IF false THEN",
        ),
    },
    {
      regla: "estados",
      nombre: "dejar que los envíos cambien fuera de la entrada a validación",
      sonda: "enviosDeAUno",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "ELSIF NEW.envios <> OLD.envios THEN",
          "ELSIF false THEN",
        ),
    },
    {
      regla: "estados",
      nombre: "dejar que un INCIERTO se autorice con la respuesta del pedido original",
      sonda: "inciertoSoloPorConsulta",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_cambio",
          "AND NEW.resuelto_por IS DISTINCT FROM 'RECONCILIACION' THEN",
          "AND false THEN",
        ),
    },
    {
      regla: "estados",
      nombre: "darle a la aplicación UPDATE sobre el total",
      sonda: "appNoCambiaElContenido",
      debilitar: sql("grant update (total) on comprobante to pedernal_app"),
    },
    {
      regla: "estados",
      nombre: "darle a la aplicación UPDATE sobre el receptor",
      sonda: "appNoCambiaElContenido",
      debilitar: sql(
        "grant update (receptor_nombre, receptor_documento_numero) on comprobante to pedernal_app",
      ),
    },
    {
      regla: "estados",
      nombre: "quitar la solo inserción de los renglones",
      sonda: "soloInsercion",
      debilitar: sql("drop trigger comprobante_linea_solo_insercion on comprobante_linea"),
    },
    {
      regla: "estados",
      nombre: "quitar la solo inserción del desglose",
      sonda: "soloInsercion",
      debilitar: sql("drop trigger comprobante_alicuota_solo_insercion on comprobante_alicuota"),
    },
    {
      regla: "estados",
      nombre: "quitar el freno del borrado del comprobante",
      sonda: "nadaSeBorra",
      debilitar: sql("drop trigger comprobante_sin_borrado on comprobante"),
    },
    {
      regla: "estados",
      nombre: "quitar el freno de renglones tardíos",
      sonda: "renglonTardio",
      debilitar: sql("drop trigger comprobante_linea_alta on comprobante_linea"),
    },
    {
      regla: "estados",
      nombre:
        "dejar que un renglón entre en cualquier momento (sin mirar que el comprobante nació en esta transacción)",
      sonda: "renglonTardio",
      debilitar: (c) =>
        reescribirFuncion(c, "comprobante_hijo_validar_alta", "AND c.creado_en = now()", ""),
    },
    // ---- serie y numeración ---------------------------------------------------------------------------------
    {
      regla: "serie",
      nombre: "quitar comprobante_coherente_con_serie",
      sonda: "enValidacionExigeReserva",
      debilitar: sql("drop trigger comprobante_coherente_con_serie on comprobante"),
    },
    {
      regla: "serie",
      nombre: "no mirar la solicitud de la serie (cualquier reserva respalda al comprobante)",
      sonda: "reservaAjena",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_serie",
          "OR s.solicitud_en_curso IS DISTINCT FROM c.id",
          "OR false",
        ),
    },
    {
      regla: "serie",
      nombre: "no mirar el número de la reserva de la serie",
      sonda: "reservaConOtroNumero",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_serie",
          "OR s.numero_en_curso IS DISTINCT FROM c.numero_reservado THEN",
          "THEN",
        ),
    },
    {
      regla: "serie",
      nombre:
        "quitar comprobante_serie_con_reserva (la serie podría soltar la reserva de un comprobante en vuelo)",
      sonda: "serieNoSueltaLaReserva",
      debilitar: sql("drop trigger serie_comprobante_con_reserva on serie_comprobante"),
    },
    {
      regla: "serie",
      nombre: "aceptar un autorizado aunque la serie no haya avanzado",
      sonda: "autorizadoExigeLaSerieAvanzada",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_serie",
          "OR s.ultimo_numero < c.numero",
          "OR false",
        ),
    },
    {
      regla: "serie",
      nombre: "aceptar un autorizado aunque la serie conserve su reserva",
      sonda: "autorizadoExigeLaReservaCerrada",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_serie",
          "OR (s.estado = 'EN_CURSO' AND s.solicitud_en_curso IS NOT DISTINCT FROM c.id)",
          "",
        ),
    },
    {
      regla: "serie",
      nombre: "quitar comprobante_en_vuelo_uk",
      sonda: "unEnVueloPorSerie",
      debilitar: sql("drop index comprobante_en_vuelo_uk"),
    },
    {
      regla: "serie",
      nombre: "sacar el ambiente de serie_pkey (el ambiente dejaría de separar las series)",
      sonda: "serieSeparaPorAmbiente",
      debilitar: sql(
        "alter table serie_comprobante drop constraint serie_pkey, add constraint serie_pkey primary key (empresa_id, punto_de_venta_id, tipo_comprobante)",
      ),
    },
    {
      regla: "serie",
      nombre: "dejar que la serie bloqueada salga hacia atrás",
      sonda: "ultimoNumeroNuncaBaja",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "serie_comprobante_validar_cambio",
          "IF NEW.ultimo_numero < OLD.ultimo_numero THEN",
          "IF false THEN",
        ),
    },
    {
      regla: "serie",
      nombre: "dejar que el último número salte sin salir de BLOQUEADA",
      sonda: "ultimoNumeroNuncaBaja",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "serie_comprobante_validar_cambio",
          "AND NOT (OLD.estado = 'BLOQUEADA' AND NEW.estado = 'LIBRE')",
          "AND false",
        ),
    },
    {
      regla: "serie",
      nombre: "volver a darle a la serie un ambiente por defecto",
      sonda: "serieSinAmbienteNoSeCrea",
      debilitar: sql(
        "alter table serie_comprobante alter column ambiente set default 'HOMOLOGACION'",
      ),
    },
    // ---- ambiente -------------------------------------------------------------------------------------------
    {
      regla: "ambiente",
      nombre:
        "quitar el disparador del ambiente del punto de venta (cambiaría con una serie en curso)",
      sonda: "ambienteDelPuntoDeVenta",
      debilitar: sql("drop trigger punto_de_venta_ambiente on punto_de_venta"),
    },
    {
      regla: "ambiente",
      nombre: "dejar que el punto de venta vuelva a homologación después de emitir en producción",
      sonda: "ambienteDelPuntoDeVenta",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "punto_de_venta_validar_ambiente",
          "IF OLD.ambiente = 'PRODUCCION' AND EXISTS (",
          "IF false AND EXISTS (",
        ),
    },
    {
      regla: "ambiente",
      nombre:
        "quitar el disparador de alta de la serie (una serie de producción en un punto de venta de homologación)",
      sonda: "serieNaceEnElAmbienteDelPv",
      debilitar: sql("drop trigger serie_comprobante_alta on serie_comprobante"),
    },
    {
      regla: "ambiente",
      nombre: "dejar que el comprobante nazca en otro ambiente que su punto de venta",
      sonda: "comprobanteNaceEnElAmbienteDelPv",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_alta",
          "\n                OR v_pv.ambiente <> NEW.ambiente)",
          ")",
        ),
    },
    {
      regla: "ambiente",
      nombre:
        "quitar la verificación del ambiente al crear un comprobante (todo el disparador de alta)",
      sonda: "comprobanteNaceEnElAmbienteDelPv",
      debilitar: sql("drop trigger comprobante_alta on comprobante"),
    },
    // ---- dinero y cuadre ------------------------------------------------------------------------------------
    {
      regla: "dinero",
      nombre: "quitar comprobante_cuadra",
      sonda: "cuadra",
      debilitar: sql("drop trigger comprobante_cuadra on comprobante"),
    },
    {
      regla: "dinero",
      nombre:
        "no comprobar que los renglones sumen el total (letra C: no hay desglose que lo repita)",
      sonda: "letraCSumaElTotal",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_cuadre",
          "OR v_suma <> c.total THEN",
          "OR false THEN",
        ),
    },
    {
      regla: "dinero",
      nombre: "no pedir que los renglones empiecen en la posición 1 y no tengan huecos",
      sonda: "renglonesNumeradosDesdeUno",
      debilitar: (c) =>
        reescribirFuncion(c, "comprobante_verificar_cuadre", "OR v_ultima <> v_renglones", ""),
    },
    {
      regla: "dinero",
      nombre: "no comparar cada alícuota del desglose con la suma de sus renglones",
      sonda: "desgloseDeLaMismaAlicuota",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_cuadre",
          "WHERE por_renglon.suma IS DISTINCT FROM por_desglose.total",
          "WHERE false",
        ),
    },
    {
      regla: "dinero",
      nombre: "dejar que la letra C lleve alícuotas",
      sonda: "letraCSinAlicuotas",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_verificar_cuadre",
          "IF v_con_alicuota <> 0 OR v_filas <> 0 THEN",
          "IF false THEN",
        ),
    },
    {
      regla: "dinero",
      nombre: "quitar comprobante_importes_ck",
      sonda: "importesCierran",
      debilitar: sql("alter table comprobante drop constraint comprobante_importes_ck"),
    },
    {
      regla: "dinero",
      nombre:
        "volver al CHECK de importes de la especificación (>= 0 y sin cota: acepta cero y NaN)",
      sonda: "importesCierran",
      debilitar: sql(
        "alter table comprobante drop constraint comprobante_importes_ck; alter table comprobante add constraint comprobante_importes_ck check (total >= 0 and neto_gravado >= 0 and iva >= 0 and exento >= 0 and no_gravado >= 0 and total = neto_gravado + iva + exento + no_gravado)",
      ),
    },
    {
      regla: "dinero",
      nombre: "guardar el total como número de punto flotante",
      sonda: "dineroExactoYMonedaExplicita",
      debilitar: sql(
        "alter table comprobante drop constraint comprobante_importes_ck, drop constraint comprobante_c_sin_iva_ck; alter table comprobante alter column total type double precision",
      ),
    },
    {
      regla: "dinero",
      nombre: "volver a darle a la moneda un valor por defecto",
      sonda: "dineroExactoYMonedaExplicita",
      debilitar: sql("alter table comprobante alter column moneda set default 'ARS'"),
    },
    {
      regla: "dinero",
      nombre:
        "volver al CHECK del autorizado de la especificación (con el hueco de los NULL: un autorizado sin CAE)",
      sonda: "autorizadoExigeCae",
      debilitar: sql(
        `alter table comprobante drop constraint comprobante_autorizado_ck;
         alter table comprobante add constraint comprobante_autorizado_ck check (
           (estado = 'AUTORIZADO') = (numero IS NOT NULL)
           AND (numero IS NULL OR (numero = numero_reservado AND cae ~ '^[0-9]{14}$' AND cae_vence IS NOT NULL
                AND autorizado_en IS NOT NULL AND resuelto_por IN ('RESPUESTA','RECONCILIACION')))
           AND (numero IS NOT NULL OR (cae IS NULL AND cae_vence IS NULL AND autorizado_en IS NULL AND resuelto_por IS NULL)))`,
      ),
    },
    {
      regla: "dinero",
      nombre: "volver al CHECK de servicios de la especificación (acepta solo el fin del período)",
      sonda: "serviciosExigenLasTresFechas",
      debilitar: sql(
        `alter table comprobante drop constraint comprobante_servicio_ck;
         alter table comprobante add constraint comprobante_servicio_ck check (
           (concepto = 'PRODUCTOS') = (servicio_desde IS NULL AND servicio_hasta IS NULL AND vencimiento_pago IS NULL)
           AND (servicio_desde IS NULL OR (servicio_hasta IS NOT NULL AND vencimiento_pago IS NOT NULL AND servicio_desde <= servicio_hasta)))`,
      ),
    },
    {
      regla: "dinero",
      nombre: "no comprobar que la foto del emisor coincida con los datos fiscales",
      sonda: "fotoDelEmisorCoincide",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_alta",
          "IF FOUND AND (v_df.estado <> 'CONFIRMADA'",
          "IF false AND (v_df.estado <> 'CONFIRMADA'",
        ),
    },
    {
      regla: "dinero",
      nombre: "no comprobar que el CUIT del comprobante sea el del emisor",
      sonda: "fotoDelEmisorCoincide",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_alta",
          "IF FOUND AND v_cuit IS DISTINCT FROM NEW.emisor_cuit THEN",
          "IF false THEN",
        ),
    },
    {
      regla: "dinero",
      nombre: "dejar que una nota se asocie a un comprobante que no está AUTORIZADO",
      sonda: "notaSoloSobreAutorizado",
      debilitar: (c) =>
        reescribirFuncion(
          c,
          "comprobante_validar_alta",
          "IF FOUND AND (v_aso.estado <> 'AUTORIZADO'",
          "IF FOUND AND (false",
        ),
    },
    // ---- aislamiento ----------------------------------------------------------------------------------------
    {
      regla: "aislamiento",
      nombre: "quitar FORCE ROW LEVEL SECURITY del comprobante",
      sonda: "rlsForzada",
      debilitar: sql("alter table comprobante no force row level security"),
    },
    {
      regla: "aislamiento",
      nombre: "quitar ENABLE ROW LEVEL SECURITY del ticket de acceso",
      sonda: "rlsForzada",
      debilitar: sql("alter table acceso_arca disable row level security"),
    },
    {
      regla: "aislamiento",
      nombre: "abrir la lectura del comprobante a todas las empresas",
      sonda: "lecturaPorEmpresa",
      debilitar: sql("alter policy comprobante_app_leer on comprobante using (true)"),
    },
    {
      regla: "aislamiento",
      nombre: "abrir la lectura de los certificados a todas las empresas",
      sonda: "lecturaPorEmpresa",
      debilitar: sql("alter policy certificado_arca_app_leer on certificado_arca using (true)"),
    },
    {
      regla: "aislamiento",
      nombre: "quitar empresa_operable de la política de alta del comprobante",
      sonda: "escrituraSoloSiOpera",
      debilitar: sql(
        "alter policy comprobante_app_alta on comprobante with check (empresa_id = (select app_empresa_id()) and creado_por is not distinct from (select app_persona_id()))",
      ),
    },
    {
      regla: "aislamiento",
      nombre: "quitar empresa_operable de la política de cambio del comprobante",
      sonda: "escrituraSoloSiOpera",
      debilitar: sql(
        "alter policy comprobante_app_cambiar on comprobante using (empresa_id = (select app_empresa_id())) with check (empresa_id = (select app_empresa_id()))",
      ),
    },
    {
      regla: "aislamiento",
      nombre: "darle a la plataforma lectura del comprobante",
      sonda: "otrosRolesSinAcceso",
      debilitar: sql(
        "grant select on comprobante to pedernal_plataforma; create policy comprobante_plataforma_leer on comprobante for select to pedernal_plataforma using (true)",
      ),
    },
    {
      regla: "aislamiento",
      nombre: "darle al rol de trabajos lectura de los intentos",
      sonda: "otrosRolesSinAcceso",
      debilitar: sql("grant select on intento_arca to pedernal_trabajos"),
    },
    {
      regla: "aislamiento",
      nombre: "reemplazar la clave foránea compuesta del punto de venta por una simple",
      sonda: "fkCompuestaDelPuntoDeVenta",
      debilitar: sql(
        "alter table comprobante drop constraint comprobante_pv_fkey; alter table comprobante add constraint comprobante_pv_fkey foreign key (punto_de_venta_id) references punto_de_venta (id)",
      ),
    },
    {
      regla: "aislamiento",
      nombre: "agregar una única sin empresa_id a los certificados",
      sonda: "unicasConEmpresa",
      debilitar: sql("create unique index certificado_global_uk on certificado_arca (alias)"),
    },
    // ---- certificados e intentos ----------------------------------------------------------------------------
    {
      regla: "certificados",
      nombre: "quitar certificado_vigente_uk",
      sonda: "unVigentePorAmbiente",
      debilitar: sql("drop index certificado_vigente_uk"),
    },
    {
      regla: "certificados",
      nombre: "sacar el ambiente de certificado_vigente_uk",
      sonda: "unVigentePorAmbiente",
      debilitar: sql(
        "drop index certificado_vigente_uk; create unique index certificado_vigente_uk on certificado_arca (empresa_id) where estado = 'VIGENTE'",
      ),
    },
    {
      regla: "certificados",
      nombre: "quitar el disparador del certificado (se podría pisar uno cargado)",
      sonda: "certificadoCargadoInmutable",
      debilitar: sql("drop trigger certificado_arca_cambio on certificado_arca"),
    },
    {
      regla: "certificados",
      nombre: "permitir cualquier combinación de operación y desenlace en un intento",
      sonda: "intentoCoherente",
      debilitar: sql("alter table intento_arca drop constraint intento_operacion_desenlace_ck"),
    },
  ];

  /** Corre la sonda dentro de una transacción que se deshace: lo que haga (y rompa) no queda. */
  const enTransaccion = async (trabajo: () => Promise<boolean>): Promise<boolean> => {
    await dueno.query("begin");
    try {
      return await trabajo();
    } finally {
      await dueno.query("rollback");
    }
  };

  it("cada sonda pasa sobre la migración sana (si no, un debilitamiento «detectado» no probaría nada)", async () => {
    const fallan: string[] = [];
    for (const [nombre, sonda] of Object.entries(SONDAS) as Array<[string, Sonda]>) {
      const paso = await enTransaccion(() => sonda(dueno)).catch(
        (error: unknown) => `${String(error)}`,
      );
      if (paso !== true) fallan.push(`${nombre}: ${String(paso)}`);
    }
    expect(fallan).toEqual([]);
  });

  it("todas las sondas se usan, hay al menos tres debilitamientos por cada regla importante y ninguna regla queda sin ellos", () => {
    const usadas = new Set(CASOS.map((c) => c.sonda));
    expect([...usadas].sort()).toEqual(Object.keys(SONDAS).sort());
    const porRegla = new Map<string, number>();
    for (const c of CASOS) porRegla.set(c.regla, (porRegla.get(c.regla) ?? 0) + 1);
    for (const regla of ["identidad", "estados", "serie", "ambiente", "dinero", "aislamiento"]) {
      expect(porRegla.get(regla) ?? 0, regla).toBeGreaterThanOrEqual(3);
    }
    expect(CASOS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(CASOS.map((c) => [`${c.regla}: ${c.nombre}`, c] as const))(
    "con la migración rota — %s — la sonda deja de cumplirse",
    async (_nombre, caso) => {
      const sonda: Sonda = SONDAS[caso.sonda];
      const detecta = await enTransaccion(async () => {
        await caso.debilitar(dueno);
        return sonda(dueno);
      });
      expect(detecta, "la sonda tiene que dejar de cumplirse con el debilitamiento").toBe(false);
    },
  );

  // ---- los dos casos de bloqueo: necesitan dos conexiones, así que cada uno con su base --------------------------------

  describe("bloqueos entre transacciones (una base por caso)", () => {
    /** Una transacción abre un comprobante (o una serie) sin confirmar y otra intenta cambiar el ambiente del punto de venta. */
    const bloquea = async (
      b: BaseDePruebas,
      debilitar: ((c: pg.Client) => Promise<void>) | null,
      armar: (a: pg.Client, x: Escenario) => Promise<void>,
    ): Promise<boolean> => {
      const dueno1 = new pg.Client({ connectionString: b.dueno });
      await dueno1.connect();
      const x = await crearEscenario(dueno1);
      if (debilitar !== null) await debilitar(dueno1);
      const a = new pg.Client({ connectionString: b.dueno });
      const c = new pg.Client({ connectionString: b.dueno });
      await a.connect();
      await c.connect();
      try {
        await a.query("begin");
        await armar(a, x);
        await c.query("begin");
        await c.query("set local lock_timeout = '400ms'");
        try {
          await c.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
          return false; // no esperó: el alta no retenía el punto de venta
        } catch (error) {
          return (error as { code?: string }).code === "55P03";
        }
      } finally {
        await a.query("rollback").catch(() => undefined);
        await c.query("rollback").catch(() => undefined);
        await a.end();
        await c.end();
        await dueno1.end();
      }
    };
    const altaDeComprobante = async (a: pg.Client, x: Escenario) => {
      const r = await insertarComprobante(viaDueno(a), datosDeComprobante(x));
      if (!r.ok) throw new Error(r.mensaje);
    };
    const altaDeSerie = async (a: pg.Client, x: Escenario) => {
      await a.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente) values ($1, $2, $3, 'FACTURA_B', 0, 'HOMOLOGACION')`,
        [x.empresa, x.pv, x.emisor],
      );
    };

    it.each([
      [
        "el alta de un comprobante retiene el punto de venta (FOR SHARE)",
        "comprobante_validar_alta",
        altaDeComprobante,
      ],
      [
        "el alta de una serie retiene el punto de venta (FOR SHARE)",
        "serie_comprobante_validar_alta",
        altaDeSerie,
      ],
    ] as const)(
      "%s: sana bloquea el cambio de ambiente; sin el FOR SHARE no",
      async (_n, funcion, armar) => {
        if (base === null) return;
        const sana = await crearBaseAparte(base);
        const rota = await crearBaseAparte(base);
        try {
          expect(await bloquea(sana.base, null, armar), "sana").toBe(true);
          expect(
            await bloquea(
              rota.base,
              (c) => reescribirFuncion(c, funcion, "FOR SHARE;", ";").then(() => undefined),
              armar,
            ),
            "sin el bloqueo",
          ).toBe(false);
        } finally {
          await sana.destruir();
          await rota.destruir();
        }
      },
    );
  });
});
