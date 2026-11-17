import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { crearExistenciasDeCatalogo } from "../../src/composicion/existencias-de-catalogo";
import { disponibilidadDeBase } from "./carta-publica-apoyo";
import { sucursalDeBase } from "./stock-apoyo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Carta real T9: un producto OCULTO no recibe existencia (recepción de compra, transferencia entrante, ajuste positivo) ni se cuenta; las salidas y las
 * correcciones hacia cero siguen. Lo impide la base (disparadores de `0049`), así que la prueba mira el rechazo por la restricción, en el alcance de la
 * empresa y en el de un local, y el puerto real que le contesta al catálogo «¿tiene existencia o un conteo abierto con cargas?».
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: producto oculto (carta real T9)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const pedido = (producto: string, cantidad: string) => ({
    productoId: producto,
    cantidad,
    unidadId: "UNIDAD",
  });
  const entrar = (producto: string, dep: string, cantidad: string) =>
    c.casos.registrarEntrada(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "COMPRA",
      renglones: [pedido(producto, cantidad)],
    });
  const sacar = (producto: string, dep: string, cantidad: string) =>
    c.casos.registrarSalida(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      motivo: "MERMA",
      renglones: [pedido(producto, cantidad)],
    });
  const ajustar = (producto: string, dep: string, cantidad: string, sentido: "SUMA" | "RESTA") =>
    c.casos.ajustar(e.gerente, {
      clave: nuevoId(),
      depositoId: dep,
      detalle: "Ajuste de prueba",
      renglones: [{ ...pedido(producto, cantidad), sentido }],
    });
  const ocultar = (producto: string, sucursal: string | null = null) =>
    disponibilidadDeBase(c.dueno, e.empresa, producto, sucursal, true);
  const mostrar = (producto: string, sucursal: string | null = null) =>
    c.dueno.query(
      `update disponibilidad_de_producto set oculto = false
        where empresa_id = $1 and producto_id = $2 and sucursal_id is not distinct from $3`,
      [e.empresa, producto, sucursal],
    );
  const quedo = (r: { ok: boolean; error?: unknown }) => (r.ok ? "OK" : JSON.stringify(r.error));
  const puerto = crearExistenciasDeCatalogo();
  const preguntar = (
    producto: string,
    alcance: Parameters<typeof puerto.conExistencia>[3],
    que: "conExistencia" | "conConteoAbiertoConCargas" = "conExistencia",
  ) =>
    c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
      const r = await puerto[que](tx, e.gerente, producto, alcance);
      return { ok: true as const, valor: r };
    });

  it("oculto en toda la empresa: la entrada, la transferencia entrante y el ajuste positivo se rechazan; la existencia no cambia", async () => {
    const a = await c.articulo(e);
    const dep = await c.deposito(e);
    const otro = await c.deposito(e);
    valorDe(await entrar(a.producto, dep, "5"));
    await ocultar(a.producto);
    // Con existencia previa positiva, sumar más se rechaza.
    expect(quedo(await entrar(a.producto, dep, "1"))).toContain("PRODUCTO_OCULTO");
    expect(quedo(await ajustar(a.producto, dep, "1", "SUMA"))).toContain("PRODUCTO_OCULTO");
    expect(
      quedo(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: dep,
          destinoId: otro,
          renglones: [pedido(a.producto, "2")],
        }),
      ),
    ).toContain("PRODUCTO_OCULTO");
    expect(await c.existencia(dep, a.articulo)).toBe("5.0000");
    expect(await c.existencia(otro, a.articulo)).toBe("0");
  });

  it("las salidas y restar siguen: se puede dar de baja lo que queda de un producto oculto", async () => {
    const a = await c.articulo(e);
    const dep = await c.deposito(e);
    valorDe(await entrar(a.producto, dep, "5"));
    await ocultar(a.producto);
    valorDe(await sacar(a.producto, dep, "2"));
    valorDe(await ajustar(a.producto, dep, "1", "RESTA"));
    expect(await c.existencia(dep, a.articulo)).toBe("2.0000");
  });

  it("corregir una existencia negativa hacia cero se permite; pasarse de cero, no", async () => {
    const a = await c.articulo(e);
    const dep = await c.deposito(e);
    await c.fijarNivel(e.empresa, "PERMITIR");
    valorDe(await entrar(a.producto, dep, "1"));
    valorDe(await sacar(a.producto, dep, "3"));
    expect(await c.existencia(dep, a.articulo)).toBe("-2.0000");
    await ocultar(a.producto);
    valorDe(await ajustar(a.producto, dep, "2", "SUMA"));
    expect(await c.existencia(dep, a.articulo)).toBe("0.0000");
    expect(quedo(await ajustar(a.producto, dep, "1", "SUMA"))).toContain("PRODUCTO_OCULTO");
    expect(await c.existencia(dep, a.articulo)).toBe("0.0000");
  });

  it("oculto solo en un local: ese local rechaza, el otro sigue recibiendo; mostrarlo de nuevo reabre las entradas", async () => {
    const a = await c.articulo(e);
    const otraSucursal = await sucursalDeBase(c.dueno, e.empresa);
    const aqui = await c.deposito(e);
    const alla = await c.deposito({ ...e, sucursal: sucursalId(otraSucursal) });
    await ocultar(a.producto, e.sucursal);
    expect(quedo(await entrar(a.producto, aqui, "1"))).toContain("PRODUCTO_OCULTO");
    valorDe(await entrar(a.producto, alla, "1"));
    await mostrar(a.producto, e.sucursal);
    valorDe(await entrar(a.producto, aqui, "1"));
    expect(await c.existencia(aqui, a.articulo)).toBe("1.0000");
    expect(await c.existencia(alla, a.articulo)).toBe("1.0000");
  });

  it("un producto oculto no se cuenta; uno visible sí", async () => {
    const oculto = await c.articulo(e);
    const visible = await c.articulo(e);
    const dep = await c.deposito(e);
    const conteoId = valorDe(
      await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: dep }),
    ).conteoId;
    await ocultar(oculto.producto);
    const contar = (producto: string) =>
      c.casos.registrarConteo(e.gerente, {
        id: nuevoId(),
        conteoId,
        productoId: producto,
        cantidadContada: "3",
        unidadId: "UNIDAD",
      });
    expect(quedo(await contar(oculto.producto))).toContain("PRODUCTO_OCULTO");
    valorDe(await contar(visible.producto));
  });

  it("el puerto real: existencia distinta de cero (también negativa) por alcance, conteo abierto con cargas, y producto sin artículo", async () => {
    const a = await c.articulo(e);
    const otraSucursal = await sucursalDeBase(c.dueno, e.empresa);
    const aqui = await c.deposito(e);
    await c.fijarNivel(e.empresa, "PERMITIR");
    const empresa = { tipo: "EMPRESA" } as const;
    const local = { tipo: "SUCURSAL", sucursalId: sucursalId(e.sucursal) } as const;
    const ajeno = { tipo: "SUCURSAL", sucursalId: sucursalId(otraSucursal) } as const;
    expect(
      (await preguntar(a.producto, empresa)).ok && (await preguntar(a.producto, empresa)),
    ).toMatchObject({ valor: false });
    valorDe(await sacar(a.producto, aqui, "1")); // queda en -1
    expect(valorDe(await preguntar(a.producto, empresa))).toBe(true);
    expect(valorDe(await preguntar(a.producto, local))).toBe(true);
    expect(valorDe(await preguntar(a.producto, ajeno))).toBe(false);
    valorDe(await entrar(a.producto, aqui, "1")); // vuelve a 0
    expect(valorDe(await preguntar(a.producto, empresa))).toBe(false);

    const conteoId = valorDe(
      await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: aqui }),
    ).conteoId;
    expect(valorDe(await preguntar(a.producto, empresa, "conConteoAbiertoConCargas"))).toBe(false);
    valorDe(
      await c.casos.registrarConteo(e.gerente, {
        id: nuevoId(),
        conteoId,
        productoId: a.producto,
        cantidadContada: "1",
        unidadId: "UNIDAD",
      }),
    );
    expect(valorDe(await preguntar(a.producto, local, "conConteoAbiertoConCargas"))).toBe(true);
    expect(valorDe(await preguntar(a.producto, ajeno, "conConteoAbiertoConCargas"))).toBe(false);
    // Un producto de otro tipo, sin artículo de stock, no tiene existencia ni conteos.
    const sinArticulo = nuevoId();
    expect(valorDe(await preguntar(sinArticulo, empresa))).toBe(false);
    expect(valorDe(await preguntar(sinArticulo, empresa, "conConteoAbiertoConCargas"))).toBe(false);
  });

  it("ocultar y recibir a la vez: nunca queda un producto oculto con existencia nueva (una de las dos pierde)", async () => {
    for (let i = 0; i < 5; i++) {
      const a = await c.articulo(e);
      const dep = await c.deposito(e);
      const [oculto, entrada] = await Promise.allSettled([
        ocultar(a.producto),
        entrar(a.producto, dep, "1"),
      ]);
      expect(oculto.status).toBe("fulfilled");
      expect(entrada.status).toBe("fulfilled");
      const existencia = await c.existencia(dep, a.articulo);
      const oculto2 =
        (await c.contar(
          "select count(*) as n from disponibilidad_de_producto where empresa_id = $1 and producto_id = $2 and oculto",
          [e.empresa, a.producto],
        )) === 1;
      // El único estado inválido: oculto Y con existencia sumada después. Si entró la existencia, la entrada fue la primera.
      if (oculto2 && existencia !== "0") {
        expect((entrada as PromiseFulfilledResult<{ ok: boolean }>).value.ok).toBe(true);
      }
    }
  });
});
