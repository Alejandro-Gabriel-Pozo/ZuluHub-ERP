import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras N4 (tramo N4-3): tolerancias y diferencias de la conciliación de tres vías. Conciliar en N4 calcula en la misma transacción lo facturado de más y el precio contra la
 * referencia (la orden, o la recepción si no hay orden); sin tolerancias toda diferencia queda abierta, dentro de la tolerancia queda resuelta con rastro; resolverla, anularla con la
 * conciliación, las tolerancias (idempotentes, con versión, solo el gerente) y la tolerancia de recepción contra la orden.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N4: tolerancias y diferencias", () => {
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

  /** Una empresa en N4 con un proveedor, harina en gramos y una orden PEDIDA de 10000 g a $ 1,20 el gramo. */
  const armar = async (precioDeLaOrden: string | null = "1.2") => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const deposito = await c.deposito(e);
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const ordenId = valorDe(
      await c.casos.crearOrden(e.gerente, {
        clave: nuevoId(),
        proveedorId: proveedor,
        sucursalId: e.sucursal,
        lineas: [{ productoId: harina, cantidad: "10000", precio: precioDeLaOrden }],
      }),
    ).ordenId;
    valorDe(await c.casos.pedirOrden(e.gerente, { ordenId }));
    return { e, harina, proveedor, deposito, ordenId, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** Recibe `kilos` (a $ 1000 el kilo = $ 1 el gramo) y los confirma; contra la orden o sin ella. */
  const recibir = async (m: M, kilos: string, contraOrden = true) => {
    const r = valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
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
        ...(contraOrden
          ? { contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 1 }] }
          : {}),
      }),
    );
    valorDe(
      await c.casos.confirmarRecepcion(m.e.gerente, {
        recepcionId: r.recepcionId,
        depositoId: m.deposito,
      }),
    );
    return r.recepcionId;
  };
  const facturar = async (m: M, gramos: number, precioNeto: string) =>
    valorDe(
      await c.casos.registrarFactura(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [
            { productoId: m.harina, cantidadFacturada: String(gramos), precioNeto, alicuota: "21" },
          ],
          totalSegunFactura: (gramos * Number(precioNeto) * 1.21).toFixed(2),
          cuitDelProveedor: m.cuit,
        },
      }),
    ).comprobanteId;
  const conciliar = (
    m: M,
    comprobanteId: string,
    recepcionId: string,
    gramos: string,
    clave = nuevoId(),
  ) =>
    c.casos.conciliarFactura(m.e.gerente, {
      clave,
      comprobanteId,
      asignaciones: [{ lineaDeFactura: 1, recepcionId, lineaDeRecepcion: 1, cantidad: gramos }],
    });
  const diferencias = (m: M) =>
    c.filas<Record<string, string | null>>(
      `select tipo, estado, resolucion, motivo, dentro_de_tolerancia::text as dentro, cantidad_de_diferencia::text as cantidad, importe_de_diferencia::text as importe,
              precio_facturado::text as facturado, precio_de_referencia::text as referencia, origen_del_precio_de_referencia as origen, id, resuelta_por
         from diferencia_de_compra where empresa_id = $1 order by tipo, registrado_en`,
      [m.e.empresa],
    );
  const tolerancias = (m: M, extra: Record<string, unknown>, versionEsperada = 0) =>
    c.casos.configurarTolerancias(m.e.gerente, { versionEsperada, ...extra });

  it("el ejemplo del dueño: orden de 10 kg a 1,20, llegan 9,6 kg, factura de 10 kg a 1,25: cantidad de más 0,4 kg ($ 500) y precio +0,05 sobre 9,6 kg ($ 480), abiertas; se copian las tolerancias (vacías)", async () => {
    const m = await armar();
    const recepcion = await recibir(m, "9.6");
    const factura = await facturar(m, 10000, "1.25");
    const conciliacionId = valorDe(await conciliar(m, factura, recepcion, "9600")).conciliacionId;
    const filas = await diferencias(m);
    expect(filas.map((f) => ({ ...f, id: undefined, resuelta_por: undefined }))).toEqual([
      {
        tipo: "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
        estado: "ABIERTA",
        resolucion: null,
        motivo: null,
        dentro: "false",
        cantidad: "400.0000",
        importe: "500.00",
        facturado: null,
        referencia: null,
        origen: null,
        id: undefined,
        resuelta_por: undefined,
      },
      {
        tipo: "PRECIO_DISTINTO",
        estado: "ABIERTA",
        resolucion: null,
        motivo: null,
        dentro: "false",
        cantidad: "9600.0000",
        importe: "480.00",
        facturado: "1.250000",
        referencia: "1.200000",
        origen: "ORDEN",
        id: undefined,
        resuelta_por: undefined,
      },
    ]);
    const aplicada = await c.filas<Record<string, string | null>>(
      "select tolerancia_de_cantidad as c, tolerancia_de_precio as p, tolerancia_de_importe as i from tolerancia_aplicada_de_conciliacion where conciliacion_id = $1",
      [conciliacionId],
    );
    expect(aplicada).toEqual([{ c: null, p: null, i: null }]);
    expect(
      (await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).at(-1)?.despues,
    ).toMatchObject({
      diferencias: 2,
      diferenciasAbiertas: 2,
    });
  });

  it("sin orden, el precio de referencia es el de la recepción; una orden sin precio no inventa referencia; lo que coincide no genera diferencia", async () => {
    const m = await armar();
    const sinOrden = await recibir(m, "10", false);
    const f1 = await facturar(m, 10000, "1.1");
    valorDe(await conciliar(m, f1, sinOrden, "10000"));
    expect(await diferencias(m)).toMatchObject([
      {
        tipo: "PRECIO_DISTINTO",
        referencia: "1.000000",
        origen: "RECEPCION",
        importe: "1000.00",
        estado: "ABIERTA",
      },
    ]);
    const sinPrecio = await armar(null);
    const conOrden = await recibir(sinPrecio, "10");
    const f2 = await facturar(sinPrecio, 10000, "9");
    valorDe(await conciliar(sinPrecio, f2, conOrden, "10000"));
    expect(await diferencias(sinPrecio)).toEqual([]);
    const igual = await armar("1");
    const r = await recibir(igual, "10");
    valorDe(await conciliar(igual, await facturar(igual, 10000, "1"), r, "10000"));
    expect(await diferencias(igual)).toEqual([]);
  });

  it("con tolerancias, lo que queda dentro se resuelve en el acto como DENTRO_DE_TOLERANCIA con quién y cuándo, y se copian los umbrales aplicados", async () => {
    const m = await armar();
    valorDe(await tolerancias(m, { cantidad: "10", precio: "5" }));
    const recepcion = await recibir(m, "9.6");
    const factura = await facturar(m, 10000, "1.25");
    const conciliacionId = valorDe(await conciliar(m, factura, recepcion, "9600")).conciliacionId;
    const filas = await diferencias(m);
    expect(filas.map((f) => [f.tipo, f.estado, f.resolucion, f.dentro, f.motivo])).toEqual([
      ["FACTURADO_DISTINTO_DE_LO_RECIBIDO", "RESUELTA", "DENTRO_DE_TOLERANCIA", "true", null],
      ["PRECIO_DISTINTO", "RESUELTA", "DENTRO_DE_TOLERANCIA", "true", null],
    ]);
    expect(filas.every((f) => f.resuelta_por === m.e.personaDelGerente)).toBe(true);
    const aplicada = await c.filas<Record<string, string | null>>(
      "select tolerancia_de_cantidad::text as c, tolerancia_de_precio::text as p, tolerancia_de_importe as i from tolerancia_aplicada_de_conciliacion where conciliacion_id = $1",
      [conciliacionId],
    );
    expect(aplicada).toEqual([{ c: "10.0000", p: "5.0000", i: null }]);
    expect(
      (await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).at(-1)?.despues,
    ).toMatchObject({
      diferencias: 2,
      diferenciasAbiertas: 0,
    });
    // una tolerancia más ajustada deja abiertas las que no entran
    const otra = await armar();
    valorDe(await tolerancias(otra, { cantidad: "4", precio: "5", importe: "400" }));
    const r = await recibir(otra, "9.6");
    valorDe(await conciliar(otra, await facturar(otra, 10000, "1.25"), r, "9600"));
    const mixtas = await diferencias(otra);
    expect(mixtas.map((f) => [f.tipo, f.estado])).toEqual([
      ["FACTURADO_DISTINTO_DE_LO_RECIBIDO", "ABIERTA"],
      ["PRECIO_DISTINTO", "ABIERTA"],
    ]);
  });

  it("reintentar la conciliación (misma clave) no duplica diferencias ni auditoría; la tolerancia cambiada después no toca lo ya conciliado", async () => {
    const m = await armar();
    const recepcion = await recibir(m, "9.6");
    const factura = await facturar(m, 10000, "1.25");
    const clave = nuevoId();
    valorDe(await conciliar(m, factura, recepcion, "9600", clave));
    const auditadas = (await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).length;
    expect(valorDe(await conciliar(m, factura, recepcion, "9600", clave)).yaExistia).toBe(true);
    expect(await diferencias(m)).toHaveLength(2);
    expect((await c.auditoria(m.e.empresa, "CONCILIACION_REGISTRADA")).length).toBe(auditadas);
    valorDe(await tolerancias(m, { cantidad: "100", precio: "100" }));
    expect((await diferencias(m)).every((f) => f.estado === "ABIERTA")).toBe(true);
  });

  it("I8: resolver dos veces la misma diferencia con lo mismo devuelve yaEstaba y la segunda no escribe ni audita", async () => {
    const m = await armar();
    const recepcion = await recibir(m, "9.6");
    valorDe(await conciliar(m, await facturar(m, 10000, "1.25"), recepcion, "9600"));
    const [cantidad] = await diferencias(m);
    const id = cantidad?.id as string;
    expect(
      valorDe(
        await c.casos.resolverDiferencia(m.e.gerente, {
          diferenciaId: id,
          resolucion: "NOTA_DE_CREDITO",
          motivo: "Se pide la nota por 0,4 kg",
        }),
      ).yaEstaba,
    ).toBe(false);
    const auditadas = (await c.auditoria(m.e.empresa, "DIFERENCIA_DE_COMPRA_RESUELTA")).length;
    expect(
      valorDe(
        await c.casos.resolverDiferencia(m.e.administrador, {
          diferenciaId: id,
          resolucion: "NOTA_DE_CREDITO",
          motivo: "Se pide la nota por 0,4 kg",
        }),
      ).yaEstaba,
    ).toBe(true);
    expect((await c.auditoria(m.e.empresa, "DIFERENCIA_DE_COMPRA_RESUELTA")).length).toBe(
      auditadas,
    );
    for (const otra of [
      { resolucion: "ACEPTADA", motivo: "Se pide la nota por 0,4 kg" },
      { resolucion: "NOTA_DE_CREDITO", motivo: "Otro motivo" },
    ]) {
      expect(await c.casos.resolverDiferencia(m.e.gerente, { diferenciaId: id, ...otra })).toEqual({
        ok: false,
        error: "DIFERENCIA_YA_RESUELTA",
      });
    }
    const [fila] = await c.filas<Record<string, string | null>>(
      "select estado, resolucion, motivo, resuelta_por, (resuelta_en is not null)::text as con_momento from diferencia_de_compra where id = $1",
      [id],
    );
    expect(fila).toEqual({
      estado: "RESUELTA",
      resolucion: "NOTA_DE_CREDITO",
      motivo: "Se pide la nota por 0,4 kg",
      resuelta_por: m.e.personaDelGerente,
      con_momento: "true",
    });
    expect((await c.auditoria(m.e.empresa, "DIFERENCIA_DE_COMPRA_RESUELTA")).at(-1)).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad_id: id,
      despues: {
        estado: "RESUELTA",
        tipo: "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
        resolucion: "NOTA_DE_CREDITO",
      },
    });
  });

  it("resolver: las seis resoluciones manuales sirven, DENTRO_DE_TOLERANCIA no se elige, el motivo es obligatorio, solo gerente y administrador y de otra empresa no existe", async () => {
    const m = await armar();
    const otra = await armar();
    const recepcion = await recibir(m, "9.6");
    valorDe(await conciliar(m, await facturar(m, 10000, "1.25"), recepcion, "9600"));
    const [a, b] = await diferencias(m);
    const id = a?.id as string;
    for (const malo of [
      { resolucion: "DENTRO_DE_TOLERANCIA", motivo: "x" },
      { resolucion: "OTRA", motivo: "x" },
    ]) {
      expect(await c.casos.resolverDiferencia(m.e.gerente, { diferenciaId: id, ...malo })).toEqual({
        ok: false,
        error: "RESOLUCION_INVALIDA",
      });
    }
    expect(
      await c.casos.resolverDiferencia(m.e.gerente, {
        diferenciaId: id,
        resolucion: "ACEPTADA",
        motivo: "  ",
      }),
    ).toEqual({
      ok: false,
      error: "MOTIVO_REQUERIDO",
    });
    expect(
      await c.casos.resolverDiferencia(m.e.operador, {
        diferenciaId: id,
        resolucion: "ACEPTADA",
        motivo: "x",
      }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(
      await c.casos.resolverDiferencia(otra.e.gerente, {
        diferenciaId: id,
        resolucion: "ACEPTADA",
        motivo: "x",
      }),
    ).toEqual({
      ok: false,
      error: "DIFERENCIA_NO_ENCONTRADA",
    });
    expect(
      await c.casos.resolverDiferencia(m.e.gerente, {
        diferenciaId: "x",
        resolucion: "ACEPTADA",
        motivo: "x",
      }),
    ).toEqual({
      ok: false,
      error: "DIFERENCIA_NO_ENCONTRADA",
    });
    expect((await diferencias(m)).every((f) => f.estado === "ABIERTA")).toBe(true);
    for (const resolucion of ["ACEPTADA", "NOTA_DE_DEBITO"]) {
      valorDe(
        await c.casos.resolverDiferencia(m.e.gerente, {
          diferenciaId: (resolucion === "ACEPTADA" ? id : b?.id) as string,
          resolucion,
          motivo: "Lo hablamos",
        }),
      );
    }
    expect((await diferencias(m)).map((f) => f.resolucion).sort()).toEqual([
      "ACEPTADA",
      "NOTA_DE_DEBITO",
    ]);
  });

  it("dos resoluciones distintas a la vez de la misma diferencia: gana una y la otra es DIFERENCIA_YA_RESUELTA; con la misma, las dos ven el mismo resultado", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const recepcion = await recibir(m, "9.6");
      valorDe(await conciliar(m, await facturar(m, 10000, "1.25"), recepcion, "9600"));
      const id = (await diferencias(m))[0]?.id as string;
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.resolverDiferencia(m.e.gerente, {
            diferenciaId: id,
            resolucion: "ACEPTADA",
            motivo: "A",
          }),
          c.casos.resolverDiferencia(m.e.administrador, {
            diferenciaId: id,
            resolucion: "DEVOLUCION",
            motivo: "B",
          }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = rs.find((r) => !r.ok);
      expect(perdedora && codigo(perdedora)).toBe("DIFERENCIA_YA_RESUELTA");
      expect((await c.auditoria(m.e.empresa, "DIFERENCIA_DE_COMPRA_RESUELTA")).length).toBe(1);
    }
  });

  it("anular la conciliación anula sus diferencias (las ya resueltas conservan su resolución) y una anulada no se resuelve", async () => {
    const m = await armar();
    const recepcion = await recibir(m, "9.6");
    const conciliacionId = valorDe(
      await conciliar(m, await facturar(m, 10000, "1.25"), recepcion, "9600"),
    ).conciliacionId;
    const [cantidad, precio] = await diferencias(m);
    valorDe(
      await c.casos.resolverDiferencia(m.e.gerente, {
        diferenciaId: precio?.id as string,
        resolucion: "ACEPTADA",
        motivo: "Precio de la lista nueva",
      }),
    );
    valorDe(await c.casos.anularConciliacion(m.e.gerente, { conciliacionId }));
    const filas = await diferencias(m);
    expect(filas.map((f) => [f.tipo, f.estado, f.resolucion])).toEqual([
      ["FACTURADO_DISTINTO_DE_LO_RECIBIDO", "ANULADA", null],
      ["PRECIO_DISTINTO", "ANULADA", "ACEPTADA"],
    ]);
    expect((await c.auditoria(m.e.empresa, "CONCILIACION_ANULADA")).at(-1)?.despues).toMatchObject({
      diferenciasAnuladas: 2,
    });
    expect(
      await c.casos.resolverDiferencia(m.e.gerente, {
        diferenciaId: cantidad?.id as string,
        resolucion: "ACEPTADA",
        motivo: "x",
      }),
    ).toEqual({
      ok: false,
      error: "DIFERENCIA_ANULADA",
    });
    // conciliar de nuevo registra otras diferencias (nada se reabre)
    valorDe(
      await conciliar(
        m,
        (
          await c.filas<{ id: string }>(
            "select id from comprobante_de_proveedor where empresa_id = $1",
            [m.e.empresa],
          )
        )[0]?.id as string,
        recepcion,
        "9600",
      ),
    );
    expect((await diferencias(m)).filter((f) => f.estado === "ABIERTA")).toHaveLength(2);
  });

  it("la base impone lo suyo: la diferencia solo entra con su conciliación, solo cambia su resolución, nada se reabre y una resolución sin motivo o «dentro de tolerancia» sin estarlo no entra", async () => {
    const m = await armar();
    const recepcion = await recibir(m, "9.6");
    valorDe(await conciliar(m, await facturar(m, 10000, "1.25"), recepcion, "9600"));
    const [cantidad, precio] = await diferencias(m);
    const intento = async (texto: string, parametros: unknown[]) => {
      await c.dueno.query("begin");
      try {
        await c.dueno.query("savepoint x");
        try {
          await c.dueno.query(texto, parametros);
          return "acepto";
        } catch (error) {
          return (error as { constraint?: string }).constraint ?? "otro";
        }
      } finally {
        await c.dueno.query("rollback");
      }
    };
    expect(
      await intento("update diferencia_de_compra set importe_de_diferencia = 1 where id = $1", [
        cantidad?.id,
      ]),
    ).toBe("diferencia_inmutable");
    expect(
      await intento(
        "update diferencia_de_compra set resolucion = 'ACEPTADA', motivo = 'x' where id = $1",
        [cantidad?.id],
      ),
    ).toBe("diferencia_inmutable");
    expect(
      await intento(
        "update diferencia_de_compra set estado = 'RESUELTA', resolucion = 'ACEPTADA' where id = $1",
        [cantidad?.id],
      ),
    ).toBe("diferencia_resolucion_estado_ck");
    expect(
      await intento(
        "update diferencia_de_compra set estado = 'RESUELTA', resolucion = 'DENTRO_DE_TOLERANCIA' where id = $1",
        [cantidad?.id],
      ),
    ).toBe("diferencia_tolerancia_ck");
    expect(
      await intento(
        "update diferencia_de_compra set estado = 'RESUELTA', resolucion = 'ACEPTADA', motivo = 'x' where id = $1",
        [cantidad?.id],
      ),
    ).toBe("acepto");
    valorDe(
      await c.casos.resolverDiferencia(m.e.gerente, {
        diferenciaId: precio?.id as string,
        resolucion: "ACEPTADA",
        motivo: "x",
      }),
    );
    expect(
      await intento(
        "update diferencia_de_compra set estado = 'ABIERTA', resolucion = null, motivo = null, resuelta_por = null where id = $1",
        [precio?.id],
      ),
    ).toBe("diferencia_transicion_invalida");
    expect(
      await intento(
        `insert into diferencia_de_compra (empresa_id, conciliacion_id, tipo, comprobante_id, dentro_de_tolerancia)
         select empresa_id, conciliacion_id, 'PRECIO_DISTINTO', comprobante_id, false from diferencia_de_compra where id = $1`,
        [cantidad?.id],
      ),
    ).toBe("diferencia_de_compra_conciliacion_confirmada");
    expect(await intento("delete from diferencia_de_compra where id = $1", [cantidad?.id])).toBe(
      "otro",
    );
  });

  it("I7: fijar dos veces las mismas tolerancias deja una sola escritura: la segunda devuelve sinCambios sin escribir ni auditar", async () => {
    const m = await armar();
    const primera = valorDe(await tolerancias(m, { cantidad: "2.5", importe: "100" }));
    expect(primera).toEqual({
      version: 1,
      tolerancias: { cantidad: "2.5000", precio: null, importe: "100.00", recepcion: null },
      sinCambios: false,
    });
    const auditadas = (await c.auditoria(m.e.empresa, "TOLERANCIAS_DE_COMPRAS_CAMBIADAS")).length;
    expect(valorDe(await tolerancias(m, { cantidad: "2.5", importe: "100.00" }, 1))).toMatchObject({
      version: 1,
      sinCambios: true,
    });
    expect((await c.auditoria(m.e.empresa, "TOLERANCIAS_DE_COMPRAS_CAMBIADAS")).length).toBe(
      auditadas,
    );
    const vigentes = valorDe(await c.consultas.obtenerTolerancias(m.e.administrador));
    expect(vigentes).toEqual({ version: 1, tolerancias: primera.tolerancias });
    // cambiar sube la versión y una versión vieja con otros valores se rechaza; «no definida» vuelve a null
    expect(valorDe(await tolerancias(m, { precio: "1" }, 1))).toMatchObject({
      version: 2,
      tolerancias: { cantidad: null, precio: "1.0000", importe: null },
    });
    expect(await tolerancias(m, { precio: "9" }, 1)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(await tolerancias(m, { precio: "9" }, 0)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    expect(
      (await c.auditoria(m.e.empresa, "TOLERANCIAS_DE_COMPRAS_CAMBIADAS")).at(-1),
    ).toMatchObject({
      antes: { cantidad: "2.5000", importe: "100.00" },
      despues: { precio: "1.0000" },
    });
  });

  it("tolerancias: valores inválidos, solo el gerente, empresa en N4 con la perilla, y dos cambios a la vez desde la misma versión dejan uno", async () => {
    const m = await armar();
    for (const malo of [
      { cantidad: "101" },
      { precio: "-1" },
      { importe: "x" },
      { recepcion: 5 as unknown as string },
    ]) {
      expect(await tolerancias(m, malo)).toEqual({ ok: false, error: "TOLERANCIA_INVALIDA" });
    }
    expect(
      await c.casos.configurarTolerancias(m.e.administrador, { versionEsperada: 0, cantidad: "1" }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(
      await c.casos.configurarTolerancias(m.e.operador, { versionEsperada: 0, cantidad: "1" }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(await tolerancias(m, { cantidad: "1" }, -1)).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    c.apagarPerillas();
    try {
      expect(await tolerancias(m, { cantidad: "1" })).toEqual({
        ok: false,
        error: { error: "FUNCION_NO_INCLUIDA", perilla: "conciliacion_de_tres_vias" },
      });
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
    expect(
      await c.casos.configurarTolerancias(n3.gerente, { versionEsperada: 0, cantidad: "1" }),
    ).toEqual({
      ok: false,
      error: "ORDEN_NO_CORRESPONDE_AL_NIVEL",
    });
    expect(valorDe(await c.consultas.obtenerTolerancias(m.e.gerente))).toEqual({
      version: 0,
      tolerancias: { cantidad: null, precio: null, importe: null, recepcion: null },
    });
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await armar();
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          tolerancias(x, { cantidad: "1" }),
          tolerancias(x, { cantidad: "2" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      const perdedora = rs.find((r) => !r.ok);
      expect(perdedora && codigo(perdedora)).toBe("VERSION_DESACTUALIZADA");
      expect(valorDe(await c.consultas.obtenerTolerancias(x.e.gerente)).version).toBe(1);
    }
  });

  it("la tolerancia de recepción deja recibir hasta ese porcentaje sobre lo pedido con BLOQUEAR (al registrar y al confirmar) y ni un gramo más", async () => {
    const m = await armar();
    await c.dueno.query(
      "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'compras.recepcion_excede_la_orden', 'BLOQUEAR')",
      [m.e.empresa],
    );
    valorDe(await tolerancias(m, { recepcion: "5" }));
    await recibir(m, "10.5");
    const saldo = async () =>
      (
        await c.filas<{ r: string }>(
          "select cantidad_recibida::text as r from saldo_de_linea_de_orden where orden_id = $1",
          [m.ordenId],
        )
      )[0]?.r;
    expect(await saldo()).toBe("10500.0000");
    const excede = await c.casos.registrarRecepcion(m.e.operador, {
      clave: nuevoId(),
      sucursalId: m.e.sucursal,
      proveedorId: m.proveedor,
      renglones: [
        {
          productoId: m.harina,
          unidadDeCompraId: "GRAMO",
          cantidad: "1",
          precioPor: "UNIDAD",
          unidadDePrecioId: "GRAMO",
          precio: "1",
        },
      ],
      contraOrden: [{ linea: 1, ordenId: m.ordenId, lineaDeOrden: 1 }],
    });
    expect(codigo(excede)).toBe("RECEPCION_EXCEDE_LA_ORDEN");
    expect(await saldo()).toBe("10500.0000");
    // sin la tolerancia (otra empresa), 10,5 kg ya no entra
    const sin = await armar();
    await c.dueno.query(
      "insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'compras.recepcion_excede_la_orden', 'BLOQUEAR')",
      [sin.e.empresa],
    );
    const r = await c.casos.registrarRecepcion(sin.e.operador, {
      clave: nuevoId(),
      sucursalId: sin.e.sucursal,
      proveedorId: sin.proveedor,
      renglones: [
        {
          productoId: sin.harina,
          unidadDeCompraId: "KILOGRAMO",
          cantidad: "10.5",
          precioPor: "UNIDAD",
          unidadDePrecioId: "KILOGRAMO",
          precio: "1000",
        },
      ],
      contraOrden: [{ linea: 1, ordenId: sin.ordenId, lineaDeOrden: 1 }],
    });
    expect(codigo(r)).toBe("RECEPCION_EXCEDE_LA_ORDEN");
  });

  it("la lista de diferencias filtra por estado, tipo y factura, se pagina, es de gerente y administrador y no mezcla empresas", async () => {
    const m = await armar();
    const otra = await armar();
    const recepcion = await recibir(m, "9.6");
    const factura = await facturar(m, 10000, "1.25");
    valorDe(await conciliar(m, factura, recepcion, "9600"));
    const r2 = await recibir(otra, "9.6");
    valorDe(await conciliar(otra, await facturar(otra, 10000, "1.25"), r2, "9600"));
    const todas = valorDe(await c.consultas.listarDiferencias(m.e.gerente, {}));
    expect(todas.filas).toHaveLength(2);
    expect(todas.siguiente).toBeNull();
    expect(todas.filas.map((f) => f.tipo).sort()).toEqual([
      "FACTURADO_DISTINTO_DE_LO_RECIBIDO",
      "PRECIO_DISTINTO",
    ]);
    expect(todas.filas.every((f) => f.comprobanteId === factura)).toBe(true);
    const soloPrecio = valorDe(
      await c.consultas.listarDiferencias(m.e.administrador, {
        tipo: "PRECIO_DISTINTO",
        estado: "ABIERTA",
        comprobanteId: factura,
      }),
    );
    expect(soloPrecio.filas).toHaveLength(1);
    expect(soloPrecio.filas[0]).toMatchObject({
      importeDeDiferencia: "480.00",
      precioDeReferencia: "1.200000",
      origenDelPrecioDeReferencia: "ORDEN",
    });
    expect(
      valorDe(await c.consultas.listarDiferencias(m.e.gerente, { estado: "RESUELTA" })).filas,
    ).toEqual([]);
    expect(await c.consultas.listarDiferencias(m.e.operador, {})).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(await c.consultas.listarDiferencias(m.e.gerente, { estado: "X" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarDiferencias(m.e.gerente, { tipo: "X" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarDiferencias(m.e.gerente, { comprobanteId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.consultas.listarDiferencias(m.e.gerente, { despuesDe: "nada" })).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
  });

  it("en N3 la conciliación no calcula diferencias ni copia tolerancias", async () => {
    const e = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const deposito = await c.deposito(e);
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const r = valorDe(
      await c.casos.registrarRecepcion(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        renglones: [
          {
            productoId: harina,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "9.6",
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
    const factura = valorDe(
      await c.casos.registrarFactura(e.operador, {
        clave: nuevoId(),
        proveedorId: proveedor,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [
            { productoId: harina, cantidadFacturada: "10000", precioNeto: "1.25", alicuota: "21" },
          ],
          totalSegunFactura: "15125.00",
          cuitDelProveedor: cuitUnico(),
        },
      }),
    ).comprobanteId;
    valorDe(
      await c.casos.conciliarFactura(e.gerente, {
        clave: nuevoId(),
        comprobanteId: factura,
        asignaciones: [
          { lineaDeFactura: 1, recepcionId: r.recepcionId, lineaDeRecepcion: 1, cantidad: "9600" },
        ],
      }),
    );
    expect(
      await c.contar("select count(*) as n from diferencia_de_compra where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(0);
    expect(
      await c.contar(
        "select count(*) as n from tolerancia_aplicada_de_conciliacion where empresa_id = $1",
        [e.empresa],
      ),
    ).toBe(0);
  });
});
