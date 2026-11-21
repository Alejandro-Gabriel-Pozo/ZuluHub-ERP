import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";

/**
 * Compras N4 (tramo N4-2): recibir contra una orden pedida. La recepción de N3 y N4 trae, por línea, contra qué línea de qué orden es; lo recibido (en la unidad base) se suma al saldo de la
 * orden con el control `compras.recepcion_excede_la_orden` (PERMITIR, AVISAR con confirmación), anular la recepción lo devuelve y repetir el pedido no suma dos veces.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N4: recibir contra la orden", () => {
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

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  /** Una empresa en N4 con un proveedor, dos productos en gramos y una orden PEDIDA de 10 kg de harina (10000 g) y 500 g de azúcar. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const azucar = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const deposito = await c.deposito(e);
    await c.deposito(e, { uso: "RECHAZO" });
    const ordenId = valorDe(
      await c.casos.crearOrden(e.gerente, {
        clave: nuevoId(),
        proveedorId: proveedor,
        sucursalId: e.sucursal,
        lineas: [
          { productoId: harina, cantidad: "10000", precio: "1" },
          { productoId: azucar, cantidad: "500", precio: "2" },
        ],
      }),
    ).ordenId;
    valorDe(await c.casos.pedirOrden(e.gerente, { ordenId }));
    return { e, harina, azucar, proveedor, ordenId, deposito };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const pedido = (m: M, kilos: string, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    renglones: [
      {
        productoId: m.harina,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: kilos,
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
      },
    ],
    contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 1 }],
    ...extra,
  });
  const recibir = (m: M, kilos: string, extra: Record<string, unknown> = {}) =>
    c.casos.registrarRecepcion(m.e.operador, pedido(m, kilos, extra));
  const confirmar = (m: M, recepcionId: string) =>
    c.casos.confirmarRecepcion(m.e.gerente, { recepcionId, depositoId: m.deposito });
  /** Registra la recepción contra la orden y la confirma: recién ahí se suma lo aceptado al saldo. */
  const recibirYConfirmar = async (m: M, kilos: string, extra: Record<string, unknown> = {}) => {
    const r = valorDe(await recibir(m, kilos, extra));
    valorDe(await confirmar(m, r.recepcionId));
    return r.recepcionId;
  };
  const recibido = async (m: M, linea = 1) =>
    (
      await c.dueno.query<{ r: string }>(
        "select cantidad_recibida::text as r from saldo_de_linea_de_orden where orden_id = $1 and linea = $2",
        [m.ordenId, linea],
      )
    ).rows[0]?.r;
  const control = (m: M, nivel: string) =>
    c.dueno.query(
      "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'compras.recepcion_excede_la_orden', $2)",
      [m.e.empresa, nivel],
    );

  it("recibir contra la orden suma lo recibido (kilos a gramos) al saldo y el detalle lo muestra", async () => {
    const m = await armar();
    const r = valorDe(await recibir(m, "4"));
    expect(await recibido(m)).toBe("0.0000");
    valorDe(await confirmar(m, r.recepcionId));
    expect(await recibido(m)).toBe("4000.0000");
    const detalle = valorDe(await c.consultas.obtenerOrden(m.e.operador, { ordenId: m.ordenId }));
    expect(detalle?.lineas.map((l) => [l.cantidadPedida, l.cantidadRecibida])).toEqual([
      ["10000.0000", "4000.0000"],
      ["500.0000", "0.0000"],
    ]);
    const auditada = (await c.auditoria(m.e.empresa, "RECEPCION_REGISTRADA")).at(-1);
    expect(auditada?.despues).toMatchObject({ ordenes: [m.ordenId] });
  });

  it("I6: el mismo pedido dos veces (misma clave) suma una sola vez; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m, "3");
    const primera = valorDe(await c.casos.registrarRecepcion(m.e.operador, p));
    const segunda = valorDe(await c.casos.registrarRecepcion(m.e.operador, p));
    expect(segunda).toEqual({ recepcionId: primera.recepcionId, yaExistia: true });
    valorDe(await confirmar(m, primera.recepcionId));
    expect(valorDe(await confirmar(m, primera.recepcionId)).yaExistia).toBe(true);
    expect(await recibido(m)).toBe("3000.0000");
    expect(
      await c.casos.registrarRecepcion(m.e.operador, {
        ...p,
        contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 2 }],
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await recibido(m)).toBe("3000.0000");
  });

  it("sin control (PERMITIR) el exceso pasa y queda en el saldo", async () => {
    const m = await armar();
    await recibirYConfirmar(m, "12");
    expect(await recibido(m)).toBe("12000.0000");
  });

  it("con AVISAR el exceso pide confirmación explícita y con ella pasa", async () => {
    const m = await armar();
    await control(m, "AVISAR");
    expect(codigo(await recibir(m, "11"))).toBe("RECEPCION_EXCEDE_LA_ORDEN_SIN_CONFIRMAR");
    await recibirYConfirmar(m, "11", {
      contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 1, confirmoExceso: true }],
    });
    expect(await recibido(m)).toBe("11000.0000");
  });

  it("solo se recibe contra una orden pedida, del mismo proveedor, del mismo producto y con la línea sin retirar", async () => {
    const m = await armar();
    const otra = await armar();
    const contra = (ordenId: string, lineaDeOrden: number) => ({
      contraOrden: [{ linea: 1, ordenId, lineaDeOrden }],
    });
    expect(codigo(await recibir(m, "1", contra(otra.ordenId, 1)))).toBe("ORDEN_NO_ENCONTRADA");
    expect(codigo(await recibir(m, "1", contra(nuevoId(), 1)))).toBe("ORDEN_NO_ENCONTRADA");
    expect(codigo(await recibir(m, "1", contra(m.ordenId, 2)))).toBe(
      "LINEA_DE_ORDEN_DE_OTRO_PRODUCTO",
    );
    expect(codigo(await recibir(m, "1", contra(m.ordenId, 9)))).toBe("ORDEN_NO_ENCONTRADA");
    const otroProveedor = await c.proveedor(m.e.operador, {
      condicionIva: "RESPONSABLE_INSCRIPTO",
    });
    expect(codigo(await recibir(m, "1", { proveedorId: otroProveedor }))).toBe(
      "ORDEN_DE_OTRO_PROVEEDOR",
    );
    const borrador = valorDe(
      await c.casos.crearOrden(m.e.gerente, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        lineas: [{ productoId: m.harina, cantidad: "1" }],
      }),
    ).ordenId;
    expect(codigo(await recibir(m, "1", contra(borrador, 1)))).toBe("ORDEN_NO_ESTA_PEDIDA");
    const conRetirada = valorDe(
      await c.casos.crearOrden(m.e.gerente, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        lineas: [
          { productoId: m.azucar, cantidad: "5" },
          { productoId: m.harina, cantidad: "5" },
        ],
      }),
    ).ordenId;
    valorDe(
      await c.casos.editarOrden(m.e.gerente, {
        ordenId: conRetirada,
        versionEsperada: 1,
        proveedorId: m.proveedor,
        lineas: [{ productoId: m.harina, cantidad: "5" }],
      }),
    );
    valorDe(await c.casos.pedirOrden(m.e.gerente, { ordenId: conRetirada }));
    expect(codigo(await recibir(m, "1", contra(conRetirada, 1)))).toBe("LINEA_DE_ORDEN_RETIRADA");
    expect(await recibido(m)).toBe("0.0000");
  });

  it("los vínculos mal armados se rechazan y recibir contra una orden pide N4 con su perilla", async () => {
    const m = await armar();
    for (const contraOrden of [
      "x",
      [{ linea: 2, ordenId: m.ordenId, lineaDeOrden: 1 }],
      [{ linea: 1, ordenId: "x", lineaDeOrden: 1 }],
    ]) {
      expect(await recibir(m, "1", { contraOrden })).toMatchObject({ ok: false });
    }
    c.apagarPerillas();
    try {
      c.encenderPerilla("recepcion_separada");
      expect(await recibir(m, "1")).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "conciliacion_de_tres_vias" },
      });
    } finally {
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
    const p = (await c.articulo(n3, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    expect(
      await c.casos.registrarRecepcion(n3.operador, {
        clave: nuevoId(),
        sucursalId: n3.sucursal,
        proveedorId: proveedor,
        renglones: [
          {
            productoId: p,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "1",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1",
          },
        ],
        contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 1 }],
      }),
    ).toEqual({ ok: false, error: "ORDEN_NO_CORRESPONDE_AL_NIVEL" });
  });

  it("una orden con una recepción pendiente no se anula ni se cierra; anulada la pendiente no devuelve nada (nunca sumó) y la orden se puede cerrar COMPLETA", async () => {
    const m = await armar();
    const r = valorDe(await recibir(m, "6")).recepcionId;
    expect(
      await c.casos.anularOrden(m.e.gerente, { ordenId: m.ordenId, motivo: "Con recepciones" }),
    ).toEqual({
      ok: false,
      error: "ORDEN_CON_RECEPCIONES",
    });
    expect(await c.casos.cerrarOrden(m.e.gerente, { ordenId: m.ordenId })).toEqual({
      ok: false,
      error: "ORDEN_CON_RECEPCIONES_PENDIENTES",
    });
    valorDe(
      await c.casos.anularRecepcionPendiente(m.e.gerente, {
        recepcionId: r,
        motivo: "Se cargó mal",
      }),
    );
    expect(await recibido(m)).toBe("0.0000");
    await recibirYConfirmar(m, "10");
    const azucar = valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
        ...pedido(m, "500", {}),
        renglones: [
          {
            productoId: m.azucar,
            unidadDeCompraId: "GRAMO",
            cantidad: "500",
            precioPor: "UNIDAD",
            unidadDePrecioId: "GRAMO",
            precio: "2",
          },
        ],
        contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 2 }],
      }),
    );
    valorDe(await confirmar(m, azucar.recepcionId));
    expect(valorDe(await c.casos.cerrarOrden(m.e.gerente, { ordenId: m.ordenId })).motivo).toBe(
      "COMPLETA",
    );
    expect(codigo(await recibir(m, "1"))).toBe("ORDEN_NO_ESTA_PEDIDA");
  });

  it("una línea RECHAZADA por el control no cuenta como recibida contra la orden: la orden sigue con saldo y se cierra CON_SALDO", async () => {
    const m = await armar();
    const r = valorDe(
      await recibir(m, "4", {
        controles: [{ linea: 1, condicion: "RECHAZADA", observacion: "Vencida" }],
      }),
    );
    valorDe(await confirmar(m, r.recepcionId));
    expect(await recibido(m)).toBe("0.0000");
    await recibirYConfirmar(m, "3");
    expect(await recibido(m)).toBe("3000.0000");
    expect(valorDe(await c.casos.cerrarOrden(m.e.gerente, { ordenId: m.ordenId })).motivo).toBe(
      "CON_SALDO",
    );
  });

  it("dos recepciones pendientes que no caben juntas, confirmadas a la vez con AVISAR sin confirmar: entra una sola y la otra falla cerrado y sigue pendiente", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      await control(m, "AVISAR");
      const a = valorDe(await recibir(m, "7")).recepcionId;
      const b = valorDe(await recibir(m, "7")).recepcionId;
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([confirmar(m, a), confirmar(m, b)]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = rs.find((r) => !r.ok);
      expect(perdedora && codigo(perdedora)).toBe("RECEPCION_EXCEDE_LA_ORDEN_SIN_CONFIRMAR");
      expect(await recibido(m)).toBe("7000.0000");
      const pendientes = await c.dueno.query(
        "select 1 from recepcion where id = any($1) and estado = 'PENDIENTE'",
        [[a, b]],
      );
      expect(pendientes.rowCount).toBe(1);
    }
  });

  it("confirmar la misma recepción dos veces a la vez suma una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = valorDe(await recibir(m, "4")).recepcionId;
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([confirmar(m, r), confirmar(m, r)]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((x) => x.ok).length).toBeGreaterThanOrEqual(1);
      expect(await recibido(m)).toBe("4000.0000");
    }
  });

  it("confirmar la recepción y anular la orden a la vez: la orden no se anula (hay una recepción vigente) y lo recibido queda sumado", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = valorDe(await recibir(m, "2")).recepcionId;
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          confirmar(m, r),
          c.casos.anularOrden(m.e.gerente, { ordenId: m.ordenId, motivo: "Carrera" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs[0].ok).toBe(true);
      expect(codigo(rs[1])).toBe("ORDEN_CON_RECEPCIONES");
      const estado = (
        await c.dueno.query<{ estado: string }>(
          "select estado from orden_de_compra where id = $1",
          [m.ordenId],
        )
      ).rows[0]?.estado;
      expect(estado).toBe("PEDIDA");
      expect(await recibido(m)).toBe("2000.0000");
    }
  });
});
