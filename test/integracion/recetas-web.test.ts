import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import {
  listarLasRecetas,
  listarLasVersionesDeLaReceta,
  ofrecerLosIngredientes,
  verLaFichaDeCocina,
  verLaReceta,
  verLaVistaPreviaDeLaReceta,
  type DependenciasDeRecetasWeb,
} from "../../src/composicion/recetas-web";
import { errorAPublico } from "../../src/composicion/a-respuesta";
import { traducirErrorDeReceta } from "../../src/composicion/errores-de-recetas";
import { productoDeBase } from "./catalogo-apoyo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * Las lecturas de la pantalla de Recetas de la web (`recetas-web.ts`, B1 a B5) y la tabla de errores de guardar (B9) contra una base real y los roles reales: lo que la pantalla recibe, que
 * una empresa no ve lo de otra, que el operador no ve costos, que las versiones salen con el correo de quien las guardó (nunca su id), que una entrada mala es una lista vacía y que leer no
 * escribe. Las consultas en sí tienen su prueba en `stock-recetas-pantalla.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;
const VACIA = { texto: "", conReceta: "", activo: "", despues: "" };

describe.skipIf(base === null)("recetas de la web: lecturas y errores", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  let registrados: string[];
  let d: DependenciasDeRecetasWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    c.encenderPerilla("composiciones_con_perdida");
    registrados = [];
    const identidad = crearConsultasDeIdentidad({ transacciones: c.entorno, reglas: c.reglas });
    d = {
      consultas: () => c.consultas,
      personas: () => identidad,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const materia = (x = e) => c.articulo(x, { clase: "MATERIA_PRIMA", ...kilos });
  const vendible = (x = e, nombre?: string) =>
    productoDeBase(c.dueno, x.empresa, {
      clase: "VENDIBLE",
      ...kilos,
      ...(nombre === undefined ? {} : { nombre }),
    });
  const guardar = async (
    quien: EscenarioDeStock["gerente"],
    productoId: string,
    ingrediente: string,
    versionEsperada: number,
    cantidad = "1",
  ) =>
    valorDe(
      await c.casos.guardarComposicion(quien, {
        productoId,
        versionEsperada,
        rinde: "1",
        componentes: [{ productoId: ingrediente, cantidad, unidadId: "KILOGRAMO" }],
      }),
    );
  const correoDe = async (persona: string) =>
    (await c.filas<{ email: string }>("select email from persona where id = $1", [persona]))[0]
      ?.email;
  const escrituras = async (x = e) =>
    JSON.stringify([
      await c.contar("select count(*) as n from composicion where empresa_id = $1", [x.empresa]),
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        x.empresa,
      ]),
    ]);
  const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: { codigo: string } }): T => {
    if (!r.ok) throw new Error(`se esperaba el dato y vino ${r.error.codigo}`);
    return r.dato;
  };

  it("las versiones salen con el correo de quien las guardó, no con su id, y con el costo solo para quien ve costos", async () => {
    const x = await c.escenario();
    const harina = await materia(x);
    const p = await vendible(x);
    const dep = await c.deposito(x, { deVenta: true });
    valorDe(
      await c.casos.registrarEntrada(x.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [
          {
            productoId: harina.producto,
            cantidad: "10",
            unidadId: "KILOGRAMO",
            costoUnitario: "20",
          },
        ],
      }),
    );
    await guardar(x.gerente, p, harina.producto, 0, "1");
    await guardar(x.administrador, p, harina.producto, 1, "2");
    const antes = await escrituras(x);

    const gerente = dato(await listarLasVersionesDeLaReceta(d, x.gerente, p));
    expect(gerente.map((v) => [v.version, v.creadaPorNombre, v.costoPorUnidad, v.moneda])).toEqual([
      [2, await correoDe(x.administrador.personaId as string), "40.000000", "ARS"],
      [1, await correoDe(x.gerente.personaId as string), "20.000000", "ARS"],
    ]);
    // Nada de más: ni el id de la persona ni ningún campo que la pantalla no use.
    for (const v of gerente) {
      expect(Object.keys(v).sort()).toEqual(
        [
          "costoPorUnidad",
          "creadaEn",
          "creadaPorNombre",
          "moneda",
          "pasos",
          "rinde",
          "version",
        ].sort(),
      );
    }
    expect(JSON.stringify(gerente)).not.toContain(x.administrador.personaId as string);

    const operador = dato(await listarLasVersionesDeLaReceta(d, x.operador, p));
    expect(operador.map((v) => v.version)).toEqual([2, 1]);
    for (const v of operador) {
      expect(Object.hasOwn(v, "costoPorUnidad")).toBe(false);
      expect(Object.hasOwn(v, "moneda")).toBe(false);
      expect(v.creadaPorNombre).not.toBeNull();
    }
    expect(await escrituras(x)).toBe(antes);
  });

  it("las versiones de un producto de otra empresa, inexistente o con id mal formado son una lista vacía", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const harina = await materia(a);
    const p = await vendible(a);
    await guardar(a.gerente, p, harina.producto, 0);
    for (const productoId of [p, nuevoId(), "no-es-un-uuid", ""]) {
      const r = productoId === p ? b : a;
      expect(dato(await listarLasVersionesDeLaReceta(d, r.gerente, productoId))).toEqual([]);
    }
  });

  it("la lista: páginas con la clave de la siguiente en forma de texto, sin repetir ni saltear", async () => {
    const x = await c.escenario();
    for (let i = 0; i < 51; i++) await vendible(x, `web ${String(i).padStart(3, "0")}`);
    const primera = dato(await listarLasRecetas(d, x.gerente, VACIA));
    expect(primera.recetas).toHaveLength(50);
    expect(typeof primera.siguiente).toBe("string");
    const segunda = dato(
      await listarLasRecetas(d, x.gerente, { ...VACIA, despues: primera.siguiente ?? "" }),
    );
    expect(segunda.recetas).toHaveLength(1);
    expect(segunda.siguiente).toBeNull();
  });

  it("la lista filtra con y sin receta y activos; una entrada mala es una página vacía", async () => {
    const x = await c.escenario();
    const harina = await materia(x);
    const con = await vendible(x, "Con receta web");
    const sin = await vendible(x, "Sin receta web");
    await guardar(x.gerente, con, harina.producto, 0);
    expect(
      dato(await listarLasRecetas(d, x.gerente, { ...VACIA, conReceta: "con" })).recetas.map(
        (r) => r.productoId,
      ),
    ).toEqual([con]);
    expect(
      dato(await listarLasRecetas(d, x.gerente, { ...VACIA, conReceta: "sin" })).recetas.map(
        (r) => r.productoId,
      ),
    ).toEqual([sin]);
    for (const mala of [
      { conReceta: "todas" },
      { activo: "tal vez" },
      { texto: "a\u0000b" },
      { despues: "mal" },
    ]) {
      expect(dato(await listarLasRecetas(d, x.gerente, { ...VACIA, ...mala }))).toEqual({
        recetas: [],
        siguiente: null,
      });
    }
  });

  it("la lista no muestra lo de otra empresa y el operador la ve sin costos", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    await vendible(a, "De A web");
    await vendible(b, "De B web");
    expect(dato(await listarLasRecetas(d, a.gerente, VACIA)).recetas.map((r) => r.nombre)).toEqual([
      "De A web",
    ]);
    const operador = dato(await listarLasRecetas(d, a.operador, VACIA));
    expect(Object.hasOwn(operador.recetas[0] ?? {}, "costoPorUnidad")).toBe(false);
  });

  it("la receta: ultimaVersion y ficha; un id que no es un uuid, de otra empresa o inexistente es null", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const harina = await materia(a);
    const p = await vendible(a);
    await guardar(a.gerente, p, harina.producto, 0);
    const r = dato(await verLaReceta(d, a.gerente, { productoId: p }));
    expect(r).toMatchObject({ ultimaVersion: 1, ficha: { version: 1, esLaVigente: true } });
    for (const [quien, productoId] of [
      [b, p],
      [a, nuevoId()],
      [a, "no-es-un-uuid"],
    ] as const) {
      expect(dato(await verLaReceta(d, quien.gerente, { productoId }))).toBeNull();
    }
  });

  it("los ingredientes y la vista previa salen por el camino común, y una entrada mala no filtra nada", async () => {
    const x = await c.escenario();
    const harina = await materia(x);
    const p = await vendible(x);
    const ofrecidos = dato(await ofrecerLosIngredientes(d, x.gerente, { texto: "", despues: "" }));
    expect(ofrecidos.ingredientes.map((i) => i.productoId)).toEqual([harina.producto]);
    expect(
      dato(await ofrecerLosIngredientes(d, x.gerente, { texto: "a\u0000", despues: "" })),
    ).toEqual({
      ingredientes: [],
      siguiente: null,
    });
    const antes = await escrituras(x);
    const vista = dato(
      await verLaVistaPreviaDeLaReceta(d, x.gerente, {
        productoId: p,
        rinde: "1",
        componentes: [
          { productoId: harina.producto, cantidad: "10", unidadId: "KILOGRAMO", perdida: "20" },
        ],
      }),
    );
    expect(vista?.componentes).toEqual([{ productoId: harina.producto, neto: "8.0000" }]);
    expect(
      dato(
        await verLaVistaPreviaDeLaReceta(d, x.gerente, {
          productoId: "x",
          rinde: "1",
          componentes: [],
        }),
      ),
    ).toBeNull();
    expect(await escrituras(x)).toBe(antes);
  });

  it("el módulo apagado sale como el motivo del guard, y un fallo de la base sale sin detalle y con referencia", async () => {
    c.apagarModulo("stock");
    try {
      const r = await listarLasRecetas(d, e.gerente, VACIA);
      expect(r).toMatchObject({ ok: false, error: { codigo: "MODULO_NO_ACTIVO" } });
    } finally {
      c.encenderModulos();
    }
    const roto: DependenciasDeRecetasWeb = {
      ...d,
      consultas: () => ({
        ...c.consultas,
        listarRecetas: () => Promise.reject(new Error("la base no responde: password=hunter2")),
      }),
    };
    const r = await listarLasRecetas(roto, e.gerente, VACIA);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(registrados.some((linea) => linea.includes("hunter2"))).toBe(true);
  });

  it("REC-A, la ficha: el gerente ve bruto, merma, neto y costos exactos; el operador, lo mismo sin costos y sin huecos; sin costo es null, nunca cero", async () => {
    const x = await c.escenario();
    c.encenderPerilla("composiciones_con_perdida");
    const harina = await materia(x);
    const sal = await materia(x);
    const p = await vendible(x);
    const dep = await c.deposito(x, { deVenta: true });
    // Solo la harina tiene costo (1 kg a $ 1.000): la sal queda sin costo.
    valorDe(
      await c.casos.registrarEntrada(x.gerente, {
        clave: nuevoId(),
        depositoId: dep,
        motivo: "COMPRA",
        renglones: [
          {
            productoId: harina.producto,
            cantidad: "10",
            unidadId: "KILOGRAMO",
            costoUnitario: "1000",
          },
        ],
      }),
    );
    valorDe(
      await c.casos.guardarComposicion(x.gerente, {
        productoId: p,
        versionEsperada: 0,
        rinde: "3",
        componentes: [
          { productoId: harina.producto, cantidad: "1", unidadId: "KILOGRAMO", perdida: "20" },
        ],
      }),
    );
    const antes = await escrituras(x);

    const gerente = dato(await verLaReceta(d, x.gerente, { productoId: p }));
    const ficha = gerente?.ficha;
    expect(ficha).toMatchObject({ version: 1, esLaVigente: true, rinde: "3.0000" });
    expect(ficha?.componentes[0]).toMatchObject({
      bruto: "1.0000",
      merma: "20.0000",
      neto: "0.8000",
      costo: "1000.000000",
    });
    // Un solo redondeo: $ 1.000 entre 3 unidades, 6 decimales exactos.
    expect(ficha?.costos).toMatchObject({
      moneda: "ARS",
      porUnidad: "333.333333",
      incompleto: false,
    });

    const operador = dato(await verLaReceta(d, x.operador, { productoId: p }));
    expect(operador?.ficha?.componentes[0]).toMatchObject({ bruto: "1.0000", merma: "20.0000" });
    expect(Object.hasOwn(operador?.ficha ?? {}, "costos")).toBe(false);
    expect(Object.hasOwn(operador?.ficha?.componentes[0] ?? {}, "costo")).toBe(false);
    expect(JSON.stringify(operador)).not.toMatch(/333|1000\.0/);

    // Una versión con un ingrediente sin costo: la línea es null y el total, incompleto; nunca cero.
    valorDe(
      await c.casos.guardarComposicion(x.gerente, {
        productoId: p,
        versionEsperada: 1,
        rinde: "3",
        componentes: [{ productoId: sal.producto, cantidad: "1", unidadId: "KILOGRAMO" }],
      }),
    );
    const sinCosto = dato(await verLaReceta(d, x.gerente, { productoId: p }));
    expect(sinCosto?.ficha?.componentes[0]?.costo).toBeNull();
    expect(sinCosto?.ficha?.costos?.incompleto).toBe(true);
    // El servidor manda 0 junto con `incompleto`: por eso la pantalla decide por `incompleto` y dice «Sin costo» (`modelo-de-receta.ts`), nunca el cero.
    expect(sinCosto?.ficha?.costos?.sinCosto).toEqual([sal.producto]);
    expect(await escrituras(x)).not.toBe(antes); // guardar la versión 2 sí escribió; leer no:
    const despues = await escrituras(x);
    dato(await verLaReceta(d, x.gerente, { productoId: p }));
    expect(await escrituras(x)).toBe(despues);
  });

  it("REC-A, la ficha de cocina: bruto y pasos sin costos ni precios, para los tres roles; de otra empresa, sin receta o mal formado es null; leer no escribe", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const harina = await materia(a);
    const conReceta = await vendible(a);
    const sinReceta = await vendible(a);
    valorDe(
      await c.casos.guardarComposicion(a.gerente, {
        productoId: conReceta,
        versionEsperada: 0,
        rinde: "10",
        pasos: "Amasar y hornear.",
        componentes: [{ productoId: harina.producto, cantidad: "2.5", unidadId: "KILOGRAMO" }],
      }),
    );
    const antes = await escrituras(a);
    for (const quien of [a.gerente, a.administrador, a.operador]) {
      const cocina = dato(await verLaFichaDeCocina(d, quien, conReceta));
      expect(cocina).toMatchObject({
        version: 1,
        rinde: "10.0000",
        pasos: "Amasar y hornear.",
        componentes: [{ productoId: harina.producto, cantidad: "2.5000", unidadId: "KILOGRAMO" }],
      });
      // Nada de costos ni precios, ni siquiera para quien los ve en la ficha de la receta.
      expect(JSON.stringify(cocina)).not.toMatch(/costo|precio|moneda/i);
    }
    for (const [quien, productoId] of [
      [b.gerente, conReceta],
      [a.gerente, sinReceta],
      [a.gerente, nuevoId()],
      [a.gerente, "no-es-un-uuid"],
    ] as const) {
      expect(dato(await verLaFichaDeCocina(d, quien, productoId))).toBeNull();
    }
    expect(await escrituras(a)).toBe(antes);
  });

  it("REC-A: con el módulo apagado la ficha y la cocina salen como el motivo del guard, sin dato alguno", async () => {
    const x = await c.escenario();
    const harina = await materia(x);
    const p = await vendible(x);
    await guardar(x.gerente, p, harina.producto, 0);
    c.apagarModulo("stock");
    try {
      for (const r of [
        await verLaReceta(d, x.gerente, { productoId: p }),
        await verLaFichaDeCocina(d, x.operador, p),
      ]) {
        expect(r).toMatchObject({ ok: false, error: { codigo: "MODULO_NO_ACTIVO" } });
      }
    } finally {
      c.encenderModulos();
    }
  });

  it("B9: lo que guardar rechaza sale como el genérico; el guard pasa sin cambios", async () => {
    const x = await c.escenario();
    const harina = await materia(x);
    const p = await vendible(x);
    const guardarCrudo = (
      productoId: string,
      version: number,
      extra: Record<string, unknown> = {},
    ) =>
      c.casos.guardarComposicion(x.gerente, {
        productoId,
        versionEsperada: version,
        rinde: "1",
        componentes: [
          { productoId: harina.producto, cantidad: "1", unidadId: "KILOGRAMO", ...extra },
        ],
      });
    const codigo = (r: Awaited<ReturnType<typeof guardarCrudo>>) =>
      r.ok ? "OK" : errorAPublico(traducirErrorDeReceta(r.error), d.respuesta).codigo;

    expect(codigo(await guardarCrudo(p, 0, { perdida: "100" }))).toBe("RECETA_ACCION_NO_PERMITIDA");
    expect(codigo(await guardarCrudo(p, 0, { perdida: "05" }))).toBe("RECETA_ACCION_NO_PERMITIDA");
    expect(codigo(await guardarCrudo(harina.producto, 0))).toBe("RECETA_ACCION_NO_PERMITIDA");
    expect(codigo(await guardarCrudo(p, 0))).toBe("OK");
    expect(codigo(await guardarCrudo(p, 0, { cantidad: "2" }))).toBe("RECETA_ACCION_NO_PERMITIDA");
    // La perilla del plan apagada (con forma de objeto) también.
    c.apagarPerillas();
    try {
      expect(codigo(await guardarCrudo(p, 1, { perdida: "10" }))).toBe(
        "RECETA_ACCION_NO_PERMITIDA",
      );
    } finally {
      c.encenderPerilla("composiciones_con_perdida");
    }
    c.apagarModulo("stock");
    try {
      expect(codigo(await guardarCrudo(p, 1))).toBe("MODULO_NO_ACTIVO");
    } finally {
      c.encenderModulos();
    }
  });
});
