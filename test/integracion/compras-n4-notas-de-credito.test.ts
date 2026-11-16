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
 * Compras N4 (tramo N4-4): la nota de crédito del proveedor como comprobante SIN saldo. Corrige UNA factura del mismo proveedor, sin pasarse del total; repetirla o cargarla a la vez no duplica; anularla libera
 * el tope; una factura con notas vigentes no se anula; la nota no se paga, no se concilia, no aparece como factura ni toca stock; todo filtra por empresa y pide gerente o administrador.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N4: notas de crédito del proveedor", () => {
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

  /** Una empresa en N4 con un proveedor (punto de venta 5 declarado) y una factura de 1000 neto + IVA 21 % = 1210. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const cuit = cuitUnico();
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
            { productoId: harina, cantidadFacturada: "1000", precioNeto: "1", alicuota: "21" },
          ],
          totalSegunFactura: "1210.00",
          cuitDelProveedor: cuit,
        },
      }),
    ).comprobanteId;
    return { e, harina, proveedor, factura };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** La nota como dice el papel: por defecto 500 neto al 21 % = 605. */
  const papel = (extra: Record<string, unknown> = {}) => ({
    tipo: "NOTA_CREDITO_A",
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-11-10",
    importes: [{ alicuota: "21", neto: "500" }],
    totalSegunNota: "605.00",
    ...extra,
  });
  /** Una nota «sin IVA» de un total exacto (alícuota 0): para las cuentas del tope. */
  const porTotal = (total: string) =>
    papel({ importes: [{ alicuota: "0", neto: total }], totalSegunNota: total });
  const pedido = (
    m: M,
    nota: Record<string, unknown> = papel(),
    extra: Record<string, unknown> = {},
  ) => ({
    clave: nuevoId(),
    proveedorId: m.proveedor,
    facturaId: m.factura,
    nota,
    ...extra,
  });
  const cargar = (m: M, nota?: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    c.casos.registrarNotaDeCredito(m.e.gerente, pedido(m, nota, extra));
  const cuantas = async (m: M, estado?: string) =>
    Number(
      (
        await c.dueno.query<{ n: string }>(
          "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'NOTA_DE_CREDITO' and ($2::text is null or estado = $2)",
          [m.e.empresa, estado ?? null],
        )
      ).rows[0]?.n,
    );
  it("cargar una nota de crédito: queda ligada a su factura con sus importes por alícuota, y no toca nada más (no se paga, no se concilia, no es una factura, no mueve stock)", async () => {
    const m = await armar();
    const antes = await c.contar(
      "select count(*) as n from movimiento_de_stock where empresa_id = $1",
      [m.e.empresa],
    );
    const r = valorDe(await cargar(m));
    expect(r.yaExistia).toBe(false);
    const fila = await c.dueno.query(
      `select clase, tipo, comprobante_asociado_id, neto_gravado::text as neto, iva::text as iva, total_segun_factura::text as total,
              credito_fiscal_computable::text as credito, nivel, es_atajo, estado, proveedor_cuit is not null as con_cuit
         from comprobante_de_proveedor where id = $1`,
      [r.comprobanteId],
    );
    expect(fila.rows[0]).toEqual({
      clase: "NOTA_DE_CREDITO",
      tipo: "NOTA_CREDITO_A",
      comprobante_asociado_id: m.factura,
      neto: "500.00",
      iva: "105.00",
      total: "605.00",
      credito: "0.00",
      nivel: "TRES_VIAS",
      es_atajo: false,
      estado: "REGISTRADO",
      con_cuit: true,
    });
    const importes = await c.dueno.query(
      "select alicuota, neto::text as neto, iva::text as iva from importe_por_alicuota where comprobante_id = $1",
      [r.comprobanteId],
    );
    expect(importes.rows).toEqual([{ alicuota: "21", neto: "500.00", iva: "105.00" }]);
    expect(
      await c.contar("select count(*) as n from linea_de_comprobante where comprobante_id = $1", [
        r.comprobanteId,
      ]),
    ).toBe(0);
    expect(
      await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(antes);
    const auditada = (await c.auditoria(m.e.empresa, "NOTA_DE_CREDITO_REGISTRADA")).at(0);
    expect(auditada).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad_id: r.comprobanteId,
      despues: { facturaId: m.factura, totalSegunNota: "605.00", importes: 1 },
    });
    // La nota no se paga, no se concilia, no se anula como factura y no sale entre las facturas.
    expect(
      codigo(
        await c.casos.declararPago(m.e.gerente, {
          clave: nuevoId(),
          comprobanteId: r.comprobanteId,
          fechaDePago: "2026-10-11",
          medio: "TRANSFERENCIA",
        }),
      ),
    ).toBe("COMPROBANTE_NO_PAGABLE");
    expect(
      codigo(
        await c.casos.conciliarFactura(m.e.gerente, {
          clave: nuevoId(),
          comprobanteId: r.comprobanteId,
          asignaciones: [
            { lineaDeFactura: 1, recepcionId: nuevoId(), lineaDeRecepcion: 1, cantidad: "1" },
          ],
        }),
      ),
    ).toBe("COMPROBANTE_NO_ENCONTRADO");
    expect(
      codigo(
        await c.casos.anularFactura(m.e.gerente, {
          comprobanteId: r.comprobanteId,
          motivo: "Error",
        }),
      ),
    ).toBe("COMPROBANTE_NO_ENCONTRADO");
    const facturas = valorDe(
      await c.consultas.listarFacturasSeparadas(m.e.gerente, { proveedorId: m.proveedor }),
    );
    expect(facturas.filas.map((f) => f.comprobanteId)).toEqual([m.factura]);
  });

  it("I1: la misma nota dos veces (misma clave) deja una sola nota y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m);
    const primera = valorDe(await c.casos.registrarNotaDeCredito(m.e.gerente, p));
    const segunda = valorDe(await c.casos.registrarNotaDeCredito(m.e.gerente, p));
    expect(segunda).toEqual({ comprobanteId: primera.comprobanteId, yaExistia: true });
    expect(await cuantas(m)).toBe(1);
    expect(await c.auditoria(m.e.empresa, "NOTA_DE_CREDITO_REGISTRADA")).toHaveLength(1);
    const otra = await c.casos.registrarNotaDeCredito(m.e.gerente, {
      ...p,
      nota: porTotal("10"),
    });
    expect(codigo(otra)).toBe("CLAVE_REUTILIZADA");
    expect(await cuantas(m)).toBe(1);
  });

  it("I1b: dos pedidos iguales a la vez (clic doble): una sola nota y los dos reciben la misma", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const p = pedido(m);
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.registrarNotaDeCredito(m.e.gerente, p),
          c.casos.registrarNotaDeCredito(m.e.gerente, p),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(valorDe(rs[0]).comprobanteId).toBe(
        valorDe(rs[1]).comprobanteId,
      );
      expect(rs.filter((r) => r.ok && !r.valor.yaExistia)).toHaveLength(1);
      expect(await cuantas(m)).toBe(1);
    }
  });

  it("la misma nota (tipo, punto de venta y número del mismo proveedor) con otra clave es COMPROBANTE_YA_REGISTRADO con la ganadora; anulada, el número queda libre", async () => {
    const m = await armar();
    const nota = papel();
    const primera = valorDe(await cargar(m, nota));
    const otra = await cargar(m, nota);
    expect(otra).toEqual({
      ok: false,
      error: { error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: primera.comprobanteId },
    });
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: primera.comprobanteId,
        motivo: "Se cargó mal",
      }),
    );
    valorDe(await cargar(m, nota));
    expect(await cuantas(m)).toBe(2);
    expect(await cuantas(m, "REGISTRADO")).toBe(1);
  });

  it("el tope: lo acreditado vigente no pasa del total de la factura (NOTA_DE_CREDITO_EXCEDE_LA_FACTURA); anular una nota lo libera", async () => {
    const m = await armar();
    const a = valorDe(await cargar(m, porTotal("1000")));
    valorDe(await cargar(m, porTotal("210")));
    const demas = await cargar(m, porTotal("0.01"));
    expect(codigo(demas)).toBe("NOTA_DE_CREDITO_EXCEDE_LA_FACTURA");
    expect(await cuantas(m)).toBe(2);
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: a.comprobanteId,
        motivo: "Error",
      }),
    );
    valorDe(await cargar(m, porTotal("1000")));
    const detalle = valorDe(
      await c.consultas.obtenerNotaDeCredito(m.e.gerente, { comprobanteId: a.comprobanteId }),
    );
    expect(detalle).toMatchObject({
      totalDeLaFactura: "1210.00",
      acreditadoDeLaFactura: "1210.00",
    });
  });

  it("dos notas a la vez sobre la misma factura que juntas se pasan: entra una sola", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.registrarNotaDeCredito(m.e.gerente, pedido(m, porTotal("700"))),
          c.casos.registrarNotaDeCredito(m.e.administrador, pedido(m, porTotal("700"))),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok).map(codigo)).toEqual(["NOTA_DE_CREDITO_EXCEDE_LA_FACTURA"]);
      expect(await cuantas(m)).toBe(1);
    }
  });

  it("I2: anular dos veces la misma nota devuelve yaEstaba y la segunda no escribe ni audita", async () => {
    const m = await armar();
    const n = valorDe(await cargar(m));
    const primera = valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: n.comprobanteId,
        motivo: "Se cargó mal",
      }),
    );
    expect(primera).toEqual({ yaEstaba: false });
    const antes = await c.auditoria(m.e.empresa, "NOTA_DE_CREDITO_ANULADA");
    expect(antes).toHaveLength(1);
    const segunda = valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: n.comprobanteId,
        motivo: "Se cargó mal",
      }),
    );
    expect(segunda).toEqual({ yaEstaba: true });
    expect(await c.auditoria(m.e.empresa, "NOTA_DE_CREDITO_ANULADA")).toHaveLength(1);
    const fila = await c.dueno.query(
      "select estado, anulado_por, motivo_de_anulacion from comprobante_de_proveedor where id = $1",
      [n.comprobanteId],
    );
    expect(fila.rows[0]).toEqual({
      estado: "ANULADO",
      anulado_por: m.e.personaDelGerente,
      motivo_de_anulacion: "Se cargó mal",
    });
  });

  it("I2b: dos anulaciones a la vez de la misma nota dejan una sola anulación", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const n = valorDe(await cargar(m));
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          c.casos.anularNotaDeCredito(m.e.gerente, {
            comprobanteId: n.comprobanteId,
            motivo: "Error",
          }),
          c.casos.anularNotaDeCredito(m.e.administrador, {
            comprobanteId: n.comprobanteId,
            motivo: "Error",
          }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.every((r) => r.ok)).toBe(true);
      expect(rs.filter((r) => r.ok && !r.valor.yaEstaba)).toHaveLength(1);
      expect(await c.auditoria(m.e.empresa, "NOTA_DE_CREDITO_ANULADA")).toHaveLength(1);
    }
  });

  it("una factura con notas vigentes no se anula (COMPROBANTE_CON_NOTA_DE_CREDITO); con la nota anulada, sí", async () => {
    const m = await armar();
    const n = valorDe(await cargar(m));
    expect(
      codigo(
        await c.casos.anularFactura(m.e.gerente, { comprobanteId: m.factura, motivo: "Error" }),
      ),
    ).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: n.comprobanteId,
        motivo: "Error",
      }),
    );
    valorDe(
      await c.casos.anularFactura(m.e.gerente, { comprobanteId: m.factura, motivo: "Error" }),
    );
    // Y a una factura anulada no se le carga una nota.
    expect(codigo(await cargar(m))).toBe("NOTA_DE_CREDITO_DE_FACTURA_ANULADA");
  });

  it("validación: factura inexistente, de otra empresa o que no es factura; de otro proveedor; punto de venta no declarado; contenido inválido; sin escribir nada", async () => {
    const m = await armar();
    const otra = await armar();
    const otroProveedor = await c.proveedor(m.e.operador, {
      condicionIva: "RESPONSABLE_INSCRIPTO",
    });
    const unaNota = valorDe(await cargar(m)).comprobanteId;
    const casos: [Record<string, unknown>, string][] = [
      [{ facturaId: nuevoId() }, "NOTA_DE_CREDITO_SIN_FACTURA"],
      [{ facturaId: otra.factura }, "NOTA_DE_CREDITO_SIN_FACTURA"],
      [{ facturaId: unaNota }, "NOTA_DE_CREDITO_SIN_FACTURA"],
      [{ proveedorId: otroProveedor }, "NOTA_DE_CREDITO_DE_OTRO_PROVEEDOR"],
      [{ proveedorId: otra.proveedor }, "PROVEEDOR_NO_ENCONTRADO"],
      [{ nota: papel({ puntoDeVenta: 6 }) }, "PUNTO_DE_VENTA_NO_DECLARADO"],
      [{ nota: papel({ tipo: "FACTURA_A" }) }, "TIPO_DE_COMPROBANTE_INVALIDO"],
      [{ nota: papel({ tipo: "NOTA_DEBITO_A" }) }, "TIPO_DE_COMPROBANTE_INVALIDO"],
      [{ nota: papel({ importes: [] }) }, "LINEAS_REQUERIDAS"],
      [{ nota: papel({ importes: [{ alicuota: "21", neto: "0" }] }) }, "PRECIO_INVALIDO"],
      [{ nota: papel({ importes: [{ alicuota: null, neto: "500" }] }) }, "ALICUOTA_REQUERIDA"],
      [{ nota: papel({ importes: [{ alicuota: "99", neto: "500" }] }) }, "ALICUOTA_INVALIDA"],
      [{ nota: papel({ moneda: "USD" }) }, "MONEDA_NO_SOPORTADA"],
      [{ nota: papel({ fecha: "mañana" }) }, "FECHA_INVALIDA"],
      [{ nota: papel({ totalSegunNota: 605 }) }, "TOTAL_INVALIDO"],
      [{ nota: papel({ totalSegunNota: "abc" }) }, "TOTAL_INVALIDO"],
      [{ clave: "x" }, "IDENTIFICADOR_INVALIDO"],
      [{ facturaId: "x" }, "IDENTIFICADOR_INVALIDO"],
    ];
    for (const [cambio, esperado] of casos) {
      const r = await c.casos.registrarNotaDeCredito(m.e.gerente, { ...pedido(m), ...cambio });
      expect(codigo(r), JSON.stringify(cambio)).toBe(esperado);
    }
    expect(await cuantas(m)).toBe(1);
  });

  it("el total del papel que no coincide con las cuentas se guarda igual: el papel dice lo que dice", async () => {
    const m = await armar();
    const r = valorDe(await cargar(m, papel({ totalSegunNota: "605.01" })));
    const fila = await c.dueno.query(
      "select total_calculado::text as calculado, total_segun_factura::text as papel from comprobante_de_proveedor where id = $1",
      [r.comprobanteId],
    );
    expect(fila.rows[0]).toEqual({ calculado: "605.00", papel: "605.01" });
  });

  it("la empresa en otro nivel no carga notas (ORDEN_NO_CORRESPONDE_AL_NIVEL); anular lo cargado sigue", async () => {
    const m = await armar();
    const n = valorDe(await cargar(m));
    valorDe(
      await c.casos.configurarCompras(m.e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 2,
      }),
    );
    expect(codigo(await cargar(m))).toBe("ORDEN_NO_CORRESPONDE_AL_NIVEL");
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: n.comprobanteId,
        motivo: "Error",
      }),
    );
  });

  it("el operador no carga ni anula (SIN_PERMISO) pero sí ve; el administrador carga; anular pide motivo y una nota que existe", async () => {
    const m = await armar();
    const n = valorDe(await c.casos.registrarNotaDeCredito(m.e.administrador, pedido(m)));
    expect(await c.casos.registrarNotaDeCredito(m.e.operador, pedido(m))).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(
      await c.casos.anularNotaDeCredito(m.e.operador, {
        comprobanteId: n.comprobanteId,
        motivo: "Error",
      }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(await cuantas(m, "ANULADO")).toBe(0);
    expect(
      valorDe(await c.consultas.listarNotasDeCredito(m.e.operador)).filas.map(
        (f) => f.comprobanteId,
      ),
    ).toEqual([n.comprobanteId]);
    expect(
      codigo(
        await c.casos.anularNotaDeCredito(m.e.gerente, {
          comprobanteId: n.comprobanteId,
          motivo: " ",
        }),
      ),
    ).toBe("MOTIVO_REQUERIDO");
    for (const comprobanteId of [nuevoId(), "x", m.factura]) {
      expect(
        codigo(await c.casos.anularNotaDeCredito(m.e.gerente, { comprobanteId, motivo: "Error" })),
      ).toBe("NOTA_DE_CREDITO_NO_ENCONTRADA");
    }
    const otra = await armar();
    expect(
      codigo(
        await c.casos.anularNotaDeCredito(otra.e.gerente, {
          comprobanteId: n.comprobanteId,
          motivo: "Error",
        }),
      ),
    ).toBe("NOTA_DE_CREDITO_NO_ENCONTRADA");
    expect(await cuantas(m, "ANULADO")).toBe(0);
  });

  it("la lista y el detalle: con su estado, paginados, filtrados y aislados por empresa", async () => {
    const m = await armar();
    const otra = await armar();
    const a = valorDe(await cargar(m, porTotal("100")));
    const b = valorDe(await cargar(m, porTotal("200")));
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: a.comprobanteId,
        motivo: "Error",
      }),
    );
    valorDe(await c.casos.registrarNotaDeCredito(otra.e.gerente, pedido(otra, porTotal("50"))));
    const todas = valorDe(await c.consultas.listarNotasDeCredito(m.e.gerente));
    expect(todas.filas.map((f) => [f.comprobanteId, f.estado, f.facturaId]).sort()).toEqual(
      [
        [a.comprobanteId, "ANULADO", m.factura],
        [b.comprobanteId, "REGISTRADO", m.factura],
      ].sort(),
    );
    expect(todas.siguiente).toBeNull();
    expect(
      valorDe(await c.consultas.listarNotasDeCredito(m.e.gerente, { estado: "ANULADO" })).filas,
    ).toHaveLength(1);
    expect(
      valorDe(await c.consultas.listarNotasDeCredito(m.e.gerente, { facturaId: m.factura })).filas,
    ).toHaveLength(2);
    expect(
      valorDe(await c.consultas.listarNotasDeCredito(m.e.gerente, { proveedorId: otra.proveedor }))
        .filas,
    ).toEqual([]);
    expect(
      await c.consultas.listarNotasDeCredito(m.e.gerente, { despuesDe: "no-es-un-cursor" }),
    ).toEqual({
      ok: false,
      error: "CURSOR_INVALIDO",
    });
    for (const malo of [{ estado: "X" }, { facturaId: "x" }, { proveedorId: "x" }]) {
      expect(await c.consultas.listarNotasDeCredito(m.e.gerente, malo)).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    }
    const detalle = valorDe(
      await c.consultas.obtenerNotaDeCredito(m.e.operador, { comprobanteId: b.comprobanteId }),
    );
    expect(detalle).toMatchObject({
      facturaId: m.factura,
      tipo: "NOTA_CREDITO_A",
      totalSegunNota: "200.00",
      estado: "REGISTRADO",
      totalDeLaFactura: "1210.00",
      acreditadoDeLaFactura: "200.00",
      importes: [{ alicuota: "0", neto: "200.00", iva: "0.00" }],
    });
    expect(
      valorDe(
        await c.consultas.obtenerNotaDeCredito(otra.e.gerente, { comprobanteId: b.comprobanteId }),
      ),
    ).toBeNull();
    // Una factura no es una nota.
    expect(
      valorDe(await c.consultas.obtenerNotaDeCredito(m.e.gerente, { comprobanteId: m.factura })),
    ).toBeNull();
    expect(await c.consultas.obtenerNotaDeCredito(m.e.gerente, { comprobanteId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });
});
