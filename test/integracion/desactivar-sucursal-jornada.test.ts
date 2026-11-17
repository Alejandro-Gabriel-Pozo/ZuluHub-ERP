import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  crearEntornoDeCaja,
  sumarPersona,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import { crearMundoDeCobro, type MundoDeCobro } from "./caja-cobrar-apoyo";
import {
  armarCierreConCaja,
  cerrarElDia,
  empezarElCierre,
  jornadaConCobros,
  ticketsFalsos,
} from "./caja-cierre-del-dia-apoyo";
import { crearJornada } from "./cierre-apoyo";
import {
  armarEmpresasConCierre,
  contarAuditorias,
  contarSesiones,
  ctxDelDia,
  entradaDeAbrir,
  entradaDelDia,
  fechaDelDia,
  jornadaDe,
  sucursalActiva,
  sumarOtraSucursal,
} from "./desactivar-sucursal-apoyo";

/**
 * Desactivar una sucursal y su jornada (decisión 178; E3, tramo 9) con una base real y los roles limitados: en auditoría no se desactiva;
 * abierta sin movimiento se cierra sola (quién y cuándo, con su auditoría, en la misma transacción); con movimiento se pide el cierre del
 * día; desactivar de nuevo no escribe nada; todo se revierte si algo falla después; el aislamiento por empresa, sucursal y fecha.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("desactivar una sucursal: su jornada (decisión 178)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let cierre: ReturnType<typeof armarCierreConCaja>;
  let empresas: ReturnType<typeof armarEmpresasConCierre>;
  let fallaDespuesDeDesactivar = false;
  const tickets = ticketsFalsos();

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8, (tx): TxDeCajaDePrueba => ({
      ...tx,
      auditoria: {
        registrar: async (registro) => {
          await tx.auditoria.registrar(registro);
          if (fallaDespuesDeDesactivar && registro.accion === "SUCURSAL_DESACTIVADA") {
            throw new Error("falla inyectada después de desactivar");
          }
        },
      },
    }));
    caja = armarCaja(entorno);
    cierre = armarCierreConCaja(entorno, tickets);
    empresas = armarEmpresasConCierre(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Una empresa con caja y cierre, con DOS sucursales activas: la del mundo (la que se desactiva) y otra. */
  const mundo = async (opciones = {}) => {
    const m = await crearMundoDeCobro(entornoBase, dueno, caja, opciones);
    const otra = await sumarOtraSucursal(dueno, m, "1");
    return { ...m, otra };
  };
  const desactivar = (m: MundoDeCobro, minutos = 50) =>
    empresas.desactivarSucursal(ctxDelDia(m, minutos), { sucursalId: m.sucursal });
  const jornada = (m: MundoDeCobro, dias = 1) =>
    jornadaDe(dueno, m.empresa, m.sucursal, fechaDelDia(dias));
  const activa = (m: MundoDeCobro) => sucursalActiva(dueno, m.empresa, m.sucursal);

  describe("sin movimiento", () => {
    it("sin jornada: se desactiva y no se crea ninguna jornada", async () => {
      const m = await mundo();
      expect(await desactivar(m)).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      expect(await activa(m)).toBe(false);
      expect(await jornada(m)).toBeNull();
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
      ).toBe(0);
    });

    it("jornada abierta sin movimiento: se cierra sola con quién y cuándo, y se audita en la misma transacción", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const ahora = ctxDelDia(m, 50).ahora;
      expect(await desactivar(m, 50)).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      expect(await activa(m)).toBe(false);
      const j = await jornada(m);
      expect(j).toMatchObject({
        estado: "CERRADA",
        auditoria_iniciada_por: m.persona,
        cerrada_por: m.persona,
      });
      expect(j?.cerrada_en?.getTime()).toBe(ahora.getTime());
      expect(j?.auditoria_iniciada_en?.getTime()).toBe(ahora.getTime());
      expect(j?.huella_de_cierre).toMatch(/^[0-9a-f]{64}$/);
      const { rows } = await dueno.query<{ actor_persona_id: string; entidad_id: string }>(
        "select actor_persona_id, entidad_id from auditoria_empresa where empresa_id = $1 and accion = 'JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL'",
        [m.empresa],
      );
      expect(rows).toEqual([
        { actor_persona_id: m.persona, entidad_id: `${m.sucursal}:${fechaDelDia()}` },
      ]);
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA")).toBe(1);
    });

    it("desactivar dos veces (doble clic): la segunda no escribe ni audita nada", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      expect((await desactivar(m)).ok).toBe(true);
      const antes = await jornada(m);
      expect(await desactivar(m, 55)).toEqual({ ok: true, valor: { yaEstabaInactiva: true } });
      expect(await jornada(m)).toEqual(antes);
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA")).toBe(1);
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
      ).toBe(1);
    });

    it("con la jornada vigente ya cerrada se desactiva sin tocarla", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      expect((await cierre.casos.iniciarAuditoria(ctxDelDia(m, 40), entradaDelDia(m))).ok).toBe(
        true,
      );
      const vistos = await cierre.consultas.controlesDeLaJornada(
        ctxDelDia(m, 60),
        entradaDelDia(m),
      );
      if (!vistos.ok) throw new Error("no se pudieron leer los controles");
      const cerrada = await cierre.casos.cerrarJornada(ctxDelDia(m, 60), {
        ...entradaDelDia(m),
        huellaVista: vistos.valor.huella,
        reconocimientos: [],
        observacion: null,
      });
      expect(cerrada.ok).toBe(true);
      const antes = await jornada(m);
      expect(await desactivar(m, 90)).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      expect(await jornada(m)).toEqual(antes);
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
      ).toBe(0);
    });
  });

  describe("en auditoría", () => {
    it("no se desactiva: la sucursal sigue activa y la jornada sigue en auditoría; al cancelar el cierre, sí", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const iniciada = await cierre.casos.iniciarAuditoria(ctxDelDia(m, 40), entradaDelDia(m));
      expect(iniciada.ok).toBe(true);
      const antes = await jornada(m);
      expect(await desactivar(m, 45)).toEqual({
        ok: false,
        error: "SUCURSAL_CON_JORNADA_EN_AUDITORIA",
      });
      expect(await activa(m)).toBe(true);
      expect(await jornada(m)).toEqual(antes);
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA")).toBe(0);

      expect((await cierre.casos.cancelarAuditoria(ctxDelDia(m, 46), entradaDelDia(m))).ok).toBe(
        true,
      );
      expect((await desactivar(m, 47)).ok).toBe(true);
      expect((await jornada(m))?.estado).toBe("CERRADA");
    });
  });

  describe("con movimiento", () => {
    it("una sesión abierta: se rechaza pidiendo el cierre del día y no se toca nada", async () => {
      const m = await mundo();
      const abierta = await caja.casos.abrirSesion(ctxDelDia(m), entradaDeAbrir(m));
      expect(abierta.ok).toBe(true);
      const antes = await jornada(m);
      expect(await desactivar(m)).toEqual({
        ok: false,
        error: "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA",
      });
      expect(await activa(m)).toBe(true);
      expect(await jornada(m)).toEqual(antes);
      expect(antes?.estado).toBe("ABIERTA");
      expect(await contarAuditorias(dueno, m.empresa, "SUCURSAL_DESACTIVADA")).toBe(0);
    });

    it("con cobros y la sesión cerrada también se rechaza; hecho el cierre del día, se desactiva", async () => {
      const m = await mundo();
      const j = await jornadaConCobros(
        entorno,
        caja,
        m,
        [{ medio: "EFECTIVO", importe: "50.00" }],
        {
          tickets,
        },
      );
      expect(await desactivar(m)).toEqual({
        ok: false,
        error: "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA",
      });
      expect(await activa(m)).toBe(true);
      await empezarElCierre(cierre, j);
      expect((await cerrarElDia(cierre, j)).ok).toBe(true);
      expect(await desactivar(m, 90)).toEqual({ ok: true, valor: { yaEstabaInactiva: false } });
      expect(await activa(m)).toBe(false);
      expect((await jornada(m))?.estado).toBe("CERRADA");
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
      ).toBe(0);
    });
  });

  describe("atomicidad, permisos y aislamiento", () => {
    it("si algo falla después del auto-cierre, se revierte todo: la jornada sigue abierta y la sucursal activa", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      fallaDespuesDeDesactivar = true;
      try {
        await expect(desactivar(m)).rejects.toThrow("falla inyectada");
      } finally {
        fallaDespuesDeDesactivar = false;
      }
      expect(await activa(m)).toBe(true);
      expect(await jornada(m)).toMatchObject({ estado: "ABIERTA", cerrada_por: null });
      expect(
        await contarAuditorias(dueno, m.empresa, "JORNADA_CERRADA_AL_DESACTIVAR_SUCURSAL"),
      ).toBe(0);
    });

    it("sin el permiso, el guard rechaza primero y la jornada no se toca", async () => {
      const m = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      const r = await empresas.desactivarSucursal(
        { ...operador(), ahora: ctxDelDia(m).ahora },
        { sucursalId: m.sucursal },
      );
      expect(r).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(await activa(m)).toBe(true);
      expect((await jornada(m))?.estado).toBe("ABIERTA");
    });

    it("solo toca la jornada vigente de ESA sucursal: otras fechas, otra sucursal y otra empresa quedan como estaban", async () => {
      const m = await mundo();
      const otraEmpresa = await mundo();
      await crearJornada(dueno, m, fechaDelDia());
      await crearJornada(dueno, m, fechaDelDia(0));
      await crearJornada(dueno, m, fechaDelDia(2));
      await dueno.query(
        "insert into jornada_de_sucursal (empresa_id, sucursal_id, fecha_negocio) values ($1, $2, $3)",
        [m.empresa, m.otra, fechaDelDia()],
      );
      await crearJornada(dueno, otraEmpresa, fechaDelDia());
      expect((await desactivar(m)).ok).toBe(true);
      expect((await jornada(m))?.estado).toBe("CERRADA");
      expect((await jornada(m, 0))?.estado).toBe("ABIERTA");
      expect((await jornada(m, 2))?.estado).toBe("ABIERTA");
      expect((await jornadaDe(dueno, m.empresa, m.otra, fechaDelDia()))?.estado).toBe("ABIERTA");
      expect((await jornada(otraEmpresa))?.estado).toBe("ABIERTA");
      expect(await activa(otraEmpresa)).toBe(true);
      expect(await contarSesiones(dueno, otraEmpresa.empresa, otraEmpresa.sucursal)).toBe(0);
    });
  });
});
