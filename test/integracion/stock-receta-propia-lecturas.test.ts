import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  guardarLaReceta,
  listarLasRecetas,
  listarLasVersionesDeLaReceta,
  verLaFichaDeCocina,
  verLaReceta,
  type DependenciasDeRecetasWeb,
} from "../../src/composicion/recetas-web";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import {
  crearCasosDeUsoDeStock,
  crearConsultasDeStock,
  type CasosDeUsoDeStock,
  type TxDeStock,
} from "../../src/modulos/stock/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { productoDeBase } from "./catalogo-apoyo";
import type { TxDePrueba } from "./entorno";
import { articuloDeBase, depositoDeBase, existenciaDe } from "./stock-apoyo";
import {
  montarVentas,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Receta propia por sucursal, T2: las lecturas de hoy (lista, ficha, versiones, ficha de cocina, guardar, la explosión de la venta y los ciclos) siguen siendo de la receta de la CENTRAL aunque en la base
 * haya recetas propias de la sucursal. Las propias se insertan con SQL del dueño de la base: ningún camino de la aplicación puede escribirlas todavía (la migración no da permiso sobre las columnas nuevas).
 * Previene: la primera propia con un número más alto se leería como «la vigente de la empresa» y filtraría a toda la empresa.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 600_000 });

const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;

describe.skipIf(base === null)("las lecturas de recetas ignoran las recetas propias (T2)", () => {
  let m: MundoDeVentas;
  let stock: CasosDeUsoDeStock;
  let recetas: DependenciasDeRecetasWeb;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, {
      stock: true,
      produccion: true,
      conexiones: 8,
      ajustarTx: (tx: TxDePrueba): TxDePrueba => ({
        ...tx,
        derechos: {
          ...tx.derechos,
          deLaEmpresa: async (contexto) => {
            const reales = await tx.derechos.deLaEmpresa(contexto);
            return {
              ...reales,
              perillas: new Map(
                [...reales.perillas].map(([perilla, valor]) => [
                  perilla,
                  (perilla === "produccion" || perilla === "subcomposiciones") &&
                  valor.tipo === "INTERRUPTOR"
                    ? { ...valor, encendida: true }
                    : valor,
                ]),
              ),
            };
          },
        },
      }),
    });
    const transacciones = m.entorno as unknown as Transacciones<TxDeStock>;
    stock = crearCasosDeUsoDeStock({ transacciones, reglas: m.reglas });
    recetas = {
      casosDeUso: () => stock,
      consultas: () => crearConsultasDeStock({ transacciones, reglas: m.reglas }),
      personas: () => crearConsultasDeIdentidad({ transacciones: m.entorno, reglas: m.reglas }),
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  /** Una empresa con un plato de receta central (0,1 kg de harina por plato) y, en su sucursal, DOS versiones propias que llevarían queso. */
  const escenario = async () => {
    const e: EscenarioDeVentas = await m.escenario();
    const dep = await depositoDeBase(m.dueno, e, { deVenta: true });
    const entrada = async (articulo: string) =>
      valorDe(
        await stock.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [{ productoId: articulo, cantidad: "10", unidadId: "KILOGRAMO" }],
        }),
      );
    const harina = await articuloDeBase(m.dueno, e, { clase: "MATERIA_PRIMA", ...kilos });
    const queso = await articuloDeBase(m.dueno, e, { clase: "MATERIA_PRIMA", ...kilos });
    await entrada(harina.producto);
    await entrada(queso.producto);
    const plato = await productoDeBase(m.dueno, e.empresa, { clase: "VENDIBLE" });
    await m.precio({
      empresa: e.empresa,
      producto: plato,
      precio: "1000",
      desde: "2026-01-01T00:00:00Z",
    });
    const central = await guardarLaReceta(recetas, e.gerente, {
      productoId: plato,
      versionEsperada: 0,
      rinde: "1",
      pasos: "",
      lineas: [{ ingredienteId: harina.producto, bruto: "0.1", merma: "" }],
      unidades: { [harina.producto]: "KILOGRAMO" },
    });
    expect(central).toMatchObject({ ok: true, dato: { version: 1 } });
    // Las propias, a mano (dueño de la base): v1 y v2 de la sucursal, nacidas de la central 1, con queso.
    for (const numero of [1, 2]) {
      await m.dueno.query("begin");
      const { rows } = await m.dueno.query<{ id: string }>(
        `insert into composicion (empresa_id, producto_id, numero, rinde, creada_por, creada_en, sucursal_id, origen_numero)
         values ($1, $2, $3, 1, $4, now(), $5, 1) returning id`,
        [e.empresa, plato, numero, e.gerente.personaId, e.sucursal],
      );
      await m.dueno.query(
        `insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension)
         values ($1, $2, 1, $3, 0.5, 'KILOGRAMO', 'MASA')`,
        [e.empresa, rows[0]?.id, queso.articulo],
      );
      await m.dueno.query("commit");
    }
    return { e, dep, harina, queso, plato };
  };
  const existencia = (dep: string, articulo: string) => existenciaDe(m.dueno, dep, articulo);

  it("la lista, la ficha, las versiones y la ficha de cocina muestran la central (versión 1), no la propia (versión 2)", async () => {
    const { e, plato, harina } = await escenario();
    const lista = await listarLasRecetas(recetas, e.gerente, {
      texto: "",
      conReceta: "con",
      activo: "",
      despues: "",
    });
    expect(lista.ok && lista.dato.recetas.find((r) => r.productoId === plato)).toMatchObject({
      version: 1,
    });
    const ficha = await verLaReceta(recetas, e.gerente, { productoId: plato });
    expect(ficha).toMatchObject({ ok: true, dato: { ultimaVersion: 1 } });
    const versiones = await listarLasVersionesDeLaReceta(recetas, e.gerente, plato);
    expect(versiones.ok && versiones.dato.map((v) => v.version)).toEqual([1]);
    const cocina = await verLaFichaDeCocina(recetas, e.gerente, plato);
    expect(JSON.stringify(cocina)).toContain(harina.producto);
    expect(JSON.stringify(cocina)).not.toContain("queso");
  });

  it("guardar la central compara con la central: la versión esperada 1 crea la versión 2 central (no choca con las propias) y las propias no cambian", async () => {
    const { e, plato, harina, queso } = await escenario();
    const guardada = await guardarLaReceta(recetas, e.gerente, {
      productoId: plato,
      versionEsperada: 1,
      rinde: "2",
      pasos: "",
      lineas: [{ ingredienteId: harina.producto, bruto: "0.1", merma: "" }],
      unidades: { [harina.producto]: "KILOGRAMO" },
    });
    expect(guardada).toMatchObject({ ok: true, dato: { version: 2, yaExistia: false } });
    const filas = await m.filas<{ sucursal_id: string | null; numero: number }>(
      "select sucursal_id, numero from composicion where producto_id = $1 order by sucursal_id nulls first, numero",
      [plato],
    );
    expect(filas.map((f) => [f.sucursal_id === null ? "central" : "propia", f.numero])).toEqual([
      ["central", 1],
      ["central", 2],
      ["propia", 1],
      ["propia", 2],
    ]);
    expect(queso.articulo).not.toBe(harina.articulo);
  });

  it("la venta en la sucursal con propias descuenta la receta de la CENTRAL (harina) y no la propia (queso); se anuló nada y la línea explica de qué versión salió", async () => {
    const { e, dep, harina, queso, plato } = await escenario();
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: plato,
        opcionIds: [],
        cantidad: "3",
      }),
    );
    valorDe(await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }));
    expect(await existencia(dep, harina.articulo)).toBe("9.7000");
    expect(await existencia(dep, queso.articulo)).toBe("10.0000");
    const sellada = await m.filas<{ sucursal_id: string | null; numero: number }>(
      `select c.sucursal_id, c.numero from renglon_de_movimiento r join composicion c on c.id = r.composicion_id and c.empresa_id = r.empresa_id
        where r.empresa_id = $1 and r.articulo_id = (select id from articulo_de_stock where producto_id = $2 and empresa_id = $1)`,
      [e.empresa, harina.producto],
    );
    expect(sellada.filter((f) => f.sucursal_id === null && f.numero === 1)).toHaveLength(1);
  });

  it("una receta propia de otra empresa tampoco se mezcla: la lista de una empresa no ve las propias de otra", async () => {
    const a = await escenario();
    const b = await escenario();
    const lista = await listarLasRecetas(recetas, b.e.gerente, {
      texto: "",
      conReceta: "con",
      activo: "",
      despues: "",
    });
    expect(lista.ok && lista.dato.recetas.map((r) => r.productoId)).not.toContain(a.plato);
    expect(lista.ok && lista.dato.recetas.find((r) => r.productoId === b.plato)).toMatchObject({
      version: 1,
    });
  });
});
