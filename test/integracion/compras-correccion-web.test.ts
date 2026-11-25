import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  fichaDeLaCompra,
  type DependenciasDeComprasListaWeb,
} from "../../src/composicion/compras-lista-web";
import {
  anularLaCompra,
  corregirLaCompra,
  type DependenciasDeCorreccionDeCompraWeb,
} from "../../src/composicion/correccion-de-compra-web";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras PR 10: «Corregir» el precio de una línea y «Anular» una compra para la pantalla, con una base real. Se prueba la IDEMPOTENCIA (el mismo envío dos veces: una corrección y una auditoría; anular
 * dos veces: una anulación, un espejo de stock y una auditoría), la CONCURRENCIA (dos pestañas que corrigen la misma línea: una gana y la otra recibe el genérico; dos anulaciones a la vez), la autorización
 * (solo gerente y administrador, validada en el servidor aunque el navegador mande el pedido), el aislamiento entre empresas, que un pedido con campos de más (cantidad, peso, empresa) no llega, que una
 * compra ya consumida no se anula (y se avisa para ofrecer «Corregir») y que la ficha muestra la corrección con quién, cuándo, el «Antes» y el motivo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: corregir y anular una compra", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeCorreccionDeCompraWeb;
  let lectura: DependenciasDeComprasListaWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    d = {
      casosDeUso: () => c.casos,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
    lectura = {
      consultas: () => c.consultas,
      consultasDeIdentidad: () =>
        crearConsultasDeIdentidad({ transacciones: c.entorno, reglas: REGLAS_DE_EMPRESA }),
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async (e: EscenarioDeCompras) => ({
    deposito: await c.deposito({ empresa: e.empresa, sucursal: e.sucursal }),
    producto: (await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" })).producto,
    proveedor: await c.proveedor(e.operador),
  });
  /** 2 kg a 1000 el kilo: importe 2000.00. */
  const comprar = async (e: EscenarioDeCompras) => {
    const m = await armar(e);
    const r = valorDe(
      await c.casos.registrarCompra(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: m.proveedor,
        depositoId: m.deposito,
        renglones: [
          {
            productoId: m.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    return { ...m, recepcionId: r.recepcionId };
  };
  const pedido = (recepcionId: string, cambios: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    recepcionId,
    linea: 1,
    correccionesVistas: 0,
    precio: "1200.00",
    motivo: "El proveedor subió el precio",
    ...cambios,
  });
  const ficha = async (e: EscenarioDeCompras, recepcionId: string) => {
    const r = await fichaDeLaCompra(lectura, e.gerente, recepcionId);
    if (!r.ok) throw new Error(`la ficha tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const correcciones = (e: EscenarioDeCompras) =>
    c.contar("select count(*) as n from correccion_de_compra where empresa_id = $1", [e.empresa]);
  const auditorias = async (e: EscenarioDeCompras, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const espejos = (m: { deposito: string }) =>
    c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [m.deposito]);

  it("el gerente corrige el precio: la ficha muestra el importe nuevo, la corrección con el correo, el «Antes» y el motivo, y queda una auditoría", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    const r = await corregirLaCompra(d, e.gerente, pedido(m.recepcionId));
    expect(r).toMatchObject({ ok: true, dato: { linea: 1, numero: 1, yaExistia: false } });
    const f = await ficha(e, m.recepcionId);
    expect(f.lineas[0]?.importe).toEqual({ moneda: "ARS", monto: "2400.00" });
    expect(f.total).toEqual({ moneda: "ARS", monto: "2400.00" });
    expect(f.lineas[0]?.correccionesVistas).toBe(1);
    expect(f.lineas[0]?.correcciones).toMatchObject([
      {
        numero: 1,
        precioAnterior: { moneda: "ARS", monto: "1000.000000" },
        precioNuevo: { moneda: "ARS", monto: "1200.000000" },
        motivo: "El proveedor subió el precio",
      },
    ]);
    expect(typeof f.lineas[0]?.correcciones[0]?.hechaPor).toBe("string");
    expect(await auditorias(e, "COMPRA_CORREGIDA")).toBe(1);
  });

  it("IDEMPOTENCIA: el mismo envío dos veces a la vez (doble toque) deja UNA corrección y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await c.escenario();
      const m = await comprar(e);
      const unico = pedido(m.recepcionId);
      const [a, b] = await Promise.all([
        corregirLaCompra(d, e.gerente, unico),
        corregirLaCompra(d, e.gerente, unico),
      ]);
      expect(a.ok && b.ok).toBe(true);
      // Un tercer envío tardío (reintento por red cortada) repite sin escribir.
      expect(await corregirLaCompra(d, e.gerente, unico)).toMatchObject({
        ok: true,
        dato: { yaExistia: true },
      });
      expect(await correcciones(e)).toBe(1);
      expect(await auditorias(e, "COMPRA_CORREGIDA")).toBe(1);
    }
  });

  it("CONCURRENCIA: dos pestañas corrigen la misma línea a la vez: una gana y la otra recibe el genérico, sin escribir", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await c.escenario();
      const m = await comprar(e);
      const [a, b] = await Promise.all([
        corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { precio: "1100.00" })),
        corregirLaCompra(d, e.administrador, pedido(m.recepcionId, { precio: "1300.00" })),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      esGenerico(a.ok ? b : a);
      expect(await correcciones(e)).toBe(1);
      expect(await auditorias(e, "COMPRA_CORREGIDA")).toBe(1);
      // La pantalla recarga la ficha y ve la corrección que ya está, con la versión nueva para la próxima.
      expect((await ficha(e, m.recepcionId)).lineas[0]?.correccionesVistas).toBe(1);
    }
  });

  it("una segunda corrección con la versión que vio (1) sí se hace; con la vieja (0), el genérico", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    expect(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId))).toMatchObject({ ok: true });
    esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { precio: "1250.00" })));
    expect(
      await corregirLaCompra(
        d,
        e.gerente,
        pedido(m.recepcionId, { precio: "1250.00", correccionesVistas: 1 }),
      ),
    ).toMatchObject({ ok: true, dato: { numero: 2 } });
    expect(await correcciones(e)).toBe(2);
  });

  it("«sin cambios», un precio inválido, un motivo vacío o una línea inexistente son el genérico (o el texto aprobado del precio) y no escriben", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { precio: "1000.00" })));
    expect(
      await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { precio: "0" })),
    ).toMatchObject({ ok: false, error: { codigo: "COMPRAS_PRECIO_INVALIDO" } });
    esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { motivo: "   " })));
    esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, { linea: 9 })));
    expect(await correcciones(e)).toBe(0);
    expect(await auditorias(e, "COMPRA_CORREGIDA")).toBe(0);
  });

  it("un pedido con campos de más (cantidad, peso real, empresa) o sin los pedidos no llega al servidor: el genérico, sin escribir", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    for (const extra of [
      { cantidad: "5" },
      { pesoReal: "3" },
      { empresaId: nuevoId() },
      { sucursalId: e.sucursal },
    ]) {
      esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId, extra)));
    }
    esGenerico(await corregirLaCompra(d, e.gerente, { recepcionId: m.recepcionId }));
    esGenerico(await corregirLaCompra(d, e.gerente, pedido("no-es-un-id")));
    expect(await correcciones(e)).toBe(0);
  });

  it("quien opera llamando directo es rechazado (el permiso lo decide el servidor) y no se escribe nada", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    expect((await corregirLaCompra(d, e.operador, pedido(m.recepcionId))).ok).toBe(false);
    expect(
      (await anularLaCompra(d, e.operador, { recepcionId: m.recepcionId, motivo: "Quiero" }))
        .respuesta.ok,
    ).toBe(false);
    expect(await correcciones(e)).toBe(0);
    expect((await ficha(e, m.recepcionId)).estado).toBe("RECIBIDA_SIN_FACTURAR");
  });

  it("aislamiento: corregir o anular una compra de otra empresa es el genérico y no escribe", async () => {
    const una = await c.escenario();
    const otra = await c.escenario();
    const m = await comprar(una);
    esGenerico(await corregirLaCompra(d, otra.gerente, pedido(m.recepcionId)));
    const anulacion = await anularLaCompra(d, otra.gerente, {
      recepcionId: m.recepcionId,
      motivo: "No es mía",
    });
    esGenerico(anulacion.respuesta);
    expect(anulacion.consumida).toBe(false);
    expect(await correcciones(una)).toBe(0);
    expect((await ficha(una, m.recepcionId)).estado).toBe("RECIBIDA_SIN_FACTURAR");
  });

  it("anular: queda anulada con el motivo, quién y cuándo; anular otra vez es el genérico y NO repite el espejo de stock ni la auditoría", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    const antes = await espejos(m);
    const r = await anularLaCompra(d, e.gerente, {
      recepcionId: m.recepcionId,
      motivo: "Se cargó mal",
    });
    expect(r).toMatchObject({ respuesta: { ok: true, dato: { anulada: true } }, consumida: false });
    const f = await ficha(e, m.recepcionId);
    expect(f.estado).toBe("ANULADA");
    expect(f.anulacion).toMatchObject({ motivo: "Se cargó mal" });
    expect(typeof f.anulacion?.hechaPor).toBe("string");
    const despues = await espejos(m);
    expect(despues).toBe(antes + 1);
    const otra = await anularLaCompra(d, e.administrador, {
      recepcionId: m.recepcionId,
      motivo: "Otra vez",
    });
    esGenerico(otra.respuesta);
    expect(await espejos(m)).toBe(despues);
    expect(await auditorias(e, "COMPRA_ANULADA")).toBe(1);
  });

  it("IDEMPOTENCIA Y CONCURRENCIA: dos anulaciones a la vez dejan UNA anulación, UN espejo de stock y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await c.escenario();
      const m = await comprar(e);
      const antes = await espejos(m);
      c.armarBarrera(2);
      try {
        const [a, b] = await Promise.all([
          anularLaCompra(d, e.gerente, { recepcionId: m.recepcionId, motivo: "Una" }),
          anularLaCompra(d, e.administrador, { recepcionId: m.recepcionId, motivo: "Otra" }),
        ]);
        expect([a.respuesta.ok, b.respuesta.ok].filter(Boolean)).toHaveLength(1);
        esGenerico(a.respuesta.ok ? b.respuesta : a.respuesta);
      } finally {
        c.soltarBarrera();
      }
      expect(await espejos(m)).toBe(antes + 1);
      expect(await auditorias(e, "COMPRA_ANULADA")).toBe(1);
    }
  });

  it("anular una compra ya consumida: el genérico, se avisa (`consumida`) para ofrecer «Corregir», y no cambia nada", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    valorDe(
      await c.stockCasos.registrarSalida(e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "MERMA",
        detalle: "se tiró",
        renglones: [{ productoId: m.producto, cantidad: "1500", unidadId: "GRAMO" }],
      }),
    );
    const antes = await espejos(m);
    const r = await anularLaCompra(d, e.gerente, { recepcionId: m.recepcionId, motivo: "Quiero" });
    esGenerico(r.respuesta);
    expect(r.consumida).toBe(true);
    expect(await espejos(m)).toBe(antes);
    expect((await ficha(e, m.recepcionId)).estado).toBe("RECIBIDA_SIN_FACTURAR");
    expect(await auditorias(e, "COMPRA_ANULADA")).toBe(0);
  });

  it("una compra anulada no se corrige", async () => {
    const e = await c.escenario();
    const m = await comprar(e);
    expect(
      (await anularLaCompra(d, e.gerente, { recepcionId: m.recepcionId, motivo: "Se cargó mal" }))
        .respuesta.ok,
    ).toBe(true);
    esGenerico(await corregirLaCompra(d, e.gerente, pedido(m.recepcionId)));
    expect(await correcciones(e)).toBe(0);
  });
});
