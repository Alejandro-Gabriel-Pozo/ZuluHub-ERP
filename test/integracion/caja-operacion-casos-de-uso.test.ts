import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { ok } from "../../src/primitivas/resultado/resultado";
import { ERRORES_DE_CAJA_POR_RESTRICCION } from "../../src/modulos/caja/publico";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  CERO,
  armarCierreDeJornada,
  cerrarLaJornada,
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  fechaLocal,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";
import { asignarPlan, crearPlanPublicado } from "./marcas-apoyo";

/**
 * La operación de caja (E3, tramo 5) con los roles limitados y una base real: abrir la sesión con su sello de jornada, iniciar y cancelar
 * el cierre, cerrar con el arqueo (billetes, monedas, otros medios, «conforme general»), ingresos, egresos, ajustes (con `corrigeJornada`)
 * y anulaciones, y las consultas. Cada caso: el guard por módulo y por rol, la empresa opera, el alcance de sucursal, la validación, la
 * idempotencia (la clave ANTES del estado), las reglas, la auditoría en la misma transacción, la atomicidad y el aislamiento entre
 * empresas. La concurrencia está en `caja-operacion-concurrencia.test.ts` y el arqueo exacto y el corte de día, en
 * `caja-operacion-arqueo.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

type Fila = Record<string, unknown>;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";
const BILLETE_DE_MIL = { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO };

describe.skipIf(base === null)("operación de caja: casos de uso y consultas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierreDelDia: ReturnType<typeof armarCierreDeJornada>;
  /** Falla inyectada: cuando está puesta, el repositorio que corresponda lanza DESPUÉS de escribir (para probar la atomicidad). */
  let falla: "NINGUNA" | "DESPUES_DEL_ARQUEO" | "DESPUES_DEL_FONDO" | "EN_LA_AUDITORIA" = "NINGUNA";

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    const conFalla = (tx: TxDeCajaDePrueba): TxDeCajaDePrueba => ({
      ...tx,
      arqueos: {
        ...tx.arqueos,
        guardar: async (...argumentos) => {
          await tx.arqueos.guardar(...argumentos);
          if (falla === "DESPUES_DEL_ARQUEO") throw new Error("falla inyectada tras el arqueo");
        },
      },
      movimientos: {
        ...tx.movimientos,
        insertar: async (nuevo) => {
          const id = await tx.movimientos.insertar(nuevo);
          if (falla === "DESPUES_DEL_FONDO" && nuevo.clase === "FONDO_INICIAL") {
            throw new Error("falla inyectada tras el fondo");
          }
          return id;
        },
      },
      auditoria: {
        registrar: async (registro) => {
          if (falla === "EN_LA_AUDITORIA" && registro.accion !== "MEDIO_DE_PAGO_CREADO") {
            throw new Error("falla inyectada en la auditoría");
          }
          await tx.auditoria.registrar(registro);
        },
      },
    });
    entorno = crearEntornoDeCaja(propia.base, 8, conFalla);
    caja = armarCaja(entorno);
    cierreDelDia = armarCierreDeJornada(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const consultas = () => caja.consultas;
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeOperacion(entornoBase, dueno, caja, opciones);
  const auditorias = (m: MundoDeOperacion, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const constancias = (m: MundoDeOperacion, accion: string) =>
    filas<{ entidad_id: string; actor_persona_id: string; antes: unknown; despues: unknown }>(
      `select entidad_id, actor_persona_id, antes, despues from auditoria_empresa
        where empresa_id = $1 and accion = $2 order by id`,
      [m.empresa, accion],
    );
  /** Todo lo que escribe la operación de una empresa: filas de cada tabla y la cuenta de auditorías. */
  const foto = async (m: MundoDeOperacion) =>
    JSON.stringify({
      sesiones: await filas("select * from sesion_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      movimientos: await filas("select * from movimiento_caja where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      arqueo: await filas(
        "select * from arqueo_caja where empresa_id = $1 order by sesion_id, medio_de_pago_id",
        [m.empresa],
      ),
      billetes: await filas(
        "select * from arqueo_billete where empresa_id = $1 order by sesion_id, denominacion",
        [m.empresa],
      ),
      jornadas: await filas(
        "select * from jornada_de_sucursal where empresa_id = $1 order by fecha_negocio",
        [m.empresa],
      ),
      cajas: await filas("select * from caja where empresa_id = $1 order by id", [m.empresa]),
      auditoria: await contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        m.empresa,
      ]),
    });

  /** El instante de la prueba: el día `dias` desde hoy a las 10:00 (Buenos Aires) más `minutos`. */
  const en = (dias: number, minutos = 0, hora = "10:00") =>
    new Date(instanteLocal(dias, hora).getTime() + minutos * 60_000);
  const ctxEn = (m: MundoDeOperacion, dias = 1, minutos = 0, hora = "10:00") =>
    conAhora(m.ctx(), en(dias, minutos, hora));

  /** Abre una sesión (con la clave nueva) y devuelve su id; lanza si no abre. */
  const abrir = async (
    m: MundoDeOperacion,
    opciones: { fondo?: string; dias?: number; minutos?: number; hora?: string } = {},
  ): Promise<string> => {
    const r = await casos().abrirSesion(ctxEn(m, opciones.dias, opciones.minutos, opciones.hora), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos(opciones.fondo ?? "1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir la sesión: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const ingresar = async (
    m: MundoDeOperacion,
    sesionId: string,
    importe: string,
    motivo = "Cambio",
    ctx = ctxEn(m),
  ): Promise<string> => {
    const r = await casos().registrarMovimientoManual(ctx, {
      claveDeIdempotencia: claveNueva(),
      sesionId,
      sentido: "INGRESO",
      importe: pesos(importe),
      motivo,
    });
    if (!r.ok) throw new Error(`no se pudo ingresar: ${JSON.stringify(r.error)}`);
    return r.valor.movimientoId;
  };
  const medioDe = async (m: MundoDeOperacion, tipo: string, nombre: string | null = null) => {
    const r = await casos().crearMedioDePago(m.ctx(), { tipo, nombre });
    if (!r.ok) throw new Error(`no se pudo crear el medio ${tipo}: ${JSON.stringify(r.error)}`);
    return r.valor.medioDePagoId;
  };
  const cuentaDe = async (m: MundoDeOperacion, tipo: string, nombre: string) => {
    const r = await casos().crearCuentaDeCobro(m.ctx(), {
      tipo,
      nombre,
      identificadorExterno: null,
      sucursalId: m.sucursal,
    });
    if (!r.ok) throw new Error(`no se pudo crear la cuenta ${nombre}: ${JSON.stringify(r.error)}`);
    return r.valor.cuentaDeCobroId;
  };
  /** Un ajuste en otro medio (con o sin cuenta): la forma de dejar un movimiento que no es efectivo (el cobro es del tramo siguiente). */
  const ajustar = async (
    m: MundoDeOperacion,
    sesionId: string,
    medioDePagoId: string,
    importe: string,
    cuentaDeCobroId: string | null = null,
  ) => {
    const r = await casos().registrarAjuste(ctxEn(m), {
      claveDeIdempotencia: claveNueva(),
      sesionId,
      medioDePagoId,
      cuentaDeCobroId,
      importe: pesos(importe),
      motivo: "Dinero sin otro registro",
      corrigeJornada: null,
    });
    if (!r.ok) throw new Error(`no se pudo ajustar: ${JSON.stringify(r.error)}`);
    return r.valor.movimientoId;
  };
  const estadoDe = async (sesionId: string) =>
    (await filas<{ estado: string }>("select estado from sesion_caja where id = $1", [sesionId]))[0]
      ?.estado;
  const esperadoDe = async (sesionId: string) =>
    (
      await filas<{ esperado: string }>(
        "select coalesce(sum(importe), 0)::text as esperado from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.esperado;
  /** Un cobro con origen (como lo dejará el puerto de cobrar): movimiento + fila de `cobro` en la misma transacción, con el rol de la app. */
  const cobroConOrigen = async (m: MundoDeOperacion, sesionId: string, medioId: string) => {
    const origenId = randomUUID();
    const r = await entorno.ejecutar({ contexto: ctxEn(m) }, async (tx) => {
      const { rows } = await sql<{ id: string }>`
        insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, registrado_en, registrado_por,
                                     clave_idempotencia, huella)
        values (${m.empresa}::uuid, ${sesionId}::uuid, 'COBRO', ${medioId}::uuid, 500, ${en(1)}::timestamptz, ${m.persona}::uuid,
                ${claveNueva()}, ${"b".repeat(64)})
        returning id`.execute(tx.db);
      const id = rows[0]?.id as string;
      await sql`insert into cobro (movimiento_id, empresa_id, origen_tipo, origen_id, origen_orden)
                values (${id}::uuid, ${m.empresa}::uuid, 'ventas.cobranza_de_ticket', ${origenId}::uuid, 1)`.execute(
        tx.db,
      );
      return ok(id);
    });
    if (!r.ok) throw new Error(`no se pudo dejar el cobro: ${JSON.stringify(r.error)}`);
    return { movimientoId: r.valor, origenId };
  };
  const bajarElPlan = async (m: MundoDeOperacion) => {
    const { version } = await crearPlanPublicado(dueno, { modulos: ["cierre"] });
    await asignarPlan(dueno, m.tenant, version, { desdeSegundos: -5 });
  };
  const suspenderEmpresa = (empresa: string) =>
    dueno.query("update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      empresa,
    ]);

  // =============================================================================================
  describe("guard, módulos y empresa", () => {
    it("el rol decide cada caso (e3 §3.8): el ajuste es solo de gerente y administrador; sin permiso no se escribe nada", async () => {
      const m = await mundo();
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR", true);
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const sesion = await abrir(m);
      const efectivo = (
        await filas<{ id: string }>(
          "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        )
      )[0]?.id as string;
      const ajuste = (ctx: ReturnType<typeof m.ctx>) =>
        casos().registrarAjuste(conAhora(ctx, en(1)), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          medioDePagoId: efectivo,
          cuentaDeCobroId: null,
          importe: pesos("-5.00"),
          motivo: "Faltante",
          corrigeJornada: null,
        });
      const antes = await foto(m);
      expect(await ajuste(operador()), "operador").toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await foto(m)).toBe(antes);
      expect((await ajuste(m.ctx())).ok, "gerente").toBe(true);
      expect((await ajuste(administrador())).ok, "administrador").toBe(true);
      // Los tres roles abren, ingresan y cierran.
      for (const [rol, ctx] of [
        ["gerente", m.ctx],
        ["administrador", administrador],
        ["operador", operador],
      ] as const) {
        const r = await casos().registrarMovimientoManual(conAhora(ctx(), en(1)), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        });
        expect(r.ok, rol).toBe(true);
      }
    });

    it("el módulo caja sin construir (catálogo real) se rechaza con MODULO_EN_DESARROLLO y uno no activado, con MODULO_NO_ACTIVO", async () => {
      const m = await mundo();
      const real = armarCaja(entorno, REGLAS_DE_EMPRESA);
      const antes = await foto(m);
      expect(
        await real.casos.abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "MODULO_EN_DESARROLLO" });
      const sinModulo = await mundo({ plan: ["cierre"], activados: ["cierre"] });
      expect(
        await casos().abrirSesion(ctxEn(sinModulo), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: sinModulo.sucursal,
          cajaId: sinModulo.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await foto(m)).toBe(antes);
    });

    it("sin persona en el contexto no hay rol ni quién deje constancia: el guard rechaza y no se escribe nada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const sinPersona = { ...ctxEn(m), personaId: null };
      const antes = await foto(m);
      const rechazos = [
        await casos().abrirSesion(sinPersona, {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
        await casos().iniciarCierre(sinPersona, { sesionId: sesion }),
        await casos().registrarMovimientoManual(sinPersona, {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ];
      for (const rechazo of rechazos) {
        expect(rechazo.ok).toBe(false);
        expect(["SIN_PERMISO", "MODULO_NO_ACTIVO"]).toContain(rechazo.ok ? null : rechazo.error);
      }
      expect(await foto(m)).toBe(antes);
    });

    it("con la empresa suspendida nada escribe: EMPRESA_NO_OPERA", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      await suspenderEmpresa(m.empresa);
      const antes = await foto(m);
      const esperado = {
        ok: false,
        error: { codigo: "EMPRESA_NO_OPERA", empresaId: m.empresa, motivo: "EMPRESA_SUSPENDIDA" },
      };
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual(esperado);
      expect(await casos().iniciarCierre(ctxEn(m), { sesionId: sesion })).toEqual(esperado);
      expect(
        await casos().registrarMovimientoManual(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ).toEqual(esperado);
      expect(await foto(m)).toBe(antes);
    });

    it("solo lectura por baja de plan: abrir, ingresar, egresar y ajustar se bloquean; iniciar el cierre, cancelarlo, cerrar y anular se permiten (e3 §3.8)", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const efectivo = (
        await filas<{ id: string }>(
          "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        )
      )[0]?.id as string;
      const movimiento = await ingresar(m, sesion, "10.00");
      await bajarElPlan(m);

      const antes = await foto(m);
      const bloqueados = [
        await casos().abrirSesion(ctxEn(m, 2), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
        await casos().registrarMovimientoManual(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
        await casos().registrarMovimientoManual(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "EGRESO",
          importe: pesos("1.00"),
          motivo: "Retiro",
        }),
        await casos().registrarAjuste(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          medioDePagoId: efectivo,
          cuentaDeCobroId: null,
          importe: pesos("1.00"),
          motivo: "Ajuste",
          corrigeJornada: null,
        }),
      ];
      for (const r of bloqueados) expect(r).toEqual({ ok: false, error: "MODULO_EN_SOLO_LECTURA" });
      expect(await foto(m)).toBe(antes);

      // Lo que completa o cierra sigue permitido.
      expect(await casos().iniciarCierre(ctxEn(m), { sesionId: sesion })).toEqual(
        ok({ yaEstabaEnCierre: false }),
      );
      expect(await casos().cancelarCierre(ctxEn(m), { sesionId: sesion })).toEqual(
        ok({ yaEstabaAbierta: false }),
      );
      expect(
        (
          await casos().anularMovimientoDeCaja(ctxEn(m), {
            claveDeIdempotencia: claveNueva(),
            movimientoId: movimiento,
            motivo: "Me equivoqué",
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await casos().cerrarSesion(ctxEn(m), {
            sesionId: sesion,
            conteo: BILLETE_DE_MIL,
            otros: [],
            conformeGeneral: false,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      // Y mirar.
      expect((await consultas().fichaDeSesion(ctxEn(m), { sesionId: sesion })).ok).toBe(true);
    });
  });

  // =============================================================================================
  describe("alcance de sucursal (el operador solo opera en las suyas)", () => {
    it("un operador sin la sucursal asignada recibe SUCURSAL_FUERA_DE_ALCANCE al abrir, cerrar, anotar, anular y consultar, y no se escribe nada", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const movimiento = await ingresar(m, sesion, "10.00");
      const sinAlcance = await sumarPersona(dueno, m, "OPERADOR", false);
      const ctx = () => conAhora(sinAlcance(), en(1));
      const antes = await foto(m);
      const fuera = { ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" };
      expect(
        await casos().abrirSesion(ctx(), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual(fuera);
      expect(await casos().iniciarCierre(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(await casos().cancelarCierre(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(
        await casos().cerrarSesion(ctx(), {
          sesionId: sesion,
          conteo: BILLETE_DE_MIL,
          otros: [],
          conformeGeneral: false,
          observacion: null,
        }),
      ).toEqual(fuera);
      expect(
        await casos().registrarMovimientoManual(ctx(), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ).toEqual(fuera);
      expect(
        await casos().anularMovimientoDeCaja(ctx(), {
          claveDeIdempotencia: claveNueva(),
          movimientoId: movimiento,
          motivo: "Me equivoqué",
        }),
      ).toEqual(fuera);
      expect(await consultas().resumenDeSesion(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(await consultas().movimientosDeSesion(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(await consultas().prepararCierre(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(await consultas().fichaDeSesion(ctx(), { sesionId: sesion })).toEqual(fuera);
      expect(await consultas().opcionesDeApertura(ctx(), { cajaId: m.cajaId })).toEqual(fuera);
      expect(
        await consultas().listarSesiones(ctx(), {
          sucursalId: m.sucursal,
          desde: "2026-01-01",
          hasta: "2099-01-01",
        }),
      ).toEqual(fuera);
      expect(await foto(m)).toBe(antes);
    });

    it("el operador con la sucursal asignada opera, y lo que anula es solo lo suyo", async () => {
      const m = await mundo();
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const sesion = await abrir(m);
      const ctxOperador = () => conAhora(operador(), en(1));
      const suyo = await ingresar(m, sesion, "10.00", "Cambio", ctxOperador());
      const delGerente = await ingresar(m, sesion, "20.00");
      expect(
        await casos().anularMovimientoDeCaja(ctxOperador(), {
          claveDeIdempotencia: claveNueva(),
          movimientoId: delGerente,
          motivo: "Me equivoqué",
        }),
      ).toEqual({ ok: false, error: "MOVIMIENTO_DE_OTRA_PERSONA" });
      expect(
        (
          await casos().anularMovimientoDeCaja(ctxOperador(), {
            claveDeIdempotencia: claveNueva(),
            movimientoId: suyo,
            motivo: "Me equivoqué",
          })
        ).ok,
      ).toBe(true);
      // El gerente anula lo ajeno.
      expect(
        (
          await casos().anularMovimientoDeCaja(ctxEn(m), {
            claveDeIdempotencia: claveNueva(),
            movimientoId: delGerente,
            motivo: "Error del operador",
          })
        ).ok,
      ).toBe(true);
    });
  });

  // =============================================================================================
  describe("abrirSesion", () => {
    it("abre la sesión con el sello de la jornada, el fondo inicial en efectivo y su auditoría, todo en una transacción", async () => {
      const m = await mundo();
      const ahora = en(1, 0, "10:00");
      const r = await casos().abrirSesion(conAhora(m.ctx(), ahora), {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        cajaId: m.cajaId,
        fondoInicial: pesos("1500.50"),
      });
      expect(r).toEqual(
        ok({
          sesionId: expect.any(String) as unknown,
          fechaDeNegocio: fechaLocal(ahora),
          yaExistia: false,
        }),
      );
      if (!r.ok) return;
      const [sesion] = await filas<Fila>(
        `select caja_id, estado, fecha_negocio::text as fecha, to_char(hora_de_corte, 'HH24:MI') as corte, zona_horaria,
                abierta_en, abierta_por, cerrada_en
           from sesion_caja where id = $1`,
        [r.valor.sesionId],
      );
      expect(sesion).toMatchObject({
        caja_id: m.cajaId,
        estado: "ABIERTA",
        fecha: fechaLocal(ahora),
        corte: "00:00",
        zona_horaria: "America/Argentina/Buenos_Aires",
        abierta_en: ahora,
        abierta_por: m.persona,
        cerrada_en: null,
      });
      const movimientos = await filas<Fila>(
        `select m.clase, m.importe::text as importe, md.tipo, m.cuenta_de_cobro_id, m.registrado_por, m.registrado_en, m.clave_idempotencia
           from movimiento_caja m join medio_de_pago md on md.id = m.medio_de_pago_id where m.sesion_id = $1`,
        [r.valor.sesionId],
      );
      expect(movimientos).toEqual([
        {
          clase: "FONDO_INICIAL",
          importe: "1500.50",
          tipo: "EFECTIVO",
          cuenta_de_cobro_id: null,
          registrado_por: m.persona,
          registrado_en: ahora,
          clave_idempotencia: null,
        },
      ]);
      expect(
        await contar(
          "select count(*) as n from jornada_de_sucursal where empresa_id = $1 and estado = 'ABIERTA' and fecha_negocio = $2",
          [m.empresa, fechaLocal(ahora)],
        ),
      ).toBe(1);
      const [constancia] = await constancias(m, "SESION_CAJA_ABIERTA");
      expect(constancia).toMatchObject({
        entidad_id: r.valor.sesionId,
        actor_persona_id: m.persona,
        despues: {
          cajaId: m.cajaId,
          sucursalId: m.sucursal,
          fechaDeNegocio: fechaLocal(ahora),
          fondoInicial: "1500.50",
        },
      });
      // La auditoría no lleva la clave ni la huella.
      expect(JSON.stringify(constancia)).not.toMatch(/clave|huella/i);
    });

    it("abrir la sesión dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const entrada = {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        cajaId: m.cajaId,
        fondoInicial: pesos("100.00"),
      };
      const primera = await casos().abrirSesion(ctxEn(m), entrada);
      expect(primera.ok && primera.valor.yaExistia).toBe(false);
      const antes = await foto(m);
      const segunda = await casos().abrirSesion(ctxEn(m, 1, 5), entrada);
      expect(segunda).toEqual(
        ok({
          sesionId: primera.ok ? primera.valor.sesionId : "",
          fechaDeNegocio: primera.ok ? primera.valor.fechaDeNegocio : "",
          yaExistia: true,
        }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
    });

    it("la clave se busca ANTES del estado: un reintento tras cerrar la sesión (o con la caja ya abierta de nuevo) devuelve lo hecho", async () => {
      const m = await mundo();
      const entrada = {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal,
        cajaId: m.cajaId,
        fondoInicial: pesos("100.00"),
      };
      const primera = await casos().abrirSesion(ctxEn(m), entrada);
      if (!primera.ok) throw new Error("no abrió");
      expect(
        (
          await casos().cerrarSesion(ctxEn(m, 1, 30), {
            sesionId: primera.valor.sesionId,
            conteo: { billetes: [{ denominacion: 100, cantidad: 1 }], monedas: CERO },
            otros: [],
            conformeGeneral: false,
            observacion: null,
          })
        ).ok,
      ).toBe(true);
      const antes = await foto(m);
      expect(await casos().abrirSesion(ctxEn(m, 1, 40), entrada)).toEqual(
        ok({ ...primera.valor, yaExistia: true }),
      );
      expect(await foto(m)).toBe(antes);
    });

    it("la misma clave con otro contenido es CLAVE_REUTILIZADA y no escribe", async () => {
      const m = await mundo();
      const claveDeIdempotencia = claveNueva();
      const entrada = {
        claveDeIdempotencia,
        sucursalId: m.sucursal,
        cajaId: m.cajaId,
        fondoInicial: pesos("100.00"),
      };
      expect((await casos().abrirSesion(ctxEn(m), entrada)).ok).toBe(true);
      const antes = await foto(m);
      expect(
        await casos().abrirSesion(ctxEn(m), { ...entrada, fondoInicial: pesos("100.01") }),
      ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
      expect(await casos().abrirSesion(ctxEn(m), { ...entrada, cajaId: null })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("una caja con la sesión abierta no se abre de nuevo: CAJA_YA_ABIERTA con el id de la sesión", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("50.00"),
        }),
      ).toEqual({ ok: false, error: { codigo: "CAJA_YA_ABIERTA", sesionId: sesion } });
      // También con la sesión en cierre.
      await casos().iniciarCierre(ctxEn(m), { sesionId: sesion });
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("50.00"),
        }),
      ).toEqual({ ok: false, error: { codigo: "CAJA_YA_ABIERTA", sesionId: sesion } });
      expect(await foto(m)).not.toBe(antes);
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
    });

    it("valida la entrada: clave, fondo (ARS, hasta dos decimales, sin signo, con tope), caja y sucursal", async () => {
      const m = await mundo();
      const antes = await foto(m);
      const entrada = {
        claveDeIdempotencia: claveNueva(),
        sucursalId: m.sucursal as string,
        cajaId: m.cajaId,
        fondoInicial: pesos("10.00"),
      };
      const abrirCon = (cambios: Partial<typeof entrada>) =>
        casos().abrirSesion(ctxEn(m), { ...entrada, ...cambios });
      expect(await abrirCon({ claveDeIdempotencia: "corta" })).toEqual({
        ok: false,
        error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      });
      for (const monto of [
        "-1.00",
        "10.001",
        "-0",
        "1e3",
        "5400abc",
        "",
        "1.000.000.000,00",
        "1000000000.00",
      ]) {
        expect(await abrirCon({ fondoInicial: pesos(monto) }), monto).toEqual({
          ok: false,
          error: "IMPORTE_INVALIDO",
        });
      }
      expect(await abrirCon({ fondoInicial: { moneda: "USD", monto: "10.00" } })).toEqual({
        ok: false,
        error: "MONEDA_NO_SOPORTADA",
      });
      expect(await abrirCon({ cajaId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "CAJA_NO_ENCONTRADA",
      });
      expect(await abrirCon({ cajaId: UUID_QUE_NO_EXISTE })).toEqual({
        ok: false,
        error: "CAJA_NO_ENCONTRADA",
      });
      expect(await abrirCon({ sucursalId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("acepta un fondo de cero y el tope exacto", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "0.00" });
      expect(await esperadoDe(sesion)).toBe("0.00");
      const otra = await mundo();
      const tope = await abrir(otra, { fondo: "999999999.99" });
      expect(await esperadoDe(tope)).toBe("999999999.99");
    });

    it("una caja de otra sucursal, una caja inactiva y una sucursal inactiva no abren", async () => {
      const m = await mundo();
      const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Norte");
      // La caja es de la sucursal Central, no de Norte.
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: otraSucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "CAJA_NO_ENCONTRADA" });
      await dueno.query("update caja set activa = false where id = $1", [m.cajaId]);
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "CAJA_INACTIVA" });
      await dueno.query("update caja set activa = true where id = $1", [m.cajaId]);
      await dueno.query("update sucursal set activa = false where id = $1", [m.sucursal]);
      expect(
        await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_INACTIVA" });
      expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(0);
      expect(
        await contar("select count(*) as n from sesion_caja where empresa_id = $1", [m.empresa]),
      ).toBe(0);
    });

    it("un instante sin fecha de negocio representable es INSTANTE_INVALIDO, sin escribir", async () => {
      const m = await mundo();
      const antes = await foto(m);
      expect(
        await casos().abrirSesion(conAhora(m.ctx(), new Date("9999-12-31T12:00:00Z")), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: m.sucursal,
          cajaId: m.cajaId,
          fondoInicial: pesos("10.00"),
        }),
      ).toEqual({ ok: false, error: "INSTANTE_INVALIDO" });
      expect(await foto(m)).toBe(antes);
    });

    describe("cajaId null (e3 §3.2.1)", () => {
      it("en una sucursal sin cajas asegura la «Caja 1» y abre sobre ella en la misma transacción: caja, sesión, fondo y auditorías", async () => {
        const m = await mundo();
        const sucursalNueva = await otraSucursalDeCaja(dueno, m.empresa, "Sur");
        const r = await casos().abrirSesion(ctxEn(m), {
          claveDeIdempotencia: claveNueva(),
          sucursalId: sucursalNueva,
          cajaId: null,
          fondoInicial: pesos("300.00"),
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const cajas = await filas<{ id: string; nombre: string }>(
          "select id, nombre from caja where empresa_id = $1 and sucursal_id = $2",
          [m.empresa, sucursalNueva],
        );
        expect(cajas.map((c) => c.nombre)).toEqual(["Caja 1"]);
        expect(
          (
            await filas<{ caja_id: string }>("select caja_id from sesion_caja where id = $1", [
              r.valor.sesionId,
            ])
          )[0]?.caja_id,
        ).toBe(cajas[0]?.id);
        expect(await esperadoDe(r.valor.sesionId)).toBe("300.00");
        expect(
          await contar(
            "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'CAJA_CREADA' and entidad_id = $2",
            [m.empresa, cajas[0]?.id],
          ),
        ).toBe(1);
        expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(1);
      });

      it("en una sucursal con una o más cajas es CAJA_REQUERIDA (no se elige por la persona) y no escribe", async () => {
        const m = await mundo();
        const antes = await foto(m);
        expect(
          await casos().abrirSesion(ctxEn(m), {
            claveDeIdempotencia: claveNueva(),
            sucursalId: m.sucursal,
            cajaId: null,
            fondoInicial: pesos("10.00"),
          }),
        ).toEqual({ ok: false, error: "CAJA_REQUERIDA" });
        expect(await foto(m)).toBe(antes);
        // También con la única caja desactivada: la sucursal ya tiene caja.
        await dueno.query("update caja set activa = false where id = $1", [m.cajaId]);
        expect(
          await casos().abrirSesion(ctxEn(m), {
            claveDeIdempotencia: claveNueva(),
            sucursalId: m.sucursal,
            cajaId: null,
            fondoInicial: pesos("10.00"),
          }),
        ).toEqual({ ok: false, error: "CAJA_REQUERIDA" });
        expect(await auditorias(m, "SESION_CAJA_ABIERTA")).toBe(0);
        expect(
          await contar("select count(*) as n from sesion_caja where empresa_id = $1", [m.empresa]),
        ).toBe(0);
        await dueno.query("update caja set activa = true where id = $1", [m.cajaId]);
      });

      it("si falla algo después de crear la «Caja 1» no queda la caja ni la sesión: todo o nada", async () => {
        const m = await mundo();
        const sucursalNueva = await otraSucursalDeCaja(dueno, m.empresa, "Este");
        const antes = await foto(m);
        falla = "DESPUES_DEL_FONDO";
        try {
          await expect(
            casos().abrirSesion(ctxEn(m), {
              claveDeIdempotencia: claveNueva(),
              sucursalId: sucursalNueva,
              cajaId: null,
              fondoInicial: pesos("10.00"),
            }),
          ).rejects.toThrow("falla inyectada tras el fondo");
        } finally {
          falla = "NINGUNA";
        }
        expect(await foto(m)).toBe(antes);
      });
    });

    describe("la jornada la gobierna `cierre` (e3 §3.11.1; §5.5)", () => {
      it("con la jornada en auditoría o cerrada no se abre caja: JORNADA_EN_AUDITORIA / JORNADA_CERRADA, sin escribir nada", async () => {
        const m = await mundo();
        const fecha = fechaLocal(en(1));
        const sesion = await abrir(m);
        expect(
          (
            await casos().cerrarSesion(ctxEn(m, 1, 30), {
              sesionId: sesion,
              conteo: BILLETE_DE_MIL,
              otros: [],
              conformeGeneral: false,
              observacion: null,
            })
          ).ok,
        ).toBe(true);
        const entradaDeJornada = { sucursalId: m.sucursal, fechaDeNegocio: fecha };
        const iniciada = await cierreDelDia.iniciarAuditoria(ctxEn(m, 1, 40), entradaDeJornada);
        expect(iniciada.ok).toBe(true);

        const intento = () =>
          casos().abrirSesion(ctxEn(m, 1, 50), {
            claveDeIdempotencia: claveNueva(),
            sucursalId: m.sucursal,
            cajaId: m.cajaId,
            fondoInicial: pesos("10.00"),
          });
        const antes = await foto(m);
        expect(await intento()).toEqual({ ok: false, error: "JORNADA_EN_AUDITORIA" });
        expect(await foto(m)).toBe(antes);

        expect((await cierreDelDia.cancelarAuditoria(ctxEn(m, 1, 55), entradaDeJornada)).ok).toBe(
          true,
        );
        await cerrarLaJornada(cierreDelDia, ctxEn(m, 1, 58), entradaDeJornada);
        const cerrada = await foto(m);
        expect(await intento()).toEqual({ ok: false, error: "JORNADA_CERRADA" });
        expect(await foto(m)).toBe(cerrada);
        // La jornada siguiente sí abre.
        expect((await abrir(m, { dias: 2 })).length).toBeGreaterThan(0);
      });
    });
  });

  // =============================================================================================
  describe("iniciarCierre y cancelarCierre", () => {
    it("iniciar el cierre congela la sesión: ningún movimiento entra mientras se cuenta (SESION_EN_CIERRE); cancelarlo la devuelve a abierta", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const movimiento = await ingresar(m, sesion, "10.00");
      expect(await casos().iniciarCierre(ctxEn(m, 1, 10), { sesionId: sesion })).toEqual(
        ok({ yaEstabaEnCierre: false }),
      );
      const [fila] = await filas<Fila>(
        "select estado, cierre_iniciado_en, cierre_iniciado_por from sesion_caja where id = $1",
        [sesion],
      );
      expect(fila).toEqual({
        estado: "EN_CIERRE",
        cierre_iniciado_en: en(1, 10),
        cierre_iniciado_por: m.persona,
      });
      expect(await constancias(m, "SESION_CAJA_CIERRE_INICIADO")).toEqual([
        expect.objectContaining({
          entidad_id: sesion,
          actor_persona_id: m.persona,
          antes: { estado: "ABIERTA" },
          despues: { estado: "EN_CIERRE" },
        }),
      ]);

      const antes = await foto(m);
      expect(
        await casos().registrarMovimientoManual(ctxEn(m, 1, 11), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ).toEqual({ ok: false, error: "SESION_EN_CIERRE" });
      expect(
        await casos().anularMovimientoDeCaja(ctxEn(m, 1, 11), {
          claveDeIdempotencia: claveNueva(),
          movimientoId: movimiento,
          motivo: "Me equivoqué",
        }),
      ).toEqual({ ok: false, error: "SESION_EN_CIERRE" });
      expect(await foto(m)).toBe(antes);

      expect(await casos().cancelarCierre(ctxEn(m, 1, 12), { sesionId: sesion })).toEqual(
        ok({ yaEstabaAbierta: false }),
      );
      expect(
        (
          await filas<Fila>(
            "select estado, cierre_iniciado_en, cierre_iniciado_por from sesion_caja where id = $1",
            [sesion],
          )
        )[0],
      ).toEqual({ estado: "ABIERTA", cierre_iniciado_en: null, cierre_iniciado_por: null });
      expect(await constancias(m, "SESION_CAJA_CIERRE_CANCELADO")).toEqual([
        expect.objectContaining({
          entidad_id: sesion,
          antes: { estado: "EN_CIERRE" },
          despues: { estado: "ABIERTA" },
        }),
      ]);
      // Vuelven a entrar movimientos.
      await ingresar(m, sesion, "5.00");
    });

    it("iniciar el cierre dos veces: el segundo devuelve yaEstabaEnCierre y no escribe ni audita", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      expect((await casos().iniciarCierre(ctxEn(m), { sesionId: sesion })).ok).toBe(true);
      const antes = await foto(m);
      expect(await casos().iniciarCierre(ctxEn(m, 1, 5), { sesionId: sesion })).toEqual(
        ok({ yaEstabaEnCierre: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "SESION_CAJA_CIERRE_INICIADO")).toBe(1);
    });

    it("cancelar el cierre de una sesión abierta: devuelve yaEstabaAbierta y no escribe ni audita", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      expect(await casos().cancelarCierre(ctxEn(m), { sesionId: sesion })).toEqual(
        ok({ yaEstabaAbierta: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "SESION_CAJA_CIERRE_CANCELADO")).toBe(0);
    });

    it("una sesión cerrada no se reabre ni se inicia: SESION_CERRADA; una inexistente, SESION_NO_ENCONTRADA", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      await casos().cerrarSesion(ctxEn(m, 1, 10), {
        sesionId: sesion,
        conteo: BILLETE_DE_MIL,
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      const antes = await foto(m);
      expect(await casos().iniciarCierre(ctxEn(m), { sesionId: sesion })).toEqual({
        ok: false,
        error: "SESION_CERRADA",
      });
      expect(await casos().cancelarCierre(ctxEn(m), { sesionId: sesion })).toEqual({
        ok: false,
        error: "SESION_CERRADA",
      });
      for (const sesionId of [UUID_QUE_NO_EXISTE, "no-es-un-uuid"]) {
        expect(await casos().iniciarCierre(ctxEn(m), { sesionId })).toEqual({
          ok: false,
          error: "SESION_NO_ENCONTRADA",
        });
        expect(await casos().cancelarCierre(ctxEn(m), { sesionId })).toEqual({
          ok: false,
          error: "SESION_NO_ENCONTRADA",
        });
      }
      expect(await foto(m)).toBe(antes);
    });
  });

  // =============================================================================================
  describe("cerrarSesion", () => {
    const cerrar = (
      m: MundoDeOperacion,
      sesionId: string,
      resto: Partial<{
        conteo: {
          billetes: { denominacion: number; cantidad: number }[];
          monedas: { moneda: string; monto: string };
        } | null;
        otros: {
          medioDePagoId: string;
          cuentaDeCobroId: string | null;
          contado: { moneda: string; monto: string };
        }[];
        conformeGeneral: boolean;
        observacion: string | null;
      }> = {},
      minutos = 60,
    ) =>
      casos().cerrarSesion(ctxEn(m, 1, minutos), {
        sesionId,
        conteo: BILLETE_DE_MIL,
        otros: [],
        conformeGeneral: false,
        observacion: null,
        ...resto,
      });

    it("cierra con el arqueo calculado en la transacción: estado, billetes, monedas, línea de efectivo y auditoría", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "1000.00" });
      await ingresar(m, sesion, "250.50");
      const r = await cerrar(m, sesion, {
        conteo: {
          billetes: [
            { denominacion: 1000, cantidad: 1 },
            { denominacion: 200, cantidad: 1 },
          ],
          monedas: pesos("50.50"),
        },
        observacion: "Todo bien",
      });
      expect(r).toEqual(
        ok({
          arqueo: [
            {
              medioDePagoId: expect.any(String) as unknown,
              cuentaDeCobroId: null,
              esperado: pesos("1250.50"),
              contado: pesos("1250.50"),
              contadoMonedas: pesos("50.50"),
              conforme: false,
              diferencia: pesos("0.00"),
            },
          ],
          yaEstabaCerrada: false,
        }),
      );
      const [fila] = await filas<Fila>(
        `select estado, cerrada_en, cerrada_por, cierre_iniciado_en, cierre_iniciado_por, observacion from sesion_caja where id = $1`,
        [sesion],
      );
      // Cierre directo desde ABIERTA: el inicio del cierre es el cierre.
      expect(fila).toEqual({
        estado: "CERRADA",
        cerrada_en: en(1, 60),
        cerrada_por: m.persona,
        cierre_iniciado_en: en(1, 60),
        cierre_iniciado_por: m.persona,
        observacion: "Todo bien",
      });
      expect(
        await filas(
          "select denominacion, cantidad from arqueo_billete where sesion_id = $1 order by denominacion desc",
          [sesion],
        ),
      ).toEqual([
        { denominacion: 1000, cantidad: 1 },
        { denominacion: 200, cantidad: 1 },
      ]);
      expect(
        await filas(
          "select esperado::text, contado::text, contado_monedas::text, diferencia::text, conforme from arqueo_caja where sesion_id = $1",
          [sesion],
        ),
      ).toEqual([
        {
          esperado: "1250.50",
          contado: "1250.50",
          contado_monedas: "50.50",
          diferencia: "0.00",
          conforme: false,
        },
      ]);
      const [constancia] = await constancias(m, "SESION_CAJA_CERRADA");
      expect(constancia).toMatchObject({
        entidad_id: sesion,
        antes: { estado: "ABIERTA" },
        despues: {
          estado: "CERRADA",
          lineas: 1,
          lineasConformes: 0,
          efectivoEsperado: "1250.50",
          efectivoContado: "1250.50",
          conDiferencia: false,
        },
      });
      // Sin diferencia no hay entrada de diferencia.
      expect(await auditorias(m, "CIERRE_CON_DIFERENCIA")).toBe(0);
    });

    it("desde EN_CIERRE conserva quién inició el cierre y cuándo", async () => {
      const m = await mundo();
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR", true);
      const sesion = await abrir(m);
      await casos().iniciarCierre(ctxEn(m, 1, 10), { sesionId: sesion });
      const r = await casos().cerrarSesion(conAhora(administrador(), en(1, 20)), {
        sesionId: sesion,
        conteo: BILLETE_DE_MIL,
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(r.ok).toBe(true);
      const [fila] = await filas<Fila>(
        "select cierre_iniciado_en, cierre_iniciado_por, cerrada_en, cerrada_por from sesion_caja where id = $1",
        [sesion],
      );
      expect(fila).toMatchObject({
        cierre_iniciado_en: en(1, 10),
        cierre_iniciado_por: m.persona,
        cerrada_en: en(1, 20),
      });
      expect(fila?.cerrada_por).not.toBe(m.persona);
    });

    it("una línea contada que difiere de lo esperado deja la entrada CIERRE_CON_DIFERENCIA, y nadie aprueba el arqueo", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "1000.00" });
      const r = await cerrar(m, sesion, {
        conteo: { billetes: [{ denominacion: 500, cantidad: 1 }], monedas: pesos("0.25") },
      });
      expect(r.ok && r.valor.arqueo[0]?.diferencia).toEqual(pesos("-499.75"));
      expect(await constancias(m, "CIERRE_CON_DIFERENCIA")).toEqual([
        expect.objectContaining({ entidad_id: sesion, despues: { lineasConDiferencia: 1 } }),
      ]);
      expect((await constancias(m, "SESION_CAJA_CERRADA"))[0]?.despues).toMatchObject({
        efectivoEsperado: "1000.00",
        efectivoContado: "500.25",
        conDiferencia: true,
      });
    });

    it("«conforme general» cubre los medios que no son efectivo, con quién y cuándo, sin diferencia; un total declarado gana sobre el conforme", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const qr = await medioDe(m, "QR", "QR");
      const terminal = await cuentaDe(m, "TERMINAL", "Terminal 1");
      const sesion = await abrir(m);
      await ajustar(m, sesion, debito, "300.00", terminal);
      await ajustar(m, sesion, qr, "120.00");
      const r = await cerrar(m, sesion, {
        otros: [{ medioDePagoId: debito, cuentaDeCobroId: terminal, contado: pesos("290.00") }],
        conformeGeneral: true,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const lineaDe = (medio: string) => r.valor.arqueo.find((l) => l.medioDePagoId === medio);
      // La declarada gana: contada, con su diferencia.
      expect(lineaDe(debito)).toMatchObject({
        conforme: false,
        contado: pesos("290.00"),
        diferencia: pesos("-10.00"),
        esperado: pesos("300.00"),
      });
      // La que no declaró queda conforme: sin contado y sin diferencia.
      expect(lineaDe(qr)).toMatchObject({
        conforme: true,
        contado: null,
        diferencia: null,
        esperado: pesos("120.00"),
      });
      const guardadas = await filas<Fila>(
        "select medio_de_pago_id, conforme, contado::text, diferencia::text, conforme_por, conforme_en from arqueo_caja where sesion_id = $1",
        [sesion],
      );
      const delQr = guardadas.find((l) => l.medio_de_pago_id === qr);
      expect(delQr).toMatchObject({
        conforme: true,
        contado: null,
        diferencia: null,
        conforme_por: m.persona,
        conforme_en: en(1, 60),
      });
      expect(guardadas.find((l) => l.medio_de_pago_id === debito)).toMatchObject({
        conforme: false,
        conforme_por: null,
        conforme_en: null,
      });
      expect((await constancias(m, "SESION_CAJA_CERRADA"))[0]?.despues).toMatchObject({
        lineas: 3,
        lineasConformes: 1,
      });
    });

    it("sin conforme general y sin declarar una línea no efectivo: CONTEO_O_CONFORME_FALTANTE con las líneas que faltan, y no cierra", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const qr = await medioDe(m, "QR", "QR");
      const sesion = await abrir(m);
      await ajustar(m, sesion, debito, "300.00");
      await ajustar(m, sesion, qr, "120.00");
      const antes = await foto(m);
      const r = await cerrar(m, sesion, {
        otros: [{ medioDePagoId: debito, cuentaDeCobroId: null, contado: pesos("300.00") }],
      });
      expect(r).toEqual({
        ok: false,
        error: {
          codigo: "CONTEO_O_CONFORME_FALTANTE",
          lineas: [{ medioDePagoId: qr, cuentaDeCobroId: null }],
        },
      });
      expect(await foto(m)).toBe(antes);
      expect(await estadoDe(sesion)).toBe("ABIERTA");
    });

    it("el conforme general NO cubre el efectivo: sin conteo de efectivo es CONTEO_DE_EFECTIVO_FALTANTE", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      for (const conteo of [null, { billetes: [], monedas: CERO }]) {
        expect(await cerrar(m, sesion, { conteo, conformeGeneral: true })).toEqual({
          ok: false,
          error: "CONTEO_DE_EFECTIVO_FALTANTE",
        });
      }
      expect(await foto(m)).toBe(antes);
    });

    it("un total mal escrito es un error (CONTEO_INVALIDO con el campo): nunca se toma como conforme ni como «sin contar»", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m);
      await ajustar(m, sesion, debito, "300.00");
      const antes = await foto(m);
      for (const monto of ["abc", "-1.00", "10.001", "", "1e3"]) {
        expect(
          await cerrar(m, sesion, {
            otros: [{ medioDePagoId: debito, cuentaDeCobroId: null, contado: pesos(monto) }],
            conformeGeneral: true,
          }),
          monto,
        ).toEqual({ ok: false, error: { codigo: "CONTEO_INVALIDO", campo: "otros.0.contado" } });
      }
      expect(
        await cerrar(m, sesion, {
          conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: pesos("1.001") },
        }),
      ).toEqual({
        ok: false,
        error: { codigo: "CONTEO_INVALIDO", campo: "monedas" },
      });
      expect(await foto(m)).toBe(antes);
    });

    it("billetes: denominación fuera de la lista, cantidad fuera de 0 a 99.999 o no entera, y duplicados", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      const conBilletes = (billetes: { denominacion: number; cantidad: number }[]) =>
        cerrar(m, sesion, { conteo: { billetes, monedas: CERO } });
      expect(await conBilletes([{ denominacion: 50, cantidad: 1 }])).toEqual({
        ok: false,
        error: { codigo: "CONTEO_INVALIDO", campo: "billetes.0.denominacion" },
      });
      for (const cantidad of [-1, 100_000, 1.5, Number.NaN]) {
        expect(await conBilletes([{ denominacion: 1000, cantidad }]), String(cantidad)).toEqual({
          ok: false,
          error: { codigo: "CONTEO_INVALIDO", campo: "billetes.0.cantidad" },
        });
      }
      expect(
        await conBilletes([
          { denominacion: 1000, cantidad: 1 },
          { denominacion: 1000, cantidad: 2 },
        ]),
      ).toEqual({ ok: false, error: "CONTEO_DUPLICADO" });
      expect(await foto(m)).toBe(antes);
      // El cero y el máximo son válidos.
      expect(
        (
          await conBilletes([
            { denominacion: 1000, cantidad: 1 },
            { denominacion: 100, cantidad: 0 },
          ])
        ).ok,
      ).toBe(true);
    });

    it("un total de un medio que no es de la sesión es CONTEO_DE_MEDIO_AJENO, y una observación fuera de la lista permitida, OBSERVACION_INVALIDA", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m);
      const antes = await foto(m);
      expect(
        await cerrar(m, sesion, {
          otros: [{ medioDePagoId: debito, cuentaDeCobroId: null, contado: pesos("1.00") }],
        }),
      ).toEqual({ ok: false, error: "CONTEO_DE_MEDIO_AJENO" });
      expect(await cerrar(m, sesion, { observacion: "<script>" })).toEqual({
        ok: false,
        error: "OBSERVACION_INVALIDA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("cerrar dos veces con el mismo conteo: la segunda devuelve yaEstabaCerrada con el arqueo guardado y no escribe ni audita", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m);
      await ajustar(m, sesion, debito, "40.00");
      const pedido = {
        otros: [{ medioDePagoId: debito, cuentaDeCobroId: null, contado: pesos("40.00") }],
      };
      const primera = await cerrar(m, sesion, pedido);
      expect(primera.ok && primera.valor.yaEstabaCerrada).toBe(false);
      const antes = await foto(m);
      const segunda = await cerrar(m, sesion, pedido, 90);
      expect(segunda).toEqual(
        ok({ arqueo: primera.ok ? primera.valor.arqueo : [], yaEstabaCerrada: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "SESION_CAJA_CERRADA")).toBe(1);
    });

    it("cerrar de nuevo con otro conteo (u otro conforme) es SESION_CERRADA: una cerrada no se reabre ni se recuenta", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m);
      await ajustar(m, sesion, debito, "40.00");
      expect((await cerrar(m, sesion, { conformeGeneral: true })).ok).toBe(true);
      const antes = await foto(m);
      // Otro conteo de efectivo, un total declarado donde había conforme, y un pedido ni siquiera válido.
      expect(
        await cerrar(m, sesion, {
          conteo: { billetes: [{ denominacion: 500, cantidad: 2 }], monedas: CERO },
          conformeGeneral: true,
        }),
      ).toEqual({ ok: false, error: "SESION_CERRADA" });
      expect(
        await cerrar(m, sesion, {
          otros: [{ medioDePagoId: debito, cuentaDeCobroId: null, contado: pesos("40.00") }],
        }),
      ).toEqual({ ok: false, error: "SESION_CERRADA" });
      expect(await cerrar(m, sesion, { conteo: null })).toEqual({
        ok: false,
        error: "SESION_CERRADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("una sesión inexistente es SESION_NO_ENCONTRADA", async () => {
      const m = await mundo();
      expect(await cerrar(m, UUID_QUE_NO_EXISTE)).toEqual({
        ok: false,
        error: "SESION_NO_ENCONTRADA",
      });
    });

    it("cerrada la sesión no entran más movimientos: SESION_CERRADA", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const movimiento = await ingresar(m, sesion, "10.00");
      await cerrar(m, sesion, {
        conteo: {
          billetes: [
            { denominacion: 1000, cantidad: 1 },
            { denominacion: 10, cantidad: 0 },
          ].slice(0, 1),
          monedas: pesos("10.00"),
        },
      });
      expect(
        await casos().registrarMovimientoManual(ctxEn(m, 1, 70), {
          claveDeIdempotencia: claveNueva(),
          sesionId: sesion,
          sentido: "INGRESO",
          importe: pesos("1.00"),
          motivo: "Cambio",
        }),
      ).toEqual({ ok: false, error: "SESION_CERRADA" });
      expect(
        await casos().anularMovimientoDeCaja(ctxEn(m, 1, 70), {
          claveDeIdempotencia: claveNueva(),
          movimientoId: movimiento,
          motivo: "Me equivoqué",
        }),
      ).toEqual({ ok: false, error: "SESION_CERRADA" });
    });

    it("atomicidad: una falla inyectada DESPUÉS de guardar el arqueo deja la sesión abierta, sin arqueo ni billetes ni auditoría", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      falla = "DESPUES_DEL_ARQUEO";
      try {
        await expect(cerrar(m, sesion)).rejects.toThrow("falla inyectada tras el arqueo");
      } finally {
        falla = "NINGUNA";
      }
      expect(await foto(m)).toBe(antes);
      expect(await estadoDe(sesion)).toBe("ABIERTA");
      expect(
        await contar("select count(*) as n from arqueo_caja where sesion_id = $1", [sesion]),
      ).toBe(0);
      expect(
        await contar("select count(*) as n from arqueo_billete where sesion_id = $1", [sesion]),
      ).toBe(0);
      // Y se puede cerrar después.
      expect((await cerrar(m, sesion)).ok).toBe(true);
    });

    it("el efectivo marcado como conforme lo rechaza la base (arqueo_caja_efectivo_conforme) y el mapa lo traduce a CONFORME_NO_ADMITIDO_EN_EFECTIVO", async () => {
      expect(ERRORES_DE_CAJA_POR_RESTRICCION.arqueo_caja_efectivo_conforme).toBe(
        "CONFORME_NO_ADMITIDO_EN_EFECTIVO",
      );
      const m = await mundo();
      const sesion = await abrir(m);
      const efectivo = (
        await filas<{ id: string }>(
          "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        )
      )[0]?.id as string;
      // Con SQL directo y el rol de la app: la sesión se cierra en esta transacción y la línea de efectivo viene como «conforme».
      const r = await entorno.ejecutar({ contexto: ctxEn(m, 1, 30) }, async (tx) => {
        await sql`update sesion_caja set estado = 'CERRADA', cierre_iniciado_en = ${en(1, 30)}::timestamptz, cierre_iniciado_por = ${m.persona}::uuid,
                  cerrada_en = ${en(1, 30)}::timestamptz, cerrada_por = ${m.persona}::uuid where id = ${sesion}::uuid`.execute(
          tx.db,
        );
        await sql`insert into arqueo_caja (empresa_id, sesion_id, medio_de_pago_id, esperado, conforme, conforme_por, conforme_en)
                  values (${m.empresa}::uuid, ${sesion}::uuid, ${efectivo}::uuid, 1000, true, ${m.persona}::uuid, ${en(1, 30)}::timestamptz)`.execute(
          tx.db,
        );
        return ok(null);
      });
      expect(r).toEqual({
        ok: false,
        error: { tipo: "Check", restriccion: "arqueo_caja_efectivo_conforme" },
      });
      expect(await estadoDe(sesion)).toBe("ABIERTA");
    });
  });

  // =============================================================================================
  describe("registrarMovimientoManual (ingreso y egreso de efectivo)", () => {
    const manual = (
      m: MundoDeOperacion,
      sesionId: string,
      resto: Partial<{
        claveDeIdempotencia: string;
        sentido: "INGRESO" | "EGRESO";
        importe: { moneda: string; monto: string };
        motivo: string;
      }> = {},
      minutos = 5,
    ) =>
      casos().registrarMovimientoManual(ctxEn(m, 1, minutos), {
        claveDeIdempotencia: claveNueva(),
        sesionId,
        sentido: "INGRESO",
        importe: pesos("100.00"),
        motivo: "Cambio",
        ...resto,
      });

    it("un ingreso suma y un egreso resta, solo en efectivo y con signo, con su auditoría en la misma transacción", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "1000.00" });
      const ingreso = await manual(m, sesion, {
        importe: pesos("250.50"),
        motivo: "Cambio de otro local",
      });
      const egreso = await manual(m, sesion, {
        sentido: "EGRESO",
        importe: pesos("100.25"),
        motivo: "Compra de hielo",
      });
      expect(ingreso.ok && egreso.ok).toBe(true);
      expect(await esperadoDe(sesion)).toBe("1150.25");
      const filasDelMovimiento = await filas<Fila>(
        `select m.clase, m.importe::text as importe, md.tipo, m.cuenta_de_cobro_id, m.motivo, m.registrado_por, m.registrado_en
           from movimiento_caja m join medio_de_pago md on md.id = m.medio_de_pago_id
          where m.sesion_id = $1 and m.clase <> 'FONDO_INICIAL' order by m.registrado_en, m.clase`,
        [sesion],
      );
      expect(filasDelMovimiento).toEqual([
        {
          clase: "EGRESO_MANUAL",
          importe: "-100.25",
          tipo: "EFECTIVO",
          cuenta_de_cobro_id: null,
          motivo: "Compra de hielo",
          registrado_por: m.persona,
          registrado_en: en(1, 5),
        },
        {
          clase: "INGRESO_MANUAL",
          importe: "250.50",
          tipo: "EFECTIVO",
          cuenta_de_cobro_id: null,
          motivo: "Cambio de otro local",
          registrado_por: m.persona,
          registrado_en: en(1, 5),
        },
      ]);
      const [constancia] = await constancias(m, "MOVIMIENTO_MANUAL_REGISTRADO");
      expect(constancia?.despues).toEqual({
        sesionId: sesion,
        clase: "INGRESO_MANUAL",
        importe: "250.50",
        motivo: "Cambio de otro local",
      });
      expect(JSON.stringify(await constancias(m, "MOVIMIENTO_MANUAL_REGISTRADO"))).not.toMatch(
        /clave|huella/i,
      );
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(2);
      // Un egreso que no supera el efectivo no deja la entrada de aviso.
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(0);
    });

    it("registrar el mismo ingreso dos veces con la misma clave: el segundo devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const entrada = { claveDeIdempotencia: claveNueva(), importe: pesos("33.30") };
      const primero = await manual(m, sesion, entrada);
      expect(primero.ok && primero.valor.yaExistia).toBe(false);
      const antes = await foto(m);
      expect(await manual(m, sesion, entrada, 9)).toEqual(
        ok({ movimientoId: primero.ok ? primero.valor.movimientoId : "", yaExistia: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MOVIMIENTO_MANUAL_REGISTRADO")).toBe(1);
    });

    it("la clave se busca ANTES del estado: el reintento tras el cierre devuelve lo hecho; con otro contenido, CLAVE_REUTILIZADA", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const entrada = { claveDeIdempotencia: claveNueva(), importe: pesos("10.00") };
      const primero = await manual(m, sesion, entrada);
      await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: pesos("10.00") },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      const antes = await foto(m);
      expect(await manual(m, sesion, entrada, 40)).toEqual(
        ok({ movimientoId: primero.ok ? primero.valor.movimientoId : "", yaExistia: true }),
      );
      expect(await manual(m, sesion, { ...entrada, importe: pesos("10.01") }, 40)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await manual(m, sesion, { ...entrada, sentido: "EGRESO" }, 40)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await manual(m, sesion, { ...entrada, motivo: "Otro motivo" }, 40)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("la misma clave en otra sesión de la empresa es otra operación con otro contenido: CLAVE_REUTILIZADA", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const entrada = { claveDeIdempotencia: claveNueva() };
      expect((await manual(m, sesion, entrada)).ok).toBe(true);
      await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: {
          billetes: [
            { denominacion: 1000, cantidad: 1 },
            { denominacion: 100, cantidad: 1 },
          ],
          monedas: CERO,
        },
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      const otra = await abrir(m, { dias: 1, minutos: 120 });
      expect(await manual(m, otra, entrada, 130)).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
    });

    it("valida: clave, importe (ARS, positivo, dos decimales, tope) y motivo obligatorio con lista de permitidos", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      expect(await manual(m, sesion, { claveDeIdempotencia: "corta" })).toEqual({
        ok: false,
        error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      });
      for (const monto of ["0.00", "-5.00", "10.001", "-0", "1e3", "5400abc", "1000000000.00"]) {
        for (const sentido of ["INGRESO", "EGRESO"] as const) {
          expect(
            await manual(m, sesion, { importe: pesos(monto), sentido }),
            `${sentido} ${monto}`,
          ).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
        }
      }
      expect(await manual(m, sesion, { importe: { moneda: "USD", monto: "1.00" } })).toEqual({
        ok: false,
        error: "MONEDA_NO_SOPORTADA",
      });
      for (const motivo of ["", "   ", "<b>x</b>", "a\u0000b"]) {
        expect(await manual(m, sesion, { motivo }), JSON.stringify(motivo)).toEqual({
          ok: false,
          error: "MOTIVO_INVALIDO",
        });
      }
      expect(await manual(m, UUID_QUE_NO_EXISTE)).toEqual({
        ok: false,
        error: "SESION_NO_ENCONTRADA",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("un egreso mayor al efectivo esperado se PERMITE y deja la auditoría EGRESO_SUPERA_EFECTIVO (el esperado puede quedar negativo)", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "100.00" });
      const r = await manual(m, sesion, {
        sentido: "EGRESO",
        importe: pesos("999999999.00"),
        motivo: "Retiro del dueño",
      });
      expect(r.ok).toBe(true);
      expect(await esperadoDe(sesion)).toBe("-999999899.00");
      expect(await constancias(m, "EGRESO_SUPERA_EFECTIVO")).toEqual([
        expect.objectContaining({
          entidad_id: r.ok ? r.valor.movimientoId : "",
          despues: { sesionId: sesion, efectivoEsperadoAntes: "100.00", egreso: "-999999999.00" },
        }),
      ]);
      // Un egreso igual al esperado no lo supera.
      const otra = await mundo();
      const sesionOtra = await abrir(otra, { fondo: "100.00" });
      expect(
        (await manual(otra, sesionOtra, { sentido: "EGRESO", importe: pesos("100.00") })).ok,
      ).toBe(true);
      expect(await auditorias(otra, "EGRESO_SUPERA_EFECTIVO")).toBe(0);
    });

    it("un ingreso no deja el aviso de egreso aunque el esperado esté en negativo", async () => {
      const m = await mundo();
      const sesion = await abrir(m, { fondo: "10.00" });
      await manual(m, sesion, { sentido: "EGRESO", importe: pesos("50.00") });
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
      await manual(m, sesion, { sentido: "INGRESO", importe: pesos("1.00") });
      expect(await auditorias(m, "EGRESO_SUPERA_EFECTIVO")).toBe(1);
    });

    it("atomicidad: si falla la auditoría no queda el movimiento", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const antes = await foto(m);
      falla = "EN_LA_AUDITORIA";
      try {
        await expect(manual(m, sesion)).rejects.toThrow("falla inyectada en la auditoría");
      } finally {
        falla = "NINGUNA";
      }
      expect(await foto(m)).toBe(antes);
    });
  });

  // =============================================================================================
  describe("registrarAjuste", () => {
    const ajuste = (
      m: MundoDeOperacion,
      sesionId: string,
      resto: Partial<{
        claveDeIdempotencia: string;
        medioDePagoId: string;
        cuentaDeCobroId: string | null;
        importe: { moneda: string; monto: string };
        motivo: string;
        corrigeJornada: string | null;
      }> = {},
      ctx = ctxEn(m, 1, 5),
    ) =>
      casos().registrarAjuste(ctx, {
        claveDeIdempotencia: claveNueva(),
        sesionId,
        medioDePagoId: UUID_QUE_NO_EXISTE,
        cuentaDeCobroId: null,
        importe: pesos("-20.00"),
        motivo: "Error de carga",
        corrigeJornada: null,
        ...resto,
      });
    const efectivoDe = async (m: MundoDeOperacion) =>
      (
        await filas<{ id: string }>(
          "select id from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        )
      )[0]?.id as string;

    it("un ajuste con signo en cualquier medio, con o sin cuenta, y su auditoría con corrigeJornada vacío", async () => {
      const m = await mundo();
      const efectivo = await efectivoDe(m);
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const terminal = await cuentaDe(m, "TERMINAL", "Terminal 1");
      const sesion = await abrir(m);
      const enEfectivo = await ajuste(m, sesion, {
        medioDePagoId: efectivo,
        importe: pesos("-20.00"),
      });
      const enDebito = await ajuste(m, sesion, {
        medioDePagoId: debito,
        cuentaDeCobroId: terminal,
        importe: pesos("75.10"),
      });
      const sinCuenta = await ajuste(m, sesion, { medioDePagoId: debito, importe: pesos("1.00") });
      expect(enEfectivo.ok && enDebito.ok && sinCuenta.ok).toBe(true);
      expect(
        await filas(
          "select clase, medio_de_pago_id, cuenta_de_cobro_id, importe::text, motivo, corrige_jornada from movimiento_caja where sesion_id = $1 and clase = 'AJUSTE' order by importe",
          [sesion],
        ),
      ).toEqual([
        {
          clase: "AJUSTE",
          medio_de_pago_id: efectivo,
          cuenta_de_cobro_id: null,
          importe: "-20.00",
          motivo: "Error de carga",
          corrige_jornada: null,
        },
        {
          clase: "AJUSTE",
          medio_de_pago_id: debito,
          cuenta_de_cobro_id: null,
          importe: "1.00",
          motivo: "Error de carga",
          corrige_jornada: null,
        },
        {
          clase: "AJUSTE",
          medio_de_pago_id: debito,
          cuenta_de_cobro_id: terminal,
          importe: "75.10",
          motivo: "Error de carga",
          corrige_jornada: null,
        },
      ]);
      expect((await constancias(m, "AJUSTE_REGISTRADO"))[0]?.despues).toEqual({
        sesionId: sesion,
        medioDePagoId: efectivo,
        cuentaDeCobroId: null,
        importe: "-20.00",
        motivo: "Error de carga",
        corrigeJornada: null,
      });
    });

    it("registrar el mismo ajuste dos veces con la misma clave: el segundo devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const efectivo = await efectivoDe(m);
      const sesion = await abrir(m);
      const entrada = { claveDeIdempotencia: claveNueva(), medioDePagoId: efectivo };
      const primero = await ajuste(m, sesion, entrada);
      const antes = await foto(m);
      expect(await ajuste(m, sesion, entrada, ctxEn(m, 1, 9))).toEqual(
        ok({ movimientoId: primero.ok ? primero.valor.movimientoId : "", yaExistia: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "AJUSTE_REGISTRADO")).toBe(1);
      // Otro contenido con la misma clave.
      expect(await ajuste(m, sesion, { ...entrada, importe: pesos("-20.01") })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      expect(await ajuste(m, sesion, { ...entrada, corrigeJornada: "2020-01-01" })).toEqual({
        ok: false,
        error: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
      });
    });

    it("valida el importe (con signo y distinto de cero), el motivo y la clave", async () => {
      const m = await mundo();
      const efectivo = await efectivoDe(m);
      const sesion = await abrir(m);
      const antes = await foto(m);
      for (const monto of ["0.00", "10.001", "abc", "1000000000.00", "-1000000000.00"]) {
        expect(
          await ajuste(m, sesion, { medioDePagoId: efectivo, importe: pesos(monto) }),
          monto,
        ).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
      }
      expect(await ajuste(m, sesion, { medioDePagoId: efectivo, motivo: " " })).toEqual({
        ok: false,
        error: "MOTIVO_INVALIDO",
      });
      expect(
        await ajuste(m, sesion, { medioDePagoId: efectivo, claveDeIdempotencia: "x" }),
      ).toEqual({ ok: false, error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA" });
      expect(await foto(m)).toBe(antes);
    });

    it("el medio y la cuenta: inexistente, inactivo, cuenta con efectivo, incompatible, inactiva o de otra sucursal", async () => {
      const m = await mundo();
      const efectivo = await efectivoDe(m);
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const transferencia = await medioDe(m, "TRANSFERENCIA", "Transferencia");
      const terminal = await cuentaDe(m, "TERMINAL", "Terminal 1");
      const sesion = await abrir(m);
      const antes = await foto(m);
      expect(await ajuste(m, sesion, { medioDePagoId: UUID_QUE_NO_EXISTE })).toEqual({
        ok: false,
        error: "MEDIO_NO_ENCONTRADO",
      });
      expect(
        await ajuste(m, sesion, { medioDePagoId: efectivo, cuentaDeCobroId: terminal }),
      ).toEqual({ ok: false, error: "CUENTA_DE_COBRO_NO_ADMITIDA" });
      expect(
        await ajuste(m, sesion, { medioDePagoId: debito, cuentaDeCobroId: UUID_QUE_NO_EXISTE }),
      ).toEqual({ ok: false, error: "CUENTA_DE_COBRO_NO_ENCONTRADA" });
      expect(
        await ajuste(m, sesion, { medioDePagoId: transferencia, cuentaDeCobroId: terminal }),
      ).toEqual({ ok: false, error: "CUENTA_DE_COBRO_INCOMPATIBLE" });
      await dueno.query("update cuenta_de_cobro set activa = false where id = $1", [terminal]);
      expect(await ajuste(m, sesion, { medioDePagoId: debito, cuentaDeCobroId: terminal })).toEqual(
        { ok: false, error: "CUENTA_DE_COBRO_INACTIVA" },
      );
      const otraSucursal = await otraSucursalDeCaja(dueno, m.empresa, "Norte");
      const deOtra = (
        await dueno.query<{ id: string }>(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', 'Terminal Norte', $2) returning id",
          [m.empresa, otraSucursal],
        )
      ).rows[0]?.id as string;
      expect(await ajuste(m, sesion, { medioDePagoId: debito, cuentaDeCobroId: deOtra })).toEqual({
        ok: false,
        error: "CUENTA_DE_COBRO_DE_OTRA_SUCURSAL",
      });
      await dueno.query("update medio_de_pago set activo = false where id = $1", [debito]);
      expect(await ajuste(m, sesion, { medioDePagoId: debito })).toEqual({
        ok: false,
        error: "MEDIO_INACTIVO",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("solo con la sesión abierta: SESION_EN_CIERRE y SESION_CERRADA", async () => {
      const m = await mundo();
      const efectivo = await efectivoDe(m);
      const sesion = await abrir(m);
      await casos().iniciarCierre(ctxEn(m, 1, 10), { sesionId: sesion });
      expect(await ajuste(m, sesion, { medioDePagoId: efectivo })).toEqual({
        ok: false,
        error: "SESION_EN_CIERRE",
      });
      await casos().cerrarSesion(ctxEn(m, 1, 20), {
        sesionId: sesion,
        conteo: BILLETE_DE_MIL,
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(await ajuste(m, sesion, { medioDePagoId: efectivo })).toEqual({
        ok: false,
        error: "SESION_CERRADA",
      });
    });

    describe("corrige una jornada ya cerrada (e3 §3.11.3; §5.5)", () => {
      /** Una sesión del día 1 cerrada con su jornada cerrada, y la sesión abierta del día 2 donde se hace el ajuste. */
      const escenarioDeCorreccion = async () => {
        const m = await mundo();
        const efectivo = await efectivoDe(m);
        const ayer = await abrir(m, { dias: 1 });
        await casos().cerrarSesion(ctxEn(m, 1, 60), {
          sesionId: ayer,
          conteo: BILLETE_DE_MIL,
          otros: [],
          conformeGeneral: false,
          observacion: null,
        });
        const jornada = { sucursalId: m.sucursal as string, fechaDeNegocio: fechaLocal(en(1)) };
        await cerrarLaJornada(cierreDelDia, ctxEn(m, 1, 120), jornada);
        const hoy = await abrir(m, { dias: 2 });
        return { m, efectivo, ayer, hoy, jornada };
      };

      it("el ajuste queda enlazado a la jornada cerrada y cae en la fecha de negocio de la sesión de HOY; la jornada cerrada no cambia", async () => {
        const { m, efectivo, hoy, jornada } = await escenarioDeCorreccion();
        const antes = await filas(
          "select * from jornada_de_sucursal where empresa_id = $1 and fecha_negocio = $2",
          [m.empresa, jornada.fechaDeNegocio],
        );
        const arqueoAntes = await filas(
          "select * from arqueo_caja where empresa_id = $1 order by sesion_id",
          [m.empresa],
        );
        const r = await ajuste(
          m,
          hoy,
          {
            medioDePagoId: efectivo,
            importe: pesos("-35.00"),
            corrigeJornada: jornada.fechaDeNegocio,
          },
          ctxEn(m, 2, 5),
        );
        expect(r.ok).toBe(true);
        const [fila] = await filas<Fila>(
          "select corrige_jornada::text as c, sesion_id, clase from movimiento_caja where id = $1",
          [r.ok ? r.valor.movimientoId : ""],
        );
        expect(fila).toEqual({ c: jornada.fechaDeNegocio, sesion_id: hoy, clase: "AJUSTE" });
        // La fecha de negocio es la de la sesión de hoy (la del día en curso), nunca la de la jornada cerrada.
        const ficha = await consultas().fichaDeSesion(ctxEn(m, 2, 6), { sesionId: hoy });
        expect(ficha.ok && ficha.valor.sesion.fechaDeNegocio).toBe(fechaLocal(en(2)));
        expect(fechaLocal(en(2))).not.toBe(jornada.fechaDeNegocio);
        // La jornada cerrada y los arqueos de sus sesiones no cambian.
        expect(
          await filas(
            "select * from jornada_de_sucursal where empresa_id = $1 and fecha_negocio = $2",
            [m.empresa, jornada.fechaDeNegocio],
          ),
        ).toEqual(antes);
        expect(
          await filas("select * from arqueo_caja where empresa_id = $1 order by sesion_id", [
            m.empresa,
          ]),
        ).toEqual(arqueoAntes);
        // La auditoría lleva corrigeJornada, y la consulta de movimientos lo muestra.
        expect((await constancias(m, "AJUSTE_REGISTRADO"))[0]?.despues).toMatchObject({
          corrigeJornada: jornada.fechaDeNegocio,
          importe: "-35.00",
        });
        const movimientos = await consultas().movimientosDeSesion(ctxEn(m, 2, 6), {
          sesionId: hoy,
        });
        expect(
          movimientos.ok &&
            movimientos.valor.movimientos.find((x) => x.clase === "AJUSTE")?.corrigeJornada,
        ).toBe(jornada.fechaDeNegocio);
        // Es un movimiento de hoy: suma al esperado de la sesión de hoy y es anulable ahí mismo.
        expect(await esperadoDe(hoy)).toBe("965.00");
        expect(
          (
            await casos().anularMovimientoDeCaja(ctxEn(m, 2, 7), {
              claveDeIdempotencia: claveNueva(),
              movimientoId: r.ok ? r.valor.movimientoId : "",
              motivo: "Me equivoqué",
            })
          ).ok,
        ).toBe(true);
      });

      it("registrar el mismo ajuste con corrigeJornada dos veces con la misma clave: devuelve yaExistia", async () => {
        const { m, efectivo, hoy, jornada } = await escenarioDeCorreccion();
        const entrada = {
          claveDeIdempotencia: claveNueva(),
          medioDePagoId: efectivo,
          corrigeJornada: jornada.fechaDeNegocio,
        };
        const primero = await ajuste(m, hoy, entrada, ctxEn(m, 2, 5));
        const antes = await foto(m);
        expect(await ajuste(m, hoy, entrada, ctxEn(m, 2, 9))).toEqual(
          ok({ movimientoId: primero.ok ? primero.valor.movimientoId : "", yaExistia: true }),
        );
        expect(await foto(m)).toBe(antes);
      });

      it("la jornada a corregir tiene que existir, estar CERRADA y ser anterior a la de la sesión", async () => {
        const { m, efectivo, hoy } = await escenarioDeCorreccion();
        const corrige = (corrigeJornada: string | null) =>
          ajuste(m, hoy, { medioDePagoId: efectivo, corrigeJornada }, ctxEn(m, 2, 5));
        // Una fecha sin jornada, o que no es una fecha del calendario.
        expect(await corrige("2020-01-01")).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
        });
        expect(await corrige("2026-02-30")).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
        });
        expect(await corrige("no es una fecha")).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_ENCONTRADA",
        });
        // La jornada de la propia sesión sigue ABIERTA: nada que enlazar, se corrige con la corrección de medio o se espera al cierre.
        expect(await corrige(fechaLocal(en(2)))).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_CERRADA",
        });
        // Una jornada cerrada que no es anterior.
        const futura = fechaLocal(en(5));
        await dueno.query(
          "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
          [m.empresa, m.sucursal, futura],
        );
        await cerrarLaJornada(cierreDelDia, ctxEn(m, 5, 10), {
          sucursalId: m.sucursal,
          fechaDeNegocio: futura,
        });
        expect(await corrige(futura)).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_ANTERIOR",
        });
        // Una jornada EN_AUDITORIA tampoco se enlaza.
        const enAuditoria = fechaLocal(en(4));
        await dueno.query(
          "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
          [m.empresa, m.sucursal, enAuditoria],
        );
        await cierreDelDia.iniciarAuditoria(ctxEn(m, 4, 10), {
          sucursalId: m.sucursal,
          fechaDeNegocio: enAuditoria,
        });
        expect(await corrige(enAuditoria)).toEqual({
          ok: false,
          error: "JORNADA_A_CORREGIR_NO_CERRADA",
        });
        expect(
          await contar(
            "select count(*) as n from movimiento_caja where corrige_jornada is not null and empresa_id = $1",
            [m.empresa],
          ),
        ).toBe(0);
      });

      it("la jornada cerrada de OTRA empresa no se enlaza: la jornada se busca en la sucursal de la caja de la sesión", async () => {
        const ajena = await escenarioDeCorreccion();
        const propia = await mundo();
        const sesion = await abrir(propia, { dias: 2 });
        expect(
          await ajuste(
            propia,
            sesion,
            {
              medioDePagoId: await efectivoDe(propia),
              corrigeJornada: ajena.jornada.fechaDeNegocio,
            },
            ctxEn(propia, 2, 5),
          ),
        ).toEqual({ ok: false, error: "JORNADA_A_CORREGIR_NO_ENCONTRADA" });
      });
    });
  });

  // =============================================================================================
  describe("anularMovimientoDeCaja", () => {
    const anular = (
      m: MundoDeOperacion,
      movimientoId: string,
      resto: Partial<{ claveDeIdempotencia: string; motivo: string }> = {},
      ctx = ctxEn(m, 1, 20),
    ) =>
      casos().anularMovimientoDeCaja(ctx, {
        claveDeIdempotencia: claveNueva(),
        movimientoId,
        motivo: "Me equivoqué",
        ...resto,
      });

    it("anular es un registro nuevo: el espejo exacto (mismo medio y cuenta, importe opuesto, motivo), el original queda intacto y el esperado vuelve", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const terminal = await cuentaDe(m, "TERMINAL", "Terminal 1");
      const sesion = await abrir(m, { fondo: "1000.00" });
      const ingreso = await ingresar(m, sesion, "250.50");
      const ajusteConCuenta = await ajustar(m, sesion, debito, "-33.33", terminal);
      const antesDelEsperado = await esperadoDe(sesion);
      expect(antesDelEsperado).toBe("1217.17");
      const originales = await filas(
        "select * from movimiento_caja where id = any($1::uuid[]) order by id",
        [[ingreso, ajusteConCuenta]],
      );

      const a = await anular(m, ingreso, { motivo: "Se cargó dos veces" });
      const b = await anular(m, ajusteConCuenta);
      expect(a.ok && b.ok).toBe(true);
      expect(
        await filas("select * from movimiento_caja where id = any($1::uuid[]) order by id", [
          [ingreso, ajusteConCuenta],
        ]),
      ).toEqual(originales);
      expect(
        await filas(
          "select clase, medio_de_pago_id, cuenta_de_cobro_id, importe::text, motivo, anula_a, registrado_por, registrado_en from movimiento_caja where clase = 'ANULACION' and sesion_id = $1 order by importe",
          [sesion],
        ),
      ).toEqual([
        {
          clase: "ANULACION",
          medio_de_pago_id: expect.any(String) as unknown,
          cuenta_de_cobro_id: null,
          importe: "-250.50",
          motivo: "Se cargó dos veces",
          anula_a: ingreso,
          registrado_por: m.persona,
          registrado_en: en(1, 20),
        },
        {
          clase: "ANULACION",
          medio_de_pago_id: debito,
          cuenta_de_cobro_id: terminal,
          importe: "33.33",
          motivo: "Me equivoqué",
          anula_a: ajusteConCuenta,
          registrado_por: m.persona,
          registrado_en: en(1, 20),
        },
      ]);
      // El esperado vuelve al que tenía antes de los dos movimientos.
      expect(await esperadoDe(sesion)).toBe("1000.00");
      expect((await constancias(m, "MOVIMIENTO_ANULADO"))[0]?.despues).toMatchObject({
        sesionId: sesion,
        movimientoAnuladoId: ingreso,
        clase: "INGRESO_MANUAL",
        importe: "-250.50",
        motivo: "Se cargó dos veces",
      });
      expect(JSON.stringify(await constancias(m, "MOVIMIENTO_ANULADO"))).not.toMatch(
        /clave|huella/i,
      );
      // Se puede cerrar: el arqueo cuenta lo anulado como neutro.
      const cierre = await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: { billetes: [{ denominacion: 1000, cantidad: 1 }], monedas: CERO },
        otros: [],
        conformeGeneral: true,
        observacion: null,
      });
      expect(cierre.ok && cierre.valor.arqueo.map((l) => l.esperado.monto).sort()).toEqual([
        "0.00",
        "1000.00",
      ]);
    });

    it("anular el mismo movimiento dos veces con la misma clave: la segunda devuelve yaExistia y no escribe ni audita", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ingreso = await ingresar(m, sesion, "10.00");
      const entrada = { claveDeIdempotencia: claveNueva() };
      const primera = await anular(m, ingreso, entrada);
      expect(primera.ok && primera.valor.yaExistia).toBe(false);
      const antes = await foto(m);
      expect(await anular(m, ingreso, entrada, ctxEn(m, 1, 25))).toEqual(
        ok({ anulacionId: primera.ok ? primera.valor.anulacionId : "", yaExistia: true }),
      );
      expect(await foto(m)).toBe(antes);
      expect(await auditorias(m, "MOVIMIENTO_ANULADO")).toBe(1);
      // La misma clave con otro motivo (u otro movimiento) es CLAVE_REUTILIZADA.
      expect(await anular(m, ingreso, { ...entrada, motivo: "Otro motivo" })).toEqual({
        ok: false,
        error: "CLAVE_REUTILIZADA",
      });
      const otro = await ingresar(m, sesion, "20.00");
      expect(await anular(m, otro, entrada)).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    });

    it("la clave se busca ANTES del estado: el reintento tras el cierre de la sesión devuelve lo hecho", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ingreso = await ingresar(m, sesion, "10.00");
      const entrada = { claveDeIdempotencia: claveNueva() };
      const primera = await anular(m, ingreso, entrada);
      await casos().cerrarSesion(ctxEn(m, 1, 30), {
        sesionId: sesion,
        conteo: BILLETE_DE_MIL,
        otros: [],
        conformeGeneral: false,
        observacion: null,
      });
      expect(await anular(m, ingreso, entrada, ctxEn(m, 1, 40))).toEqual(
        ok({ anulacionId: primera.ok ? primera.valor.anulacionId : "", yaExistia: true }),
      );
    });

    it("con otra clave, anular lo ya anulado es MOVIMIENTO_YA_ANULADO", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ingreso = await ingresar(m, sesion, "10.00");
      expect((await anular(m, ingreso)).ok).toBe(true);
      const antes = await foto(m);
      expect(await anular(m, ingreso)).toEqual({ ok: false, error: "MOVIMIENTO_YA_ANULADO" });
      expect(await foto(m)).toBe(antes);
    });

    it("nunca el fondo inicial ni una anulación: MOVIMIENTO_NO_ANULABLE", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ingreso = await ingresar(m, sesion, "10.00");
      const anulacion = await anular(m, ingreso);
      const fondo = (
        await filas<{ id: string }>(
          "select id from movimiento_caja where sesion_id = $1 and clase = 'FONDO_INICIAL'",
          [sesion],
        )
      )[0]?.id as string;
      const antes = await foto(m);
      expect(await anular(m, fondo)).toEqual({ ok: false, error: "MOVIMIENTO_NO_ANULABLE" });
      expect(await anular(m, anulacion.ok ? anulacion.valor.anulacionId : "")).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ANULABLE",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("un cobro con origen nunca se anula desde caja: MOVIMIENTO_CON_ORIGEN con su origen, también para el gerente", async () => {
      const m = await mundo();
      const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
      const sesion = await abrir(m);
      const { movimientoId, origenId } = await cobroConOrigen(m, sesion, debito);
      const antes = await foto(m);
      expect(await anular(m, movimientoId)).toEqual({
        ok: false,
        error: {
          codigo: "MOVIMIENTO_CON_ORIGEN",
          origenTipo: "ventas.cobranza_de_ticket",
          origenId,
        },
      });
      expect(await foto(m)).toBe(antes);
    });

    it("valida: motivo obligatorio con lista de permitidos, clave y movimiento existente", async () => {
      const m = await mundo();
      const sesion = await abrir(m);
      const ingreso = await ingresar(m, sesion, "10.00");
      const antes = await foto(m);
      for (const motivo of ["", "  ", "<x>"]) {
        expect(await anular(m, ingreso, { motivo }), JSON.stringify(motivo)).toEqual({
          ok: false,
          error: "MOTIVO_INVALIDO",
        });
      }
      expect(await anular(m, ingreso, { claveDeIdempotencia: "x" })).toEqual({
        ok: false,
        error: "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
      });
      expect(await anular(m, UUID_QUE_NO_EXISTE)).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ENCONTRADO",
      });
      expect(await anular(m, "no-es-un-uuid")).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ENCONTRADO",
      });
      expect(await foto(m)).toBe(antes);
    });

    it("el operador anula solo lo suyo, comparando con la persona del contexto firmado; gerente y administrador, cualquiera", async () => {
      const m = await mundo();
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const otroOperador = await sumarPersona(dueno, m, "OPERADOR", true);
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR", true);
      const sesion = await abrir(m);
      const delOperador = await ingresar(m, sesion, "10.00", "Cambio", conAhora(operador(), en(1)));
      const delOtro = await ingresar(m, sesion, "20.00", "Cambio", conAhora(otroOperador(), en(1)));
      const antes = await foto(m);
      expect(await anular(m, delOtro, {}, conAhora(operador(), en(1, 20)))).toEqual({
        ok: false,
        error: "MOVIMIENTO_DE_OTRA_PERSONA",
      });
      expect(await anular(m, delOperador, {}, conAhora(otroOperador(), en(1, 20)))).toEqual({
        ok: false,
        error: "MOVIMIENTO_DE_OTRA_PERSONA",
      });
      expect(await foto(m)).toBe(antes);
      expect((await anular(m, delOperador, {}, conAhora(operador(), en(1, 20)))).ok).toBe(true);
      expect((await anular(m, delOtro, {}, conAhora(administrador(), en(1, 20)))).ok).toBe(true);
    });

    it("anulablePorElActor y motivoNoAnulable de la consulta coinciden con el resultado real, para cada movimiento y cada rol", async () => {
      for (const rol of ["gerente", "operador"] as const) {
        const m = await mundo();
        const operador = await sumarPersona(dueno, m, "OPERADOR", true);
        const debito = await medioDe(m, "TARJETA_DEBITO", "Débito");
        const sesion = await abrir(m);
        const delOperador = await ingresar(
          m,
          sesion,
          "10.00",
          "Cambio",
          conAhora(operador(), en(1, 1)),
        );
        const delGerente = await ingresar(m, sesion, "20.00", "Cambio", ctxEn(m, 1, 2));
        const yaAnulado = await ingresar(m, sesion, "30.00", "Cambio", ctxEn(m, 1, 3));
        expect((await anular(m, yaAnulado, {}, ctxEn(m, 1, 4))).ok).toBe(true);
        await cobroConOrigen(m, sesion, debito);
        const ctx = () => (rol === "gerente" ? ctxEn(m, 1, 30) : conAhora(operador(), en(1, 30)));
        const pagina = await consultas().movimientosDeSesion(ctx(), { sesionId: sesion });
        expect(pagina.ok).toBe(true);
        if (!pagina.ok) return;
        // Fondo, ingreso del operador, del gerente, el ya anulado, su anulación y el cobro.
        expect(pagina.valor.movimientos).toHaveLength(6);
        const anulables = pagina.valor.movimientos
          .filter((x) => x.anulablePorElActor)
          .map((x) => x.id);
        expect(anulables.sort(), rol).toEqual(
          (rol === "gerente" ? [delOperador, delGerente] : [delOperador]).sort(),
        );
        const codigoDelError: Record<string, string[]> = {
          CON_ORIGEN: ["MOVIMIENTO_CON_ORIGEN"],
          DE_OTRA_PERSONA: ["MOVIMIENTO_DE_OTRA_PERSONA"],
          NO_ANULABLE: ["MOVIMIENTO_NO_ANULABLE", "MOVIMIENTO_YA_ANULADO"],
        };
        for (const movimiento of pagina.valor.movimientos) {
          const real = await anular(m, movimiento.id, {}, ctx());
          if (movimiento.motivoNoAnulable === null) {
            expect(movimiento.anulablePorElActor).toBe(true);
            expect(real.ok, `${rol} ${movimiento.clase}`).toBe(true);
            continue;
          }
          expect(movimiento.anulablePorElActor).toBe(false);
          expect(real.ok, `${rol} ${movimiento.clase}`).toBe(false);
          const error = real.ok ? null : real.error;
          const codigo =
            typeof error === "object" && error !== null && "codigo" in error ? error.codigo : error;
          expect(
            codigoDelError[movimiento.motivoNoAnulable],
            `${rol} ${movimiento.clase}`,
          ).toContain(codigo);
        }
        // Con la sesión en cierre nada es anulable: SESION_NO_ABIERTA, y el caso lo confirma.
        const ultimo = await ingresar(m, sesion, "5.00", "Cambio", ctxEn(m, 1, 35));
        await casos().iniciarCierre(ctxEn(m, 1, 40), { sesionId: sesion });
        const enCierre = await consultas().movimientosDeSesion(ctx(), { sesionId: sesion });
        expect(enCierre.ok && enCierre.valor.movimientos.every((x) => !x.anulablePorElActor)).toBe(
          true,
        );
        expect(
          enCierre.ok &&
            enCierre.valor.movimientos.filter((x) => x.motivoNoAnulable === "SESION_NO_ABIERTA")
              .length,
        ).toBeGreaterThan(0);
        expect(await anular(m, ultimo, {}, ctxEn(m, 1, 41))).toEqual({
          ok: false,
          error: "SESION_EN_CIERRE",
        });
      }
    });
  });
});
