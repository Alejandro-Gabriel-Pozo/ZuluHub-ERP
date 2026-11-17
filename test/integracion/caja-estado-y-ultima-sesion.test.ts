import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { armarCaja, crearEntornoDeCaja, sumarPersona } from "./caja-configuracion-apoyo";
import {
  claveNueva,
  conAhora,
  crearMundoDeOperacion,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * «Estado de la caja» (C1) y «Última sesión» (C2) de la pantalla Caja del mostrador contra una base real y los roles reales: cada caja de la sucursal con su sesión y la jornada
 * de hoy; la última sesión cerrada con su arqueo. Son lecturas con `cajas.ver` y alcance de sucursal: nunca «todas» si no se eligió una, ni una sucursal o caja de otra empresa.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000 });

const UUID_QUE_NO_EXISTE = "99999999-9999-4999-8999-999999999999";

describe.skipIf(base === null)("estado de la caja y última sesión", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
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

  const mundo = () => crearMundoDeOperacion(entornoBase, dueno, caja);
  const ctxEn = (m: MundoDeOperacion, minutos = 0) =>
    conAhora(m.ctx(), new Date(instanteLocal(1, "10:00").getTime() + minutos * 60_000));
  const abrir = async (m: MundoDeOperacion, minutos = 0, fondo = "1000.00") => {
    const r = await caja.casos.abrirSesion(ctxEn(m, minutos), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos(fondo),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
    return r.valor.sesionId;
  };
  const cerrar = async (m: MundoDeOperacion, sesionId: string, minutos: number, cantidad = 1) => {
    const r = await caja.casos.cerrarSesion(ctxEn(m, minutos), {
      sesionId,
      conteo: { billetes: [{ denominacion: 1000, cantidad }], monedas: pesos("0.00") },
      otros: [],
      conformeGeneral: true,
      observacion: null,
    });
    if (!r.ok) throw new Error(`no se pudo cerrar: ${JSON.stringify(r.error)}`);
  };

  describe("estadoDeLaCaja", () => {
    it("recorre el ciclo de la caja: sin sesión, abierta y en cierre, con la jornada de hoy", async () => {
      const m = await mundo();
      const sin = await caja.consultas.estadoDeLaCaja(ctxEn(m), { sucursalId: m.sucursal });
      if (!sin.ok) throw new Error(JSON.stringify(sin.error));
      expect(sin.valor.cajas).toEqual([
        {
          cajaId: m.cajaId,
          nombre: "Caja 1",
          estado: "SIN_SESION",
          sesionId: null,
          fechaDeNegocio: null,
          jornadaVencida: false,
        },
      ]);
      expect(sin.valor.jornadaActual.estado).toBe("ABIERTA");

      const sesion = await abrir(m);
      const abierta = await caja.consultas.estadoDeLaCaja(ctxEn(m), { sucursalId: m.sucursal });
      if (!abierta.ok) throw new Error(JSON.stringify(abierta.error));
      expect(abierta.valor.cajas[0]).toMatchObject({ estado: "ABIERTA", sesionId: sesion });
      expect(abierta.valor.cajas[0]?.fechaDeNegocio).toBe(
        abierta.valor.jornadaActual.fechaDeNegocio,
      );

      const iniciado = await caja.casos.iniciarCierre(ctxEn(m, 5), { sesionId: sesion });
      expect(iniciado.ok).toBe(true);
      const enCierre = await caja.consultas.estadoDeLaCaja(ctxEn(m), { sucursalId: m.sucursal });
      if (!enCierre.ok) throw new Error(JSON.stringify(enCierre.error));
      expect(enCierre.valor.cajas[0]).toMatchObject({ estado: "EN_CIERRE", sesionId: sesion });
    });

    it("es una lectura: no escribe nada (ni la jornada ni la auditoría)", async () => {
      const m = await mundo();
      const contar = async () =>
        JSON.stringify([
          (
            await dueno.query("select * from jornada_de_sucursal where empresa_id = $1", [
              m.empresa,
            ])
          ).rows,
          (
            await dueno.query("select count(*) from auditoria_empresa where empresa_id = $1", [
              m.empresa,
            ])
          ).rows,
          (await dueno.query("select count(*) from sesion_caja where empresa_id = $1", [m.empresa]))
            .rows,
        ]);
      const antes = await contar();
      await caja.consultas.estadoDeLaCaja(ctxEn(m), { sucursalId: m.sucursal });
      expect(await contar()).toBe(antes);
    });

    it("aislamiento: una sucursal sin forma de id, inexistente o de otra empresa no se ve; ningún texto se toma por «todas»", async () => {
      const a = await mundo();
      const b = await mundo();
      expect(await caja.consultas.estadoDeLaCaja(ctxEn(a), { sucursalId: "todas" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      expect(await caja.consultas.estadoDeLaCaja(ctxEn(a), { sucursalId: "" })).toEqual({
        ok: false,
        error: "SUCURSAL_NO_ENCONTRADA",
      });
      const ajena = await caja.consultas.estadoDeLaCaja(ctxEn(a), { sucursalId: b.sucursal });
      const inexistente = await caja.consultas.estadoDeLaCaja(ctxEn(a), {
        sucursalId: UUID_QUE_NO_EXISTE,
      });
      // La sucursal de otra empresa no se distingue de una que no existe: mismo error, sin pistas.
      expect(ajena.ok).toBe(false);
      expect(ajena).toEqual(inexistente);
    });

    it("autorización: un operador sin sucursales asignadas no ve la sucursal (SUCURSAL_FUERA_DE_ALCANCE); asignado, la ve", async () => {
      const m = await mundo();
      const sinAlcance = await sumarPersona(dueno, m, "OPERADOR", false);
      expect(
        await caja.consultas.estadoDeLaCaja(conAhora(sinAlcance(), ctxEn(m).ahora), {
          sucursalId: m.sucursal,
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      const conAlcance = await sumarPersona(dueno, m, "OPERADOR", true);
      expect(
        (
          await caja.consultas.estadoDeLaCaja(conAhora(conAlcance(), ctxEn(m).ahora), {
            sucursalId: m.sucursal,
          })
        ).ok,
      ).toBe(true);
    });
  });

  describe("ultimaSesionDeLaCaja", () => {
    it("null si la caja nunca se cerró (una sesión abierta no cuenta)", async () => {
      const m = await mundo();
      expect(await caja.consultas.ultimaSesionDeLaCaja(ctxEn(m), { cajaId: m.cajaId })).toEqual({
        ok: true,
        valor: null,
      });
      await abrir(m);
      expect(await caja.consultas.ultimaSesionDeLaCaja(ctxEn(m), { cajaId: m.cajaId })).toEqual({
        ok: true,
        valor: null,
      });
    });

    it("devuelve la ficha de la que cerró más tarde, con su arqueo y sus billetes", async () => {
      const m = await mundo();
      const primera = await abrir(m, 0, "1000.00");
      await cerrar(m, primera, 30, 1);
      const segunda = await abrir(m, 60, "2000.00");
      await cerrar(m, segunda, 90, 2);
      const r = await caja.consultas.ultimaSesionDeLaCaja(ctxEn(m, 120), { cajaId: m.cajaId });
      if (!r.ok || r.valor === null) throw new Error(JSON.stringify(r));
      expect(r.valor.sesion).toMatchObject({ id: segunda, estado: "CERRADA", cajaId: m.cajaId });
      expect(r.valor.billetes).toEqual([{ denominacion: 1000, cantidad: 2 }]);
      const efectivo = r.valor.arqueo.find((l) => l.medioTipo === "EFECTIVO");
      expect(efectivo).toMatchObject({ esperado: pesos("2000.00"), contado: pesos("2000.00") });
    });

    it("aislamiento: una caja de otra empresa o inexistente es CAJA_NO_ENCONTRADA, igual para las dos; sin permiso de sucursal, fuera de alcance", async () => {
      const a = await mundo();
      const b = await mundo();
      const ajena = await caja.consultas.ultimaSesionDeLaCaja(ctxEn(a), { cajaId: b.cajaId });
      const inexistente = await caja.consultas.ultimaSesionDeLaCaja(ctxEn(a), {
        cajaId: UUID_QUE_NO_EXISTE,
      });
      expect(ajena).toEqual({ ok: false, error: "CAJA_NO_ENCONTRADA" });
      expect(ajena).toEqual(inexistente);
      const sinAlcance = await sumarPersona(dueno, a, "OPERADOR", false);
      expect(
        await caja.consultas.ultimaSesionDeLaCaja(conAhora(sinAlcance(), ctxEn(a).ahora), {
          cajaId: a.cajaId,
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    });
  });
});
