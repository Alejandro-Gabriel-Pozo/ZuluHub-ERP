import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  guardarElConsumoDeUnGrupo,
  verElConsumoDeUnGrupo,
  type DependenciasDeConsumoWeb,
} from "../../src/composicion/consumo-web";
import {
  grupoDeBase,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  opcionDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Lo que consume cada opción de la web (`consumo-web.ts`, A13 tramo Consumo) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe (una versión NUEVA de la opción
 * por cada cambio) y qué se audita; que repetir no duplica; dos pestañas (la de la versión vieja no escribe) y dos guardados a la vez; los insumos admitidos (también un elaborado) y los que no;
 * la escala con la medida; el aislamiento entre empresas, el permiso y el módulo en desarrollo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("consumo de las opciones de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let d: DependenciasDeConsumoWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    cerrado = await montarCatalogo(base, {
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
    });
    e = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const producto = (
    clase: string,
    x: EscenarioDeCatalogo = e,
    extra: Record<string, unknown> = {},
  ) =>
    productoDeBase(c.dueno, x.empresa, {
      nombre: nombreAlAzarDeProducto(),
      clase,
      ...extra,
    } as never);
  /** Un producto vendible con un grupo «Carne» de dos opciones y, si `conMedida`, una variante que es la medida. */
  const conGrupo = async (conMedida = false, x: EscenarioDeCatalogo = e) => {
    const p = await producto("VENDIBLE", x);
    const grupo = await grupoDeBase(c.dueno, x.empresa, p, {
      clase: "INCLUIDA",
      nombre: "Carne",
      orden: 1,
    });
    const pollo = (await opcionDeBase(c.dueno, x.empresa, p, grupo, { nombre: "Pollo" })).opcion;
    const carne = (await opcionDeBase(c.dueno, x.empresa, p, grupo, { nombre: "Carne" })).opcion;
    await c.dueno.query("update opcion set orden = 1 where id = $1", [pollo]);
    await c.dueno.query("update opcion set orden = 2 where id = $1", [carne]);
    if (conMedida)
      await grupoDeBase(c.dueno, x.empresa, p, {
        clase: "VARIANTE",
        esTamano: true,
        nombre: "Medida",
        orden: 0,
      });
    return { p, grupo, pollo, carne };
  };
  const ver = async (p: string, grupo: string, contexto = e.gerente) => {
    const r = await verElConsumoDeUnGrupo(d, contexto, p, grupo);
    if (!r.ok) throw new Error(`se esperaba el consumo y vino ${r.error.codigo}`);
    return r.dato;
  };
  type Vista = Awaited<ReturnType<typeof ver>>;
  type Lineas = readonly { insumoId: string; cantidad: string; escalaConTamano?: boolean }[];
  const guardar = (
    p: string,
    grupo: string,
    vista: Pick<Vista, "versionDeOpciones" | "opciones">,
    consumo: readonly Lineas[],
    contexto = e.gerente,
  ) =>
    guardarElConsumoDeUnGrupo(d, contexto, {
      productoId: p,
      grupoId: grupo,
      versionDeOpciones: vista.versionDeOpciones,
      opciones: vista.opciones.map((o, i) => ({
        opcionId: o.id,
        lineas: (consumo[i] ?? []).map((l) => ({ escalaConTamano: false, ...l })),
      })),
    });
  const codigoDe = (r: Awaited<ReturnType<typeof guardar>>) => (r.ok ? "OK" : r.error.codigo);
  const versiones = (p: string) =>
    c.filas(
      "select v.nombre, v.numero, (select count(*) from consumo_de_opcion k where k.version_de_opcion_id = v.id)::int as lineas from opcion o join version_de_opcion v on v.opcion_id = o.id where o.producto_id = $1 order by v.nombre, v.numero",
      [p],
    );
  const auditorias = (p: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad = 'producto' and accion = 'CONSUMO_DE_OPCIONES_GUARDADO' and entidad_id = $1",
      [p],
    );

  it("sin consumo cargado: las opciones activas en su orden y los insumos que se ofrecen (con el símbolo de su unidad), sin la variante", async () => {
    const { p, grupo, pollo, carne } = await conGrupo();
    const insumo = await producto("MATERIA_PRIMA");
    const v = await ver(p, grupo);
    expect(v).toMatchObject({
      id: p,
      grupo: { id: grupo, nombre: "Carne" },
      tieneMedida: false,
      opciones: [
        { id: pollo, nombre: "Pollo", lineas: [] },
        { id: carne, nombre: "Carne", lineas: [] },
      ],
    });
    expect(v.insumos).toContainEqual({
      id: insumo,
      nombre: expect.any(String) as string,
      unidad: "u",
    });
    expect(JSON.stringify(v)).not.toContain(e.personaDelGerente);
  });

  it("guardar sella una versión NUEVA de la opción cambiada (la otra no se toca), audita una vez y la pantalla ve lo guardado con la cantidad exacta", async () => {
    const { p, grupo } = await conGrupo();
    const pollo = await producto("MATERIA_PRIMA");
    const v0 = await ver(p, grupo);
    expect(await guardar(p, grupo, v0, [[{ insumoId: pollo, cantidad: "150.5" }], []])).toEqual({
      ok: true,
      dato: { productoId: p },
    });
    expect(await versiones(p)).toEqual(
      [
        { nombre: "Carne", numero: 1, lineas: 0 },
        { nombre: "Pollo", numero: 2, lineas: 1 },
        { nombre: "Pollo", numero: 1, lineas: 0 },
      ].sort((a, b) => a.nombre.localeCompare(b.nombre) || a.numero - b.numero),
    );
    const v1 = await ver(p, grupo);
    expect(v1.versionDeOpciones).toBe(v0.versionDeOpciones + 1);
    expect(v1.opciones[0]?.lineas).toEqual([
      { insumoId: pollo, cantidad: "150.5000", escalaConTamano: false },
    ]);
    expect(await auditorias(p)).toBe(1);
  });

  it("es el conjunto FINAL: cambiar la cantidad, agregar otro insumo y quitar uno; lo que ya se sello no cambia (la versión anterior conserva su consumo)", async () => {
    const { p, grupo } = await conGrupo();
    const a = await producto("MATERIA_PRIMA");
    const b = await producto("INSUMO");
    const v0 = await ver(p, grupo);
    expect(
      await guardar(p, grupo, v0, [
        [
          { insumoId: a, cantidad: "100" },
          { insumoId: b, cantidad: "2" },
        ],
      ]),
    ).toMatchObject({ ok: true });
    const v1 = await ver(p, grupo);
    expect(await guardar(p, grupo, v1, [[{ insumoId: a, cantidad: "120" }]])).toMatchObject({
      ok: true,
    });
    const v2 = await ver(p, grupo);
    expect(v2.opciones[0]?.lineas).toEqual([
      { insumoId: a, cantidad: "120.0000", escalaConTamano: false },
    ]);
    expect(
      (await versiones(p))
        .filter((f) => f["nombre"] === "Pollo")
        .map((f) => [f["numero"], f["lineas"]]),
    ).toEqual([
      [1, 0],
      [2, 2],
      [3, 1],
    ]);
    expect(await guardar(p, grupo, v2, [[]])).toMatchObject({ ok: true });
    expect((await ver(p, grupo)).opciones[0]?.lineas).toEqual([]);
  });

  it("una opción puede consumir un ELABORADO (el stock propio del elaborado), y también una reventa", async () => {
    const { p, grupo } = await conGrupo();
    const elaborado = await producto("ELABORADO");
    const reventa = await producto("REVENTA");
    const v0 = await ver(p, grupo);
    expect(v0.insumos.map((i) => i.id)).toEqual(expect.arrayContaining([elaborado, reventa]));
    expect(
      await guardar(p, grupo, v0, [
        [
          { insumoId: elaborado, cantidad: "1" },
          { insumoId: reventa, cantidad: "1" },
        ],
      ]),
    ).toMatchObject({ ok: true });
  });

  it("guardar el mismo consumo (doble toque, reintento tras un éxito) no escribe, no audita y no sube la versión", async () => {
    const { p, grupo } = await conGrupo();
    const a = await producto("MATERIA_PRIMA");
    const v0 = await ver(p, grupo);
    for (let i = 0; i < 3; i += 1) {
      expect(await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "10" }]])).toMatchObject({
        ok: true,
      });
    }
    expect((await versiones(p)).filter((f) => f["nombre"] === "Pollo")).toHaveLength(2);
    expect(await auditorias(p)).toBe(1);
    expect((await ver(p, grupo)).versionDeOpciones).toBe(v0.versionDeOpciones + 1);
  });

  it("dos pestañas: la que guarda después con la versión vieja y otro consumo sale como el genérico y no escribe", async () => {
    const { p, grupo } = await conGrupo();
    const a = await producto("MATERIA_PRIMA");
    const v0 = await ver(p, grupo);
    expect(await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "10" }]])).toMatchObject({
      ok: true,
    });
    expect(await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "99" }]])).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect((await ver(p, grupo)).opciones[0]?.lineas[0]?.cantidad).toBe("10.0000");
    expect(
      await guardar(p, grupo, await ver(p, grupo), [[{ insumoId: a, cantidad: "99" }]]),
    ).toMatchObject({ ok: true });
  });

  it("dos guardados distintos a la vez sobre la misma versión (5 rondas): uno gana y el otro sale como el genérico; el mismo guardado dos veces a la vez: los dos bien, una sola escritura", async () => {
    for (let ronda = 0; ronda < 5; ronda += 1) {
      const { p, grupo } = await conGrupo();
      const a = await producto("MATERIA_PRIMA");
      const v0 = await ver(p, grupo);
      const [x, y] = await Promise.all([
        guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "1" }]]),
        guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "2" }]]),
      ]);
      expect([codigoDe(x), codigoDe(y)].sort()).toEqual([GENERICO, "OK"]);
      expect(await auditorias(p)).toBe(1);
      const q = await conGrupo();
      const w0 = await ver(q.p, q.grupo);
      const [m, n] = await Promise.all([
        guardar(q.p, q.grupo, w0, [[{ insumoId: a, cantidad: "3" }]]),
        guardar(q.p, q.grupo, w0, [[{ insumoId: a, cantidad: "3" }]]),
      ]);
      expect([codigoDe(m), codigoDe(n)]).toEqual(["OK", "OK"]);
      expect(await auditorias(q.p)).toBe(1);
    }
  });

  it("«Ese insumo ya está cargado» y «La cantidad tiene que ser mayor que cero» salen con su texto y su campo; ningún otro error del consumo trae texto propio", async () => {
    const { p, grupo } = await conGrupo();
    const a = await producto("MATERIA_PRIMA");
    const v0 = await ver(p, grupo);
    expect(
      await guardar(p, grupo, v0, [
        [
          { insumoId: a, cantidad: "1" },
          { insumoId: a, cantidad: "2" },
        ],
      ]),
    ).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_CONSUMO_REPETIDO", campo: "insumo" },
    });
    for (const mala of ["0", "", "abc", "-1", "1.23456"]) {
      expect(
        await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: mala }]]),
        `cantidad «${mala}»`,
      ).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_CANTIDAD_INVALIDA", campo: "cantidad" },
      });
    }
    const vendible = await producto("VENDIBLE");
    expect(codigoDe(await guardar(p, grupo, v0, [[{ insumoId: vendible, cantidad: "1" }]]))).toBe(
      GENERICO,
    );
    expect(codigoDe(await guardar(p, grupo, v0, [[{ insumoId: p, cantidad: "1" }]]))).toBe(
      GENERICO,
    );
    expect(codigoDe(await guardar(p, grupo, v0, [[{ insumoId: nuevoId(), cantidad: "1" }]]))).toBe(
      GENERICO,
    );
    expect(await auditorias(p)).toBe(0);
  });

  it("la escala con la medida solo si el producto tiene variante que es la medida; con ella se guarda y se ve", async () => {
    const sin = await conGrupo(false);
    const con = await conGrupo(true);
    const a = await producto("MATERIA_PRIMA");
    const vs = await ver(sin.p, sin.grupo);
    expect(vs.tieneMedida).toBe(false);
    expect(
      codigoDe(
        await guardar(sin.p, sin.grupo, vs, [
          [{ insumoId: a, cantidad: "1", escalaConTamano: true }],
        ]),
      ),
    ).toBe(GENERICO);
    const vc = await ver(con.p, con.grupo);
    expect(vc.tieneMedida).toBe(true);
    expect(
      await guardar(con.p, con.grupo, vc, [
        [{ insumoId: a, cantidad: "1", escalaConTamano: true }],
      ]),
    ).toMatchObject({ ok: true });
    expect((await ver(con.p, con.grupo)).opciones[0]?.lineas[0]?.escalaConTamano).toBe(true);
  });

  it("la variante, un grupo desactivado, uno de otro producto, uno que no existe, un id mal escrito, una clase que no se vende y un producto que no existe: el genérico; una opción ajena no se acepta", async () => {
    const { p, grupo, pollo } = await conGrupo(true);
    const variante = (
      await c.filas(
        "select id from grupo_de_elecciones where producto_id = $1 and clase = 'VARIANTE'",
        [p],
      )
    )[0]?.["id"] as string;
    const apagado = await grupoDeBase(c.dueno, e.empresa, p, { nombre: "Apagado", activo: false });
    const otro = await conGrupo();
    for (const g of [variante, apagado, otro.grupo, nuevoId(), "no-es-un-id"]) {
      expect(await verElConsumoDeUnGrupo(d, e.gerente, p, g)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
    }
    const insumo = await producto("INSUMO");
    expect(await verElConsumoDeUnGrupo(d, e.gerente, insumo, grupo)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await verElConsumoDeUnGrupo(d, e.gerente, nuevoId(), grupo)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    const v0 = await ver(p, grupo);
    const ajena = { ...v0, opciones: [{ id: otro.pollo, nombre: "x", lineas: [] }] };
    expect(codigoDe(await guardar(p, grupo, ajena, [[{ insumoId: insumo, cantidad: "1" }]]))).toBe(
      GENERICO,
    );
    expect(await versiones(otro.p)).toHaveLength(2);
    expect(pollo).toBeDefined();
  });

  it("aislamiento: una empresa no ve ni toca el consumo de otra, y no se distingue de un grupo que no existe; un insumo de otra empresa no se acepta", async () => {
    const otra = await c.escenario();
    const ajeno = await conGrupo(false, otra);
    const mio = await conGrupo();
    expect(await verElConsumoDeUnGrupo(d, e.gerente, ajeno.p, ajeno.grupo)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    const v = await ver(mio.p, mio.grupo);
    const insumoAjeno = await producto("MATERIA_PRIMA", otra);
    expect(
      codigoDe(await guardar(mio.p, mio.grupo, v, [[{ insumoId: insumoAjeno, cantidad: "1" }]])),
    ).toBe(GENERICO);
    expect(codigoDe(await guardar(ajeno.p, ajeno.grupo, v, [[]]))).toBe(GENERICO);
    expect((await ver(mio.p, mio.grupo)).insumos.map((i) => i.id)).not.toContain(insumoAjeno);
  });

  it("el permiso: el operador ve pero no guarda; el administrador de una sola sucursal no (alcance); el administrador sí", async () => {
    const { p, grupo } = await conGrupo();
    const a = await producto("MATERIA_PRIMA");
    const v0 = await ver(p, grupo);
    expect((await ver(p, grupo, e.operador)).nombre).toBeDefined();
    expect(
      await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "1" }]], e.operador),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "1" }]], e.administradorDeUnaSucursal),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await versiones(p)).toHaveLength(2);
    expect(
      codigoDe(await guardar(p, grupo, v0, [[{ insumoId: a, cantidad: "1" }]], e.administrador)),
    ).toBe("OK");
  });

  it("con el catálogo en desarrollo todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const p = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const g = await grupoDeBase(cerrado.dueno, x.empresa, p, { nombre: "Carne" });
    const dependencias: DependenciasDeConsumoWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const v = await verElConsumoDeUnGrupo(dependencias, contexto, p, g);
      expect(v).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      const s = await guardarElConsumoDeUnGrupo(dependencias, contexto, {
        productoId: p,
        grupoId: g,
        versionDeOpciones: 0,
        opciones: [],
      });
      expect(s).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify([v, s])).not.toContain("Cerrado");
    }
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const { p, grupo } = await conGrupo();
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    await ver(p, grupo);
    await ver(p, grupo, e.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
    expect(valorDe({ ok: true, valor: 1 })).toBe(1);
  });
});
