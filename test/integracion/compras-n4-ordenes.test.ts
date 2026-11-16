import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";

/**
 * Compras N4 (tramo N4-1): las órdenes de compra al proveedor. Crear en borrador (idempotente), editar mientras es borrador, pedir (número, idempotente y con dos pedidos a la
 * vez), cerrar y anular (idempotentes), la perilla y el nivel, los permisos (el operador no) y el aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N4: órdenes de compra", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa en N4 con un proveedor y dos productos. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const azucar = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    return { e, harina: harina.producto, azucar: azucar.producto, proveedor };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const linea = (productoId: string, cantidad: string, precio: string | null = "10") => ({
    productoId,
    cantidad,
    precio,
  });
  const pedido = (m: M, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    proveedorId: m.proveedor,
    sucursalId: m.e.sucursal,
    entrega: "2999-12-31",
    lineas: [linea(m.harina, "1000"), linea(m.azucar, "500")],
    ...extra,
  });
  const crear = async (m: M, extra: Record<string, unknown> = {}) =>
    valorDe(await c.casos.crearOrden(m.e.gerente, pedido(m, extra))).ordenId;
  const filas = async (ordenId: string) =>
    (
      await c.dueno.query<{ numero: number; estado: string; version: number }>(
        "select numero, estado, version from orden_de_compra where id = $1",
        [ordenId],
      )
    ).rows[0];
  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  it("I1: la misma orden dos veces (misma clave) deja un solo borrador y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m);
    const primera = valorDe(await c.casos.crearOrden(m.e.gerente, p));
    expect(primera.yaExistia).toBe(false);
    const auditadas = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_CREADA")).length;
    const segunda = valorDe(await c.casos.crearOrden(m.e.administrador, p));
    expect(segunda).toEqual({ ordenId: primera.ordenId, yaExistia: true });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_CREADA")).length).toBe(auditadas);
    expect(
      (await c.dueno.query("select 1 from orden_de_compra where empresa_id = $1", [m.e.empresa]))
        .rowCount,
    ).toBe(1);
    const otra = await c.casos.crearOrden(m.e.gerente, {
      ...p,
      lineas: [linea(m.harina, "1001")],
    });
    expect(otra).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await filas(primera.ordenId)).toMatchObject({ numero: null, estado: "BORRADOR" });
    const lineas = await c.dueno.query(
      "select numero from linea_de_orden where orden_id = $1 order by numero",
      [primera.ordenId],
    );
    expect(lineas.rows).toEqual([{ numero: 1 }, { numero: 2 }]);
  });

  it("I1b: dos pedidos iguales a la vez (clic doble): una sola orden y los dos reciben la misma", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const p = pedido(m);
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.crearOrden(m.e.gerente, p),
          c.casos.crearOrden(m.e.gerente, p),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const ids = rs.map((r) => valorDe(r).ordenId);
      expect(ids[0]).toBe(ids[1]);
      expect(rs.filter((r) => r.ok && !r.valor.yaExistia)).toHaveLength(1);
      expect(
        (await c.dueno.query("select 1 from orden_de_compra where empresa_id = $1", [m.e.empresa]))
          .rowCount,
      ).toBe(1);
    }
  });

  it("validación: proveedor ajeno o inexistente, producto ajeno o no comprable, sucursal ajena, líneas y fechas inválidas", async () => {
    const m = await armar();
    const otra = await armar();
    const casos: [Record<string, unknown>, string][] = [
      [{ proveedorId: otra.proveedor }, "PROVEEDOR_NO_ENCONTRADO"],
      [{ proveedorId: "x" }, "IDENTIFICADOR_INVALIDO"],
      [{ clave: "x" }, "IDENTIFICADOR_INVALIDO"],
      [{ sucursalId: otra.e.sucursal }, "SUCURSAL_NO_ENCONTRADA"],
      [{ lineas: [linea(otra.harina, "1")] }, "PRODUCTO_NO_ENCONTRADO"],
      [{ lineas: [] }, "RENGLONES_INVALIDOS"],
      [{ lineas: [linea(m.harina, "0")] }, "RENGLONES_INVALIDOS"],
      [{ lineas: [linea(m.harina, "1"), linea(m.harina, "2")] }, "RENGLONES_INVALIDOS"],
      [{ entrega: "mañana" }, "FECHA_INVALIDA"],
    ];
    for (const [extra, esperado] of casos) {
      const r = await c.casos.crearOrden(m.e.gerente, pedido(m, extra));
      expect(codigo(r), JSON.stringify(extra)).toBe(esperado);
    }
    const noComprable = await c.producto(m.e.empresa, { clase: "VENDIBLE" });
    expect(
      codigo(
        await c.casos.crearOrden(m.e.gerente, pedido(m, { lineas: [linea(noComprable, "1")] })),
      ),
    ).toBe("PRODUCTO_NO_COMPRABLE");
    expect(
      (await c.dueno.query("select 1 from orden_de_compra where empresa_id = $1", [m.e.empresa]))
        .rowCount,
    ).toBe(0);
  });

  it("la entrega y la sucursal son opcionales: una orden sin destino ni fecha se crea", async () => {
    const m = await armar();
    const id = await crear(m, { sucursalId: null, entrega: null });
    expect(await filas(id)).toMatchObject({ estado: "BORRADOR" });
  });

  it("I2: editar dos veces con el mismo contenido deja una sola edición: la segunda devuelve sinCambios sin escribir ni auditar", async () => {
    const m = await armar();
    const id = await crear(m);
    const edicion = {
      ordenId: id,
      versionEsperada: 1,
      proveedorId: m.proveedor,
      sucursalId: m.e.sucursal,
      entrega: "2999-12-30",
      lineas: [linea(m.harina, "2000", "12"), linea(m.azucar, "500")],
    };
    expect(valorDe(await c.casos.editarOrden(m.e.gerente, edicion))).toEqual({
      version: 2,
      sinCambios: false,
    });
    const auditadas = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_EDITADA")).length;
    expect(valorDe(await c.casos.editarOrden(m.e.administrador, edicion))).toEqual({
      version: 2,
      sinCambios: true,
    });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_EDITADA")).length).toBe(auditadas);
    const lineas = await c.dueno.query<{
      numero: number;
      cantidad_pedida: string;
      retirada: boolean;
    }>(
      "select numero, cantidad_pedida::text, retirada from linea_de_orden where orden_id = $1 order by numero",
      [id],
    );
    expect(lineas.rows).toEqual([
      { numero: 1, cantidad_pedida: "2000.0000", retirada: false },
      { numero: 2, cantidad_pedida: "500.0000", retirada: false },
    ]);
  });

  it("editar: la línea que falta se retira (no se borra), la nueva va al final, una versión vieja con otro contenido se rechaza y no se edita lo pedido", async () => {
    const m = await armar();
    const id = await crear(m);
    const tercero = await c.articulo(m.e, { unidadBase: "GRAMO", dimension: "MASA" });
    const base = { ordenId: id, proveedorId: m.proveedor, sucursalId: m.e.sucursal, entrega: null };
    valorDe(
      await c.casos.editarOrden(m.e.gerente, {
        ...base,
        versionEsperada: 1,
        lineas: [linea(m.azucar, "500"), linea(tercero.producto, "7")],
      }),
    );
    const lineas = await c.dueno.query<{ numero: number; producto_id: string; retirada: boolean }>(
      "select numero, producto_id, retirada from linea_de_orden where orden_id = $1 order by numero",
      [id],
    );
    expect(lineas.rows).toEqual([
      { numero: 1, producto_id: m.harina, retirada: true },
      { numero: 2, producto_id: m.azucar, retirada: false },
      { numero: 3, producto_id: tercero.producto, retirada: false },
    ]);
    expect(
      await c.casos.editarOrden(m.e.gerente, {
        ...base,
        versionEsperada: 1,
        lineas: [linea(m.azucar, "9")],
      }),
    ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }));
    expect(
      await c.casos.editarOrden(m.e.gerente, {
        ...base,
        versionEsperada: 2,
        lineas: [linea(m.azucar, "9")],
      }),
    ).toEqual({ ok: false, error: "ORDEN_NO_ES_BORRADOR" });
    expect(
      await c.casos.editarOrden(m.e.gerente, {
        ...base,
        ordenId: nuevoId(),
        versionEsperada: 1,
        lineas: [linea(m.azucar, "9")],
      }),
    ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
  });

  it("I3: pedir dos veces la misma orden deja un solo número y la segunda devuelve yaEstaba sin escribir ni auditar", async () => {
    const m = await armar();
    const id = await crear(m);
    const primera = valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }));
    expect(primera.yaEstaba).toBe(false);
    const auditadas = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_PEDIDA")).length;
    const segunda = valorDe(await c.casos.pedirOrden(m.e.administrador, { ordenId: id }));
    expect(segunda).toEqual({ numero: primera.numero, yaEstaba: true });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_PEDIDA")).length).toBe(auditadas);
    expect(await filas(id)).toMatchObject({ numero: primera.numero, estado: "PEDIDA" });
    const saldos = await c.dueno.query<{
      linea: number;
      cantidad_pedida: string;
      cantidad_recibida: string;
    }>(
      "select linea, cantidad_pedida::text, cantidad_recibida::text from saldo_de_linea_de_orden where orden_id = $1 order by linea",
      [id],
    );
    expect(saldos.rows).toEqual([
      { linea: 1, cantidad_pedida: "1000.0000", cantidad_recibida: "0.0000" },
      { linea: 2, cantidad_pedida: "500.0000", cantidad_recibida: "0.0000" },
    ]);
  });

  it("pedir: los números de la empresa son consecutivos y dos pedidos a la vez de la misma orden o de órdenes distintas no repiten ni saltan", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const a = await crear(m);
      const b = await crear(m);
      const mismo = await crear(m);
      c.armarBarrera(4);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.pedirOrden(m.e.gerente, { ordenId: a }),
          c.casos.pedirOrden(m.e.gerente, { ordenId: b }),
          c.casos.pedirOrden(m.e.gerente, { ordenId: mismo }),
          c.casos.pedirOrden(m.e.administrador, { ordenId: mismo }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const valores = rs.map((r) => valorDe(r));
      expect(valores[2]?.numero).toBe(valores[3]?.numero);
      expect(valores.filter((v) => !v.yaEstaba)).toHaveLength(3);
      const numeros = (
        await c.dueno.query<{ numero: number }>(
          "select numero from orden_de_compra where empresa_id = $1 order by numero",
          [m.e.empresa],
        )
      ).rows.map((f) => f.numero);
      expect(numeros).toEqual([1, 2, 3]);
    }
  });

  it("pedir una orden cuyo proveedor o producto ya no sirve falla cerrado y la deja en borrador", async () => {
    const m = await armar();
    const id = await crear(m);
    await c.dueno.query("update producto set activo = false where id = $1", [m.harina]);
    expect(codigo(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }))).toBe(
      "PRODUCTO_NO_COMPRABLE",
    );
    expect(await filas(id)).toMatchObject({ numero: null, estado: "BORRADOR" });
  });

  it("I4: cerrar dos veces la misma orden devuelve el mismo motivo y la segunda no escribe ni audita", async () => {
    const m = await armar();
    const id = await crear(m);
    expect(await c.casos.cerrarOrden(m.e.gerente, { ordenId: id })).toEqual({
      ok: false,
      error: "ORDEN_NO_ESTA_PEDIDA",
    });
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }));
    const primera = valorDe(await c.casos.cerrarOrden(m.e.gerente, { ordenId: id }));
    expect(primera).toEqual({ motivo: "CON_SALDO", yaEstaba: false });
    const auditadas = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_CERRADA")).length;
    expect(valorDe(await c.casos.cerrarOrden(m.e.administrador, { ordenId: id }))).toEqual({
      motivo: "CON_SALDO",
      yaEstaba: true,
    });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_CERRADA")).length).toBe(auditadas);
    expect(await c.casos.anularOrden(m.e.gerente, { ordenId: id, motivo: "Ya cerrada" })).toEqual({
      ok: false,
      error: "ORDEN_YA_CERRADA",
    });
  });

  it("I5: anular dos veces la misma orden devuelve yaEstaba y la segunda no escribe ni audita; sirve en borrador y pedida, exige motivo y una anulada no se pide ni se cierra", async () => {
    const m = await armar();
    const borrador = await crear(m);
    const pedida = await crear(m);
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: pedida }));
    expect(await c.casos.anularOrden(m.e.gerente, { ordenId: pedida, motivo: " " })).toMatchObject({
      ok: false,
      error: "MOTIVO_REQUERIDO",
    });
    for (const id of [borrador, pedida]) {
      expect(
        valorDe(await c.casos.anularOrden(m.e.gerente, { ordenId: id, motivo: "Se cargó mal" })),
      ).toEqual({ yaEstaba: false });
    }
    const auditadas = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_ANULADA")).length;
    expect(auditadas).toBe(2);
    expect(
      valorDe(
        await c.casos.anularOrden(m.e.administrador, { ordenId: pedida, motivo: "Otra vez" }),
      ),
    ).toEqual({ yaEstaba: true });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_ANULADA")).length).toBe(auditadas);
    expect(await c.casos.pedirOrden(m.e.gerente, { ordenId: borrador })).toEqual({
      ok: false,
      error: "ORDEN_NO_ES_BORRADOR",
    });
    expect(await c.casos.cerrarOrden(m.e.gerente, { ordenId: pedida })).toEqual({
      ok: false,
      error: "ORDEN_NO_ESTA_PEDIDA",
    });
    const anulada = await c.dueno.query<{ anulada_por: string; motivo_de_anulacion: string }>(
      "select anulada_por, motivo_de_anulacion from orden_de_compra where id = $1",
      [pedida],
    );
    expect(anulada.rows[0]).toEqual({
      anulada_por: m.e.personaDelGerente,
      motivo_de_anulacion: "Se cargó mal",
    });
  });

  it("anular y pedir la misma orden a la vez: gana una y el estado queda de acuerdo (nunca pedida y anulada)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const id = await crear(m);
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.pedirOrden(m.e.gerente, { ordenId: id }),
          c.casos.anularOrden(m.e.administrador, { ordenId: id, motivo: "Carrera" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const estado = (await filas(id))?.estado;
      if (estado === "ANULADA") {
        expect(rs[0].ok ? "pedida primero" : codigo(rs[0])).toMatch(
          /ORDEN_NO_ES_BORRADOR|pedida primero/,
        );
      } else {
        expect(estado).toBe("PEDIDA");
        expect(rs[1].ok).toBe(true);
      }
    }
  });

  it("el operador no crea, edita, pide, cierra ni anula (SIN_PERMISO) y no cambia nada", async () => {
    const m = await armar();
    const id = await crear(m);
    const op = m.e.operador;
    const intentos = [
      await c.casos.crearOrden(op, pedido(m)),
      await c.casos.editarOrden(op, {
        ordenId: id,
        versionEsperada: 1,
        proveedorId: m.proveedor,
        lineas: [linea(m.harina, "1")],
      }),
      await c.casos.pedirOrden(op, { ordenId: id }),
      await c.casos.cerrarOrden(op, { ordenId: id }),
      await c.casos.anularOrden(op, { ordenId: id, motivo: "No puede" }),
    ];
    for (const r of intentos) expect(r).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(await filas(id)).toMatchObject({ numero: null, estado: "BORRADOR", version: 1 });
  });

  it("la empresa en otro nivel no crea ni pide órdenes: ORDEN_NO_CORRESPONDE_AL_NIVEL; sin la perilla en el plan, FUNCION_NO_INCLUIDA; cerrar y anular lo iniciado siguen", async () => {
    const m = await armar();
    const id = await crear(m);
    const pedida = await crear(m);
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: pedida }));
    c.apagarPerillas();
    try {
      for (const r of [
        await c.casos.crearOrden(m.e.gerente, pedido(m)),
        await c.casos.pedirOrden(m.e.gerente, { ordenId: id }),
      ]) {
        expect(r).toEqual({
          ok: false,
          error: { error: "FUNCION_NO_INCLUIDA", perilla: "conciliacion_de_tres_vias" },
        });
      }
      expect(valorDe(await c.casos.cerrarOrden(m.e.gerente, { ordenId: pedida })).yaEstaba).toBe(
        false,
      );
      expect(
        valorDe(
          await c.casos.anularOrden(m.e.gerente, { ordenId: id, motivo: "Plan sin la función" }),
        ).yaEstaba,
      ).toBe(false);
    } finally {
      c.encenderPerilla("recepcion_separada");
      c.encenderPerilla("conciliacion_de_tres_vias");
    }
    const n3 = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(n3.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
    const proveedor = await c.proveedor(n3.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const articulo = await c.articulo(n3, { unidadBase: "GRAMO", dimension: "MASA" });
    expect(
      await c.casos.crearOrden(n3.gerente, {
        clave: nuevoId(),
        proveedorId: proveedor,
        lineas: [linea(articulo.producto, "1")],
      }),
    ).toEqual({ ok: false, error: "ORDEN_NO_CORRESPONDE_AL_NIVEL" });
  });

  it("aislamiento: otra empresa no ve, no pide, no cierra ni anula la orden de esta", async () => {
    const a = await armar();
    const b = await armar();
    const id = await crear(a);
    expect(await c.casos.pedirOrden(b.e.gerente, { ordenId: id })).toEqual({
      ok: false,
      error: "ORDEN_NO_ENCONTRADA",
    });
    expect(await c.casos.cerrarOrden(b.e.gerente, { ordenId: id })).toEqual({
      ok: false,
      error: "ORDEN_NO_ENCONTRADA",
    });
    expect(await c.casos.anularOrden(b.e.gerente, { ordenId: id, motivo: "Ajena" })).toEqual({
      ok: false,
      error: "ORDEN_NO_ENCONTRADA",
    });
    expect(
      await c.casos.editarOrden(b.e.gerente, {
        ordenId: id,
        versionEsperada: 1,
        proveedorId: b.proveedor,
        lineas: [linea(b.harina, "1")],
      }),
    ).toEqual({ ok: false, error: "ORDEN_NO_ENCONTRADA" });
    // la misma clave en dos empresas son dos órdenes
    const clave = nuevoId();
    const x = valorDe(await c.casos.crearOrden(a.e.gerente, pedido(a, { clave })));
    const y = valorDe(await c.casos.crearOrden(b.e.gerente, pedido(b, { clave })));
    expect(x.ordenId).not.toBe(y.ordenId);
    expect(await filas(id)).toMatchObject({ estado: "BORRADOR" });
  });

  it("todo cambio deja constancia con quién y qué cambió", async () => {
    const m = await armar();
    const id = await crear(m);
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }));
    valorDe(await c.casos.cerrarOrden(m.e.administrador, { ordenId: id }));
    const pedida = (await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_PEDIDA")).at(-1);
    expect(pedida).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad: "orden_de_compra",
      entidad_id: id,
      antes: { estado: "BORRADOR" },
      despues: { estado: "PEDIDA", numero: 1, renglones: 2 },
    });
    expect((await c.auditoria(m.e.empresa, "ORDEN_DE_COMPRA_CERRADA")).at(-1)).toMatchObject({
      antes: { estado: "PEDIDA" },
      despues: { estado: "CERRADA", motivo: "CON_SALDO" },
    });
  });
});

describe.skipIf(base === null)("compras N4: lectura de órdenes", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    return { e, harina: harina.producto, proveedor };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const crear = async (m: M, extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearOrden(m.e.gerente, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        sucursalId: m.e.sucursal,
        lineas: [{ productoId: m.harina, cantidad: "1000", precio: "10" }],
        ...extra,
      }),
    ).ordenId;

  it("la lista trae el estado de cada orden, filtra por estado y proveedor y no mezcla empresas", async () => {
    const m = await armar();
    const otra = await armar();
    const borrador = await crear(m);
    const pedida = await crear(m);
    const cerrada = await crear(m);
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: pedida }));
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: cerrada }));
    valorDe(await c.casos.cerrarOrden(m.e.gerente, { ordenId: cerrada }));
    await crear(otra);
    const todas = valorDe(await c.consultas.listarOrdenes(m.e.gerente, {}));
    expect(todas.filas.map((f) => [f.ordenId, f.estado, f.numero, f.renglones])).toEqual([
      [cerrada, "CERRADA", 2, 1],
      [pedida, "PEDIDA", 1, 1],
      [borrador, "BORRADOR", null, 1],
    ]);
    expect(todas.filas[0]).toMatchObject({ cierreMotivo: "CON_SALDO", proveedorId: m.proveedor });
    expect(todas.siguiente).toBeNull();
    expect(
      valorDe(await c.consultas.listarOrdenes(m.e.administrador, { estado: "PEDIDA" })).filas,
    ).toHaveLength(1);
    expect(
      valorDe(await c.consultas.listarOrdenes(m.e.gerente, { proveedorId: nuevoId() })).filas,
    ).toEqual([]);
    expect(await c.consultas.listarOrdenes(m.e.gerente, { estado: "VIEJA" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarOrdenes(m.e.gerente, { proveedorId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarOrdenes(m.e.gerente, { despuesDe: "no-es-un-cursor" })).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
  });

  it("la lista se pagina por cursor sin repetir ni saltear órdenes", async () => {
    const m = await armar();
    const creadas: string[] = [];
    for (let i = 0; i < 51; i++) creadas.push(await crear(m));
    const primera = valorDe(await c.consultas.listarOrdenes(m.e.gerente, {}));
    expect(primera.filas).toHaveLength(50);
    expect(primera.siguiente).not.toBeNull();
    const segunda = valorDe(
      await c.consultas.listarOrdenes(m.e.gerente, { despuesDe: primera.siguiente as string }),
    );
    expect(segunda.siguiente).toBeNull();
    const vistas = [...primera.filas, ...segunda.filas].map((f) => f.ordenId);
    expect(new Set(vistas).size).toBe(51);
    expect([...vistas].sort()).toEqual([...creadas].sort());
  });

  it("el detalle trae lo pedido y lo recibido por línea; el operador lo ve sin precios y no puede pedirlos", async () => {
    const m = await armar();
    const id = await crear(m);
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: id }));
    const detalle = valorDe(await c.consultas.obtenerOrden(m.e.operador, { ordenId: id }));
    expect(detalle).toMatchObject({
      ordenId: id,
      numero: 1,
      estado: "PEDIDA",
      version: 2,
      lineas: [
        { numero: 1, cantidadPedida: "1000.0000", cantidadRecibida: "0.0000", retirada: false },
      ],
    });
    expect(detalle?.lineas[0]).not.toHaveProperty("precioUnitario");
    expect(
      await c.consultas.obtenerOrden(m.e.operador, { ordenId: id, conPrecios: true }),
    ).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    const conPrecios = valorDe(
      await c.consultas.obtenerOrden(m.e.gerente, { ordenId: id, conPrecios: true }),
    );
    expect(conPrecios?.lineas[0]).toMatchObject({ precioUnitario: "10.000000" });
    const borrador = await crear(m);
    expect(
      valorDe(await c.consultas.obtenerOrden(m.e.gerente, { ordenId: borrador }))?.lineas[0],
    ).toMatchObject({
      cantidadRecibida: null,
    });
  });

  it("el detalle de una orden inexistente, de otra empresa o con id inválido no existe; el operador solo ve las de sus sucursales y nunca una sin destino", async () => {
    const m = await armar();
    const otra = await armar();
    const id = await crear(m);
    const ajena = await crear(otra);
    expect(valorDe(await c.consultas.obtenerOrden(m.e.gerente, { ordenId: ajena }))).toBeNull();
    expect(valorDe(await c.consultas.obtenerOrden(m.e.gerente, { ordenId: nuevoId() }))).toBeNull();
    expect(await c.consultas.obtenerOrden(m.e.gerente, { ordenId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(valorDe(await c.consultas.obtenerOrden(m.e.operador, { ordenId: id }))?.ordenId).toBe(
      id,
    );
    const sinDestino = await crear(m, { sucursalId: null });
    expect(
      valorDe(await c.consultas.obtenerOrden(m.e.operador, { ordenId: sinDestino })),
    ).toBeNull();
    expect(
      valorDe(await c.consultas.obtenerOrden(m.e.gerente, { ordenId: sinDestino }))?.ordenId,
    ).toBe(sinDestino);
    const delOperador = valorDe(await c.consultas.listarOrdenes(m.e.operador, {}));
    expect(delOperador.filas.map((f) => f.ordenId)).toEqual([id]);
    const deOtraSucursal = await c.consultas.listarOrdenes(m.e.operador, {
      proveedorId: m.proveedor,
    });
    expect(valorDe(deOtraSucursal).filas).toHaveLength(1);
  });
});
