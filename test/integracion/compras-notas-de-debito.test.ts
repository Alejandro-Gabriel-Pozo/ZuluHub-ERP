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
 * NOTAS-1: la nota de débito del proveedor. Un comprobante que SUMA a lo que se debe, con una factura vinculada del mismo proveedor (sin tope) o suelta; se paga aparte y no cambia lo que se paga de la factura. Repetirla
 * o cargarla a la vez no duplica; anularla deja el espejo en el libro y no se anula con un pago vigente; con alcance de sucursales y permisos; dos actores a la vez (anular la factura y cargar una nota de débito; una nota
 * de crédito y una de débito; dos de débito) sin abrazo mortal y con un estado válido; y las lecturas de las notas de una factura (neto a pagar y saldo a favor informativo).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: notas de débito del proveedor", () => {
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

  /** Una empresa en N4 con un proveedor y una factura de 1210,00 (1000 neto + IVA 21 %), cargada sin sucursal. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    // Un proveedor tiene un solo documento: todas sus facturas llevan el mismo CUIT.
    const cuit = cuitUnico();
    const facturar = async (p: string) =>
      valorDe(
        await c.casos.registrarFactura(e.operador, {
          clave: nuevoId(),
          proveedorId: p,
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
    const factura = await facturar(proveedor);
    return { e, proveedor, factura, facturar };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const porTotal = (total: string, tipo = "NOTA_DEBITO_A") => ({
    tipo,
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-11-10",
    importes: [{ alicuota: "0", neto: total }],
    totalSegunNota: total,
  });
  const cargarND = (
    m: M,
    total = "500.00",
    facturaId: string | null = m.factura,
    quien = m.e.gerente,
    proveedorId = m.proveedor,
  ) =>
    c.casos.registrarNotaDeDebito(quien, {
      clave: nuevoId(),
      proveedorId,
      facturaId,
      nota: porTotal(total),
    });
  const anularND = (m: M, comprobanteId: string, quien = m.e.gerente) =>
    c.casos.anularNotaDeDebito(quien, { comprobanteId, motivo: "Se cargó mal" });
  const cargarNC = (m: M, total = "200.00") =>
    c.casos.registrarNotaDeCredito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: porTotal(total, "NOTA_CREDITO_A"),
    });
  const pagar = (m: M, comprobanteId: string) =>
    c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const auditorias = (accion: string, id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where accion = $1 and entidad = 'comprobante_de_proveedor' and entidad_id = $2",
      [accion, id],
    );
  const asientos = (notaId: string) =>
    c.filas<{ naturaleza: string; importe: string; clase: string }>(
      "select naturaleza, importe::text as importe, clase from asiento_de_saldo where origen_tipo = 'compras.nota' and origen_id = $1 order by naturaleza desc",
      [notaId],
    );
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const notas = (m: M) =>
    c.contar(
      "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'NOTA_DE_DEBITO'",
      [m.e.empresa],
    );
  const fila = async (id: string) =>
    (
      await c.filas<{
        clase: string;
        estado: string;
        asociado: string | null;
        nivel: string;
        total: string;
      }>(
        "select clase, estado, comprobante_asociado_id as asociado, nivel, total_segun_factura::text as total from comprobante_de_proveedor where id = $1",
        [id],
      )
    )[0];

  it("una nota de débito vinculada: queda como comprobante de su factura, con su asiento (un cargo suelto que suma, sin imputar) y su auditoría; la factura sigue pagando su total", async () => {
    const m = await armar();
    const antes = await saldo(m);
    const r = valorDe(await cargarND(m));
    expect(r.yaExistia).toBe(false);
    expect(await fila(r.comprobanteId)).toMatchObject({
      clase: "NOTA_DE_DEBITO",
      estado: "REGISTRADO",
      asociado: m.factura,
      nivel: "TRES_VIAS",
      total: "500.00",
    });
    expect(await asientos(r.comprobanteId)).toEqual([
      { naturaleza: "ORIGINAL", importe: "500.00", clase: "NOTA_DE_DEBITO_DE_COMPRA" },
    ]);
    expect(Number(await saldo(m)) - Number(antes)).toBe(500);
    expect(await auditorias("NOTA_DE_DEBITO_REGISTRADA", r.comprobanteId)).toBe(1);
    // La nota de débito NO resta ni suma al neto de la factura: se paga aparte.
    const ver = valorDe(await c.consultas.notasDeLaFactura(m.e.gerente, { facturaId: m.factura }));
    expect(ver).toMatchObject({
      acreditado: "0.00",
      debitado: "500.00",
      netoAPagar: "1210.00",
      saldoAFavorPendiente: null,
    });
    const pago = valorDe(await pagar(m, m.factura));
    expect(pago.yaExistia).toBe(false);
    const [importe] = await c.filas<{ importe: string }>(
      "select importe::text as importe from pago_de_comprobante where id = $1",
      [pago.pagoId],
    );
    expect(importe?.importe).toBe("1210.00");
  });

  it("una nota de débito suelta (sin factura): se carga con alcance sobre todas las sucursales, graba el nivel de la empresa y suma al saldo del proveedor", async () => {
    const m = await armar();
    const r = valorDe(await cargarND(m, "300.00", null));
    expect(await fila(r.comprobanteId)).toMatchObject({
      clase: "NOTA_DE_DEBITO",
      asociado: null,
      nivel: "TRES_VIAS",
    });
    expect(await asientos(r.comprobanteId)).toHaveLength(1);
    expect(await saldo(m)).toBe("1510.00");
    // Sin alcance sobre todas las sucursales no se carga (no tiene a qué sucursal pertenecer).
    c.alcances.set(m.e.administrador.personaId as string, [m.e.otraSucursal]);
    try {
      expect(codigo(await cargarND(m, "10.00", null, m.e.administrador))).toBe(
        "SUCURSAL_FUERA_DE_ALCANCE",
      );
    } finally {
      c.alcances.delete(m.e.administrador.personaId as string);
    }
    expect(await notas(m)).toBe(1);
  });

  it("el vínculo: factura de otro proveedor, anulada, que no es factura o inexistente se rechazan con su nombre y sin escribir nada; una nota de crédito no entra por esta puerta", async () => {
    const m = await armar();
    const otroProveedor = await c.proveedor(m.e.operador, {
      condicionIva: "RESPONSABLE_INSCRIPTO",
    });
    valorDe(await c.casos.agregarPuntoDeVenta(m.e.gerente, { parteId: otroProveedor, numero: 5 }));
    expect(codigo(await cargarND(m, "10.00", m.factura, m.e.gerente, otroProveedor))).toBe(
      "NOTA_DE_DEBITO_DE_OTRO_PROVEEDOR",
    );
    const anulada = await m.facturar(m.proveedor);
    valorDe(
      await c.casos.anularFactura(m.e.gerente, { comprobanteId: anulada, motivo: "Mal cargada" }),
    );
    expect(codigo(await cargarND(m, "10.00", anulada))).toBe("NOTA_DE_DEBITO_DE_FACTURA_ANULADA");
    const unaNota = valorDe(await cargarND(m, "10.00", null));
    expect(codigo(await cargarND(m, "10.00", unaNota.comprobanteId))).toBe(
      "NOTA_DE_DEBITO_SIN_FACTURA",
    );
    expect(codigo(await cargarND(m, "10.00", nuevoId()))).toBe("NOTA_DE_DEBITO_SIN_FACTURA");
    expect(
      codigo(
        await c.casos.registrarNotaDeDebito(m.e.gerente, {
          clave: nuevoId(),
          proveedorId: m.proveedor,
          facturaId: m.factura,
          nota: porTotal("10.00", "NOTA_CREDITO_A"),
        }),
      ),
    ).toBe("TIPO_DE_COMPROBANTE_INVALIDO");
    expect(await notas(m)).toBe(1);
  });

  it("no tiene tope: una nota de débito mayor que el total de la factura entra y no le quita tope a las notas de crédito", async () => {
    const m = await armar();
    valorDe(await cargarND(m, "5000.00"));
    valorDe(await cargarNC(m, "1210.00"));
    expect(codigo(await cargarNC(m, "0.01"))).toBe("NOTA_DE_CREDITO_EXCEDE_LA_FACTURA");
  });

  it("I1: la misma nota de débito dos veces (misma clave, también a la vez) deja una sola nota y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const pedido = {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: porTotal("500.00"),
    };
    const primera = valorDe(await c.casos.registrarNotaDeDebito(m.e.gerente, pedido));
    const otra = valorDe(await c.casos.registrarNotaDeDebito(m.e.gerente, pedido));
    expect(otra).toEqual({ comprobanteId: primera.comprobanteId, yaExistia: true });
    expect(await notas(m)).toBe(1);
    expect(await auditorias("NOTA_DE_DEBITO_REGISTRADA", primera.comprobanteId)).toBe(1);
    expect(await asientos(primera.comprobanteId)).toHaveLength(1);
    expect(
      codigo(
        await c.casos.registrarNotaDeDebito(m.e.gerente, {
          ...pedido,
          nota: porTotal("501.00"),
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    // La misma nota (tipo, punto de venta y número) con OTRA clave: COMPROBANTE_YA_REGISTRADO con la ganadora.
    const igual = await c.casos.registrarNotaDeDebito(m.e.gerente, {
      ...pedido,
      clave: nuevoId(),
    });
    expect(!igual.ok && igual.error).toMatchObject({
      error: "COMPROBANTE_YA_REGISTRADO",
      comprobanteId: primera.comprobanteId,
    });
    // A la vez, con la misma clave: una nota, un asiento.
    const n = await armar();
    const mismo = {
      clave: nuevoId(),
      proveedorId: n.proveedor,
      facturaId: n.factura,
      nota: porTotal("500.00"),
    };
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        c.casos.registrarNotaDeDebito(n.e.gerente, mismo),
        c.casos.registrarNotaDeDebito(n.e.administrador, mismo),
      ]);
    } finally {
      c.soltarBarrera();
    }
    const ids = new Set(resultados.flatMap((r) => (r.ok ? [r.valor.comprobanteId] : [])));
    expect(ids.size).toBe(1);
    expect(await notas(n)).toBe(1);
    expect(await asientos([...ids][0] as string)).toHaveLength(1);
  });

  it("I2: anular dos veces la misma nota de débito devuelve yaEstaba y la segunda no escribe ni audita", async () => {
    const m = await armar();
    const r = valorDe(await cargarND(m));
    expect(valorDe(await anularND(m, r.comprobanteId))).toEqual({ yaEstaba: false });
    expect(await fila(r.comprobanteId)).toMatchObject({ estado: "ANULADO" });
    expect(await asientos(r.comprobanteId)).toEqual([
      { naturaleza: "ORIGINAL", importe: "500.00", clase: "NOTA_DE_DEBITO_DE_COMPRA" },
      { naturaleza: "ANULACION", importe: "-500.00", clase: "NOTA_DE_DEBITO_DE_COMPRA" },
    ]);
    expect(await saldo(m)).toBe("1210.00");
    expect(valorDe(await anularND(m, r.comprobanteId))).toEqual({ yaEstaba: true });
    expect(await auditorias("NOTA_DE_DEBITO_ANULADA", r.comprobanteId)).toBe(1);
    expect(await asientos(r.comprobanteId)).toHaveLength(2);
    expect(codigo(await anularND(m, m.factura))).toBe("NOTA_DE_DEBITO_NO_ENCONTRADA");
    expect(
      await c.casos.anularNotaDeDebito(m.e.gerente, { comprobanteId: r.comprobanteId, motivo: "" }),
    ).toMatchObject({ ok: false });
  });

  it("la nota de débito se paga aparte, por su total; con un pago vigente no se anula (COMPROBANTE_YA_PAGADO) y con el pago anulado sí", async () => {
    const m = await armar();
    const nd = valorDe(await cargarND(m, "500.00"));
    const pago = valorDe(await pagar(m, nd.comprobanteId));
    const [importe] = await c.filas<{ importe: string }>(
      "select importe::text as importe from pago_de_comprobante where id = $1",
      [pago.pagoId],
    );
    expect(importe?.importe).toBe("500.00");
    const r = await anularND(m, nd.comprobanteId);
    expect(!r.ok && r.error).toMatchObject({ error: "COMPROBANTE_YA_PAGADO", pagoId: pago.pagoId });
    expect(await fila(nd.comprobanteId)).toMatchObject({ estado: "REGISTRADO" });
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Mal cargado" }));
    valorDe(await anularND(m, nd.comprobanteId));
    expect(await fila(nd.comprobanteId)).toMatchObject({ estado: "ANULADO" });
  });

  it("A: si el libro falla al cargar la nota de débito no queda la nota; si falla al anularla, la nota sigue registrada", async () => {
    const m = await armar();
    c.inyectarFalla("libro-nota");
    try {
      await expect(cargarND(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await notas(m)).toBe(0);
    const r = valorDe(await cargarND(m));
    c.inyectarFalla("libro-nota");
    try {
      await expect(anularND(m, r.comprobanteId)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await fila(r.comprobanteId)).toMatchObject({ estado: "REGISTRADO" });
    expect(await auditorias("NOTA_DE_DEBITO_ANULADA", r.comprobanteId)).toBe(0);
    expect(await saldo(m)).toBe("1710.00");
  });

  it("permisos y alcance: el operador no carga ni anula (SIN_PERMISO) pero ve; el administrador carga; con alcance de una sola sucursal no se carga ni se anula una nota de una factura sin sucursal", async () => {
    const m = await armar();
    expect(
      await c.casos.registrarNotaDeDebito(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        facturaId: m.factura,
        nota: porTotal("10.00"),
      }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    const nd = valorDe(await cargarND(m, "100.00", m.factura, m.e.administrador));
    expect(await anularND(m, nd.comprobanteId, m.e.operador)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(await notas(m)).toBe(1);
    const lista = valorDe(await c.consultas.listarNotasDeDebito(m.e.operador, {}));
    expect(lista.filas.map((f) => f.comprobanteId)).toContain(nd.comprobanteId);
    c.alcances.set(m.e.administrador.personaId as string, [m.e.otraSucursal]);
    try {
      expect(codigo(await cargarND(m, "10.00", m.factura, m.e.administrador))).toBe(
        "SUCURSAL_FUERA_DE_ALCANCE",
      );
      expect(codigo(await anularND(m, nd.comprobanteId, m.e.administrador))).toBe(
        "SUCURSAL_FUERA_DE_ALCANCE",
      );
    } finally {
      c.alcances.delete(m.e.administrador.personaId as string);
    }
    expect(await fila(nd.comprobanteId)).toMatchObject({ estado: "REGISTRADO" });
  });

  it("aislamiento: la empresa B no vincula la factura de A, ni ve ni anula sus notas de débito", async () => {
    const a = await armar();
    const b = await armar();
    const nd = valorDe(await cargarND(a));
    expect(
      codigo(
        await c.casos.registrarNotaDeDebito(b.e.gerente, {
          clave: nuevoId(),
          proveedorId: b.proveedor,
          facturaId: a.factura,
          nota: porTotal("10.00"),
        }),
      ),
    ).toBe("NOTA_DE_DEBITO_SIN_FACTURA");
    expect(codigo(await anularND(b, nd.comprobanteId, b.e.gerente))).toBe(
      "NOTA_DE_DEBITO_NO_ENCONTRADA",
    );
    expect(valorDe(await c.consultas.listarNotasDeDebito(b.e.gerente, {})).filas).toEqual([]);
    expect(
      valorDe(
        await c.consultas.obtenerNotaDeDebito(b.e.gerente, { comprobanteId: nd.comprobanteId }),
      ),
    ).toBeNull();
    expect(
      valorDe(await c.consultas.notasDeLaFactura(b.e.gerente, { facturaId: a.factura })),
    ).toBeNull();
    expect(await fila(nd.comprobanteId)).toMatchObject({ estado: "REGISTRADO" });
  });

  it("lecturas: la lista y el detalle de la nota de débito; las notas de la factura traen crédito y débito, lo que acreditan y suman, el neto y el saldo a favor informativo de un pago ya hecho", async () => {
    const m = await armar();
    const nd = valorDe(await cargarND(m, "500.00"));
    const detalle = valorDe(
      await c.consultas.obtenerNotaDeDebito(m.e.gerente, { comprobanteId: nd.comprobanteId }),
    );
    expect(detalle).toMatchObject({
      comprobanteId: nd.comprobanteId,
      facturaId: m.factura,
      totalSegunNota: "500.00",
      estado: "REGISTRADO",
      totalDeLaFactura: "1210.00",
      acreditadoDeLaFactura: "0.00",
    });
    // Una nota de crédito no se lee por la puerta de la de débito, ni al revés.
    const nc = valorDe(await cargarNC(m, "200.00"));
    expect(
      valorDe(
        await c.consultas.obtenerNotaDeDebito(m.e.gerente, { comprobanteId: nc.comprobanteId }),
      ),
    ).toBeNull();
    expect(
      valorDe(
        await c.consultas.obtenerNotaDeCredito(m.e.gerente, { comprobanteId: nd.comprobanteId }),
      ),
    ).toBeNull();
    const suelta = valorDe(await cargarND(m, "50.00", null));
    const lista = valorDe(await c.consultas.listarNotasDeDebito(m.e.gerente, {}));
    expect(lista.filas.map((f) => [f.comprobanteId, f.facturaId]).sort()).toEqual(
      [
        [nd.comprobanteId, m.factura],
        [suelta.comprobanteId, null],
      ].sort(),
    );
    const antes = valorDe(
      await c.consultas.notasDeLaFactura(m.e.gerente, { facturaId: m.factura }),
    );
    expect(antes).toMatchObject({
      acreditado: "200.00",
      debitado: "500.00",
      netoAPagar: "1010.00",
      saldoAFavorPendiente: null,
    });
    expect(antes?.notas.map((n) => [n.clase, n.total])).toEqual(
      expect.arrayContaining([
        ["NOTA_DE_CREDITO", "200.00"],
        ["NOTA_DE_DEBITO", "500.00"],
      ]),
    );
    // Pago hecho por el neto; una nota de crédito posterior deja un saldo a favor informativo (el pago no cambia).
    valorDe(await pagar(m, m.factura));
    valorDe(await cargarNC(m, "100.00"));
    const despues = valorDe(
      await c.consultas.notasDeLaFactura(m.e.gerente, { facturaId: m.factura }),
    );
    expect(despues).toMatchObject({
      acreditado: "300.00",
      netoAPagar: "910.00",
      saldoAFavorPendiente: "100.00",
    });
    // El operador ve las dos; sin factura o con un id inválido no hay nada.
    expect(
      valorDe(await c.consultas.notasDeLaFactura(m.e.operador, { facturaId: m.factura })),
    ).not.toBeNull();
    expect(
      valorDe(await c.consultas.notasDeLaFactura(m.e.gerente, { facturaId: nuevoId() })),
    ).toBeNull();
    expect(await c.consultas.notasDeLaFactura(m.e.gerente, { facturaId: "x" })).toMatchObject({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });

  it("C1: anular la factura y cargar una nota de débito vinculada a la vez: o se anula la factura y la nota falla, o entra la nota y la anulación falla; nunca una nota vigente de una factura anulada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          cargarND(m, "100.00"),
          c.casos.anularFactura(m.e.gerente, { comprobanteId: m.factura, motivo: "Mal cargada" }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const [nota, anulacion] = resultados;
      expect(nota.ok !== anulacion.ok, JSON.stringify(resultados)).toBe(true);
      if (!nota.ok) {
        expect(["NOTA_DE_DEBITO_DE_FACTURA_ANULADA", "COMPROBANTE_NO_ENCONTRADO"]).toContain(
          codigo(nota),
        );
        expect(await notas(m)).toBe(0);
      } else {
        expect(codigo(anulacion)).toBe("COMPROBANTE_CON_NOTA_DE_CREDITO");
        expect(await notas(m)).toBe(1);
      }
    }
  });

  it("C2: dos notas de débito vinculadas a la vez entran las dos; una de crédito y una de débito a la vez, también, en cualquier orden y sin abrazo mortal", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let dos;
      try {
        dos = await Promise.all([cargarND(m, "100.00"), cargarND(m, "200.00")]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of dos) expect(r.ok, r.ok ? "" : JSON.stringify(r.error)).toBe(true);
      expect(await notas(m)).toBe(2);
      c.armarBarrera(2);
      let mixto;
      try {
        mixto = await Promise.all([cargarNC(m, "100.00"), cargarND(m, "50.00")]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of mixto) expect(r.ok, r.ok ? "" : JSON.stringify(r.error)).toBe(true);
      // Libro: 1210 de cargo + 100 + 200 + 50 de notas de débito − 100 de la nota de crédito.
      expect(await saldo(m)).toBe("1460.00");
    }
  });
});
