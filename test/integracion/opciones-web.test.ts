import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  copiarLasOpcionesDeOtroProducto,
  guardarUnGrupoDeOpciones,
  verLasOpcionesDeUnProducto,
  verLasOpcionesParaCopiar,
  verUnGrupoDeOpciones,
  type DependenciasDeOpcionesWeb,
  type GrupoParaLaPantalla,
} from "../../src/composicion/opciones-web";
import { leerLasFilasDeOpciones } from "../../src/composicion/entradas-de-opciones";
import {
  grupoDeBase,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Las opciones de un producto de la web (`opciones-web.ts`, A13 tramo Opciones) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita, que
 * una empresa no toca los productos de otra, que el permiso y el módulo en desarrollo los decide el caso de uso, dos pestañas (la que llega con la versión vieja no escribe), dos
 * guardados a la vez (uno gana), el mismo guardado repetido (un solo grupo, una sola auditoría) y que nada se borra: quitar una opción la desactiva. Los casos de uso en sí tienen sus
 * pruebas en `catalogo-casos-de-uso.test.ts` y `catalogo-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("opciones de un producto de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let d: DependenciasDeOpcionesWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real con `catalogo` forzado a `en_desarrollo` (en el real es disponible, DEC-0463): el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: {
        catalogo: {
          ...CATALOGO_DE_MODULOS,
          catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "en_desarrollo" },
        },
        permisos: PERMISOS_DE_EMPRESA,
      },
    });
    e = await c.escenario();
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: () => undefined },
      nuevoId,
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const nuevoProducto = async (
    extra: Record<string, unknown> = {},
    x: EscenarioDeCatalogo = e,
  ): Promise<string> =>
    valorDe(
      await c.casos.crearProducto(x.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...extra,
      }),
    ).productoId;
  const opciones = async (id: string, contexto = e.gerente) => {
    const r = await verLasOpcionesDeUnProducto(d, contexto, id);
    if (!r.ok) throw new Error(`se esperaban las opciones y vino ${r.error.codigo}`);
    return r.dato;
  };
  const gruposDe = (id: string) =>
    c.filas(
      "select id, nombre, clase, es_obligatorio, admite_varias, se_muestra_en_carta, activo, orden from grupo_de_elecciones where producto_id = $1 order by orden, nombre",
      [id],
    );
  const opcionesDeBase = (id: string) =>
    c.filas(
      "select o.id, o.grupo_id, o.activa, o.orden, v.numero, v.nombre, v.recargo from opcion o join version_de_opcion v on v.opcion_id = o.id where o.producto_id = $1 order by o.grupo_id, o.orden, v.numero",
      [id],
    );
  const auditorias = (id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad = 'producto' and accion = 'OPCIONES_EDITADAS' and entidad_id = $1",
      [id],
    );
  type Vista = Awaited<ReturnType<typeof opciones>>;
  type Fila = Readonly<{ clave: string; id: string | null; nombre: string; recargo: string }>;
  const nuevas = (...filas: readonly [string, string][]): Fila[] =>
    filas.map(([nombre, recargo], i) => ({ clave: `n${String(i)}`, id: null, nombre, recargo }));
  const pedido = (
    id: string,
    vista: Pick<Vista, "versionDeOpciones" | "claveDelCambio">,
    resto: Partial<Record<string, unknown>> = {},
  ) => ({
    productoId: id,
    versionDeOpciones: vista.versionDeOpciones,
    claveDelCambio: vista.claveDelCambio,
    grupoId: null,
    nombre: "Agregados",
    clase: "ADICIONAL",
    esObligatorio: false,
    admiteVarias: true,
    seMuestraEnCarta: true,
    opciones: nuevas(["Queso extra", "500.00"], ["Huevo", "300.00"]),
    ...resto,
  });
  const guardar = (
    id: string,
    vista: Pick<Vista, "versionDeOpciones" | "claveDelCambio">,
    resto: Partial<Record<string, unknown>> = {},
    contexto = e.gerente,
  ) => guardarUnGrupoDeOpciones(d, contexto, pedido(id, vista, resto));
  const codigoDe = (r: Awaited<ReturnType<typeof guardar>>) => (r.ok ? "OK" : r.error.codigo);
  const grupoPorNombre = (v: Vista, nombre: string): GrupoParaLaPantalla => {
    const g = v.grupos.find((x) => x.nombre === nombre);
    if (g === undefined) throw new Error(`no hay un grupo ${nombre}`);
    return g;
  };

  it("un producto sin opciones: sin grupos, y una clave de cambio nueva en cada lectura", async () => {
    const id = await nuevoProducto({ nombre: "Milanesa" });
    const a = await opciones(id);
    const b = await opciones(id);
    expect(a).toMatchObject({ id, nombre: "Milanesa", versionDeOpciones: 0, grupos: [] });
    expect(a.claveDelCambio).not.toBe(b.claveDelCambio);
  });

  it("lo que sale es solo lo que la pantalla muestra: grupos activos, incluida o adicional, con sus opciones activas en orden; sin la variante ni lo desactivado", async () => {
    const id = await nuevoProducto();
    const incluida = await grupoDeBase(c.dueno, e.empresa, id, {
      clase: "INCLUIDA",
      nombre: "Guarnición",
      orden: 1,
      esObligatorio: true,
    });
    await opcionDeBase(c.dueno, e.empresa, id, incluida, { nombre: "Papas" });
    const adicional = await grupoDeBase(c.dueno, e.empresa, id, {
      clase: "ADICIONAL",
      nombre: "Extras",
      orden: 2,
      seMuestraEnCarta: false,
    });
    await opcionDeBase(c.dueno, e.empresa, id, adicional, { nombre: "Bacon" });
    await grupoDeBase(c.dueno, e.empresa, id, { clase: "VARIANTE", esTamano: true, orden: 0 });
    const apagado = await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Viejo", activo: false });
    await opcionDeBase(c.dueno, e.empresa, id, apagado, { nombre: "Nada" });
    const v = await opciones(id);
    expect(v.grupos).toEqual([
      {
        id: incluida,
        nombre: "Guarnición",
        clase: "INCLUIDA",
        esObligatorio: true,
        admiteVarias: false,
        seMuestraEnCarta: false,
        opciones: [{ id: expect.any(String) as string, nombre: "Papas", recargo: "0.000000" }],
      },
      {
        id: adicional,
        nombre: "Extras",
        clase: "ADICIONAL",
        esObligatorio: false,
        admiteVarias: false,
        seMuestraEnCarta: false,
        opciones: [{ id: expect.any(String) as string, nombre: "Bacon", recargo: "0.000000" }],
      },
    ]);
    expect(JSON.stringify(v)).not.toContain(e.personaDelGerente);
  });

  it("guardar un grupo nuevo lo agrega con sus opciones y recargos, audita una vez y sube la versión; la pantalla lo ve", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0)).toEqual({ ok: true, dato: { productoId: id } });
    const v1 = await opciones(id);
    expect(v1.versionDeOpciones).toBe(v0.versionDeOpciones + 1);
    expect(v1.grupos).toMatchObject([
      {
        id: v0.claveDelCambio,
        nombre: "Agregados",
        clase: "ADICIONAL",
        esObligatorio: false,
        admiteVarias: true,
        seMuestraEnCarta: true,
        opciones: [
          { nombre: "Queso extra", recargo: "500.000000" },
          { nombre: "Huevo", recargo: "300.000000" },
        ],
      },
    ]);
    expect(await auditorias(id)).toBe(1);
  });

  it("un grupo incluido nuevo (la casilla «Adicional» sin marcar) sin recargos", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    const r = await guardar(id, v0, {
      nombre: "Punto de la carne",
      clase: "INCLUIDA",
      esObligatorio: true,
      admiteVarias: false,
      seMuestraEnCarta: true,
      opciones: nuevas(["Jugoso", "0.00"], ["Cocido", "0.00"]),
    });
    expect(r.ok).toBe(true);
    expect(grupoPorNombre(await opciones(id), "Punto de la carne")).toMatchObject({
      clase: "INCLUIDA",
      esObligatorio: true,
    });
  });

  it("editar un grupo cambia lo pedido, versiona la opción cuyo recargo cambió y no toca las demás ni los otros grupos", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    const otro = await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Bebidas", orden: 9 });
    await opcionDeBase(c.dueno, e.empresa, id, otro, { nombre: "Soda", recargo: "100" });
    // El grupo agregado por la pantalla y uno cargado a mano (con la forma que deja la base).
    const v1 = await opciones(id);
    const antes = await opcionesDeBase(id);
    const g = grupoPorNombre(v1, "Agregados");
    const r = await guardar(id, v1, {
      grupoId: g.id,
      nombre: "Agregados del chef",
      esObligatorio: true,
      opciones: g.opciones.map((o, i) => ({
        clave: `e${String(i)}`,
        id: o.id,
        nombre: o.nombre,
        recargo: o.nombre === "Huevo" ? "350.00" : o.recargo,
      })),
    });
    expect(r).toMatchObject({ ok: true });
    const v2 = await opciones(id);
    expect(grupoPorNombre(v2, "Agregados del chef")).toMatchObject({
      esObligatorio: true,
      opciones: [
        { nombre: "Queso extra", recargo: "500.000000" },
        { nombre: "Huevo", recargo: "350.000000" },
      ],
    });
    const despues = await opcionesDeBase(id);
    // Una sola versión nueva: la de «Huevo». Lo demás (también el otro grupo) quedó como estaba.
    expect(despues.length).toBe(antes.length + 1);
    expect(despues.filter((f) => f["nombre"] === "Huevo").map((f) => f["numero"])).toEqual([1, 2]);
    expect(despues.filter((f) => f["nombre"] === "Soda")).toEqual(
      antes.filter((f) => f["nombre"] === "Soda"),
    );
    expect(grupoPorNombre(v2, "Bebidas").opciones).toMatchObject([{ nombre: "Soda" }]);
  });

  it("guardar un grupo sin cambiar nada no escribe, no audita y no sube la versión (aunque haya grupos cargados con otra forma)", async () => {
    const id = await nuevoProducto();
    const a = await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Salsas", orden: 1 });
    await opcionDeBase(c.dueno, e.empresa, id, a, { nombre: "Mayonesa", recargo: "50.5" });
    const b = await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Panes", orden: 2 });
    await opcionDeBase(c.dueno, e.empresa, id, b, { nombre: "Brioche", recargo: "120" });
    const v = await opciones(id);
    const g = grupoPorNombre(v, "Salsas");
    const antes = await opcionesDeBase(id);
    const r = await guardar(id, v, {
      grupoId: g.id,
      nombre: g.nombre,
      esObligatorio: g.esObligatorio,
      admiteVarias: g.admiteVarias,
      seMuestraEnCarta: g.seMuestraEnCarta,
      opciones: g.opciones.map((o, i) => ({
        clave: `e${String(i)}`,
        id: o.id,
        nombre: o.nombre,
        recargo: o.recargo,
      })),
    });
    expect(r).toMatchObject({ ok: true });
    expect(await opcionesDeBase(id)).toEqual(antes);
    expect(await auditorias(id)).toBe(0);
    expect((await opciones(id)).versionDeOpciones).toBe(v.versionDeOpciones);
  });

  it("quitar una opción la desactiva (nada se borra); agregar otra con el mismo nombre la reactiva en vez de chocar", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    const v1 = await opciones(id);
    const g = grupoPorNombre(v1, "Agregados");
    const huevo = g.opciones.find((o) => o.nombre === "Huevo");
    const queso = g.opciones.find((o) => o.nombre === "Queso extra");
    expect(huevo).toBeDefined();
    expect(queso).toBeDefined();
    expect(
      await guardar(id, v1, {
        grupoId: g.id,
        opciones: [{ clave: "e0", id: queso?.id ?? "", nombre: "Queso extra", recargo: "500.00" }],
      }),
    ).toMatchObject({ ok: true });
    const v2 = await opciones(id);
    expect(grupoPorNombre(v2, "Agregados").opciones.map((o) => o.nombre)).toEqual(["Queso extra"]);
    expect((await opcionesDeBase(id)).filter((f) => f["nombre"] === "Huevo")).toHaveLength(1);
    expect(
      await guardar(id, v2, {
        grupoId: g.id,
        opciones: [
          { clave: "e0", id: queso?.id ?? "", nombre: "Queso extra", recargo: "500.00" },
          { clave: "n0", id: null, nombre: "huevo", recargo: "320.00" },
        ],
      }),
    ).toMatchObject({ ok: true });
    const v3 = await opciones(id);
    expect(grupoPorNombre(v3, "Agregados").opciones).toMatchObject([
      { nombre: "Queso extra" },
      { id: huevo?.id, nombre: "huevo", recargo: "320.000000" },
    ]);
  });

  it("repetir el mismo guardado (doble toque, reintento tras un éxito): un solo grupo, una sola auditoría, una sola versión", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    expect(await gruposDe(id)).toHaveLength(1);
    expect(await opcionesDeBase(id)).toHaveLength(2);
    expect(await auditorias(id)).toBe(1);
    expect((await opciones(id)).versionDeOpciones).toBe(v0.versionDeOpciones + 1);
  });

  it("dos pestañas: la que guarda después con la versión vieja y otro contenido no escribe y sale el genérico; con la versión nueva (la pantalla se vuelve a pedir) guarda", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0)).toMatchObject({ ok: true });
    const segunda = await guardar(id, { ...v0, claveDelCambio: nuevoId() }, { nombre: "Salsas" });
    expect(segunda).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await gruposDe(id)).toHaveLength(1);
    expect(await auditorias(id)).toBe(1);
    const vNueva = await opciones(id);
    expect(await guardar(id, vNueva, { nombre: "Salsas" })).toMatchObject({ ok: true });
    expect(await gruposDe(id)).toHaveLength(2);
  });

  it(`dos grupos distintos a la vez sobre la misma versión vista (${String(RONDAS)} rondas): uno gana, el otro sale como el genérico y queda un solo grupo`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const v0 = await opciones(id);
      const [a, b] = await Promise.all([
        guardar(id, { ...v0, claveDelCambio: nuevoId() }, { nombre: "Uno" }),
        guardar(id, { ...v0, claveDelCambio: nuevoId() }, { nombre: "Dos" }),
      ]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual([GENERICO, "OK"]);
      expect(await gruposDe(id)).toHaveLength(1);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it(`el mismo guardado dos veces a la vez (${String(RONDAS)} rondas): los dos salen bien y se escribe una sola vez`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const v0 = await opciones(id);
      const [a, b] = await Promise.all([guardar(id, v0), guardar(id, v0)]);
      expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
      expect(await gruposDe(id)).toHaveLength(1);
      expect(await opcionesDeBase(id)).toHaveLength(2);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it("el nombre vacío del grupo sale como «Falta el nombre» en su campo, y no escribe", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0, { nombre: "   " })).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" },
    });
    expect(await gruposDe(id)).toEqual([]);
  });

  describe("filas de opciones sin nombre (como la maqueta: no se guardan)", () => {
    /** Lo que manda el formulario → las filas que lee el servidor (`leerLasFilasDeOpciones`), igual que la acción de la web. */
    const delFormulario = (ids: readonly string[], ...campos: readonly [string, string][]) =>
      leerLasFilasDeOpciones(campos, ids);

    it("una fila vacía no se guarda: el grupo queda con las que tienen nombre", async () => {
      const id = await nuevoProducto();
      const v0 = await opciones(id);
      const filas = delFormulario(
        [],
        ["opcion_n0_nombre", "Queso extra"],
        ["opcion_n0_recargo", "500.00"],
        ["opcion_n1_nombre", "   "],
        ["opcion_n1_recargo", "0.00"],
      );
      expect(await guardar(id, v0, { opciones: filas })).toMatchObject({ ok: true });
      expect(grupoPorNombre(await opciones(id), "Agregados").opciones).toMatchObject([
        { nombre: "Queso extra", recargo: "500.000000" },
      ]);
      expect(await opcionesDeBase(id)).toHaveLength(1);
    });

    it("vaciar el nombre de una opción guardada la desactiva y no borra nada; volver a cargarla la reactiva", async () => {
      const id = await nuevoProducto();
      expect(await guardar(id, await opciones(id))).toMatchObject({ ok: true });
      const v1 = await opciones(id);
      const g = grupoPorNombre(v1, "Agregados");
      const [queso, huevo] = [g.opciones[0], g.opciones[1]];
      const idsDeLaPagina = g.opciones.map((o) => o.id);
      const antes = await opcionesDeBase(id);
      const vaciada = delFormulario(
        idsDeLaPagina,
        ["opcion_e0_nombre", queso?.nombre ?? ""],
        ["opcion_e0_recargo", "500.00"],
        ["opcion_e1_nombre", ""],
        ["opcion_e1_recargo", "300.00"],
      );
      expect(await guardar(id, v1, { grupoId: g.id, opciones: vaciada })).toMatchObject({
        ok: true,
      });
      expect(grupoPorNombre(await opciones(id), "Agregados").opciones.map((o) => o.nombre)).toEqual(
        [queso?.nombre],
      );
      // Nada se borró: las mismas filas, y la vaciada quedó inactiva.
      const despues = await opcionesDeBase(id);
      expect(despues).toHaveLength(antes.length);
      expect(despues.find((f) => f["id"] === huevo?.id)).toMatchObject({ activa: false });
      // Volver a cargar el mismo nombre la reactiva (misma opción, no una nueva).
      const v2 = await opciones(id);
      const devuelta = delFormulario(
        [queso?.id ?? ""],
        ["opcion_e0_nombre", queso?.nombre ?? ""],
        ["opcion_e0_recargo", "500.00"],
        ["opcion_n0_nombre", huevo?.nombre ?? ""],
        ["opcion_n0_recargo", "300.00"],
      );
      expect(await guardar(id, v2, { grupoId: g.id, opciones: devuelta })).toMatchObject({
        ok: true,
      });
      expect(await opcionesDeBase(id)).toHaveLength(antes.length);
      expect(
        grupoPorNombre(await opciones(id), "Agregados").opciones.find((o) => o.id === huevo?.id),
      ).toBeDefined();
    });

    it("con todas las filas vacías el grupo no tiene opciones: sale el genérico y no escribe", async () => {
      const id = await nuevoProducto();
      const v0 = await opciones(id);
      const filas = delFormulario(
        [],
        ["opcion_n0_nombre", ""],
        ["opcion_n0_recargo", "0.00"],
        ["opcion_n1_nombre", " "],
        ["opcion_n1_recargo", "0.00"],
      );
      expect(filas).toEqual([]);
      expect(await guardar(id, v0, { opciones: filas })).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await gruposDe(id)).toEqual([]);
      expect(await auditorias(id)).toBe(0);
    });
  });

  it("un recargo en un grupo incluido sale como «Una opción incluida no lleva recargo» y uno mal escrito como «Escribí un precio válido»; ninguno escribe", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect(await guardar(id, v0, { clase: "INCLUIDA" })).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_INCLUIDA_CON_RECARGO", campo: "recargo" },
    });
    for (const malo of ["", "abc", "-1", "1,5", "0.1234567"]) {
      expect(
        await guardar(id, v0, { opciones: nuevas(["Queso", malo]) }),
        `recargo «${malo}»`,
      ).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "recargo" },
      });
    }
    expect(await gruposDe(id)).toEqual([]);
  });

  it.each([
    ["un nombre de grupo repetido", { nombre: "Existente" }],
    ["un grupo adicional sin opciones", { opciones: [] }],
    ["la misma opción dos veces", { opciones: nuevas(["Igual", "1.00"], ["igual", "2.00"]) }],
  ])("%s sale como el genérico y no escribe", async (_caso, resto) => {
    const id = await nuevoProducto();
    await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Existente" });
    const v0 = await opciones(id);
    const antes = await gruposDe(id);
    expect(await guardar(id, v0, resto)).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await gruposDe(id)).toEqual(antes);
  });

  it("un grupo que no existe, la variante, uno desactivado y uno de otro producto no se pueden editar: el genérico", async () => {
    const id = await nuevoProducto();
    const otroProducto = await nuevoProducto();
    const ajeno = await grupoDeBase(c.dueno, e.empresa, otroProducto, { nombre: "Ajeno" });
    const variante = await grupoDeBase(c.dueno, e.empresa, id, {
      clase: "VARIANTE",
      esTamano: true,
    });
    const apagado = await grupoDeBase(c.dueno, e.empresa, id, { nombre: "Apagado", activo: false });
    const v0 = await opciones(id);
    for (const grupoId of [nuevoId(), variante, apagado, ajeno]) {
      expect(await guardar(id, v0, { grupoId })).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await verUnGrupoDeOpciones(d, e.gerente, id, grupoId)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
    }
    expect(await verUnGrupoDeOpciones(d, e.gerente, id, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await auditorias(id)).toBe(0);
  });

  it("una clase que no se vende, un producto desactivado y uno que no existe salen como el genérico", async () => {
    const insumo = await nuevoProducto({ claseDeUso: "INSUMO", alicuota: undefined });
    expect(await verLasOpcionesDeUnProducto(d, e.gerente, insumo)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
    expect(codigoDe(await guardar(id, v0))).toBe(GENERICO);
    expect(codigoDe(await guardar(nuevoId(), v0))).toBe(GENERICO);
    expect(await verLasOpcionesDeUnProducto(d, e.gerente, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
  });

  it("aislamiento: una empresa no ve ni toca las opciones de otra, y no se distingue de un producto que no existe", async () => {
    const otra = await c.escenario();
    const ajeno = await nuevoProducto({ nombre: "Reservado" }, otra);
    const mio = await opciones(await nuevoProducto());
    const ver = await verLasOpcionesDeUnProducto(d, e.gerente, ajeno);
    expect(ver).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(JSON.stringify(ver)).not.toContain("Reservado");
    expect(codigoDe(await guardar(ajeno, mio))).toBe(GENERICO);
    expect(await gruposDe(ajeno)).toEqual([]);
    const copia = await copiarLasOpcionesDeOtroProducto(d, e.gerente, {
      productoDestinoId: ajeno,
      productoOrigenId: mio.id,
      versionDeOpciones: 0,
      claveDelCambio: nuevoId(),
    });
    expect(copia).toMatchObject({ ok: false, error: { codigo: GENERICO } });
  });

  it("el permiso lo deciden la consulta y el caso de uso: el operador ve pero no guarda; el administrador sí", async () => {
    const id = await nuevoProducto();
    const v0 = await opciones(id);
    expect((await opciones(id, e.operador)).nombre).toBeDefined();
    expect(await guardar(id, v0, {}, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await gruposDe(id)).toEqual([]);
    expect(codigoDe(await guardar(id, v0, {}, e.administrador))).toBe("OK");
  });

  it("con el catálogo en desarrollo (forzado: en el catálogo real es disponible, DEC-0463) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const id = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const dependencias: DependenciasDeOpcionesWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const ver = await verLasOpcionesDeUnProducto(dependencias, contexto, id);
      expect(ver).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO", presentacion: "POR_QUE_NO_PUEDO" },
      });
      const guarda = await guardarUnGrupoDeOpciones(
        dependencias,
        contexto,
        pedido(id, { versionDeOpciones: 0, claveDelCambio: nuevoId() }),
      );
      expect(guarda).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify([ver, guarda])).not.toContain("Cerrado");
    }
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const id = await nuevoProducto();
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    await opciones(id);
    await opciones(id, e.operador);
    await verLasOpcionesParaCopiar(d, e.gerente, id, null);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
  });

  describe("copiar de otro producto", () => {
    const conOpciones = async (nombre: string): Promise<string> => {
      const origen = await nuevoProducto({ nombre: `${nombre} ${nombreAlAzarDeProducto("x")}` });
      const g = await grupoDeBase(c.dueno, e.empresa, origen, { nombre: "Salsas", orden: 1 });
      await opcionDeBase(c.dueno, e.empresa, origen, g, { nombre: "Mayonesa", recargo: "40" });
      await opcionDeBase(c.dueno, e.empresa, origen, g, { nombre: "Ketchup", recargo: "0" });
      return origen;
    };
    const copiar = (destino: string, origen: string, version: number, clave: string) =>
      copiarLasOpcionesDeOtroProducto(d, e.gerente, {
        productoDestinoId: destino,
        productoOrigenId: origen,
        versionDeOpciones: version,
        claveDelCambio: clave,
      });

    it("ofrece los productos con opciones (menos el propio) y copia sus grupos; el origen no cambia", async () => {
      const origen = await conOpciones("Origen");
      const destino = await nuevoProducto();
      const antesOrigen = await opcionesDeBase(origen);
      const v = await verLasOpcionesParaCopiar(d, e.gerente, destino, null);
      expect(v.ok && v.dato.candidatos.map((p) => p.id)).toContain(origen);
      expect(v.ok && v.dato.candidatos.map((p) => p.id)).not.toContain(destino);
      expect(v.ok && JSON.stringify(v.dato)).not.toContain(e.personaDelGerente);
      if (!v.ok) throw new Error("se esperaba la lista");
      expect(
        await copiar(destino, origen, v.dato.versionDeOpciones, v.dato.claveDeLaCopia),
      ).toEqual({ ok: true, dato: { productoId: destino } });
      expect(grupoPorNombre(await opciones(destino), "Salsas").opciones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ nombre: "Mayonesa", recargo: "40.000000" }),
          expect.objectContaining({ nombre: "Ketchup", recargo: "0.000000" }),
        ]),
      );
      expect(await opcionesDeBase(origen)).toEqual(antesOrigen);
    });

    it("repetir la misma copia (doble toque, reintento): una sola copia y una sola auditoría", async () => {
      const origen = await conOpciones("Origen");
      const destino = await nuevoProducto();
      const clave = nuevoId();
      for (let i = 0; i < 3; i += 1) {
        expect(await copiar(destino, origen, 0, clave)).toMatchObject({ ok: true });
      }
      expect(await gruposDe(destino)).toHaveLength(1);
      expect(await opcionesDeBase(destino)).toHaveLength(2);
    });

    it("dos copias a la vez con la misma versión (otra clave cada una): una gana y la otra sale como el genérico", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const a = await conOpciones("A");
        const b = await conOpciones("B");
        const destino = await nuevoProducto();
        const [x, y] = await Promise.all([
          copiar(destino, a, 0, nuevoId()),
          copiar(destino, b, 0, nuevoId()),
        ]);
        expect(
          [x, y].map((r) => (r.ok ? "OK" : r.error.codigo)).sort(),
          `ronda ${String(ronda)}`,
        ).toEqual([GENERICO, "OK"]);
        expect((await gruposDe(destino)).length).toBe(1);
      }
    });

    it("con la versión vieja, sin nada para copiar, a sí mismo o con un origen inexistente: el genérico y no escribe", async () => {
      const origen = await conOpciones("Origen");
      const destino = await nuevoProducto();
      expect(await copiar(destino, origen, 7, nuevoId())).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await copiar(origen, origen, 0, nuevoId())).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await copiar(destino, nuevoId(), 0, nuevoId())).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      const vacio = await nuevoProducto();
      expect(await copiar(destino, vacio, 0, nuevoId())).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await gruposDe(destino)).toEqual([]);
    });

    describe("la vista previa de la hoja", () => {
      type Grupo = Readonly<{
        nombre: string;
        clase: string;
        opciones: readonly Readonly<{ nombre: string; recargo: string | null }>[];
      }>;
      const conRecargo = (r: string): string | null => (/[1-9]/.test(r) ? r : null);
      const vista = async (origen: string, destino: string, contexto = e.gerente) => {
        const r = await c.consultas.vistaPreviaDeCopiaDeOpciones(contexto, {
          productoOrigenId: origen,
          productoDestinoId: destino,
        });
        if (!r.ok) throw new Error(`se esperaba la vista previa y vino ${JSON.stringify(r.error)}`);
        return r.valor;
      };
      /** Lo que hay (activo) en un producto, con la misma forma que la vista previa y sin importar el orden. */
      const enElDestino = async (id: string): Promise<Grupo[]> => {
        const filas = await c.filas(
          "select g.nombre as grupo, g.clase, v.nombre, v.recargo from grupo_de_elecciones g join opcion o on o.grupo_id = g.id join version_de_opcion v on v.opcion_id = o.id and v.numero = (select max(numero) from version_de_opcion where opcion_id = o.id) where g.producto_id = $1 and g.activo and o.activa",
          [id],
        );
        const porGrupo = new Map<
          string,
          { clase: string; opciones: { nombre: string; recargo: string | null }[] }
        >();
        for (const f of filas) {
          const g = porGrupo.get(String(f["grupo"])) ?? { clase: String(f["clase"]), opciones: [] };
          g.opciones.push({
            nombre: String(f["nombre"]),
            recargo: conRecargo(String(f["recargo"])),
          });
          porGrupo.set(String(f["grupo"]), g);
        }
        return [...porGrupo].map(([nombre, g]) => ({ nombre, ...g }));
      };
      const normal = (gs: readonly Grupo[]) =>
        gs
          .map((g) => ({
            nombre: g.nombre,
            clase: g.clase,
            opciones: g.opciones.map((o) => `${o.nombre}|${o.recargo ?? ""}`).sort(),
          }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre));

      /** Un origen con de todo: activos, un grupo desactivado, un grupo con la opción desactivada y una variante. */
      const origenCompleto = async (): Promise<string> => {
        const o = await nuevoProducto({ nombre: `Completo ${nombreAlAzarDeProducto("x")}` });
        const salsas = await grupoDeBase(c.dueno, e.empresa, o, { nombre: "Salsas", orden: 1 });
        await opcionDeBase(c.dueno, e.empresa, o, salsas, { nombre: "Mayonesa", recargo: "40" });
        await opcionDeBase(c.dueno, e.empresa, o, salsas, { nombre: "Ketchup", recargo: "0" });
        const guarnicion = await grupoDeBase(c.dueno, e.empresa, o, {
          nombre: "Guarnición",
          clase: "INCLUIDA",
          orden: 2,
        });
        await opcionDeBase(c.dueno, e.empresa, o, guarnicion, { nombre: "Papas fritas" });
        await opcionDeBase(c.dueno, e.empresa, o, guarnicion, { nombre: "Ensalada" });
        const viejo = await grupoDeBase(c.dueno, e.empresa, o, {
          nombre: "Viejo",
          orden: 3,
          activo: false,
        });
        await opcionDeBase(c.dueno, e.empresa, o, viejo, { nombre: "Ya no", recargo: "5" });
        const sinActivas = await grupoDeBase(c.dueno, e.empresa, o, {
          nombre: "Apagadas",
          orden: 4,
        });
        const { opcion } = await opcionDeBase(c.dueno, e.empresa, o, sinActivas, {
          nombre: "Sin stock",
          recargo: "9",
        });
        await c.dueno.query("update opcion set activa = false where id = $1", [opcion]);
        const tamano = await grupoDeBase(c.dueno, e.empresa, o, {
          nombre: "Tamaño",
          clase: "VARIANTE",
          esTamano: true,
          orden: 5,
        });
        await opcionDeBase(c.dueno, e.empresa, o, tamano, { nombre: "Chica", factor: "1" });
        await opcionDeBase(c.dueno, e.empresa, o, tamano, { nombre: "Grande", factor: "2" });
        return o;
      };

      it("coincide EXACTO con lo que la copia hace, para varios pares origen y destino; vacía si y solo si no hay nada para copiar", async () => {
        const origen = await origenCompleto();
        // Destinos: sin nada (trae todo, también la variante); con «salsas» ya (por nombre, sin importar mayúsculas); con precio de la empresa (no trae la variante); con una variante; sin nada que traer.
        const vacio = await nuevoProducto();
        const conSalsas = await nuevoProducto();
        const gs = await grupoDeBase(c.dueno, e.empresa, conSalsas, { nombre: "SALSAS" });
        await opcionDeBase(c.dueno, e.empresa, conSalsas, gs, { nombre: "Otra" });
        const conPrecio = await nuevoProducto();
        await precioDeBase(c.dueno, {
          empresa: e.empresa,
          producto: conPrecio,
          precio: "1000",
          desde: "2026-01-01T00:00:00Z",
        });
        const conVariante = await nuevoProducto();
        const gv = await grupoDeBase(c.dueno, e.empresa, conVariante, {
          nombre: "Porción",
          clase: "VARIANTE",
          esTamano: true,
        });
        await opcionDeBase(c.dueno, e.empresa, conVariante, gv, { nombre: "Media" });
        const yaTieneTodo = await nuevoProducto();
        for (const nombre of ["Salsas", "Guarnición", "Tamaño"]) {
          const g = await grupoDeBase(c.dueno, e.empresa, yaTieneTodo, {
            nombre,
            clase: nombre === "Tamaño" ? "VARIANTE" : "ADICIONAL",
            esTamano: nombre === "Tamaño",
          });
          await opcionDeBase(c.dueno, e.empresa, yaTieneTodo, g, { nombre: "X" });
        }
        const sinOpciones = await nuevoProducto();

        // Lo esperado, no solo lo coherente (antes de copiar: copiar cambia el destino).
        expect((await vista(origen, vacio)).map((g) => g.nombre).sort()).toEqual([
          "Guarnición",
          "Salsas",
          "Tamaño",
        ]);
        expect((await vista(origen, conSalsas)).map((g) => g.nombre).sort()).toEqual([
          "Guarnición",
          "Tamaño",
        ]);
        expect((await vista(origen, conPrecio)).map((g) => g.nombre).sort()).toEqual([
          "Guarnición",
          "Salsas",
        ]);
        expect((await vista(origen, conVariante)).map((g) => g.nombre).sort()).toEqual([
          "Guarnición",
          "Salsas",
        ]);
        expect(await vista(origen, yaTieneTodo)).toEqual([]);
        expect(await vista(sinOpciones, vacio)).toEqual([]);
        // El recargo viaja como texto decimal; sin recargo, nulo.
        const salsasVacio = (await vista(origen, await nuevoProducto())).find(
          (g) => g.nombre === "Salsas",
        );
        expect(salsasVacio?.opciones).toEqual(
          expect.arrayContaining([
            { nombre: "Mayonesa", recargo: "40.000000" },
            { nombre: "Ketchup", recargo: null },
          ]),
        );
        const pares: [string, string, string][] = [
          [origen, vacio, "destino vacío"],
          [origen, conSalsas, "destino con «SALSAS» ya"],
          [origen, conPrecio, "destino con precio de la empresa"],
          [origen, conVariante, "destino con variante"],
          [origen, yaTieneTodo, "destino que ya tiene todo"],
          [sinOpciones, vacio, "origen sin opciones"],
        ];
        for (const [o, dest, caso] of pares) {
          const previa = await vista(o, dest);
          const antes = normal(await enElDestino(dest));
          const v = await opciones(dest);
          const resultado = await copiar(dest, o, v.versionDeOpciones, nuevoId());
          const despues = normal(await enElDestino(dest));
          if (previa.length === 0) {
            expect(resultado, caso).toMatchObject({ ok: false, error: { codigo: GENERICO } });
            expect(despues, caso).toEqual(antes);
          } else {
            expect(resultado, caso).toMatchObject({ ok: true });
            // Lo que aparece en el destino es EXACTAMENTE la vista previa (lo que ya había queda además).
            const nuevos = despues.filter((g) => !antes.some((a) => a.nombre === g.nombre));
            expect(nuevos, caso).toEqual(normal(previa));
          }
        }
      });

      it("origen o destino inexistente, de otra empresa, o el mismo producto: vacía (no dice cuál es el caso)", async () => {
        const origen = await origenCompleto();
        const destino = await nuevoProducto();
        const otra = await c.escenario();
        const ajeno = await nuevoProducto({ nombre: "Reservado" }, otra);
        const g = await grupoDeBase(c.dueno, otra.empresa, ajeno, { nombre: "Secreto" });
        await opcionDeBase(c.dueno, otra.empresa, ajeno, g, { nombre: "Confidencial" });
        expect(await vista(ajeno, destino)).toEqual([]);
        expect(await vista(origen, ajeno)).toEqual([]);
        expect(await vista(origen, nuevoId())).toEqual([]);
        expect(await vista(nuevoId(), destino)).toEqual([]);
        expect(await vista(origen, origen)).toEqual([]);
        expect(JSON.stringify(await vista(ajeno, destino))).not.toContain("Confidencial");
      });

      it("el operador ve la vista previa pero no copia; y la consulta no escribe ni audita", async () => {
        const origen = await origenCompleto();
        const destino = await nuevoProducto();
        const auditoria = () =>
          c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
            e.empresa,
          ]);
        const filasAntes = await opcionesDeBase(destino);
        const antes = await auditoria();
        expect((await vista(origen, destino, e.operador)).length).toBeGreaterThan(0);
        await vista(origen, destino);
        expect(await auditoria()).toBe(antes);
        expect(await opcionesDeBase(destino)).toEqual(filasAntes);
        expect(await gruposDe(destino)).toEqual([]);
        expect(
          await copiarLasOpcionesDeOtroProducto(d, e.operador, {
            productoDestinoId: destino,
            productoOrigenId: origen,
            versionDeOpciones: 0,
            claveDelCambio: nuevoId(),
          }),
        ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
        expect(await gruposDe(destino)).toEqual([]);
      });

      it("verLasOpcionesParaCopiar: toma el origen pedido si es un candidato y si no el primero; sin candidatos no hay origen ni vista previa", async () => {
        const a = await origenCompleto();
        const b = await conOpciones("Segundo");
        const destino = await nuevoProducto();
        const lectura = async (pedido: string | null) => {
          const r = await verLasOpcionesParaCopiar(d, e.gerente, destino, pedido);
          if (!r.ok) throw new Error("se esperaba la lectura");
          return r.dato;
        };
        const primero = (await lectura(null)).candidatos[0]?.id;
        expect((await lectura(null)).origen).toBe(primero);
        expect((await lectura(b)).origen).toBe(b);
        expect((await lectura(a)).origen).toBe(a);
        // Un valor de la dirección que no es candidato (destino mismo, inexistente, texto cualquiera) cae en el primero.
        for (const raro of [destino, nuevoId(), "1", "' or 1=1 --", ""]) {
          expect((await lectura(raro)).origen, raro).toBe(primero);
        }
        expect((await lectura(a)).vistaPrevia.map((g) => g.nombre).sort()).toEqual([
          "Guarnición",
          "Salsas",
          "Tamaño",
        ]);
        // Sin candidatos (el destino es el único producto con opciones de otra empresa, vacía).
        const otra = await c.escenario();
        const solo = await nuevoProducto({}, otra);
        const r = await verLasOpcionesParaCopiar(d, otra.gerente, solo, null);
        expect(r.ok && r.dato.origen).toBeNull();
        expect(r.ok && r.dato.vistaPrevia).toEqual([]);
      });
    });

    it("el operador no copia", async () => {
      const origen = await conOpciones("Origen");
      const destino = await nuevoProducto();
      expect(
        await copiarLasOpcionesDeOtroProducto(d, e.operador, {
          productoDestinoId: destino,
          productoOrigenId: origen,
          versionDeOpciones: 0,
          claveDelCambio: nuevoId(),
        }),
      ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
      expect(await gruposDe(destino)).toEqual([]);
    });
  });
});
