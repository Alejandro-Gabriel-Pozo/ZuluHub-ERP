import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";
import {
  crearCuentaDelProveedor,
  type DependenciasDeCuentaDelProveedor,
} from "../../src/composicion/cuenta-del-proveedor";

/**
 * La cuenta del proveedor desde el libro (NOTAS-1, pedido del dueño sobre DEC-COM-006): lo que se debe, lo que queda a favor de la empresa y el saldo. Lo debido menos lo a favor es SIEMPRE el saldo del libro
 * (sin cargos, con notas de crédito, con una nota de débito, con un pago que supera lo pendiente, con anulaciones); el saldo a favor se ve; un proveedor de otra empresa o que no existe sale `null`; sin permiso
 * no se lee; el operador ve (como las facturas).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: la cuenta del proveedor", () => {
  let c: MontajeDeCompras;
  let cuenta: ReturnType<typeof crearCuentaDelProveedor>;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
    // Las transacciones de la prueba traen el libro (lo usan los casos de uso) aunque su tipo no lo diga.
    cuenta = crearCuentaDelProveedor({
      transacciones: c.entorno as unknown as DependenciasDeCuentaDelProveedor["transacciones"],
      reglas: c.reglas,
    });
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa en N4 con un proveedor y una factura de 1210,00 (1000 neto + IVA 21 %), cargada sin sucursal. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel: "TRES_VIAS", versionEsperada: 1 }));
    const harina = (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto;
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const cuit = cuitUnico();
    const facturar = async () =>
      valorDe(
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
    return { e, proveedor, facturar, factura: await facturar() };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const nota = (total: string, tipo: string) => ({
    tipo,
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-11-10",
    importes: [{ alicuota: "0", neto: total }],
    totalSegunNota: total,
  });
  const cargarNC = (m: M, total: string, facturaId = m.factura) =>
    c.casos.registrarNotaDeCredito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId,
      nota: nota(total, "NOTA_CREDITO_A"),
    });
  const cargarND = (m: M, total: string) =>
    c.casos.registrarNotaDeDebito(m.e.gerente, {
      clave: nuevoId(),
      proveedorId: m.proveedor,
      facturaId: m.factura,
      nota: nota(total, "NOTA_DEBITO_A"),
    });
  const pagar = (m: M, comprobanteId = m.factura) =>
    c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const ver = async (m: M, quien = m.e.gerente) => {
    const r = valorDe(await cuenta.cuentaDelProveedor(quien, { proveedorId: m.proveedor }));
    if (r === null) throw new Error("el proveedor no se ve");
    return r;
  };
  /** Los tres números de la cuenta, con la cuenta que tienen que cumplir: aPagar − aFavor = saldo (en centavos exactos). */
  const cifras = async (m: M) => {
    const r = await ver(m);
    expect(r.aPagar.unidades - r.aFavor.unidades).toBe(r.saldo.unidades);
    return r;
  };

  it("sin movimientos: todo en cero; con una factura se debe su total y no hay nada a favor", async () => {
    const m = await armar();
    const r = await cifras(m);
    expect(r.proveedorId).toBe(m.proveedor);
    expect(r.aPagar).toMatchObject({ moneda: "ARS" });
    expect(r.saldo.unidades).toBe(121000n);
    expect(r.aPagar.unidades).toBe(121000n);
    expect(r.aFavor.unidades).toBe(0n);
    const vacio = await c.proveedor(m.e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    const sin = valorDe(await cuenta.cuentaDelProveedor(m.e.gerente, { proveedorId: vacio }));
    expect(sin).toMatchObject({ aPagar: { unidades: 0n }, aFavor: { unidades: 0n } });
    expect(sin?.saldo.unidades).toBe(0n);
  });

  it("una nota de crédito baja lo que se debe; una nota de débito lo sube; el pago por el neto lo salda", async () => {
    const m = await armar();
    valorDe(await cargarNC(m, "210.00"));
    expect((await cifras(m)).saldo.unidades).toBe(100000n);
    valorDe(await cargarND(m, "500.00"));
    const conND = await cifras(m);
    expect(conND.saldo.unidades).toBe(150000n);
    expect(conND.aFavor.unidades).toBe(0n);
    valorDe(await pagar(m));
    const pagado = await cifras(m);
    // Queda solo la nota de débito, que se paga aparte.
    expect(pagado.saldo.unidades).toBe(50000n);
    expect(pagado.aPagar.unidades).toBe(50000n);
  });

  it("lo que queda a favor se ve: una nota de crédito que llega después del pago deja el saldo a favor de la empresa, y lo debido y lo a favor suman el saldo", async () => {
    const m = await armar();
    valorDe(await pagar(m));
    valorDe(await cargarNC(m, "420.00"));
    const r = await cifras(m);
    expect(r.aPagar.unidades).toBe(0n);
    expect(r.aFavor.unidades).toBe(42000n);
    expect(r.saldo.unidades).toBe(-42000n);
  });

  it("con varias facturas y notas: lo debido y lo a favor siguen sumando el saldo, también con anulaciones", async () => {
    const m = await armar();
    const segunda = await m.facturar();
    valorDe(await pagar(m));
    const tardia = valorDe(await cargarNC(m, "100.00"));
    valorDe(await cargarNC(m, "300.00", segunda));
    valorDe(await cargarND(m, "50.00"));
    const antes = await cifras(m);
    expect(antes.aFavor.unidades).toBe(10000n);
    valorDe(
      await c.casos.anularNotaDeCredito(m.e.gerente, {
        comprobanteId: tardia.comprobanteId,
        motivo: "Se cargó mal",
      }),
    );
    const despues = await cifras(m);
    expect(despues.aFavor.unidades).toBe(0n);
    expect(despues.saldo.unidades).toBe(despues.aPagar.unidades);
  });

  it("aislamiento y permisos: un proveedor de otra empresa, que no existe o que no es un proveedor sale null; el operador ve; un id inválido se rechaza", async () => {
    const a = await armar();
    const b = await armar();
    expect(
      valorDe(await cuenta.cuentaDelProveedor(b.e.gerente, { proveedorId: a.proveedor })),
    ).toBeNull();
    expect(
      valorDe(await cuenta.cuentaDelProveedor(a.e.gerente, { proveedorId: nuevoId() })),
    ).toBeNull();
    const cliente = valorDe(
      await c.clientes.crearParte(a.e.gerente, {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: "Cliente sin rol de proveedor",
        roles: ["CUSTOMER"],
      }),
    );
    expect(
      valorDe(await cuenta.cuentaDelProveedor(a.e.gerente, { proveedorId: cliente.parteId })),
    ).toBeNull();
    expect((await ver(a, a.e.operador)).saldo.unidades).toBe(121000n);
    expect(await cuenta.cuentaDelProveedor(a.e.gerente, { proveedorId: "x" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
  });
});
