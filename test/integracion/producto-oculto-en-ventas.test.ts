import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Carta real T8 (decisión del dueño, 12/11/2026: «ocultar… que no aparezca ni en conteos, ni en carta/pos»): el mostrador y el salón no cargan una línea NUEVA de un producto
 * oculto en esa sucursal (`PRODUCTO_OCULTO`), sea que lo oculte la empresa o el local. Lo ya cargado se cobra con su precio congelado (no se vuelve a cotizar) y anular una línea
 * sigue permitido; ocultar en un local no toca a los otros ni a otra empresa; «volver a mostrar» lo deja vender de nuevo; y ocultar a la vez que se agrega nunca da otra cosa
 * que «se agregó» o `PRODUCTO_OCULTO` (sin agotar reintentos ni dejar líneas a medias).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("ventas: un producto oculto no se carga (carta real T8)", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Fija el estado de ocultar de un alcance (`sucursal` nula = toda la empresa). El botón real es de catálogo; acá se arma como el dueño de la base. */
  const fijar = async (
    e: EscenarioDeVentas,
    producto: string,
    sucursal: string | null,
    oculto: boolean,
  ) => {
    const { rowCount } = await m.dueno.query(
      "update disponibilidad_de_producto set oculto = $4, actualizado_en = now() where empresa_id = $1 and producto_id = $2 and sucursal_id is not distinct from $3::uuid",
      [e.empresa, producto, sucursal, oculto],
    );
    if (rowCount === 0)
      await m.dueno.query(
        "insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_por, actualizado_en) values ($1, $2, $3, $4, null, now())",
        [e.empresa, producto, sucursal, oculto],
      );
  };
  const abrir = async (e: EscenarioDeVentas, sucursal: string = e.sucursal) => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: sucursal }));
    return cuenta;
  };
  const agregar = (e: EscenarioDeVentas, cuenta: string, producto: string) =>
    m.casos.agregarLinea(e.gerente, {
      cuentaId: cuenta,
      lineaId: nuevoId(),
      productoId: producto,
      opcionIds: [],
      cantidad: "1",
    });
  const lineas = async (cuenta: string) =>
    Number(
      (
        await m.filas<{ n: string }>(
          "select count(*) as n from linea_cuenta where cuenta_id = $1",
          [cuenta],
        )
      )[0]?.n,
    );

  it("oculto por la empresa: no se carga en ninguna sucursal; al volver a mostrar, sí", async () => {
    const e = await m.escenario();
    await fijar(e, e.producto, null, true);
    for (const sucursal of [e.sucursal, e.otraSucursal]) {
      const cuenta = await abrir(e, sucursal);
      expect(await agregar(e, cuenta, e.producto)).toEqual({
        ok: false,
        error: "PRODUCTO_OCULTO",
      });
      expect(await lineas(cuenta)).toBe(0);
    }
    await fijar(e, e.producto, null, false);
    const cuenta = await abrir(e);
    valorDe(await agregar(e, cuenta, e.producto));
    expect(await lineas(cuenta)).toBe(1);
  });

  it("oculto en un local: solo ahí se rechaza; el otro local y los demás productos siguen vendiendo", async () => {
    const e = await m.escenario();
    const otro = await m.productoVendible(e.empresa, "500");
    await fijar(e, e.producto, e.otraSucursal, true);
    const enNorte = await abrir(e, e.otraSucursal);
    expect(await agregar(e, enNorte, e.producto)).toEqual({ ok: false, error: "PRODUCTO_OCULTO" });
    valorDe(await agregar(e, enNorte, otro));
    const enPrincipal = await abrir(e);
    valorDe(await agregar(e, enPrincipal, e.producto));
  });

  it("un local que lo muestra no puede mostrar lo que la empresa oculta, y ocultar en otro local no afecta al primero", async () => {
    const e = await m.escenario();
    await fijar(e, e.producto, null, true);
    await fijar(e, e.producto, e.sucursal, false);
    expect(await agregar(e, await abrir(e), e.producto)).toEqual({
      ok: false,
      error: "PRODUCTO_OCULTO",
    });
    const f = await m.escenario();
    await fijar(f, f.producto, f.otraSucursal, true);
    valorDe(await agregar(f, await abrir(f), f.producto));
  });

  it("ocultar en una empresa no toca a otra", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    await fijar(a, a.producto, null, true);
    valorDe(await agregar(b, await abrir(b), b.producto));
  });

  it("lo ya cargado se cobra con su precio y se puede anular; una línea nueva del mismo producto se rechaza", async () => {
    const e = await m.escenario();
    const cuenta = await abrir(e);
    const linea = nuevoId();
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    await fijar(e, e.producto, null, true);
    expect(await agregar(e, cuenta, e.producto)).toEqual({ ok: false, error: "PRODUCTO_OCULTO" });
    // Cerrar no vuelve a cotizar: la cuenta con la línea ya cargada se cierra por su total.
    const cerrada = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
    );
    expect(cerrada).toMatchObject({ ticketId: expect.any(String) as unknown });
    // Otra cuenta con una línea cargada antes de ocultar: anularla sigue permitido.
    const otra = await m.escenario();
    const c2 = await abrir(otra);
    const l2 = nuevoId();
    valorDe(
      await m.casos.agregarLinea(otra.gerente, {
        cuentaId: c2,
        lineaId: l2,
        productoId: otra.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    await fijar(otra, otra.producto, null, true);
    valorDe(
      await m.casos.anularLinea(otra.gerente, {
        cuentaId: c2,
        lineaId: l2,
        motivo: "Se terminó",
      }),
    );
  });

  it("ocultar y agregar a la vez: se agrega o se rechaza por oculto; nunca otra cosa ni una línea a medias", async () => {
    const e = await m.escenario();
    for (let i = 0; i < 6; i++) {
      const producto = await m.productoVendible(e.empresa, "700");
      const cuenta = await abrir(e);
      const [agregada] = await Promise.all([
        agregar(e, cuenta, producto),
        fijar(e, producto, null, true),
      ]);
      if (agregada.ok) expect(await lineas(cuenta)).toBe(1);
      else {
        expect(agregada).toEqual({ ok: false, error: "PRODUCTO_OCULTO" });
        expect(await lineas(cuenta)).toBe(0);
      }
    }
  });
});
