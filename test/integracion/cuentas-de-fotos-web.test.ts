import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  declararLaCuentaDeFotos,
  retirarLaCuentaDeFotos,
  verLasCuentasDeFotos,
  type DependenciasDeCuentasDeFotosWeb,
} from "../../src/composicion/cuentas-de-fotos-web";
import { montarCatalogo, type EscenarioDeCatalogo } from "./catalogo-apoyo";

/**
 * La pantalla «Conectá tu cuenta de fotos» (`cuentas-de-fotos-web.ts`) contra una base real y los roles reales: ver, declarar y retirar; el mismo gesto repetido (clic doble, reintento) deja UNA cuenta
 * y UNA auditoría; dos declaraciones A LA VEZ con la misma clave, igual; una versión vieja no retira; la empresa y la persona las pone el servidor; el operador ve y no cambia; lo de una empresa no se ve
 * en otra; y todo error sale con el genérico. Los casos de uso en sí tienen sus pruebas en `cuentas-de-imagen-casos-de-uso.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 4;
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("cuentas de fotos de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let d: DependenciasDeCuentasDeFotosWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const pedido = (extra: Record<string, unknown> = {}) => ({
    claveDeIdempotencia: randomUUID(),
    cuenta: "mi-hotel",
    ...extra,
  });
  const ver = async (e: EscenarioDeCatalogo, contexto = e.gerente) => {
    const r = await verLasCuentasDeFotos(d, contexto);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato;
  };
  const declarar = async (e: EscenarioDeCatalogo, cuenta = "mi-hotel") => {
    const r = await declararLaCuentaDeFotos(d, e.gerente, pedido({ cuenta }));
    if (!r.ok) throw new Error(`se esperaba la cuenta y vino ${r.error.codigo}`);
    return r.dato;
  };
  const filas = (e: EscenarioDeCatalogo) =>
    c.contar("select count(*) as n from cuenta_de_imagen_declarada where empresa_id = $1", [
      e.empresa,
    ]);
  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  /** Un pedido que perdió la carrera se repite igual: es seguro por su clave o por su estado. */
  const firme = async <R extends { ok: boolean }>(trabajo: () => Promise<R>): Promise<R> => {
    const primero = await trabajo();
    return primero.ok ? primero : trabajo();
  };

  it("sin cuentas: la lista está vacía; declarar suma una con su versión y se ve en la lista", async () => {
    const e = await c.escenario();
    expect(await ver(e)).toEqual([]);
    const cuenta = await declarar(e);
    expect(cuenta.yaExistia).toBe(false);
    expect(await ver(e)).toEqual([{ id: cuenta.cuentaId, cuenta: "mi-hotel", version: 1 }]);
    expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
  });

  it("la misma declaración repetida (clic doble, reintento) deja UNA cuenta y UNA auditoría", async () => {
    const e = await c.escenario();
    const p = pedido();
    const a = await declararLaCuentaDeFotos(d, e.gerente, p);
    const b = await declararLaCuentaDeFotos(d, e.gerente, p);
    expect(a).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(b).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await filas(e)).toBe(1);
    expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
  });

  it("dos declaraciones A LA VEZ con la misma clave dejan UNA cuenta y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await c.escenario();
      const p = pedido();
      const r = await Promise.all([
        firme(() => declararLaCuentaDeFotos(d, e.gerente, p)),
        firme(() => declararLaCuentaDeFotos(d, e.gerente, p)),
      ]);
      expect(r.map((x) => x.ok)).toEqual([true, true]);
      expect(await filas(e), `ronda ${ronda}`).toBe(1);
      expect(await auditorias(e, "CUENTA_DE_IMAGEN_DECLARADA")).toBe(1);
    }
  });

  it("la cuenta se guarda sin los espacios de los costados, y la empresa y la persona no se pueden mandar", async () => {
    const e = await c.escenario();
    const otra = await c.escenario();
    const r = await declararLaCuentaDeFotos(
      d,
      e.gerente,
      pedido({ cuenta: "  mi-hotel  ", empresaId: otra.empresa, proveedor: "OTRO" }),
    );
    expect(r.ok).toBe(true);
    expect((await ver(e)).map((x) => x.cuenta)).toEqual(["mi-hotel"]);
    expect(await filas(otra)).toBe(0);
  });

  it("una cuenta con forma inválida, o un pedido torcido, sale con el genérico y no escribe", async () => {
    const e = await c.escenario();
    for (const crudo of [
      pedido({ cuenta: "con espacios" }),
      pedido({ cuenta: "" }),
      { cuenta: 1 },
    ]) {
      expect(await declararLaCuentaDeFotos(d, e.gerente, crudo)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
    }
    expect(await filas(e)).toBe(0);
  });

  it("el permiso lo decide el servidor: el operador no ve, ni declara, ni retira", async () => {
    const e = await c.escenario();
    const cuenta = await declarar(e);
    // La lectura dice «sin permiso» (como el resto de las lecturas del catálogo: la pantalla no se arma); igual las escrituras: el permiso es una cosa y los datos inválidos, el genérico.
    expect(await verLasCuentasDeFotos(d, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(
      await declararLaCuentaDeFotos(d, e.operador, pedido({ cuenta: "del-operador" })),
    ).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(
      await retirarLaCuentaDeFotos(d, e.operador, {
        id: cuenta.cuentaId,
        versionEsperada: 1,
        motivo: "Cerramos la cuenta",
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(await filas(e)).toBe(1);
    expect((await ver(e)).map((x) => x.cuenta)).toEqual(["mi-hotel"]);
  });

  it("aislamiento: la lista de una empresa no trae las de otra, y retirar una cuenta ajena sale con el genérico sin tocarla", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const ajena = await declarar(a, "cuenta-de-a");
    await declarar(b, "cuenta-de-b");
    expect((await ver(a)).map((x) => x.cuenta)).toEqual(["cuenta-de-a"]);
    expect((await ver(b)).map((x) => x.cuenta)).toEqual(["cuenta-de-b"]);
    expect(
      await retirarLaCuentaDeFotos(d, b.gerente, {
        id: ajena.cuentaId,
        versionEsperada: 1,
        motivo: "Cerramos la cuenta",
      }),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect((await ver(a)).map((x) => x.cuenta)).toEqual(["cuenta-de-a"]);
  });

  it("retirar con motivo la saca de la lista y deja una auditoría; repetirlo no duplica ni audita de nuevo", async () => {
    const e = await c.escenario();
    const cuenta = await declarar(e);
    const p = { id: cuenta.cuentaId, versionEsperada: 1, motivo: "  Cerramos la cuenta  " };
    const a = await retirarLaCuentaDeFotos(d, e.gerente, p);
    const b = await retirarLaCuentaDeFotos(d, e.gerente, p);
    expect(a).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect(b).toMatchObject({ ok: true, dato: { yaEstaba: true } });
    expect(await ver(e)).toEqual([]);
    expect(await filas(e)).toBe(1);
    expect(await auditorias(e, "CUENTA_DE_IMAGEN_RETIRADA")).toBe(1);
  });

  it("dos retiros A LA VEZ dejan UNA auditoría y la cuenta retirada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await c.escenario();
      const cuenta = await declarar(e);
      const p = { id: cuenta.cuentaId, versionEsperada: 1, motivo: "Cerramos la cuenta" };
      const r = await Promise.all([
        firme(() => retirarLaCuentaDeFotos(d, e.gerente, p)),
        firme(() => retirarLaCuentaDeFotos(d, e.gerente, p)),
      ]);
      expect(
        r.map((x) => x.ok),
        `ronda ${ronda}`,
      ).toEqual([true, true]);
      expect(await auditorias(e, "CUENTA_DE_IMAGEN_RETIRADA")).toBe(1);
      expect(await ver(e)).toEqual([]);
    }
  });

  it("retirar con una versión vieja sale con el genérico y la cuenta sigue activa", async () => {
    const e = await c.escenario();
    const cuenta = await declarar(e);
    expect(
      await retirarLaCuentaDeFotos(d, e.gerente, {
        id: cuenta.cuentaId,
        versionEsperada: 7,
        motivo: "Cerramos la cuenta",
      }),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect((await ver(e)).map((x) => x.cuenta)).toEqual(["mi-hotel"]);
  });
});
