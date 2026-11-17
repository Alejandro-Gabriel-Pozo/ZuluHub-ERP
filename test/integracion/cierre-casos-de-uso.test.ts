import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { huellaDeControles, type AporteAlCierreDelDia } from "../../src/modulos/cierre/publico";
import { crearBaseAparte, crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import {
  FECHA,
  aporteDeActividad,
  aporteFalso,
  armarCierre,
  control,
  crearJornada,
  crearMundoDeCierre,
  otraSucursal,
  prepararTablaDeActividad,
  type Mundo,
  type OpcionesDeMundo,
} from "./cierre-apoyo";

/**
 * El cierre del día (E3b) con los roles limitados y una base real: guard por módulo y por rol, alcance de sucursal, el ciclo de la
 * jornada (iniciar, cancelar, cerrar), «resueltos o reconocidos», la huella que se vio, la atomicidad con aportes que fallan, la
 * idempotencia por estado, el aislamiento entre empresas y las consultas. Los aportes de caja y ventas son falsos: los implementa cada
 * etapa. La concurrencia está en `cierre-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)("cierre del día: casos de uso y consultas", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 8);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    await prepararTablaDeActividad(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const estadoDe = async (m: Mundo, fecha = FECHA) =>
    (
      await filas<{ estado: string }>(
        "select estado from jornada_de_sucursal where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3",
        [m.empresa, m.sucursal, fecha],
      )
    )[0]?.estado;
  const auditorias = (m: Mundo, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const fotos = (m: Mundo) =>
    contar("select count(*) as n from control_de_jornada_cerrada where empresa_id = $1", [
      m.empresa,
    ]);

  /** Una empresa lista (con su jornada creada) y el cierre armado con los aportes dados. */
  const escenario = async (
    aportes: readonly AporteAlCierreDelDia<TxDePrueba>[] = [],
    opciones: OpcionesDeMundo = {},
    conJornada = true,
  ) => {
    const m = await crearMundoDeCierre(entorno, dueno, opciones);
    if (conJornada) await crearJornada(dueno, m);
    const cierre = armarCierre(entorno, aportes);
    const entrada = { sucursalId: m.sucursal, fechaDeNegocio: FECHA };
    const iniciar = () => cierre.casos.iniciarAuditoria(m.ctx(), entrada);
    const cancelar = () => cierre.casos.cancelarAuditoria(m.ctx(), entrada);
    const huella = (controles: Parameters<typeof huellaDeControles>[0]) =>
      huellaDeControles(controles);
    const cerrar = (
      resto: Partial<{
        huellaVista: string;
        reconocimientos: { modulo: string; clave: string; texto: string | null }[];
        observacion: string | null;
      }> = {},
    ) =>
      cierre.casos.cerrarJornada(m.ctx(), {
        ...entrada,
        huellaVista: huella([]),
        reconocimientos: [],
        observacion: null,
        ...resto,
      });
    return { m, cierre, entrada, iniciar, cancelar, cerrar, huella };
  };

  describe("guard, módulos y alcance", () => {
    it("los tres roles pueden iniciar, cancelar y cerrar; sin persona en el contexto no hay permiso", async () => {
      for (const rol of ["GERENTE", "ADMINISTRADOR", "OPERADOR"] as const) {
        const { m, iniciar, cancelar, cerrar } = await escenario([], {
          rol,
          asignarALaSucursal: true,
        });
        expect(await iniciar(), rol).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: false } });
        expect(await cancelar(), rol).toEqual({ ok: true, valor: { yaEstabaAbierta: false } });
        expect(await iniciar(), rol).toMatchObject({ ok: true });
        expect(await cerrar(), rol).toMatchObject({ ok: true });
        expect(await estadoDe(m), rol).toBe("CERRADA");
      }
      // Sin persona (o sin membresía) no hay rol ni módulos para el actor: el guard rechaza las tres, y la jornada no cambia.
      const { m, cierre, entrada } = await escenario();
      const sinPersona = { ...m.ctx(), personaId: null };
      const rechazos = [
        await cierre.casos.iniciarAuditoria(sinPersona, entrada),
        await cierre.casos.cancelarAuditoria(sinPersona, entrada),
        await cierre.casos.cerrarJornada(sinPersona, {
          ...entrada,
          huellaVista: huellaDeControles([]),
          reconocimientos: [],
          observacion: null,
        }),
      ];
      for (const rechazo of rechazos) {
        expect(rechazo.ok).toBe(false);
        expect(["SIN_PERMISO", "MODULO_NO_ACTIVO"]).toContain(rechazo.ok ? null : rechazo.error);
      }
      expect(await estadoDe(m)).toBe("ABIERTA");
    });

    it("sin el módulo cierre activo en la empresa, o fuera de su plan, se aplica el guard del catálogo", async () => {
      // No activado: MODULO_NO_ACTIVO.
      const sinActivar = await escenario([], {
        plan: ["cierre", "facturacion"],
        activados: ["facturacion"],
      });
      expect(await sinActivar.iniciar()).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await sinActivar.cerrar()).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await estadoDe(sinActivar.m)).toBe("ABIERTA");
      // Activado pero fuera del techo del plan (solo lectura): las tres acciones COMPLETA_CIERRA se permiten.
      const enSoloLectura = await escenario([], {
        plan: ["facturacion"],
        activados: ["cierre", "facturacion"],
      });
      expect(await enSoloLectura.iniciar()).toMatchObject({ ok: true });
      expect(await enSoloLectura.cancelar()).toMatchObject({ ok: true });
      expect(await enSoloLectura.iniciar()).toMatchObject({ ok: true });
      expect(await enSoloLectura.cerrar()).toMatchObject({ ok: true });
    });

    it("el operador solo opera en las sucursales de su alcance; gerente y administrador, en todas", async () => {
      const sinAlcance = await escenario([], { rol: "OPERADOR" });
      expect(await sinAlcance.iniciar()).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(await sinAlcance.cancelar()).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await sinAlcance.cerrar()).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(await estadoDe(sinAlcance.m)).toBe("ABIERTA");
      // Con otra sucursal asignada, la propia sigue fuera de alcance.
      const m = await crearMundoDeCierre(entorno, dueno, { rol: "OPERADOR" });
      const otra = await otraSucursal(dueno, m.empresa, "Anexo");
      await dueno.query(
        "insert into asignacion_sucursal (empresa_id, persona_id, sucursal_id) values ($1, $2, $3)",
        [m.empresa, m.persona, otra],
      );
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, []);
      expect(
        await casos.iniciarAuditoria(m.ctx(), { sucursalId: m.sucursal, fechaDeNegocio: FECHA }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      // El administrador opera en cualquiera.
      const admin = await escenario([], { rol: "ADMINISTRADOR" });
      expect(await admin.iniciar()).toMatchObject({ ok: true });
    });
  });

  describe("validación de la entrada", () => {
    it("una fecha que no es una fecha civil real, o una sucursal que no es un UUID, se rechazan sin tocar nada", async () => {
      const { m, cierre } = await escenario();
      for (const fechaDeNegocio of [
        "2026-13-01",
        "2026-02-30",
        "09/11/2026",
        "",
        "2026-11-09T00:00:00Z",
      ]) {
        const entrada = { sucursalId: m.sucursal, fechaDeNegocio };
        expect(await cierre.casos.iniciarAuditoria(m.ctx(), entrada), fechaDeNegocio).toEqual({
          ok: false,
          error: "FECHA_INVALIDA",
        });
      }
      for (const sucursalId of ["", "no-es-un-uuid", `${m.sucursal} `, "' or 1=1 --"]) {
        expect(
          await cierre.casos.iniciarAuditoria(m.ctx(), { sucursalId, fechaDeNegocio: FECHA }),
          sucursalId,
        ).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      }
      expect(await estadoDe(m)).toBe("ABIERTA");
    });

    it("sin actividad ese día la jornada no existe: JORNADA_NO_ENCONTRADA en los tres casos", async () => {
      const { m, cierre } = await escenario([], {}, false);
      const entrada = { sucursalId: m.sucursal, fechaDeNegocio: FECHA };
      expect(await cierre.casos.iniciarAuditoria(m.ctx(), entrada)).toEqual({
        ok: false,
        error: "JORNADA_NO_ENCONTRADA",
      });
      expect(await cierre.casos.cancelarAuditoria(m.ctx(), entrada)).toEqual({
        ok: false,
        error: "JORNADA_NO_ENCONTRADA",
      });
      expect(
        await cierre.casos.cerrarJornada(m.ctx(), {
          ...entrada,
          huellaVista: huellaDeControles([]),
          reconocimientos: [],
          observacion: null,
        }),
      ).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      expect(
        await contar("select count(*) as n from jornada_de_sucursal where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(0);
    });

    it("los reconocimientos y la observación inválidos se rechazan antes de cerrar nada", async () => {
      const e = await escenario();
      await e.iniciar();
      for (const reconocimientos of [
        [{ modulo: "caja", clave: "ventas.x", texto: null }],
        [{ modulo: "Caja", clave: "Caja.x", texto: null }],
        [{ modulo: "caja", clave: "caja.x", texto: "con\nsalto" }],
        [
          { modulo: "caja", clave: "caja.x", texto: null },
          { modulo: "caja", clave: "caja.x", texto: null },
        ],
      ]) {
        expect(await e.cerrar({ reconocimientos })).toEqual({
          ok: false,
          error: "RECONOCIMIENTO_INVALIDO",
        });
      }
      for (const observacion of ["x".repeat(501), "con\nsalto", "<b>"]) {
        expect(await e.cerrar({ observacion })).toEqual({
          ok: false,
          error: "OBSERVACION_INVALIDA",
        });
      }
      expect(await estadoDe(e.m)).toBe("EN_AUDITORIA");
      expect(await fotos(e.m)).toBe(0);
    });
  });

  describe("el ciclo de la jornada", () => {
    it("iniciar la auditoría dos veces: la segunda devuelve yaEstabaEnAuditoria y no escribe ni audita", async () => {
      const e = await escenario();
      const antes = (
        await filas(
          "select version, auditoria_iniciada_en from jornada_de_sucursal where empresa_id = $1",
          [e.m.empresa],
        )
      )[0];
      expect(await e.iniciar()).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: false } });
      const despues = (
        await filas(
          "select version, auditoria_iniciada_en, auditoria_iniciada_por from jornada_de_sucursal where empresa_id = $1",
          [e.m.empresa],
        )
      )[0];
      expect(despues?.["version"]).toBe(Number(antes?.["version"]) + 1);
      expect(despues?.["auditoria_iniciada_por"]).toBe(e.m.persona);
      expect(await e.iniciar()).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: true } });
      expect(await e.iniciar()).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: true } });
      const repetida = (
        await filas(
          "select version, auditoria_iniciada_en from jornada_de_sucursal where empresa_id = $1",
          [e.m.empresa],
        )
      )[0];
      expect(repetida?.["version"]).toBe(despues?.["version"]);
      expect(repetida?.["auditoria_iniciada_en"]).toEqual(despues?.["auditoria_iniciada_en"]);
      expect(await auditorias(e.m, "JORNADA_EN_AUDITORIA")).toBe(1);
    });

    it("cancelar la auditoría dos veces: la segunda devuelve yaEstabaAbierta y no escribe ni audita", async () => {
      const e = await escenario();
      // Cancelar una jornada que nunca empezó tampoco escribe.
      expect(await e.cancelar()).toEqual({ ok: true, valor: { yaEstabaAbierta: true } });
      expect(await auditorias(e.m, "JORNADA_AUDITORIA_CANCELADA")).toBe(0);
      await e.iniciar();
      expect(await e.cancelar()).toEqual({ ok: true, valor: { yaEstabaAbierta: false } });
      expect(await estadoDe(e.m)).toBe("ABIERTA");
      const sinMarcas = (
        await filas(
          "select auditoria_iniciada_en, auditoria_iniciada_por from jornada_de_sucursal where empresa_id = $1",
          [e.m.empresa],
        )
      )[0];
      expect(sinMarcas).toEqual({ auditoria_iniciada_en: null, auditoria_iniciada_por: null });
      const version = (
        await filas("select version from jornada_de_sucursal where empresa_id = $1", [e.m.empresa])
      )[0];
      expect(await e.cancelar()).toEqual({ ok: true, valor: { yaEstabaAbierta: true } });
      expect(
        (
          await filas("select version from jornada_de_sucursal where empresa_id = $1", [
            e.m.empresa,
          ])
        )[0],
      ).toEqual(version);
      expect(await auditorias(e.m, "JORNADA_AUDITORIA_CANCELADA")).toBe(1);
      // Después de cancelar se puede volver a empezar.
      expect(await e.iniciar()).toEqual({ ok: true, valor: { yaEstabaEnAuditoria: false } });
      expect(await auditorias(e.m, "JORNADA_EN_AUDITORIA")).toBe(2);
    });

    it("cerrar con la jornada abierta es JORNADA_NO_EN_AUDITORIA; nada sale de CERRADA", async () => {
      const e = await escenario();
      expect(await e.cerrar()).toEqual({ ok: false, error: "JORNADA_NO_EN_AUDITORIA" });
      await e.iniciar();
      expect(await e.cerrar()).toMatchObject({ ok: true, valor: { yaEstabaCerrada: false } });
      expect(await estadoDe(e.m)).toBe("CERRADA");
      expect(await e.iniciar()).toEqual({ ok: false, error: "JORNADA_CERRADA" });
      expect(await e.cancelar()).toEqual({ ok: false, error: "JORNADA_CERRADA" });
      expect(await estadoDe(e.m)).toBe("CERRADA");
      expect(await auditorias(e.m, "JORNADA_EN_AUDITORIA")).toBe(1);
      expect(await auditorias(e.m, "JORNADA_AUDITORIA_CANCELADA")).toBe(0);
    });

    it("iniciar con un impedimento (como una caja sin cerrar) es JORNADA_CON_IMPEDIMENTOS con su detalle, y no cambia nada", async () => {
      const caja = aporteFalso("facturacion");
      caja.impedimentosActuales = [
        control("facturacion.sesiones_sin_cerrar", "BLOQUEA", 2, "a", ["sesion-1", "sesion-2"]),
        control("facturacion.otro", "BLOQUEA", 0),
      ];
      const e = await escenario([caja]);
      expect(await e.iniciar()).toEqual({
        ok: false,
        error: {
          codigo: "JORNADA_CON_IMPEDIMENTOS",
          impedimentos: [
            {
              modulo: "facturacion",
              clave: "facturacion.sesiones_sin_cerrar",
              cantidad: 2,
              referencias: ["sesion-1", "sesion-2"],
            },
          ],
        },
      });
      expect(await estadoDe(e.m)).toBe("ABIERTA");
      expect(await auditorias(e.m, "JORNADA_EN_AUDITORIA")).toBe(0);
      // Resuelto el impedimento, se puede empezar.
      caja.impedimentosActuales = [];
      expect(await e.iniciar()).toMatchObject({ ok: true });
    });

    it("un impedimento que no es BLOQUEA no impide empezar", async () => {
      const aporte = aporteFalso("facturacion");
      aporte.impedimentosActuales = [
        control("facturacion.solo_informa", "INFORMA", 5),
        control("facturacion.reconocible", "RECONOCIBLE", 5),
      ];
      const e = await escenario([aporte]);
      expect(await e.iniciar()).toMatchObject({ ok: true });
    });
  });

  describe("resueltos o reconocidos", () => {
    it("BLOQUEA con hallazgos frena (con todas sus claves); RECONOCIBLE sin reconocer frena; INFORMA nunca frena", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.bloqueo_a", "BLOQUEA", 1),
        control("facturacion.bloqueo_b", "BLOQUEA", 3),
        control("facturacion.bloqueo_cero", "BLOQUEA", 0),
        control("facturacion.reconocible", "RECONOCIBLE", 2),
        control("facturacion.informa", "INFORMA", 9),
      ]);
      const e = await escenario([aporte]);
      await e.iniciar();
      const huella = e.huella(aporte.controlesActuales);
      expect(await e.cerrar({ huellaVista: huella })).toEqual({
        ok: false,
        error: {
          codigo: "CONTROLES_QUE_BLOQUEAN",
          claves: ["facturacion.bloqueo_a", "facturacion.bloqueo_b"],
        },
      });
      aporte.controlesActuales = aporte.controlesActuales.filter(
        (c) => c.severidad !== "BLOQUEA" || c.cantidad === 0,
      );
      expect(await e.cerrar({ huellaVista: e.huella(aporte.controlesActuales) })).toEqual({
        ok: false,
        error: { codigo: "CONTROLES_SIN_RECONOCER", claves: ["facturacion.reconocible"] },
      });
      expect(await estadoDe(e.m)).toBe("EN_AUDITORIA");
      expect(aporte.congelaciones).toEqual([]);
      expect(await fotos(e.m)).toBe(0);
    });

    it("reconocido sin texto cierra; el cierre guarda la foto con quién y cuándo, y el aporte recibe solo lo suyo", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2),
        control("facturacion.cortesias", "RECONOCIBLE", 1),
        control("facturacion.informa", "INFORMA", 9),
        control("facturacion.sin_hallazgos", "RECONOCIBLE", 0),
      ]);
      const e = await escenario([aporte]);
      await e.iniciar();
      const resultado = await e.cerrar({
        huellaVista: e.huella(aporte.controlesActuales),
        reconocimientos: [
          { modulo: "facturacion", clave: "facturacion.reconocible", texto: null },
          {
            modulo: "facturacion",
            clave: "facturacion.cortesias",
            texto: "  Autorizadas  por el gerente ",
          },
        ],
        observacion: "Sin novedades",
      });
      expect(resultado).toMatchObject({ ok: true, valor: { yaEstabaCerrada: false } });
      expect(await estadoDe(e.m)).toBe("CERRADA");
      const guardados = await filas(
        `select clave, severidad, cantidad, reconocido, reconocido_por, texto, reconocido_en is not null as con_fecha
           from control_de_jornada_cerrada where empresa_id = $1 order by clave`,
        [e.m.empresa],
      );
      expect(guardados).toEqual([
        {
          clave: "facturacion.cortesias",
          severidad: "RECONOCIBLE",
          cantidad: 1,
          reconocido: true,
          reconocido_por: e.m.persona,
          texto: "Autorizadas por el gerente",
          con_fecha: true,
        },
        {
          clave: "facturacion.informa",
          severidad: "INFORMA",
          cantidad: 9,
          reconocido: false,
          reconocido_por: null,
          texto: null,
          con_fecha: false,
        },
        {
          clave: "facturacion.reconocible",
          severidad: "RECONOCIBLE",
          cantidad: 2,
          reconocido: true,
          reconocido_por: e.m.persona,
          texto: null,
          con_fecha: true,
        },
        {
          clave: "facturacion.sin_hallazgos",
          severidad: "RECONOCIBLE",
          cantidad: 0,
          reconocido: false,
          reconocido_por: null,
          texto: null,
          con_fecha: false,
        },
      ]);
      const jornada = (
        await filas(
          "select huella_de_cierre, observacion, cerrada_por from jornada_de_sucursal where empresa_id = $1",
          [e.m.empresa],
        )
      )[0];
      expect(jornada).toEqual({
        huella_de_cierre: e.huella(aporte.controlesActuales),
        observacion: "Sin novedades",
        cerrada_por: e.m.persona,
      });
      // El aporte congeló una sola vez, con sus dos reconocimientos (el texto ya canónico).
      expect(aporte.congelaciones).toEqual([
        [
          { clave: "facturacion.reconocible", texto: null },
          { clave: "facturacion.cortesias", texto: "Autorizadas por el gerente" },
        ],
      ]);
      // La auditoría lleva los controles y cuáles se reconocieron, sin textos ni observación.
      const auditoria = (
        await filas<{ despues: Record<string, unknown> }>(
          "select despues from auditoria_empresa where empresa_id = $1 and accion = 'JORNADA_CERRADA'",
          [e.m.empresa],
        )
      )[0]?.despues;
      expect(JSON.stringify(auditoria)).not.toMatch(/Autorizadas|Sin novedades/);
      expect(auditoria).toMatchObject({
        estado: "CERRADA",
        huella: e.huella(aporte.controlesActuales),
      });
    });

    it("reconocer algo que no se puede reconocer es RECONOCIMIENTO_INVALIDO", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.informa", "INFORMA", 3),
        control("facturacion.reconocible_cero", "RECONOCIBLE", 0),
      ]);
      const e = await escenario([aporte]);
      await e.iniciar();
      for (const clave of [
        "facturacion.informa",
        "facturacion.reconocible_cero",
        "facturacion.no_existe",
      ]) {
        expect(
          await e.cerrar({
            huellaVista: e.huella(aporte.controlesActuales),
            reconocimientos: [{ modulo: "facturacion", clave, texto: null }],
          }),
          clave,
        ).toEqual({ ok: false, error: "RECONOCIMIENTO_INVALIDO" });
      }
      expect(await estadoDe(e.m)).toBe("EN_AUDITORIA");
    });

    it("cerrar contra un cambio de controles: CONTROLES_CAMBIARON con los controles de ahora; con la huella correcta cierra", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2),
      ]);
      const e = await escenario([aporte]);
      await e.iniciar();
      const vista = e.huella(aporte.controlesActuales);
      // Cambia algo entre la pantalla y el cierre: la cantidad, o solo el detalle (misma cantidad).
      for (const cambiado of [
        [control("facturacion.reconocible", "RECONOCIBLE", 3)],
        [control("facturacion.reconocible", "RECONOCIBLE", 2, "b")],
        [
          control("facturacion.reconocible", "RECONOCIBLE", 2),
          control("facturacion.nuevo", "INFORMA", 1),
        ],
        [],
      ]) {
        aporte.controlesActuales = cambiado;
        const r = await e.cerrar({
          huellaVista: vista,
          reconocimientos: [
            { modulo: "facturacion", clave: "facturacion.reconocible", texto: null },
          ],
        });
        expect(r).toMatchObject({ ok: false, error: { codigo: "CONTROLES_CAMBIARON" } });
        expect(r.ok ? null : (r.error as { controles: unknown }).controles).toEqual(cambiado);
      }
      expect(await estadoDe(e.m)).toBe("EN_AUDITORIA");
      expect(aporte.congelaciones).toEqual([]);
      aporte.controlesActuales = [control("facturacion.reconocible", "RECONOCIBLE", 2)];
      expect(
        await e.cerrar({
          huellaVista: vista,
          reconocimientos: [
            { modulo: "facturacion", clave: "facturacion.reconocible", texto: null },
          ],
        }),
      ).toMatchObject({ ok: true });
      // Una huella que no es siquiera hexadecimal también es «cambiaron».
      const otra = await escenario([]);
      await otra.iniciar();
      expect(await otra.cerrar({ huellaVista: "cualquiera" })).toMatchObject({
        ok: false,
        error: { codigo: "CONTROLES_CAMBIARON" },
      });
    });
  });

  describe("módulos activos y aportes que fallan", () => {
    it("un módulo que no está activo en la empresa, o está en desarrollo, no aporta ni impide; uno activo con BLOQUEA frena", async () => {
      const activo = aporteFalso("administracion");
      const noActivo = aporteFalso("facturacion", [control("facturacion.bloqueo", "BLOQUEA", 5)]);
      noActivo.impedimentosActuales = [control("facturacion.bloqueo", "BLOQUEA", 5)];
      const enDesarrollo = aporteFalso("caja", [control("caja.sesiones_sin_cerrar", "BLOQUEA", 5)]);
      enDesarrollo.impedimentosActuales = [control("caja.sesiones_sin_cerrar", "BLOQUEA", 5)];
      // `facturacion` está en el plan pero la empresa no la activó; `caja` todavía está en desarrollo.
      const e = await escenario([activo, noActivo, enDesarrollo], {
        plan: ["cierre", "facturacion"],
        activados: ["cierre"],
      });
      expect(await e.iniciar()).toMatchObject({ ok: true });
      expect(await e.cerrar()).toMatchObject({ ok: true, valor: { controles: [] } });
      expect(noActivo.congelaciones).toEqual([]);
      expect(enDesarrollo.congelaciones).toEqual([]);
      expect(activo.congelaciones).toEqual([[]]);
      // El mismo aporte con BLOQUEA, en un módulo activo, frena.
      const bloqueante = aporteFalso("facturacion", [control("facturacion.bloqueo", "BLOQUEA", 1)]);
      const otro = await escenario([bloqueante]);
      await otro.iniciar();
      expect(
        await otro.cerrar({ huellaVista: otro.huella(bloqueante.controlesActuales) }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "CONTROLES_QUE_BLOQUEAN" },
      });
    });

    it("un aporte que no responde, o que devuelve algo que rompe el contrato, es APORTE_NO_DISPONIBLE: nada se cierra", async () => {
      for (const falla of ["AL_LEER", "DEVUELVE_BASURA"] as const) {
        const aporte = aporteFalso("facturacion");
        aporte.falla = falla;
        const e = await escenario([aporte]);
        // También impide empezar: el aporte no responde para los impedimentos.
        if (falla === "AL_LEER") {
          expect(await e.iniciar(), falla).toEqual({
            ok: false,
            error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "facturacion" },
          });
          aporte.falla = "NINGUNA";
        }
        await e.iniciar();
        aporte.falla = falla;
        expect(await e.cerrar(), falla).toEqual({
          ok: false,
          error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "facturacion" },
        });
        expect(await estadoDe(e.m), falla).toBe("EN_AUDITORIA");
        expect(await fotos(e.m)).toBe(0);
        expect(await auditorias(e.m, "JORNADA_CERRADA")).toBe(0);
      }
    });

    it("atomicidad: un aporte que falla a mitad del cierre deja la jornada en auditoría y ningún aporte con datos congelados", async () => {
      const primero = aporteFalso("facturacion", [control("facturacion.informa", "INFORMA", 1)]);
      const segundo = aporteFalso("administracion");
      // El primero escribe algo propio al congelar; si el segundo falla, eso también se tiene que deshacer.
      primero.alCongelar = async (tx) => {
        await sql`insert into prueba_actividad (empresa_id, sucursal_id, fecha_negocio, tipo)
                  values (${e.m.empresa}, ${e.m.sucursal}, ${FECHA}::date, 'congelado')`.execute(
          tx.db,
        );
      };
      const e = await escenario([primero, segundo], {});
      await e.iniciar();
      for (const falla of ["AL_CONGELAR", "LANZA_AL_CONGELAR"] as const) {
        segundo.falla = falla;
        const r = e.cerrar({ huellaVista: e.huella(primero.controlesActuales) });
        if (falla === "AL_CONGELAR") {
          expect(await r).toEqual({
            ok: false,
            error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "administracion" },
          });
        } else {
          await expect(r).rejects.toThrow("falla inesperada de un aporte");
        }
        expect(await estadoDe(e.m), falla).toBe("EN_AUDITORIA");
        expect(await fotos(e.m), falla).toBe(0);
        expect(await auditorias(e.m, "JORNADA_CERRADA"), falla).toBe(0);
        expect(
          await contar(
            "select count(*) as n from prueba_actividad where empresa_id = $1 and tipo = 'congelado'",
            [e.m.empresa],
          ),
          falla,
        ).toBe(0);
      }
      // Sin la falla, cierra completo: lo del primero y lo del segundo quedan.
      segundo.falla = "NINGUNA";
      expect(await e.cerrar({ huellaVista: e.huella(primero.controlesActuales) })).toMatchObject({
        ok: true,
      });
      expect(
        await contar(
          "select count(*) as n from prueba_actividad where empresa_id = $1 and tipo = 'congelado'",
          [e.m.empresa],
        ),
      ).toBe(1);
      expect(await estadoDe(e.m)).toBe("CERRADA");
    });

    it("un registro con dos aportes del mismo módulo es un error de armado y lanza al crear los casos", () => {
      expect(() =>
        armarCierre(entorno, [aporteFalso("facturacion"), aporteFalso("facturacion")]),
      ).toThrow(/registró dos aportes/);
    });
  });

  describe("doble clic y reintentos al cerrar", () => {
    it("doble clic en «Cerrar el día»: un solo cierre, una sola foto de controles y una sola auditoría; el segundo devuelve yaEstabaCerrada", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2),
        control("facturacion.informa", "INFORMA", 4),
      ]);
      const e = await escenario([aporte]);
      await e.iniciar();
      const pedido = {
        huellaVista: e.huella(aporte.controlesActuales),
        reconocimientos: [
          { modulo: "facturacion", clave: "facturacion.reconocible", texto: "Revisado" },
        ],
        observacion: "Cierre normal",
      };
      const primero = await e.cerrar(pedido);
      expect(primero).toMatchObject({ ok: true, valor: { yaEstabaCerrada: false } });
      const version = (
        await filas("select version, cerrada_en from jornada_de_sucursal where empresa_id = $1", [
          e.m.empresa,
        ])
      )[0];
      // Repetido tal cual (reintento de red, otra pestaña): ok, sin escribir.
      for (let i = 0; i < 3; i++) {
        const otra = await e.cerrar(pedido);
        expect(otra).toMatchObject({ ok: true, valor: { yaEstabaCerrada: true } });
        expect(
          otra.ok && otra.valor.controles.map((c) => [c.clave, c.cantidad, c.reconocido, c.texto]),
        ).toEqual([
          ["facturacion.informa", 4, false, null],
          ["facturacion.reconocible", 2, true, "Revisado"],
        ]);
      }
      expect(
        (
          await filas("select version, cerrada_en from jornada_de_sucursal where empresa_id = $1", [
            e.m.empresa,
          ])
        )[0],
      ).toEqual(version);
      expect(await fotos(e.m)).toBe(2);
      expect(await auditorias(e.m, "JORNADA_CERRADA")).toBe(1);
      expect(aporte.congelaciones).toHaveLength(1);
      // Con otros reconocimientos, otra observación u otra huella es otro cierre sobre una jornada congelada.
      const reconocimientos = [
        { modulo: "facturacion", clave: "facturacion.reconocible", texto: "Otro texto" },
      ];
      for (const distinto of [
        { ...pedido, reconocimientos },
        { ...pedido, reconocimientos: [] },
        { ...pedido, observacion: null },
        { ...pedido, huellaVista: "b".repeat(64) },
      ]) {
        expect(await e.cerrar(distinto)).toEqual({ ok: false, error: "JORNADA_CERRADA" });
      }
      expect(await fotos(e.m)).toBe(2);
      expect(await auditorias(e.m, "JORNADA_CERRADA")).toBe(1);
    });
  });

  describe("aislamiento entre empresas", () => {
    it("una empresa no ve ni cierra la jornada de otra, aunque conozca su sucursal", async () => {
      const a = await escenario();
      await a.iniciar();
      const b = await escenario();
      const { casos, consultas } = armarCierre(entorno, []);
      const hacia = { sucursalId: a.m.sucursal, fechaDeNegocio: FECHA };
      // El gerente de la empresa B pide la sucursal de A: para él no existe.
      for (const resultado of [
        await casos.iniciarAuditoria(b.m.ctx(), hacia),
        await casos.cancelarAuditoria(b.m.ctx(), hacia),
        await casos.cerrarJornada(b.m.ctx(), {
          ...hacia,
          huellaVista: huellaDeControles([]),
          reconocimientos: [],
          observacion: null,
        }),
      ]) {
        expect(resultado).toEqual({ ok: false, error: "JORNADA_NO_ENCONTRADA" });
      }
      expect(await consultas.estadoDeJornada(b.m.ctx(), hacia)).toMatchObject({
        ok: true,
        valor: { estado: "SIN_ACTIVIDAD" },
      });
      expect(
        await consultas.listarJornadas(b.m.ctx(), {
          sucursalId: a.m.sucursal,
          desde: FECHA,
          hasta: FECHA,
        }),
      ).toEqual({ ok: true, valor: [] });
      expect(await estadoDe(a.m)).toBe("EN_AUDITORIA");
    });
  });

  describe("consultas", () => {
    it("estadoDeJornada: SIN_ACTIVIDAD, ABIERTA, EN_AUDITORIA y CERRADA con quién y cuándo", async () => {
      const e = await escenario([], {}, false);
      const consultar = () => e.cierre.consultas.estadoDeJornada(e.m.ctx(), e.entrada);
      expect(await consultar()).toMatchObject({
        ok: true,
        valor: { estado: "SIN_ACTIVIDAD", cerradaEn: null },
      });
      await crearJornada(dueno, e.m);
      expect(await consultar()).toMatchObject({ ok: true, valor: { estado: "ABIERTA" } });
      await e.iniciar();
      expect(await consultar()).toMatchObject({
        ok: true,
        valor: { estado: "EN_AUDITORIA", auditoriaIniciadaPor: e.m.persona, cerradaEn: null },
      });
      await e.cerrar({ observacion: "Listo" });
      const cerrada = await consultar();
      expect(cerrada).toMatchObject({
        ok: true,
        valor: { estado: "CERRADA", cerradaPor: e.m.persona, observacion: "Listo" },
      });
      expect(cerrada.ok && cerrada.valor.cerradaEn).toBeInstanceOf(Date);
    });

    it("listarJornadas: de la más nueva a la más vieja, entre las fechas, con el tope; la fecha de negocio no se corre un día", async () => {
      const e = await escenario([], {}, false);
      for (const fecha of ["2026-11-07", "2026-11-09", "2026-11-08", "2026-12-31", "2027-01-01"]) {
        await crearJornada(dueno, e.m, fecha);
      }
      const lista = await e.cierre.consultas.listarJornadas(e.m.ctx(), {
        sucursalId: e.m.sucursal,
        desde: "2026-11-08",
        hasta: "2026-12-31",
      });
      expect(lista.ok && lista.valor.map((j) => [j.fechaDeNegocio, j.estado])).toEqual([
        ["2026-12-31", "ABIERTA"],
        ["2026-11-09", "ABIERTA"],
        ["2026-11-08", "ABIERTA"],
      ]);
      for (const mala of [
        { desde: "2026-12-31", hasta: "2026-11-08" },
        { desde: "ayer", hasta: "2026-11-08" },
        { desde: "2026-11-08", hasta: "mañana" },
      ]) {
        expect(
          await e.cierre.consultas.listarJornadas(e.m.ctx(), { sucursalId: e.m.sucursal, ...mala }),
        ).toEqual({
          ok: false,
          error: "FECHA_INVALIDA",
        });
      }
    });

    it("controlesDeLaJornada: en vivo mientras no está cerrada, con una huella que es la que se pasa a cerrar; la foto guardada si ya cerró", async () => {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2, "a", ["r1"]),
        control("facturacion.informa", "INFORMA", 1),
      ]);
      const e = await escenario([aporte], {}, false);
      const ver = () => e.cierre.consultas.controlesDeLaJornada(e.m.ctx(), e.entrada);
      // Sin jornada no hay nada que revisar.
      expect(await ver()).toEqual({
        ok: true,
        valor: { estado: "SIN_ACTIVIDAD", huella: huellaDeControles([]), controles: [] },
      });
      await crearJornada(dueno, e.m);
      const viva = await ver();
      expect(viva).toMatchObject({
        ok: true,
        valor: { estado: "ABIERTA", huella: e.huella(aporte.controlesActuales) },
      });
      expect(
        viva.ok && viva.valor.controles.map((c) => [c.clave, c.cantidad, c.referencias]),
      ).toEqual([
        ["facturacion.informa", 1, []],
        ["facturacion.reconocible", 2, ["r1"]],
      ]);
      // Cambia un control: la huella cambia.
      aporte.controlesActuales = [control("facturacion.reconocible", "RECONOCIBLE", 3)];
      const cambiada = await ver();
      expect(cambiada.ok && cambiada.valor.huella).toBe(e.huella(aporte.controlesActuales));
      // Cierra con la huella de la consulta y después la consulta devuelve la foto, con la misma huella.
      await e.iniciar();
      const vista = cambiada.ok ? cambiada.valor.huella : "";
      await e.cerrar({
        huellaVista: vista,
        reconocimientos: [{ modulo: "facturacion", clave: "facturacion.reconocible", texto: "ok" }],
      });
      aporte.controlesActuales = []; // lo de los módulos ya no importa: es la foto
      const foto = await ver();
      expect(foto).toMatchObject({ ok: true, valor: { estado: "CERRADA", huella: vista } });
      const guardados = foto.ok ? foto.valor.controles : [];
      expect(guardados.map((c) => ({ ...c, reconocidoEn: null }))).toEqual([
        {
          modulo: "facturacion",
          clave: "facturacion.reconocible",
          severidad: "RECONOCIBLE",
          cantidad: 3,
          referencias: [],
          reconocido: true,
          reconocidoPor: e.m.persona,
          reconocidoEn: null,
          texto: "ok",
        },
      ]);
      expect(guardados[0]?.reconocidoEn).toBeInstanceOf(Date);
    });

    it("las consultas exigen jornadas.ver y el alcance de sucursal (el operador mira solo sus sucursales)", async () => {
      const sinAlcance = await escenario([], { rol: "OPERADOR" });
      for (const resultado of [
        await sinAlcance.cierre.consultas.estadoDeJornada(sinAlcance.m.ctx(), sinAlcance.entrada),
        await sinAlcance.cierre.consultas.controlesDeLaJornada(
          sinAlcance.m.ctx(),
          sinAlcance.entrada,
        ),
        await sinAlcance.cierre.consultas.listarJornadas(sinAlcance.m.ctx(), {
          sucursalId: sinAlcance.m.sucursal,
          desde: FECHA,
          hasta: FECHA,
        }),
      ]) {
        expect(resultado).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      }
      const sinModulo = await escenario([], { plan: ["facturacion"], activados: ["facturacion"] });
      expect(
        await sinModulo.cierre.consultas.estadoDeJornada(sinModulo.m.ctx(), sinModulo.entrada),
      ).toEqual({
        ok: false,
        error: "MODULO_NO_ACTIVO",
      });
    });
  });

  it("las jornadas de actividad real (tabla de prueba) se cierran con su impedimento y sus correcciones informadas", async () => {
    const e = await escenario([aporteDeActividad("facturacion")]);
    // Una sesión abierta impide empezar.
    await dueno.query(
      "insert into prueba_actividad (empresa_id, sucursal_id, fecha_negocio, tipo) values ($1, $2, $3, 'sesion')",
      [e.m.empresa, e.m.sucursal, FECHA],
    );
    expect(await e.iniciar()).toMatchObject({
      ok: false,
      error: {
        codigo: "JORNADA_CON_IMPEDIMENTOS",
        impedimentos: [{ clave: "facturacion.sesiones_sin_cerrar", cantidad: 1 }],
      },
    });
    await dueno.query("update prueba_actividad set abierta = false where empresa_id = $1", [
      e.m.empresa,
    ]);
    expect(await e.iniciar()).toMatchObject({ ok: true });
  });
});
