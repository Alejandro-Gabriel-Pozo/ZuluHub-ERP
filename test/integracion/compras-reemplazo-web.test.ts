import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cambiarElComprobanteDeLaCompra,
  loQueHayQueDeshacerAntesDeCambiar,
  loQueHayQueDeshacerAntesDeReemplazar,
  reemplazarLaFactura,
  type DependenciasDeReemplazoWeb,
} from "../../src/composicion/reemplazo-web";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * NOTAS-2c-2: «Reemplazar el comprobante» por la composición web, con una base real. Los casos de uso ya tienen sus pruebas de servidor (`compras-reemplazo-de-factura.test.ts`, `compras-cambio-de-comprobante.test.ts`); ésta
 * prueba lo que agrega la pantalla: el pedido tal como lo manda el navegador (el proveedor de la nueva sale de la original, nunca del pedido; la versión de la factura que se miraba es obligatoria), «qué hay que deshacer antes»
 * y, de punta a punta, IDEMPOTENCIA (el mismo reemplazo dos veces, también a la vez: uno solo), CONCURRENCIA (dos reemplazos de la misma factura o del mismo comprobante a la vez: entra uno, la otra persona ve el genérico
 * y nunca se encadena A→B→C), ATOMICIDAD (con un pago, nada cambia), AISLAMIENTO entre empresas y AUTORIZACIÓN en el servidor.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

const MOTIVO = "Reemplazada por la factura 0005-00001234";

describe.skipIf(base === null)("composición web: reemplazar una factura (N3/N4)", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeReemplazoWeb;

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
    const cuit = cuitUnico();
    const contenido = (extra: { numero?: number; total?: string } = {}) => ({
      tipo: "FACTURA_A",
      puntoDeVenta: "5",
      numero: String(extra.numero ?? numeroUnico()),
      fecha: "2026-10-10",
      lineas: [{ productoId: harina, cantidadFacturada: "1000", precioNeto: "1", alicuota: "21" }],
      totalSegunFactura: extra.total ?? "1210.00",
    });
    const factura = valorDe(
      await c.casos.registrarFactura(e.operador, {
        clave: nuevoId(),
        proveedorId: proveedor,
        factura: {
          ...contenido(),
          puntoDeVenta: 5,
          numero: numeroUnico(),
          cuitDelProveedor: cuit,
        },
      }),
    ).comprobanteId;
    return { e, proveedor, factura, contenido };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  /** El pedido tal como lo manda el navegador: la clave, la factura de la ruta, el motivo y la factura nueva; nada del proveedor ni de la empresa. */
  const pedido = (m: M, extra: Record<string, unknown> = {}, nueva = m.contenido()) => ({
    clave: nuevoId(),
    comprobanteId: m.factura,
    motivo: MOTIVO,
    factura: nueva,
    ...extra,
  });
  const reemplazar = (m: M, extra: Record<string, unknown> = {}, quien = m.e.gerente) =>
    reemplazarLaFactura(d, quien, pedido(m, extra));
  const fila = async (id: string) =>
    (
      await c.filas<{
        estado: string;
        reemplaza_a_id: string | null;
        motivo: string | null;
        proveedor_id: string;
      }>(
        "select estado, reemplaza_a_id, motivo_de_anulacion as motivo, proveedor_id from comprobante_de_proveedor where id = $1",
        [id],
      )
    )[0];
  const facturas = (m: M) =>
    c.contar(
      "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'FACTURA'",
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
  const deshacer = (m: M, quien = m.e.gerente) =>
    loQueHayQueDeshacerAntesDeReemplazar(d, quien, m.factura);

  it("sin pago, conciliaciones ni notas: no hay nada que deshacer y la factura no está anulada", async () => {
    const m = await armar();
    expect(await deshacer(m)).toEqual({
      ok: true,
      dato: { comprobanteId: m.factura, anulada: false, frenos: [] },
    });
  });

  it("con un pago vigente y una nota vigente: los frenos salen en el orden del servidor, con el id del pago", async () => {
    const m = await armar();
    const pago = valorDe(await pagar(m));
    valorDe(
      await c.casos.registrarNotaDeDebito(m.e.gerente, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        facturaId: m.factura,
        nota: {
          tipo: "NOTA_DEBITO_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-11-10",
          importes: [{ alicuota: "0", neto: "10.00" }],
          totalSegunNota: "10.00",
        },
      }),
    );
    expect(await deshacer(m)).toEqual({
      ok: true,
      dato: {
        comprobanteId: m.factura,
        anulada: false,
        frenos: [{ freno: "PAGO_VIGENTE", pagoId: pago.pagoId }, { freno: "NOTAS_VIGENTES" }],
      },
    });
  });

  it("reemplaza: la original queda anulada con el motivo, la nueva es del MISMO proveedor y la reemplaza; una sola auditoría de cada tipo", async () => {
    const m = await armar();
    const r = await reemplazar(m);
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const nueva = r.ok ? r.dato.comprobanteId : "";
    expect(await fila(m.factura)).toMatchObject({ estado: "ANULADO", motivo: MOTIVO });
    expect(await fila(nueva)).toMatchObject({
      estado: "REGISTRADO",
      reemplaza_a_id: m.factura,
      proveedor_id: m.proveedor,
    });
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    expect(await auditorias("FACTURA_REGISTRADA", nueva)).toBe(1);
    // Una vez reemplazada la lectura la marca anulada (la pantalla no la ofrece).
    expect(await deshacer(m)).toMatchObject({ ok: true, dato: { anulada: true } });
  });

  it("el proveedor, la empresa o la persona que diga el navegador no se leen: se rechaza y no pasa nada", async () => {
    const m = await armar();
    const otra = await armar();
    esGenerico(await reemplazar(m, { proveedorId: otra.proveedor }));
    esGenerico(await reemplazar(m, { empresaId: otra.e.empresa }));
    esGenerico(await reemplazar(m, { personaId: nuevoId() }));
    esGenerico(
      await reemplazarLaFactura(
        d,
        m.e.gerente,
        pedido(m, {}, { ...m.contenido(), proveedorId: otra.proveedor } as never),
      ),
    );
    expect(await facturas(m)).toBe(1);
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
  });

  it("sin motivo no se reemplaza: la anulación necesita su porqué y no queda nada", async () => {
    const m = await armar();
    esGenerico(await reemplazar(m, { motivo: "" }));
    esGenerico(await reemplazar(m, { motivo: "   " }));
    expect(await facturas(m)).toBe(1);
  });

  it("IDEMPOTENCIA: el mismo reemplazo dos veces (misma clave y mismo contenido) es uno solo; con otro contenido, el genérico", async () => {
    const m = await armar();
    const uno = pedido(m);
    const a = await reemplazarLaFactura(d, m.e.gerente, uno);
    const b = await reemplazarLaFactura(d, m.e.gerente, uno);
    expect(a).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(b).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(a.ok && b.ok && a.dato.comprobanteId === b.dato.comprobanteId).toBe(true);
    expect(await facturas(m)).toBe(2);
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    esGenerico(
      await reemplazarLaFactura(d, m.e.gerente, {
        ...uno,
        factura: m.contenido({ total: "1500.00" }),
      }),
    );
    expect(await facturas(m)).toBe(2);
  });

  it("IDEMPOTENCIA a la vez: el mismo pedido llegando dos veces juntas deja UNA factura nueva", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const uno = pedido(m);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          reemplazarLaFactura(d, m.e.gerente, uno),
          reemplazarLaFactura(d, m.e.gerente, uno),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.some((x) => x.ok)).toBe(true);
      const ids = new Set(resultados.flatMap((x) => (x.ok ? [x.dato.comprobanteId] : [])));
      expect(ids.size).toBe(1);
      expect(await facturas(m)).toBe(2);
      expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    }
  });

  it("CONCURRENCIA: dos personas reemplazan la misma factura a la vez con facturas distintas: entra UNA y la otra ve el genérico; nunca dos nuevas vigentes", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([reemplazar(m), reemplazar(m, {}, m.e.administrador)]);
      } finally {
        c.soltarBarrera();
      }
      expect(
        resultados.filter((x) => x.ok),
        JSON.stringify(resultados),
      ).toHaveLength(1);
      esGenerico(resultados.find((x) => !x.ok));
      expect(await facturas(m)).toBe(2);
      expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(1);
    }
  });

  it("ATOMICIDAD: con un pago vigente no se reemplaza (genérico) y no queda nada a medias; sin ese freno, anulado el pago, sí", async () => {
    const m = await armar();
    const pago = valorDe(await pagar(m));
    esGenerico(await reemplazar(m));
    expect(await facturas(m)).toBe(1);
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO", motivo: null });
    expect(await auditorias("FACTURA_REEMPLAZADA", m.factura)).toBe(0);
    valorDe(
      await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Se pagó de más" }),
    );
    expect(await reemplazar(m)).toMatchObject({ ok: true });
    expect(await facturas(m)).toBe(2);
  });

  it("AUTORIZACIÓN: el operador no reemplaza ni ve «qué hay que deshacer antes» (el guard decide en el servidor); no queda nada", async () => {
    const m = await armar();
    const sinPermiso = { ok: false, error: { codigo: "SIN_PERMISO" } };
    expect(await reemplazar(m, {}, m.e.operador)).toMatchObject(sinPermiso);
    expect(await deshacer(m, m.e.operador)).toMatchObject(sinPermiso);
    expect(await facturas(m)).toBe(1);
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
  });

  it("AISLAMIENTO: la factura de otra empresa es indistinguible de una que no existe; ni se lee ni se reemplaza", async () => {
    const m = await armar();
    const otra = await armar();
    esGenerico(await loQueHayQueDeshacerAntesDeReemplazar(d, otra.e.gerente, m.factura));
    esGenerico(await reemplazarLaFactura(d, otra.e.gerente, pedido(m)));
    esGenerico(await loQueHayQueDeshacerAntesDeReemplazar(d, m.e.gerente, nuevoId()));
    expect(await facturas(m)).toBe(1);
    expect(await fila(m.factura)).toMatchObject({ estado: "REGISTRADO" });
  });
});

describe.skipIf(base === null)(
  "composición web: cambiar el comprobante de la compra (N1/N2)",
  () => {
    let c: MontajeDeCompras;
    let d: DependenciasDeReemplazoWeb;

    beforeAll(async () => {
      if (base === null) return;
      c = await montarCompras(base);
      d = {
        consultas: () => c.consultas,
        casosDeUso: () => c.casos,
        respuesta: { registrar: () => undefined },
      };
    });
    afterAll(async () => {
      if (base !== null) await c.cerrar();
    });

    /** Una empresa en N2 con una compra de 2 kg y su factura de 2420,00 (2000 neto + IVA 21 %). */
    const armar = async () => {
      const e: EscenarioDeCompras = await c.escenario();
      valorDe(
        await c.casos.configurarCompras(e.gerente, {
          nivel: "CON_COMPROBANTE",
          versionEsperada: 1,
        }),
      );
      const deposito = await c.deposito(e);
      const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
      const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
      valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
      const cuit = cuitUnico();
      const contenido = (extra: { numero?: number; precioNeto?: string } = {}) => {
        const precioNeto = extra.precioNeto ?? "1";
        return {
          tipo: "FACTURA_A",
          puntoDeVenta: "5",
          numero: String(extra.numero ?? numeroUnico()),
          fecha: "2026-10-10",
          totalSegunFactura: (2000 * Number(precioNeto) * 1.21).toFixed(2),
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto, alicuota: "21" }],
        };
      };
      const compra = valorDe(
        await c.casos.registrarCompraConFactura(e.operador, {
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
          factura: {
            ...contenido(),
            puntoDeVenta: 5,
            numero: numeroUnico(),
            cuitDelProveedor: cuit,
            lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
          },
        }),
      );
      return {
        e,
        proveedor,
        contenido,
        recepcionId: compra.recepcionId,
        factura: compra.comprobanteId as string,
      };
    };
    type M = Awaited<ReturnType<typeof armar>>;

    const pedido = (
      m: M,
      visto: string,
      extra: Record<string, unknown> = {},
      precioNeto = "1",
    ) => ({
      clave: nuevoId(),
      recepcionId: m.recepcionId,
      facturaVigenteVistaId: visto,
      motivo: MOTIVO,
      factura: m.contenido({ precioNeto }),
      ...extra,
    });
    const cambiar = (m: M, visto: string, quien = m.e.gerente, extra = {}) =>
      cambiarElComprobanteDeLaCompra(d, quien, pedido(m, visto, extra));
    const deshacer = (m: M, quien = m.e.gerente) =>
      loQueHayQueDeshacerAntesDeCambiar(d, quien, m.recepcionId);
    const facturas = (m: M) =>
      c.contar(
        "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'FACTURA'",
        [m.e.empresa],
      );
    const vigentes = (m: M) =>
      c.contar(
        "select count(*) as n from comprobante_de_proveedor where empresa_id = $1 and clase = 'FACTURA' and estado <> 'ANULADO'",
        [m.e.empresa],
      );
    const pagar = (m: M, comprobanteId: string) =>
      c.casos.declararPago(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId,
        fechaDePago: "2026-10-11",
        medio: "TRANSFERENCIA",
      });

    it("la lectura dice cuál es la factura vigente de la compra (la que se mira) y que no hay nada que deshacer", async () => {
      const m = await armar();
      expect(await deshacer(m)).toEqual({
        ok: true,
        dato: { comprobanteId: m.factura, anulada: false, frenos: [] },
      });
    });

    it("con un pago vigente la lectura lo muestra como freno y el cambio falla con el genérico sin tocar nada", async () => {
      const m = await armar();
      const pago = valorDe(await pagar(m, m.factura));
      expect(await deshacer(m)).toEqual({
        ok: true,
        dato: {
          comprobanteId: m.factura,
          anulada: false,
          frenos: [{ freno: "PAGO_VIGENTE", pagoId: pago.pagoId }],
        },
      });
      esGenerico(await cambiar(m, m.factura));
      expect(await facturas(m)).toBe(1);
    });

    it("cambia el comprobante con la factura que se miraba: queda UNA vigente (la nueva) y la lectura pasa a mostrar la nueva", async () => {
      const m = await armar();
      const r = await cambiar(m, m.factura);
      expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
      const nueva = r.ok ? r.dato.comprobanteId : "";
      expect(nueva).not.toBe(m.factura);
      expect(await facturas(m)).toBe(2);
      expect(await vigentes(m)).toBe(1);
      expect(await deshacer(m)).toMatchObject({
        ok: true,
        dato: { comprobanteId: nueva, anulada: false },
      });
    });

    it("CONTROL DE VERSIÓN: quien miraba la factura vieja ve el genérico y la compra queda con la factura de la otra persona (no se encadena)", async () => {
      const m = await armar();
      const primera = await cambiar(m, m.factura);
      const ganadora = primera.ok ? primera.dato.comprobanteId : "";
      esGenerico(await cambiar(m, m.factura, m.e.administrador));
      expect(await facturas(m)).toBe(2);
      expect(await vigentes(m)).toBe(1);
      expect(await deshacer(m)).toMatchObject({ ok: true, dato: { comprobanteId: ganadora } });
    });

    it("sin la factura que se miraba (o con otra cosa) no se escribe nada: no es opcional", async () => {
      const m = await armar();
      esGenerico(
        await cambiarElComprobanteDeLaCompra(d, m.e.gerente, {
          ...pedido(m, m.factura),
          facturaVigenteVistaId: undefined,
        }),
      );
      esGenerico(await cambiar(m, "no-es-uuid"));
      esGenerico(await cambiar(m, nuevoId()));
      expect(await facturas(m)).toBe(1);
    });

    it("IDEMPOTENCIA: el mismo cambio dos veces es uno solo, también a la vez", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const m = await armar();
        const uno = pedido(m, m.factura);
        const a = await cambiarElComprobanteDeLaCompra(d, m.e.gerente, uno);
        const b = await cambiarElComprobanteDeLaCompra(d, m.e.gerente, uno);
        expect(a).toMatchObject({ ok: true, dato: { yaExistia: false } });
        expect(b).toMatchObject({ ok: true, dato: { yaExistia: true } });
        expect(await facturas(m)).toBe(2);
        const n = await armar();
        const a_la_vez = pedido(n, n.factura);
        c.armarBarrera(2);
        let resultados;
        try {
          resultados = await Promise.all([
            cambiarElComprobanteDeLaCompra(d, n.e.gerente, a_la_vez),
            cambiarElComprobanteDeLaCompra(d, n.e.gerente, a_la_vez),
          ]);
        } finally {
          c.soltarBarrera();
        }
        expect(resultados.some((x) => x.ok)).toBe(true);
        expect(new Set(resultados.flatMap((x) => (x.ok ? [x.dato.comprobanteId] : []))).size).toBe(
          1,
        );
        expect(await facturas(n)).toBe(2);
        expect(await vigentes(n)).toBe(1);
      }
    });

    it("CONCURRENCIA: dos personas cambian el comprobante a la vez, las dos mirando la misma factura: entra UNA y la otra ve el genérico; queda una sola vigente", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const m = await armar();
        c.armarBarrera(2);
        let resultados;
        try {
          resultados = await Promise.all([
            cambiar(m, m.factura),
            cambiar(m, m.factura, m.e.administrador),
          ]);
        } finally {
          c.soltarBarrera();
        }
        expect(
          resultados.filter((x) => x.ok),
          JSON.stringify(resultados),
        ).toHaveLength(1);
        esGenerico(resultados.find((x) => !x.ok));
        expect(await facturas(m)).toBe(2);
        expect(await vigentes(m)).toBe(1);
      }
    });

    it("AUTORIZACIÓN: el operador no cambia el comprobante ni ve «qué hay que deshacer antes»; no queda nada", async () => {
      const m = await armar();
      const sinPermiso = { ok: false, error: { codigo: "SIN_PERMISO" } };
      expect(await cambiar(m, m.factura, m.e.operador)).toMatchObject(sinPermiso);
      expect(await deshacer(m, m.e.operador)).toMatchObject(sinPermiso);
      expect(await facturas(m)).toBe(1);
    });

    it("AISLAMIENTO: la compra de otra empresa es indistinguible de una que no existe; ni se lee ni se cambia", async () => {
      const m = await armar();
      const otra = await armar();
      esGenerico(await loQueHayQueDeshacerAntesDeCambiar(d, otra.e.gerente, m.recepcionId));
      esGenerico(await cambiar(m, m.factura, otra.e.gerente));
      esGenerico(await loQueHayQueDeshacerAntesDeCambiar(d, m.e.gerente, nuevoId()));
      expect(await facturas(m)).toBe(1);
    });
  },
);
