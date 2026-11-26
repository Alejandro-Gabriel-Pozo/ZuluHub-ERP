import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularLaNota,
  notasDeLaFactura,
  registrarLaNota,
  type DependenciasDeNotasWeb,
} from "../../src/composicion/notas-web";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * NOTAS-2c-1: «Notas de la factura», «Cargar una nota del proveedor» y «Anular» por la composición web, con una base real. Los casos de uso ya tienen sus pruebas de servidor (`compras-notas-de-debito.test.ts`,
 * `compras-pago-por-el-neto.test.ts`); ésta prueba lo que agrega la pantalla: el pedido tal como lo manda el navegador (el proveedor sale de la FACTURA, nunca del pedido), la lectura con el neto a pagar y el saldo a
 * favor, el texto propio de la nota ya descontada por un pago y, de punta a punta, IDEMPOTENCIA (la misma nota dos veces, también a la vez: una sola), CONCURRENCIA (dos notas de crédito a la vez que juntas pasan el total:
 * entra una; anular una nota y pagar la factura a la vez: nunca un importe a medias), ATOMICIDAD (si el libro falla no queda la nota), AISLAMIENTO entre empresas y AUTORIZACIÓN en el servidor.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: notas del proveedor", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeNotasWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    c.encenderPerilla("conciliacion_de_tres_vias");
    d = {
      consultas: () => c.consultas,
      casosDeUso: () => c.casos,
      respuesta: { registrar: () => undefined },
    };
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
          cuitDelProveedor: cuitUnico(),
        },
      }),
    ).comprobanteId;
    return { e, proveedor, factura };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** El pedido tal como lo manda el navegador: la clave, la factura de la ruta y la nota; nada del proveedor ni de la empresa. */
  const pedido = (m: M, total: string, tipo = "NOTA_CREDITO_A", clave = nuevoId()) => ({
    clave,
    facturaId: m.factura,
    nota: {
      tipo,
      puntoDeVenta: "5",
      numero: String(numeroUnico()),
      fecha: "2026-11-10",
      importes: [{ alicuota: "0", neto: total }],
      totalSegunNota: total,
    },
  });
  const cargar = (
    m: M,
    total: string,
    clase: "CREDITO" | "DEBITO" = "CREDITO",
    quien = m.e.gerente,
  ) =>
    registrarLaNota(
      d,
      quien,
      clase,
      pedido(m, total, clase === "CREDITO" ? "NOTA_CREDITO_A" : "NOTA_DEBITO_A"),
    );
  const notas = (m: M, quien = m.e.gerente) => notasDeLaFactura(d, quien, m.factura);
  const cuantasNotas = (m: M) =>
    c.contar(
      "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase in ('NOTA_DE_CREDITO','NOTA_DE_DEBITO')",
      [m.e.empresa],
    );
  const auditorias = (accion: string, id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where accion = $1 and entidad = 'comprobante_de_proveedor' and entidad_id = $2",
      [accion, id],
    );
  const pagar = (m: M) =>
    c.casos.declararPago(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.factura,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const pagos = (m: M) =>
    c.filas<{ importe: string; estado: string }>(
      "select importe::text as importe, estado from pago_de_comprobante where comprobante_id = $1 order by registrado_en",
      [m.factura],
    );

  it("sin notas: el neto es el total, nada acreditado ni debitado y sin saldo a favor", async () => {
    const m = await armar();
    expect(await notas(m)).toMatchObject({
      ok: true,
      dato: {
        facturaId: m.factura,
        tipo: "FACTURA_A",
        puntoDeVenta: 5,
        totalDeLaFactura: "1210.00",
        acreditado: "0.00",
        debitado: "0.00",
        netoAPagar: "1210.00",
        saldoAFavorPendiente: null,
        notas: [],
      },
    });
  });

  it("cargar una nota de crédito: el proveedor sale de la factura (el pedido no lo trae), baja el neto y la lectura la lista; una de débito se suma aparte y no entra al neto", async () => {
    const m = await armar();
    const nc = await cargar(m, "200.00");
    expect(nc).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const nd = await cargar(m, "50.00", "DEBITO");
    expect(nd).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const lectura = await notas(m);
    expect(lectura).toMatchObject({
      ok: true,
      dato: { acreditado: "200.00", debitado: "50.00", netoAPagar: "1010.00" },
    });
    const filas = lectura.ok ? lectura.dato.notas : [];
    expect(filas.map((f) => [f.clase, f.total, f.estado]).sort()).toEqual([
      ["NOTA_DE_CREDITO", "200.00", "REGISTRADO"],
      ["NOTA_DE_DEBITO", "50.00", "REGISTRADO"],
    ]);
    const hecha = nc.ok ? nc.dato.comprobanteId : "";
    expect(
      await c.filas<{ proveedor_id: string; empresa_id: string; registrado_por: string }>(
        "select proveedor_id, empresa_id, registrado_por from comprobante_de_proveedor where id = $1",
        [hecha],
      ),
    ).toEqual([
      { proveedor_id: m.proveedor, empresa_id: m.e.empresa, registrado_por: m.e.gerente.personaId },
    ]);
    expect(await auditorias("NOTA_DE_CREDITO_REGISTRADA", hecha)).toBe(1);
  });

  it("el pedido con un proveedor, una empresa o un campo de más es el genérico y no escribe nada; un tipo de la otra clase también", async () => {
    const m = await armar();
    for (const extra of [
      { proveedorId: m.proveedor },
      { empresaId: m.e.empresa },
      { personaId: m.e.gerente.personaId },
    ]) {
      esGenerico(
        await registrarLaNota(d, m.e.gerente, "CREDITO", { ...pedido(m, "10.00"), ...extra }),
      );
    }
    esGenerico(
      await registrarLaNota(d, m.e.gerente, "CREDITO", pedido(m, "10.00", "NOTA_DEBITO_A")),
    );
    esGenerico(
      await registrarLaNota(d, m.e.gerente, "DEBITO", pedido(m, "10.00", "NOTA_CREDITO_A")),
    );
    esGenerico(await registrarLaNota(d, m.e.gerente, "CREDITO", pedido(m, "10.00", "FACTURA_A")));
    expect(await cuantasNotas(m)).toBe(0);
  });

  it("el tope: una nota de crédito que pasa lo que todavía se puede acreditar es el genérico y no deja nada; justo el total sí entra y deja la factura saldada por notas (neto cero)", async () => {
    const m = await armar();
    esGenerico(await cargar(m, "1210.01"));
    expect(await cuantasNotas(m)).toBe(0);
    expect(await cargar(m, "1210.00")).toMatchObject({ ok: true });
    expect(await notas(m)).toMatchObject({
      ok: true,
      dato: { acreditado: "1210.00", netoAPagar: "0.00", saldoAFavorPendiente: null },
    });
    esGenerico(await cargar(m, "0.01"));
  });

  it("una nota de crédito sobre una factura ya pagada deja saldo a favor informativo; con el neto cero y el pago vigente no figura saldada sino con saldo a favor", async () => {
    const m = await armar();
    valorDe(await pagar(m));
    expect(await cargar(m, "300.00")).toMatchObject({ ok: true });
    expect(await notas(m)).toMatchObject({
      ok: true,
      dato: { netoAPagar: "910.00", saldoAFavorPendiente: "300.00" },
    });
  });

  it("I: la misma nota dos veces (misma clave) deja UNA sola nota, también a la vez; con otro contenido la clave no se reutiliza (el genérico)", async () => {
    const m = await armar();
    const unica = pedido(m, "100.00");
    const primera = await registrarLaNota(d, m.e.gerente, "CREDITO", unica);
    const segunda = await registrarLaNota(d, m.e.gerente, "CREDITO", unica);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(segunda.ok && segunda.dato.comprobanteId).toBe(primera.ok && primera.dato.comprobanteId);
    esGenerico(
      await registrarLaNota(d, m.e.gerente, "CREDITO", {
        ...unica,
        nota: {
          ...unica.nota,
          totalSegunNota: "101.00",
          importes: [{ alicuota: "0", neto: "101.00" }],
        },
      }),
    );
    expect(await cuantasNotas(m)).toBe(1);
    const n = await armar();
    const a_la_vez = pedido(n, "100.00");
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        registrarLaNota(d, n.e.gerente, "CREDITO", a_la_vez),
        registrarLaNota(d, n.e.gerente, "CREDITO", a_la_vez),
      ]);
    } finally {
      c.soltarBarrera();
    }
    expect(resultados.some((x) => x.ok)).toBe(true);
    const ids = new Set(resultados.flatMap((x) => (x.ok ? [x.dato.comprobanteId] : [])));
    expect(ids.size).toBe(1);
    expect(await cuantasNotas(n)).toBe(1);
    expect(await notas(n)).toMatchObject({ ok: true, dato: { acreditado: "100.00" } });
  });

  it("C1: dos notas de crédito a la vez que juntas pasan el total: entra UNA y la otra es el genérico; el neto nunca queda negativo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          cargar(m, "700.00"),
          cargar(m, "700.00", "CREDITO", m.e.administrador),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(
        resultados.filter((x) => x.ok),
        JSON.stringify(resultados),
      ).toHaveLength(1);
      esGenerico(resultados.find((x) => !x.ok));
      expect(await cuantasNotas(m)).toBe(1);
      expect(await notas(m)).toMatchObject({
        ok: true,
        dato: { acreditado: "700.00", netoAPagar: "510.00" },
      });
    }
  });

  it("anular: con motivo, una sola vez (repetir no escribe ni audita), y el neto vuelve; la nota anulada queda en la lista", async () => {
    const m = await armar();
    const nc = await cargar(m, "200.00");
    const id = nc.ok ? nc.dato.comprobanteId : "";
    expect(
      await anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "Se cargó mal" }),
    ).toEqual({
      ok: true,
      dato: { yaEstaba: false },
    });
    expect(
      await anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "Otra vez" }),
    ).toEqual({
      ok: true,
      dato: { yaEstaba: true },
    });
    expect(await auditorias("NOTA_DE_CREDITO_ANULADA", id)).toBe(1);
    const lectura = await notas(m);
    expect(lectura).toMatchObject({
      ok: true,
      dato: { acreditado: "0.00", netoAPagar: "1210.00" },
    });
    expect(lectura.ok && lectura.dato.notas.map((n) => n.estado)).toEqual(["ANULADO"]);
    esGenerico(await anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "" }));
  });

  it("anular una nota de crédito que un pago ya descontó sale con el texto del dueño, no con el genérico, y no cambia nada; anulado el pago se puede anular la nota", async () => {
    const m = await armar();
    const nc = await cargar(m, "200.00");
    const id = nc.ok ? nc.dato.comprobanteId : "";
    const pago = valorDe(await pagar(m));
    expect(await pagos(m)).toEqual([{ importe: "1010.00", estado: "VIGENTE" }]);
    expect(
      await anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "Mal" }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_NOTA_CON_PAGO", clave: "compras.error.nota_con_pago" },
    });
    expect(await notas(m)).toMatchObject({ ok: true, dato: { acreditado: "200.00" } });
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Mal pagado" }));
    expect(await anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "Mal" })).toEqual({
      ok: true,
      dato: { yaEstaba: false },
    });
  });

  it("C2: anular una nota y pagar la factura a la vez: o se anula y se paga el total, o se paga el neto y la anulación sale con el texto del dueño; nunca un importe a medias", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const nc = await cargar(m, "200.00");
      const id = nc.ok ? nc.dato.comprobanteId : "";
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          anularLaNota(d, m.e.gerente, "CREDITO", { notaId: id, motivo: "Mal" }),
          pagar(m),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const [anulacion, pago] = resultados;
      const hechos = await pagos(m);
      expect(hechos, JSON.stringify(resultados)).toHaveLength(1);
      if (anulacion.ok) {
        expect(hechos[0]?.importe).toBe("1210.00");
        expect(pago.ok).toBe(true);
      } else {
        expect(anulacion.error).toMatchObject({ codigo: "COMPRAS_NOTA_CON_PAGO" });
        expect(hechos[0]?.importe).toBe("1010.00");
      }
    }
  });

  it("A: si el libro falla no queda la nota ni su auditoría y el neto no cambia", async () => {
    const m = await armar();
    c.inyectarFalla("libro-nota");
    let respuesta;
    try {
      respuesta = await cargar(m, "200.00");
    } finally {
      c.inyectarFalla(null);
    }
    expect(respuesta).toMatchObject({ ok: false });
    expect(JSON.stringify(respuesta)).not.toMatch(/falla inyectada/);
    expect(await cuantasNotas(m)).toBe(0);
    expect(await notas(m)).toMatchObject({
      ok: true,
      dato: { acreditado: "0.00", netoAPagar: "1210.00" },
    });
  });

  it("autorización: el operador ve las notas pero no las carga ni las anula (el guard decide en el servidor con SIN_PERMISO); no queda nada", async () => {
    const m = await armar();
    const nc = await cargar(m, "200.00");
    const id = nc.ok ? nc.dato.comprobanteId : "";
    expect(await notas(m, m.e.operador)).toMatchObject({
      ok: true,
      dato: { acreditado: "200.00" },
    });
    const sinPermiso = { ok: false, error: { codigo: "SIN_PERMISO" } };
    expect(await cargar(m, "10.00", "CREDITO", m.e.operador)).toMatchObject(sinPermiso);
    expect(await cargar(m, "10.00", "DEBITO", m.e.operador)).toMatchObject(sinPermiso);
    expect(
      await anularLaNota(d, m.e.operador, "CREDITO", { notaId: id, motivo: "Mal" }),
    ).toMatchObject(sinPermiso);
    expect(
      await anularLaNota(d, m.e.operador, "DEBITO", { notaId: id, motivo: "Mal" }),
    ).toMatchObject(sinPermiso);
    expect(await cuantasNotas(m)).toBe(1);
    expect(await notas(m)).toMatchObject({ ok: true, dato: { acreditado: "200.00" } });
  });

  it("aislamiento: la factura o la nota de otra empresa es indistinguible de una que no existe; ni se lee ni se carga ni se anula", async () => {
    const m = await armar();
    const otra = await armar();
    const nc = await cargar(m, "200.00");
    const id = nc.ok ? nc.dato.comprobanteId : "";
    esGenerico(await notasDeLaFactura(d, otra.e.gerente, m.factura));
    esGenerico(await registrarLaNota(d, otra.e.gerente, "CREDITO", pedido(m, "10.00")));
    esGenerico(await anularLaNota(d, otra.e.gerente, "CREDITO", { notaId: id, motivo: "Mal" }));
    esGenerico(await notasDeLaFactura(d, m.e.gerente, nuevoId()));
    expect(await cuantasNotas(m)).toBe(1);
    expect(await notas(m)).toMatchObject({ ok: true, dato: { acreditado: "200.00" } });
  });
});
