import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  guardarElNivelDeCompras,
  leerElNivelDeCompras,
  type DependenciasDeNivelDeComprasWeb,
} from "../../src/composicion/nivel-de-compras-web";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras PR 11: «Nivel de compras» para la pantalla, con una base real. Se prueba: que MIRAR no escribe (una empresa sin fila la sigue sin tener tras leer), que guardar cambia el nivel con una sola
 * auditoría, la IDEMPOTENCIA (guardar el nivel vigente dos veces, o el mismo pedido dos veces: un solo cambio y una sola auditoría), la CONCURRENCIA (dos gerentes a la vez con el mismo nivel y la
 * misma versión: uno cambia, el otro ve lo mismo; con una versión vieja: el genérico, sin escribir), la autorización (solo el gerente), el aislamiento por empresa, que N3 y N4 no se aceptan
 * desde la pantalla y que lo ya cargado conserva el nivel con que nació.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const GENERICO = { ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } };
const esGenerico = (r: unknown) => expect(r).toMatchObject(GENERICO);

describe.skipIf(base === null)("composición web: nivel de compras", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeNivelDeComprasWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const filasDeNivel = (e: EscenarioDeCompras) =>
    c.contar("SELECT count(*) AS n FROM configuracion_de_compras WHERE empresa_id = $1", [
      e.empresa,
    ]);
  const cambios = async (e: EscenarioDeCompras) =>
    (await c.auditoria(e.empresa, "COMPRAS_NIVEL_CAMBIADO")).length;
  const leer = async (quien: EscenarioDeCompras["gerente"]) => {
    const r = await leerElNivelDeCompras(d, quien);
    if (!r.ok) throw new Error(`la lectura tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };

  it("leer NO escribe: una empresa sin fila ve el nivel inicial con su versión y sigue sin tener fila", async () => {
    const e = await c.escenario();
    expect(await filasDeNivel(e)).toBe(0);
    const vigente = await leer(e.gerente);
    expect(vigente).toEqual({
      nivel: "COMPRA_SIMPLE",
      version: 1,
      niveles: ["COMPRA_SIMPLE", "CON_COMPROBANTE"],
    });
    await leer(e.gerente);
    expect(await filasDeNivel(e)).toBe(0);
    expect(await cambios(e)).toBe(0);
  });

  it("el gerente guarda con la versión que leyó (aunque la fila todavía no exista): queda el nivel nuevo, versión siguiente y una auditoría", async () => {
    const e = await c.escenario();
    const visto = await leer(e.gerente);
    const r = await guardarElNivelDeCompras(d, e.gerente, {
      nivel: "CON_COMPROBANTE",
      versionEsperada: visto.version,
    });
    expect(r).toEqual({
      ok: true,
      dato: {
        nivel: "CON_COMPROBANTE",
        version: 2,
        niveles: ["COMPRA_SIMPLE", "CON_COMPROBANTE"],
      },
    });
    expect(await filasDeNivel(e)).toBe(1);
    expect(await cambios(e)).toBe(1);
    expect(await leer(e.gerente)).toMatchObject({ nivel: "CON_COMPROBANTE", version: 2 });
  });

  it("IDEMPOTENCIA: guardar el mismo nivel dos veces (doble toque o reintento) deja un solo cambio y una sola auditoría", async () => {
    const e = await c.escenario();
    const pedido = { nivel: "CON_COMPROBANTE", versionEsperada: 1 };
    const [a, b] = await Promise.all([
      guardarElNivelDeCompras(d, e.gerente, pedido),
      guardarElNivelDeCompras(d, e.gerente, pedido),
    ]);
    expect(a).toMatchObject({ ok: true, dato: { nivel: "CON_COMPROBANTE", version: 2 } });
    expect(b).toMatchObject({ ok: true, dato: { nivel: "CON_COMPROBANTE", version: 2 } });
    // Un tercer envío tardío, con la versión vieja, devuelve lo vigente sin escribir.
    expect(await guardarElNivelDeCompras(d, e.gerente, pedido)).toMatchObject({
      ok: true,
      dato: { nivel: "CON_COMPROBANTE", version: 2 },
    });
    expect(await cambios(e)).toBe(1);
    expect(await leer(e.gerente)).toMatchObject({ version: 2 });
  });

  it("CONCURRENCIA: dos gerentes a la vez, uno con cada nivel y la misma versión: queda un solo cambio, nunca una versión 3", async () => {
    const e = await c.escenario();
    const [a, b] = await Promise.all([
      guardarElNivelDeCompras(d, e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
      guardarElNivelDeCompras(d, e.gerente, { nivel: "COMPRA_SIMPLE", versionEsperada: 1 }),
    ]);
    // El segundo en llegar ve el nivel que quedó: o ya era el pedido (sin cambios) o es el genérico (versión vieja); nunca escribe dos veces.
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    for (const r of [a, b]) if (!r.ok) esGenerico(r);
    const vigente = await leer(e.gerente);
    expect(vigente.version).toBeLessThanOrEqual(2);
    expect(await cambios(e)).toBe(vigente.version - 1);
  });

  it("con una versión vieja y otro nivel: el genérico, no escribe, y la pantalla trae el nivel que quedó", async () => {
    const e = await c.escenario();
    expect(
      await guardarElNivelDeCompras(d, e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    ).toMatchObject({ ok: true });
    // Otra persona vio la versión 1 con «Sin factura» y quiere dejarla igual: lo que se ve ya no es lo vigente.
    esGenerico(
      await guardarElNivelDeCompras(d, e.gerente, { nivel: "COMPRA_SIMPLE", versionEsperada: 1 }),
    );
    expect(await leer(e.gerente)).toMatchObject({ nivel: "CON_COMPROBANTE", version: 2 });
    expect(await cambios(e)).toBe(1);
  });

  it("solo el gerente: quien administra y quien opera son rechazados al leer y al guardar, sin escribir", async () => {
    const e = await c.escenario();
    for (const quien of [e.administrador, e.operador]) {
      expect((await leerElNivelDeCompras(d, quien)).ok).toBe(false);
      expect(
        (
          await guardarElNivelDeCompras(d, quien, {
            nivel: "CON_COMPROBANTE",
            versionEsperada: 1,
          })
        ).ok,
      ).toBe(false);
    }
    expect(await filasDeNivel(e)).toBe(0);
    expect(await cambios(e)).toBe(0);
  });

  it("N3 y N4 (fase 5) no se aceptan desde la pantalla, aunque el plan los incluyera; un pedido con claves de más o inventadas es el genérico", async () => {
    const e = await c.escenario();
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
    try {
      for (const nivel of ["RECEPCION_SEPARADA", "TRES_VIAS", "NIVEL_INVENTADO", ""]) {
        esGenerico(await guardarElNivelDeCompras(d, e.gerente, { nivel, versionEsperada: 1 }));
      }
    } finally {
      c.apagarPerillas();
    }
    esGenerico(
      await guardarElNivelDeCompras(d, e.gerente, {
        nivel: "CON_COMPROBANTE",
        versionEsperada: 1,
        empresaId: nuevoId(),
      }),
    );
    esGenerico(await guardarElNivelDeCompras(d, e.gerente, { nivel: "CON_COMPROBANTE" }));
    esGenerico(
      await guardarElNivelDeCompras(d, e.gerente, {
        nivel: "CON_COMPROBANTE",
        versionEsperada: "1.5",
      }),
    );
    expect(await filasDeNivel(e)).toBe(0);
    expect(await cambios(e)).toBe(0);
  });

  it("aislamiento: el nivel de una empresa no lo ve ni lo cambia la otra", async () => {
    const una = await c.escenario();
    const otra = await c.escenario();
    expect(
      await guardarElNivelDeCompras(d, una.gerente, {
        nivel: "CON_COMPROBANTE",
        versionEsperada: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(await leer(otra.gerente)).toMatchObject({ nivel: "COMPRA_SIMPLE", version: 1 });
    expect(await filasDeNivel(otra)).toBe(0);
    expect(await cambios(otra)).toBe(0);
  });

  it("rige hacia adelante: una compra ya cargada conserva el nivel con que nació", async () => {
    const e = await c.escenario();
    const deposito = await c.deposito({ empresa: e.empresa, sucursal: e.sucursal });
    const producto = await c.producto(e.empresa, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    const cargada = valorDe(
      await c.casos.registrarCompra(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        depositoId: deposito,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    expect(
      await guardarElNivelDeCompras(d, e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    ).toMatchObject({ ok: true });
    const ficha = valorDe(
      await c.consultas.fichaDeCompra(e.operador, { recepcionId: cargada.recepcionId }),
    );
    expect(ficha?.nivel).toBe("COMPRA_SIMPLE");
  });
});
