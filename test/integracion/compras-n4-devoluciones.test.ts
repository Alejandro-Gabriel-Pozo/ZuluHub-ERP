import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { motivoDeRechazo } from "./compras-devoluciones-apoyo";
import { codigoDe } from "./concurrencia-apoyo";

/**
 * Compras N4 (tramo N4-5): devolver mercadería al proveedor. Una salida de stock con su motivo de la lista del sistema, de un depósito de la sucursal, atómica con la devolución y sus
 * líneas; repetir el pedido o hacerlo a la vez no descuenta dos veces; anular devuelve la mercadería con el mismo costo, una sola vez; lo devuelto con origen no pasa de lo recibido;
 * todo filtra por empresa y alcance, y pide gerente o administrador.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N4: devoluciones al proveedor", () => {
  let c: MontajeDeCompras;
  let motivo: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
    motivo = await motivoDeRechazo(c.dueno);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string => codigoDe(r);

  /** Una empresa en N4 con un proveedor, harina en gramos y 10 kg recibidos y confirmados en un depósito normal (10000 g de existencia). */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const deposito = await c.deposito(e);
    const r = valorDe(
      await c.casos.registrarRecepcion(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        renglones: [
          {
            productoId: harina.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "10",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    valorDe(
      await c.casos.confirmarRecepcion(e.gerente, {
        recepcionId: r.recepcionId,
        depositoId: deposito,
      }),
    );
    return { e, harina, proveedor, deposito, recepcionId: r.recepcionId };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const pedido = (m: M, gramos: string, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    motivoId: motivo,
    lineas: [{ productoId: m.harina.producto, cantidad: gramos }],
    ...extra,
  });
  const existencia = async (m: M) => c.existencia(m.deposito, m.harina.articulo);
  const cuantas = async (m: M, estado?: string) =>
    Number(
      (
        await c.dueno.query<{ n: string }>(
          "select count(*) as n from devolucion_a_proveedor where empresa_id = $1 and ($2::text is null or estado = $2)",
          [m.e.empresa, estado ?? null],
        )
      ).rows[0]?.n,
    );
  const salidas = async (m: M) =>
    Number(
      (
        await c.dueno.query<{ n: string }>(
          "select count(*) as n from movimiento_de_stock where empresa_id = $1 and origen_tipo = 'DEVOLUCION_A_PROVEEDOR'",
          [m.e.empresa],
        )
      ).rows[0]?.n,
    );

  it("devolver descuenta lo devuelto del depósito, numera la devolución, enlaza cada línea con su renglón de stock y deja el rastro", async () => {
    const m = await armar();
    expect(await existencia(m)).toBe("10000.0000");
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "2500.5")));
    expect(r).toMatchObject({ numero: 1, yaExistia: false });
    expect(await existencia(m)).toBe("7499.5000");
    const lineas = await c.dueno.query(
      `select l.numero, l.cantidad::text as cantidad, l.renglon_numero, m.clase, m.motivo, m.origen_tipo, m.origen_id
         from linea_de_devolucion l join movimiento_de_stock m on m.id = l.movimiento_id
        where l.devolucion_id = $1`,
      [r.devolucionId],
    );
    expect(lineas.rows).toEqual([
      {
        numero: 1,
        cantidad: "2500.5000",
        renglon_numero: 1,
        clase: "SALIDA",
        motivo: "DEVOLUCION_A_PROVEEDOR",
        origen_tipo: "DEVOLUCION_A_PROVEEDOR",
        origen_id: r.devolucionId,
      },
    ]);
    const segunda = valorDe(await c.casos.devolverAlProveedor(m.e.administrador, pedido(m, "1")));
    expect(segunda.numero).toBe(2);
    const auditada = (await c.auditoria(m.e.empresa, "DEVOLUCION_REGISTRADA")).at(0);
    expect(auditada).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad: "devolucion_a_proveedor",
      entidad_id: r.devolucionId,
      despues: { numero: 1, estado: "CONFIRMADA", renglones: 1, existenciaNegativa: 0 },
    });
  });

  it("I1: la misma devolución dos veces (misma clave) deja una sola salida de stock y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m, "1000");
    const primera = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, p));
    const segunda = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, p));
    expect(segunda).toEqual({ ...primera, yaExistia: true });
    expect(await cuantas(m)).toBe(1);
    expect(await salidas(m)).toBe(1);
    expect(await existencia(m)).toBe("9000.0000");
    expect(await c.auditoria(m.e.empresa, "DEVOLUCION_REGISTRADA")).toHaveLength(1);
    const otra = await c.casos.devolverAlProveedor(m.e.gerente, {
      ...p,
      lineas: [{ productoId: m.harina.producto, cantidad: "2000" }],
    });
    expect(codigo(otra)).toBe("CLAVE_REUTILIZADA");
    expect(await existencia(m)).toBe("9000.0000");
  });

  it("I1b: dos pedidos iguales a la vez (clic doble): una sola devolución y una sola salida", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const p = pedido(m, "1500");
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.devolverAlProveedor(m.e.gerente, p),
          c.casos.devolverAlProveedor(m.e.gerente, p),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const ids = rs.map((r) => valorDe(r).devolucionId);
      expect(ids[0]).toBe(ids[1]);
      expect(rs.filter((r) => r.ok && !r.valor.yaExistia)).toHaveLength(1);
      expect(await cuantas(m)).toBe(1);
      expect(await salidas(m)).toBe(1);
      expect(await existencia(m)).toBe("8500.0000");
    }
  });

  it("dos devoluciones distintas a la vez reciben números distintos y descuentan las dos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "1000")),
          c.casos.devolverAlProveedor(m.e.administrador, pedido(m, "2000")),
        ]);
      } finally {
        c.soltarBarrera();
      }
      // La numeración la serializa el candado de la base: la segunda espera y toma el número siguiente; las dos se hacen.
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.map((r) => valorDe(r).numero).sort()).toEqual([1, 2]);
      expect(await existencia(m)).toBe("7000.0000");
      expect(await cuantas(m)).toBe(2);
      expect(await salidas(m)).toBe(2);
    }
  });

  it("I2: anular dos veces la misma devolución devuelve yaEstaba y la segunda no escribe ni audita", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "4000")));
    expect(await existencia(m)).toBe("6000.0000");
    const primera = valorDe(
      await c.casos.anularDevolucion(m.e.gerente, {
        devolucionId: r.devolucionId,
        motivo: "Se devolvió por error",
      }),
    );
    expect(primera).toEqual({ yaEstaba: false });
    expect(await existencia(m)).toBe("10000.0000");
    const antes = await c.auditoria(m.e.empresa, "DEVOLUCION_ANULADA");
    const segunda = valorDe(
      await c.casos.anularDevolucion(m.e.gerente, {
        devolucionId: r.devolucionId,
        motivo: "Se devolvió por error",
      }),
    );
    expect(segunda).toEqual({ yaEstaba: true });
    expect(await existencia(m)).toBe("10000.0000");
    expect(await c.auditoria(m.e.empresa, "DEVOLUCION_ANULADA")).toHaveLength(antes.length);
    expect(antes).toHaveLength(1);
    const fila = await c.dueno.query(
      "select estado, anulada_por, motivo_de_anulacion from devolucion_a_proveedor where id = $1",
      [r.devolucionId],
    );
    expect(fila.rows[0]).toEqual({
      estado: "ANULADA",
      anulada_por: m.e.personaDelGerente,
      motivo_de_anulacion: "Se devolvió por error",
    });
  });

  it("I2b: dos anulaciones a la vez dejan un solo espejo en stock y la mercadería vuelve una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "3000")));
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.anularDevolucion(m.e.gerente, { devolucionId: r.devolucionId, motivo: "Error" }),
          c.casos.anularDevolucion(m.e.administrador, {
            devolucionId: r.devolucionId,
            motivo: "Error",
          }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.every((x) => x.ok)).toBe(true);
      expect(rs.filter((x) => x.ok && !x.valor.yaEstaba)).toHaveLength(1);
      expect(await existencia(m)).toBe("10000.0000");
    }
  });

  it("anular devuelve la mercadería con el mismo costo con que salió y la devolución anulada no se vuelve a anular ni a editar", async () => {
    const m = await armar();
    const costo = async () =>
      (
        await c.dueno.query<{ c: string }>(
          "select costo_unitario::text as c from costo_de_articulo where deposito_id = $1 and articulo_id = $2",
          [m.deposito, m.harina.articulo],
        )
      ).rows[0]?.c;
    const antes = await costo();
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "4000")));
    valorDe(
      await c.casos.anularDevolucion(m.e.gerente, {
        devolucionId: r.devolucionId,
        motivo: "Error",
      }),
    );
    expect(await costo()).toBe(antes);
    await expect(
      c.dueno.query("update devolucion_a_proveedor set estado = 'CONFIRMADA' where id = $1", [
        r.devolucionId,
      ]),
    ).rejects.toThrow();
  });

  it("devolver de una recepción: no pasa de lo recibido (todo o nada) y anular la devolución libera lo devuelto", async () => {
    const m = await armar();
    const conOrigen = (gramos: string) =>
      pedido(m, gramos, {
        lineas: [
          {
            productoId: m.harina.producto,
            cantidad: gramos,
            recepcionId: m.recepcionId,
            lineaDeRecepcion: 1,
          },
        ],
      });
    const primera = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, conOrigen("6000")));
    const antes = await existencia(m);
    const demasiado = await c.casos.devolverAlProveedor(m.e.gerente, conOrigen("4001"));
    expect(codigo(demasiado)).toBe("DEVOLUCION_EXCEDE_LO_RECIBIDO");
    expect(await existencia(m)).toBe(antes);
    expect(await cuantas(m)).toBe(1);
    expect(await salidas(m)).toBe(1);
    valorDe(await c.casos.devolverAlProveedor(m.e.gerente, conOrigen("4000")));
    expect(await existencia(m)).toBe("0.0000");
    valorDe(
      await c.casos.anularDevolucion(m.e.gerente, {
        devolucionId: primera.devolucionId,
        motivo: "Error",
      }),
    );
    expect(await existencia(m)).toBe("6000.0000");
    valorDe(await c.casos.devolverAlProveedor(m.e.gerente, conOrigen("6000")));
  });

  it("dos devoluciones a la vez de la misma línea recibida que juntas se pasan: solo entra una", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const conOrigen = (gramos: string) =>
        pedido(m, gramos, {
          lineas: [
            {
              productoId: m.harina.producto,
              cantidad: gramos,
              recepcionId: m.recepcionId,
              lineaDeRecepcion: 1,
            },
          ],
        });
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.devolverAlProveedor(m.e.gerente, conOrigen("6000")),
          c.casos.devolverAlProveedor(m.e.administrador, conOrigen("6000")),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(await existencia(m)).toBe("4000.0000");
      expect(await cuantas(m)).toBe(1);
      expect(await salidas(m)).toBe(1);
    }
  });

  it("atómica: si el control de existencia negativa bloquea la salida, no queda devolución ni línea ni movimiento", async () => {
    const m = await armar();
    await c.dueno.query(
      "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', 'BLOQUEAR')",
      [m.e.empresa],
    );
    const r = await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "10001"));
    expect(r.ok).toBe(false);
    expect(await cuantas(m)).toBe(0);
    expect(await salidas(m)).toBe(0);
    expect(await existencia(m)).toBe("10000.0000");
    expect(
      Number(
        (
          await c.dueno.query<{ n: string }>(
            "select count(*) as n from linea_de_devolucion where empresa_id = $1",
            [m.e.empresa],
          )
        ).rows[0]?.n,
      ),
    ).toBe(0);
    // Lo justo sí sale.
    valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "10000")));
    expect(await existencia(m)).toBe("0.0000");
  });

  it("validación: motivo fuera de la lista, proveedor, depósito, producto y sucursal ajenos, y contenido inválido, sin escribir nada", async () => {
    const m = await armar();
    const otra = await armar();
    const otraSucursal = await c.deposito({ empresa: m.e.empresa, sucursal: m.e.otraSucursal });
    const casos: [Record<string, unknown>, string][] = [
      [{ motivoId: nuevoId() }, "MOTIVO_DE_DEVOLUCION_INVALIDO"],
      [{ motivoId: "x" }, "IDENTIFICADOR_INVALIDO"],
      [{ clave: "x" }, "IDENTIFICADOR_INVALIDO"],
      [{ proveedorId: otra.proveedor }, "PROVEEDOR_NO_ENCONTRADO"],
      [{ depositoId: otra.deposito }, "DEPOSITO_NO_ENCONTRADO"],
      [{ depositoId: otraSucursal }, "DEPOSITO_NO_ENCONTRADO"],
      [{ sucursalId: otra.e.sucursal }, "SUCURSAL_NO_ENCONTRADA"],
      [{ lineas: [{ productoId: otra.harina.producto, cantidad: "1" }] }, "PRODUCTO_NO_ENCONTRADO"],
      [{ lineas: [] }, "RENGLONES_INVALIDOS"],
      [{ lineas: [{ productoId: m.harina.producto, cantidad: "0" }] }, "RENGLONES_INVALIDOS"],
      [{ remito: { numero: "1", fecha: "mañana" } }, "FECHA_INVALIDA"],
      [{ hechoEn: new Date(m.e.gerente.ahora.getTime() + 86_400_000) }, "FECHA_INVALIDA"],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "100", cambio));
      expect(codigo(r), JSON.stringify(cambio)).toBe(esperado);
    }
    expect(await cuantas(m)).toBe(0);
    expect(await salidas(m)).toBe(0);
    expect(await existencia(m)).toBe("10000.0000");
  });

  it("el remito de devolución se guarda como dato, la jornada la pone la base y una fecha pasada pide el control de stock (FECHA_PASADA_NO_ADMITIDA)", async () => {
    const m = await armar();
    const ayer = new Date(m.e.gerente.ahora.getTime() - 86_400_000);
    expect(
      codigo(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "100", { hechoEn: ayer }))),
    ).toBe("FECHA_PASADA_NO_ADMITIDA");
    expect(await cuantas(m)).toBe(0);
    expect(await salidas(m)).toBe(0);
    const r = valorDe(
      await c.casos.devolverAlProveedor(
        m.e.gerente,
        pedido(m, "100", { remito: { numero: " 0001-00000045 ", fecha: "2026-11-10" } }),
      ),
    );
    const f = await c.dueno.query(
      "select remito_de_devolucion_numero as n, remito_de_devolucion_fecha::text as f, fecha_negocio::text as j from devolucion_a_proveedor where id = $1",
      [r.devolucionId],
    );
    expect(f.rows[0]).toMatchObject({ n: "0001-00000045", f: "2026-11-10" });
    expect((f.rows[0] as { j: string }).j).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("la empresa en otro nivel no devuelve (ORDEN_NO_CORRESPONDE_AL_NIVEL) ni sin la perilla en el plan; anular lo hecho sigue", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "100")));
    valorDe(
      await c.casos.configurarCompras(m.e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 2,
      }),
    );
    expect(codigo(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "100")))).toBe(
      "ORDEN_NO_CORRESPONDE_AL_NIVEL",
    );
    expect(
      valorDe(
        await c.casos.anularDevolucion(m.e.gerente, {
          devolucionId: r.devolucionId,
          motivo: "Error",
        }),
      ),
    ).toEqual({ yaEstaba: false });
  });

  it("el operador no devuelve ni anula (SIN_PERMISO) pero sí ve; el administrador devuelve", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.administrador, pedido(m, "100")));
    expect(await c.casos.devolverAlProveedor(m.e.operador, pedido(m, "100"))).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(
      await c.casos.anularDevolucion(m.e.operador, {
        devolucionId: r.devolucionId,
        motivo: "Error",
      }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(await cuantas(m, "ANULADA")).toBe(0);
    expect(await cuantas(m)).toBe(1);
    const lista = valorDe(await c.consultas.listarDevoluciones(m.e.operador));
    expect(lista.filas.map((f) => f.devolucionId)).toEqual([r.devolucionId]);
  });

  it("anular: motivo obligatorio, devolución inexistente o de otra empresa y sucursal fuera de alcance no existen para quien pide", async () => {
    const m = await armar();
    const otra = await armar();
    const r = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "100")));
    expect(
      codigo(
        await c.casos.anularDevolucion(m.e.gerente, { devolucionId: r.devolucionId, motivo: " " }),
      ),
    ).toBe("MOTIVO_REQUERIDO");
    for (const devolucionId of [nuevoId(), "x"]) {
      expect(
        codigo(await c.casos.anularDevolucion(m.e.gerente, { devolucionId, motivo: "Error" })),
      ).toBe("DEVOLUCION_NO_ENCONTRADA");
    }
    expect(
      codigo(
        await c.casos.anularDevolucion(otra.e.gerente, {
          devolucionId: r.devolucionId,
          motivo: "Error",
        }),
      ),
    ).toBe("DEVOLUCION_NO_ENCONTRADA");
    expect(await existencia(m)).toBe("9900.0000");
    expect(await cuantas(m, "ANULADA")).toBe(0);
  });

  it("la lista y el detalle: con su estado, motivo y líneas, paginados, filtrados y aislados por empresa", async () => {
    const m = await armar();
    const otra = await armar();
    const a = valorDe(
      await c.casos.devolverAlProveedor(
        m.e.gerente,
        pedido(m, "100", { remito: { numero: "R-1", fecha: "2026-11-10" } }),
      ),
    );
    const b = valorDe(await c.casos.devolverAlProveedor(m.e.gerente, pedido(m, "200")));
    valorDe(
      await c.casos.anularDevolucion(m.e.gerente, {
        devolucionId: a.devolucionId,
        motivo: "Error",
      }),
    );
    valorDe(await c.casos.devolverAlProveedor(otra.e.gerente, pedido(otra, "50")));
    const todas = valorDe(await c.consultas.listarDevoluciones(m.e.gerente));
    expect(todas.filas.map((f) => [f.devolucionId, f.estado, f.numero])).toEqual([
      [b.devolucionId, "CONFIRMADA", 2],
      [a.devolucionId, "ANULADA", 1],
    ]);
    expect(todas.siguiente).toBeNull();
    expect(
      valorDe(await c.consultas.listarDevoluciones(m.e.gerente, { estado: "ANULADA" })).filas,
    ).toHaveLength(1);
    expect(
      valorDe(await c.consultas.listarDevoluciones(m.e.gerente, { proveedorId: otra.proveedor }))
        .filas,
    ).toEqual([]);
    expect(
      await c.consultas.listarDevoluciones(m.e.gerente, { despuesDe: "no-es-un-cursor" }),
    ).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    expect(await c.consultas.listarDevoluciones(m.e.gerente, { estado: "X" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    const detalle = valorDe(
      await c.consultas.obtenerDevolucion(m.e.operador, { devolucionId: a.devolucionId }),
    );
    expect(detalle).toMatchObject({
      numero: 1,
      estado: "ANULADA",
      remitoNumero: "R-1",
      remitoFecha: "2026-11-10",
      motivoDeAnulacion: "Error",
    });
    expect(detalle?.lineas).toEqual([
      expect.objectContaining({ numero: 1, cantidad: "100.0000", depositoId: m.deposito }),
    ]);
    expect(typeof detalle?.motivo).toBe("string");
    // Otra empresa: no existe.
    expect(
      valorDe(
        await c.consultas.obtenerDevolucion(otra.e.gerente, { devolucionId: a.devolucionId }),
      ),
    ).toBeNull();
    expect(await c.consultas.obtenerDevolucion(m.e.gerente, { devolucionId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });
});
