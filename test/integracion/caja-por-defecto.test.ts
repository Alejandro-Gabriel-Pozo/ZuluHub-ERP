import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ganchoDeSucursalDeCaja } from "../../src/modulos/caja/publico";
import type { GanchoDeSucursal, TxDeEmpresas } from "../../src/modulos/empresas/publico";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import {
  armarCaja,
  armarEmpresasConGanchos,
  crearEntornoDeCaja,
  crearMundoDeCaja,
  otraSucursalDeCaja,
  sumarPersona,
  type MundoDeCaja,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";

/**
 * «Caja 1» nace sola (E3, tramo 4; decisión 165; e3 §3.2.1) con una base real y los roles limitados de la aplicación: el gancho de
 * `crearSucursal` (misma transacción, solo si la sucursal se creó, un fallo la aborta entera), el comando `asegurarCajaPorDefecto` para
 * la primera sucursal del alta de empresa y las preexistentes (guard, alcance, solo lectura, idempotencia) y el doble ingreso simultáneo
 * con barrera (una sola «Caja 1» y una sola auditoría).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 8;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDeCajaDePrueba, esperar: () => Promise<void>) => TxDeCajaDePrueba;
const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";

describe.skipIf(base === null)("caja por defecto: gancho, comando y doble ingreso", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 12, (tx) => gancho(tx, () => barrera()));
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura de la autorización. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.autorizacion;
      return {
        ...tx,
        autorizacion: {
          ...original,
          delActor: async (contexto) => {
            const r = await original.delActor(contexto);
            if (primera) {
              primera = false;
              await esperar();
            }
            return r;
          },
        },
      };
    };
  };
  const sinRonda = () => {
    gancho = (tx) => tx;
  };

  const casos = () => caja.casos;
  const consultas = () => caja.consultas;
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeCaja(entornoBase, dueno, opciones);
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const cajasDe = (empresa: string, sucursal?: string) =>
    filas<{ id: string; sucursal_id: string; nombre: string; activa: boolean }>(
      `select id, sucursal_id, nombre, activa from caja where empresa_id = $1
         and ($2::uuid is null or sucursal_id = $2) order by nombre, id`,
      [empresa, sucursal ?? null],
    );
  const auditorias = (m: MundoDeCaja, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const constancias = (m: MundoDeCaja, accion: string) =>
    filas<{ entidad_id: string; actor_persona_id: string; despues: Record<string, unknown> }>(
      `select entidad_id, actor_persona_id, despues from auditoria_empresa
        where empresa_id = $1 and accion = $2 order by id`,
      [m.empresa, accion],
    );
  /** Todo lo que puede escribir el comando: cajas, medios y la cuenta de sus auditorías. */
  const foto = async (m: MundoDeCaja) =>
    JSON.stringify({
      cajas: await filas("select * from caja where empresa_id = $1 order by id", [m.empresa]),
      medios: await filas("select * from medio_de_pago where empresa_id = $1 order by id", [
        m.empresa,
      ]),
      auditoria: await contar(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion not like 'SESION%'",
        [m.empresa],
      ),
    });
  const resumen = (rs: readonly { ok: boolean; error?: unknown }[]) =>
    rs.map((r) => (r.ok ? "ok" : JSON.stringify(r.error)));
  /** `crearSucursal` con el gancho de caja registrado, como lo arma la composición. */
  const empresasConCaja = () => armarEmpresasConGanchos(entorno, [ganchoDeSucursalDeCaja]);

  describe("gancho de crearSucursal", () => {
    it("una sucursal creada con crearSucursal nace con «Caja 1», su efectivo y su auditoría, en la misma transacción", async () => {
      const m = await mundo({ plan: [], activados: [] });
      const r = await empresasConCaja().crearSucursal(m.ctx(), { nombre: "Norte" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.yaExistia).toBe(false);
      expect(await cajasDe(m.empresa, r.valor.sucursalId)).toEqual([
        {
          id: expect.any(String) as unknown,
          sucursal_id: r.valor.sucursalId,
          nombre: "Caja 1",
          activa: true,
        },
      ]);
      const [constancia] = await constancias(m, "CAJA_CREADA");
      expect(constancia).toMatchObject({
        actor_persona_id: m.persona,
        despues: { nombre: "Caja 1", activa: true, origen: "por defecto" },
      });
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      expect(
        await contar(
          "select count(*) as n from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        ),
      ).toBe(1);
      // Corre aunque el módulo caja no esté activo ni en el plan de la empresa (una fila por sucursal).
      expect(
        await contar("select count(*) as n from modulo_de_empresa where empresa_id = $1", [
          m.empresa,
        ]),
      ).toBe(0);
    });

    it("no pasa por el límite del plan: con un límite de cero cajas la sucursal nueva igual tiene su «Caja 1»", async () => {
      const m = await mundo({ limiteDeCajas: 0 });
      const r = await empresasConCaja().crearSucursal(m.ctx(), { nombre: "Sur" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((await cajasDe(m.empresa, r.valor.sucursalId)).map((c) => c.nombre)).toEqual([
        "Caja 1",
      ]);
      // El límite sigue rigiendo para las cajas que se crean a mano.
      expect(
        await casos().crearCaja(m.ctx(), { sucursalId: r.valor.sucursalId, nombre: "Caja 2" }),
      ).toMatchObject({ ok: false, error: { codigo: "LIMITE_DEL_PLAN" } });
    });

    it("crear la misma sucursal dos veces deja una sola caja y no reinvoca el gancho", async () => {
      const m = await mundo({ plan: [], activados: [] });
      let invocaciones = 0;
      const contador: GanchoDeSucursal<TxDeEmpresas> = {
        alCrearSucursalEnTx() {
          invocaciones += 1;
          return Promise.resolve(ok(null));
        },
      };
      const empresas = armarEmpresasConGanchos(entorno, [ganchoDeSucursalDeCaja, contador]);
      const primera = await empresas.crearSucursal(m.ctx(), { nombre: "Oeste" });
      const segunda = await empresas.crearSucursal(m.ctx(), { nombre: "oeste" });
      expect(primera).toMatchObject({ ok: true, valor: { yaExistia: false } });
      expect(segunda).toMatchObject({ ok: true, valor: { yaExistia: true } });
      expect(invocaciones).toBe(1);
      const sucursalId = primera.ok ? primera.valor.sucursalId : "";
      expect(await cajasDe(m.empresa, sucursalId)).toHaveLength(1);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    });

    it("un gancho posterior que falla aborta todo: no queda la sucursal, ni la caja, ni su efectivo, ni ninguna auditoría", async () => {
      const m = await mundo({ plan: [], activados: [] });
      const quedaba = await foto(m);
      const sucursalesAntes = await contar(
        "select count(*) as n from sucursal where empresa_id = $1",
        [m.empresa],
      );
      const falla: GanchoDeSucursal<TxDeEmpresas> = {
        alCrearSucursalEnTx: () => Promise.resolve(err("GANCHO_DE_SUCURSAL_FALLIDO")),
      };
      const empresas = armarEmpresasConGanchos(entorno, [ganchoDeSucursalDeCaja, falla]);
      expect(await empresas.crearSucursal(m.ctx(), { nombre: "Este" })).toEqual({
        ok: false,
        error: "GANCHO_DE_SUCURSAL_FALLIDO",
      });
      expect(
        await contar("select count(*) as n from sucursal where empresa_id = $1", [m.empresa]),
      ).toBe(sucursalesAntes);
      expect(await foto(m)).toBe(quedaba);
      expect(await auditorias(m, "SUCURSAL_CREADA")).toBe(0);
    });

    it("una falla de la base dentro de la caja por defecto (su auditoría) también revierte la sucursal", async () => {
      const m = await mundo({ plan: [], activados: [] });
      const antes = await foto(m);
      const roto = crearEntornoDeCaja(propia.base, 2, (tx) => ({
        ...tx,
        auditoria: {
          registrar: (registro) =>
            registro.accion === "CAJA_CREADA"
              ? Promise.reject(new Error("falla forzada de la auditoría de la caja"))
              : tx.auditoria.registrar(registro),
        },
      }));
      try {
        const empresas = armarEmpresasConGanchos(roto, [ganchoDeSucursalDeCaja]);
        await expect(empresas.crearSucursal(m.ctx(), { nombre: "Centro" })).rejects.toThrow(
          "falla forzada",
        );
      } finally {
        await roto.cerrar();
      }
      expect(await foto(m)).toBe(antes);
      expect(
        await contar(
          "select count(*) as n from sucursal where empresa_id = $1 and nombre = 'Centro'",
          [m.empresa],
        ),
      ).toBe(0);
    });
  });

  describe("comando asegurarCajaPorDefecto", () => {
    it("la primera sucursal del alta de empresa (sin gancho) no tiene caja hasta el comando, y la consulta no escribe", async () => {
      const m = await mundo();
      expect(await cajasDe(m.empresa)).toEqual([]);
      const antes = await foto(m);
      expect(await consultas().listarCajas(m.ctx(), { sucursalId: m.sucursal })).toMatchObject({
        ok: true,
        valor: { cajas: [] },
      });
      expect(await foto(m)).toBe(antes);

      const r = await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal });
      expect(r).toMatchObject({ ok: true, valor: { creada: true } });
      const cajas = await cajasDe(m.empresa, m.sucursal);
      expect(cajas).toHaveLength(1);
      expect(cajas[0]).toMatchObject({ nombre: "Caja 1", activa: true });
      expect(r.ok && r.valor.cajaId).toBe(cajas[0]?.id);
      const [constancia] = await constancias(m, "CAJA_CREADA");
      expect(constancia).toMatchObject({
        entidad_id: cajas[0]?.id,
        actor_persona_id: m.persona,
        despues: { nombre: "Caja 1", activa: true, origen: "por defecto" },
      });
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
    });

    it("asegurarCajaPorDefecto dos veces: la segunda devuelve la misma caja con creada false y no escribe ni audita", async () => {
      const m = await mundo();
      const primera = await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal });
      const despuesDeLaPrimera = await foto(m);
      const segunda = await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal });
      expect(primera).toMatchObject({ ok: true, valor: { creada: true } });
      expect(segunda).toEqual({
        ok: true,
        valor: { cajaId: primera.ok ? primera.valor.cajaId : "", creada: false },
      });
      expect(await foto(m)).toBe(despuesDeLaPrimera);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    });

    it("una caja renombrada no recibe otra: devuelve la existente sin escribir", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const creada = await casos().crearCaja(m.ctx(), {
        sucursalId: m.sucursal,
        nombre: "Mostrador",
      });
      if (!creada.ok) throw new Error("no se pudo crear la caja");
      const antes = await foto(m);
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal })).toEqual({
        ok: true,
        valor: { cajaId: creada.valor.cajaId, creada: false },
      });
      expect(await foto(m)).toBe(antes);
      expect((await cajasDe(m.empresa)).map((c) => c.nombre)).toEqual(["Mostrador"]);
    });

    it("una caja desactivada tampoco recibe otra: la sucursal ya tuvo caja", async () => {
      const m = await mundo({ limiteDeCajas: 3 });
      const creada = await casos().crearCaja(m.ctx(), { sucursalId: m.sucursal, nombre: "Caja 1" });
      if (!creada.ok) throw new Error("no se pudo crear la caja");
      expect((await casos().desactivarCaja(m.ctx(), { cajaId: creada.valor.cajaId })).ok).toBe(
        true,
      );
      const antes = await foto(m);
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal })).toEqual({
        ok: true,
        valor: { cajaId: creada.valor.cajaId, creada: false },
      });
      expect(await foto(m)).toBe(antes);
      expect(await cajasDe(m.empresa)).toMatchObject([{ nombre: "Caja 1", activa: false }]);
    });

    it("no pasa por el límite del plan (límite de cero cajas) y reutiliza el efectivo ya existente de la empresa", async () => {
      const m = await mundo({ limiteDeCajas: 0 });
      const otra = await otraSucursalDeCaja(dueno, m.empresa, "Sucursal norte");
      expect(
        await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
      ).toMatchObject({ ok: true, valor: { creada: true } });
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: otra })).toMatchObject({
        ok: true,
        valor: { creada: true },
      });
      expect(await cajasDe(m.empresa)).toHaveLength(2);
      expect(
        await contar(
          "select count(*) as n from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
          [m.empresa],
        ),
      ).toBe(1);
      expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      expect(await auditorias(m, "CAJA_CREADA")).toBe(2);
    });

    it("los tres roles con alcance la piden; el operador sin la sucursal asignada recibe SUCURSAL_FUERA_DE_ALCANCE y no se escribe nada", async () => {
      const m = await mundo();
      const operadorSinAlcance = await sumarPersona(dueno, m, "OPERADOR", false);
      const antes = await foto(m);
      expect(
        await casos().asegurarCajaPorDefecto(operadorSinAlcance(), { sucursalId: m.sucursal }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(await foto(m)).toBe(antes);

      const operador = await sumarPersona(dueno, m, "OPERADOR", true);
      expect(
        await casos().asegurarCajaPorDefecto(operador(), { sucursalId: m.sucursal }),
      ).toMatchObject({
        ok: true,
        valor: { creada: true },
      });
      const administrador = await sumarPersona(dueno, m, "ADMINISTRADOR");
      expect(
        await casos().asegurarCajaPorDefecto(administrador(), { sucursalId: m.sucursal }),
      ).toMatchObject({ ok: true, valor: { creada: false } });
      expect(
        await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
      ).toMatchObject({
        ok: true,
        valor: { creada: false },
      });
      expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
    });

    it("sucursal inexistente, de otra empresa o inactiva: SUCURSAL_NO_ENCONTRADA / SUCURSAL_INACTIVA sin escribir", async () => {
      const m = await mundo();
      const ajena = await mundo();
      const inactiva = await otraSucursalDeCaja(dueno, m.empresa, "Cerrada");
      await dueno.query("update sucursal set activa = false where id = $1", [inactiva]);
      const antes = await foto(m);
      const antesAjena = await foto(ajena);
      expect(
        await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: UUID_QUE_NO_EXISTE }),
      ).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: ajena.sucursal })).toEqual(
        {
          ok: false,
          error: "SUCURSAL_NO_ENCONTRADA",
        },
      );
      expect(
        await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: "no-es-un-uuid" }),
      ).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: inactiva })).toEqual({
        ok: false,
        error: "SUCURSAL_INACTIVA",
      });
      expect(await foto(m)).toBe(antes);
      expect(await foto(ajena)).toBe(antesAjena);
    });

    it("sin el módulo caja activo da MODULO_NO_ACTIVO y en solo lectura (baja de plan) MODULO_EN_SOLO_LECTURA, sin escribir", async () => {
      const sinModulo = await mundo({ plan: [], activados: [] });
      expect(
        await casos().asegurarCajaPorDefecto(sinModulo.ctx(), { sucursalId: sinModulo.sucursal }),
      ).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
      expect(await cajasDe(sinModulo.empresa)).toEqual([]);

      const m = await mundo();
      const { crearPlanPublicado, asignarPlan } = await import("./marcas-apoyo");
      const { version } = await crearPlanPublicado(dueno, { modulos: [] });
      await asignarPlan(dueno, m.tenant, version, { desdeSegundos: -5 });
      const antes = await foto(m);
      expect(await casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal })).toEqual({
        ok: false,
        error: "MODULO_EN_SOLO_LECTURA",
      });
      expect(await foto(m)).toBe(antes);
    });
  });

  describe("doble ingreso simultáneo", () => {
    it("dos asegurarCajaPorDefecto a la vez: una sola «Caja 1», una sola auditoría, la segunda creada false", async () => {
      for (let i = 0; i < RONDAS; i++) {
        const m = await mundo();
        ronda(2);
        const [a, b] = await Promise.all([
          casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
          casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
        ]);
        sinRonda();
        expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
        const creadas = [a, b].map((r) => (r.ok ? r.valor.creada : null));
        expect(
          creadas.filter((v) => v === true),
          `ronda ${i}`,
        ).toHaveLength(1);
        expect(
          creadas.filter((v) => v === false),
          `ronda ${i}`,
        ).toHaveLength(1);
        expect(new Set([a, b].map((r) => (r.ok ? r.valor.cajaId : ""))).size).toBe(1);
        const cajas = await cajasDe(m.empresa);
        expect(cajas.map((c) => c.nombre)).toEqual(["Caja 1"]);
        expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
        expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      }
    });

    it("cuatro ingresos a la vez (dos pestañas por dos personas): una sola caja y un solo efectivo", async () => {
      for (let i = 0; i < RONDAS; i++) {
        const m = await mundo();
        const otra = await sumarPersona(dueno, m, "ADMINISTRADOR");
        ronda(4);
        const rs = await Promise.all([
          casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
          casos().asegurarCajaPorDefecto(otra(), { sucursalId: m.sucursal }),
          casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
          casos().asegurarCajaPorDefecto(otra(), { sucursalId: m.sucursal }),
        ]);
        sinRonda();
        expect(
          rs.every((r) => r.ok),
          `ronda ${i}: ${resumen(rs).join(" | ")}`,
        ).toBe(true);
        expect(rs.filter((r) => r.ok && r.valor.creada)).toHaveLength(1);
        expect(await cajasDe(m.empresa)).toHaveLength(1);
        expect(await auditorias(m, "CAJA_CREADA")).toBe(1);
        expect(
          await contar(
            "select count(*) as n from medio_de_pago where empresa_id = $1 and tipo = 'EFECTIVO'",
            [m.empresa],
          ),
        ).toBe(1);
      }
    });

    it("el comando y la creación de otra sucursal a la vez no se pisan: cada sucursal termina con su única «Caja 1»", async () => {
      for (let i = 0; i < RONDAS; i++) {
        const m = await mundo({ plan: ["caja"] });
        ronda(2);
        const [a, b] = await Promise.all([
          casos().asegurarCajaPorDefecto(m.ctx(), { sucursalId: m.sucursal }),
          empresasConCaja().crearSucursal(m.ctx(), { nombre: `Nueva ${i}` }),
        ]);
        sinRonda();
        expect(a.ok && b.ok, `ronda ${i}: ${resumen([a, b]).join(" | ")}`).toBe(true);
        const cajas = await cajasDe(m.empresa);
        expect(cajas.map((c) => c.nombre)).toEqual(["Caja 1", "Caja 1"]);
        expect(new Set(cajas.map((c) => c.sucursal_id)).size).toBe(2);
        expect(await auditorias(m, "CAJA_CREADA")).toBe(2);
        expect(await auditorias(m, "MEDIO_DE_PAGO_CREADO")).toBe(1);
      }
    });
  });
});
