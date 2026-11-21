import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  clasificarUnProducto,
  crearUnNodoDeClasificacion,
  desactivarUnNodoDeClasificacion,
  moverUnNodoDeClasificacion,
  reactivarUnNodoDeClasificacion,
  renombrarUnNodoDeClasificacion,
  verElArbolDeClasificacion,
  verLaClasificacionDeUnProducto,
  type DependenciasDeClasificacionWeb,
} from "../../src/composicion/clasificacion-web";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  productoDeBase,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La clasificación comercial de la web (`clasificacion-web.ts`, A14) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita, aislamiento entre
 * empresas, permisos y módulo en desarrollo (los decide el caso de uso), versión vieja, doble toque y dos pedidos a la vez. Los casos de uso en sí tienen sus pruebas en
 * `clasificacion-casos-de-uso.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("clasificación comercial de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDeClasificacionWeb;

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
    registrados = [];
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const codigoDe = (r: Readonly<{ ok: true } | { ok: false; error: { codigo: string } }>) =>
    r.ok ? "OK" : r.error.codigo;
  const crear = async (
    padreId: string | null = null,
    nombre = nombreAlAzarDeProducto("Nodo"),
    contexto = e.gerente,
  ): Promise<string> => {
    const r = await crearUnNodoDeClasificacion(d, contexto, { id: nuevoId(), padreId, nombre });
    if (!r.ok) throw new Error(`se esperaba crear el nodo y vino ${r.error.codigo}`);
    return r.dato.nodoId;
  };
  const arbol = async (contexto = e.gerente) => {
    const r = await verElArbolDeClasificacion(d, contexto);
    if (!r.ok) throw new Error(`se esperaba el árbol y vino ${r.error.codigo}`);
    return r.dato.nodos;
  };
  const nodoDe = async (id: string) => {
    const n = (await arbol()).find((x) => x.id === id);
    if (n === undefined) throw new Error("el nodo no está en el árbol");
    return n;
  };
  const nuevoProducto = (x: EscenarioDeCatalogo = e): Promise<string> =>
    productoDeBase(c.dueno, x.empresa);
  const vinculos = (productoId: string) =>
    c.filas(
      "select id, nodo_id from clasificacion_de_producto where producto_id = $1 order by vigente_desde",
      [productoId],
    );
  const auditorias = (entidadId: string) =>
    c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [entidadId]);

  it("el árbol sale con nivel, versión y lo que se puede hacer con cada nodo: crear adentro y destinos de un movimiento", async () => {
    const x = await c.escenario();
    const dep = await crear(null, "Restaurante", x.gerente);
    const otroDep = await crear(null, "Alojamiento", x.gerente);
    const cat = await crear(dep, "Bebidas", x.gerente);
    const sub = await crear(cat, "Cafés", x.gerente);
    const hoja = await crear(sub, "De especialidad", x.gerente);
    const r = await verElArbolDeClasificacion(d, x.gerente);
    if (!r.ok) throw new Error("se esperaba el árbol");
    const por = new Map(r.dato.nodos.map((n) => [n.id, n]));
    expect(por.get(dep)).toMatchObject({
      nombre: "Restaurante",
      padreId: null,
      nivel: 1,
      activo: true,
      admiteHijos: true,
      destinos: [],
    });
    expect(por.get(hoja)).toMatchObject({ nivel: 4, admiteHijos: false });
    expect(por.get(cat)?.destinos).toEqual([dep, otroDep].sort());
    // Una categoría con algo adentro solo cabe donde su altura no pasa el tope; su padre actual también es un destino válido («ya estaba»).
    expect(por.get(sub)?.destinos).toEqual([cat, dep, otroDep].sort());
    expect(typeof por.get(cat)?.version).toBe("number");
    expect(JSON.stringify(r.dato)).not.toContain(x.personaDelGerente);
  });

  it("un nodo desactivado no admite hijos y no es destino de un movimiento", async () => {
    const dep = await crear();
    const otro = await crear();
    const cat = await crear(dep);
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: otro }))).toBe(
      "OK",
    );
    expect(await nodoDe(otro)).toMatchObject({ activo: false, admiteHijos: false });
    expect((await nodoDe(cat)).destinos).toEqual([dep]);
  });

  it("crear, renombrar, mover, desactivar y reactivar: cada uno escribe y audita una vez, y la pantalla ve el resultado", async () => {
    const dep = await crear();
    const otro = await crear();
    const cat = await crear(dep, "Comidas");
    expect(await auditorias(cat)).toBe(1);
    const v0 = await nodoDe(cat);
    expect(
      await renombrarUnNodoDeClasificacion(d, e.gerente, {
        nodoId: cat,
        versionEsperada: v0.version,
        nombre: "Platos",
      }),
    ).toEqual({ ok: true, dato: { nodoId: cat } });
    const v1 = await nodoDe(cat);
    expect(v1).toMatchObject({ nombre: "Platos" });
    expect(v1.version).toBeGreaterThan(v0.version);
    expect(
      await moverUnNodoDeClasificacion(d, e.gerente, {
        nodoId: cat,
        versionEsperada: v1.version,
        nuevoPadreId: otro,
      }),
    ).toEqual({ ok: true, dato: { nodoId: cat } });
    expect(await nodoDe(cat)).toMatchObject({ padreId: otro, nivel: 2 });
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: cat }))).toBe(
      "OK",
    );
    expect((await nodoDe(cat)).activo).toBe(false);
    expect(codigoDe(await reactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: cat }))).toBe(
      "OK",
    );
    expect((await nodoDe(cat)).activo).toBe(true);
    expect(await auditorias(cat)).toBe(5);
  });

  it("repetir cada pedido (doble toque, reintento): crear con el mismo id, renombrar, mover, desactivar y reactivar no duplican ni vuelven a auditar", async () => {
    const dep = await crear();
    const otro = await crear();
    const id = nuevoId();
    const pedido = { id, padreId: dep, nombre: "Una sola vez" };
    expect(await crearUnNodoDeClasificacion(d, e.gerente, pedido)).toMatchObject({ ok: true });
    expect(await crearUnNodoDeClasificacion(d, e.gerente, pedido)).toMatchObject({ ok: true });
    expect(await crearUnNodoDeClasificacion(d, e.gerente, pedido)).toMatchObject({ ok: true });
    expect(await auditorias(id)).toBe(1);
    const v = await nodoDe(id);
    const mover = { nodoId: id, versionEsperada: v.version, nuevoPadreId: otro };
    expect(codigoDe(await moverUnNodoDeClasificacion(d, e.gerente, mover))).toBe("OK");
    expect(codigoDe(await moverUnNodoDeClasificacion(d, e.gerente, mover))).toBe("OK");
    const renombrar = { nodoId: id, versionEsperada: (await nodoDe(id)).version, nombre: "Otro" };
    expect(codigoDe(await renombrarUnNodoDeClasificacion(d, e.gerente, renombrar))).toBe("OK");
    expect(codigoDe(await renombrarUnNodoDeClasificacion(d, e.gerente, renombrar))).toBe("OK");
    for (let i = 0; i < 2; i += 1) {
      expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: id }))).toBe(
        "OK",
      );
    }
    for (let i = 0; i < 2; i += 1) {
      expect(codigoDe(await reactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: id }))).toBe(
        "OK",
      );
    }
    // crear + mover + renombrar + desactivar + reactivar: cinco auditorías, una por hecho.
    expect(await auditorias(id)).toBe(5);
  });

  it("el mismo id con otro contenido no pisa lo escrito: sale el genérico", async () => {
    const dep = await crear();
    const id = nuevoId();
    expect(
      await crearUnNodoDeClasificacion(d, e.gerente, { id, padreId: dep, nombre: "Uno" }),
    ).toMatchObject({ ok: true });
    expect(
      codigoDe(await crearUnNodoDeClasificacion(d, e.gerente, { id, padreId: dep, nombre: "Dos" })),
    ).toBe(GENERICO);
    expect((await nodoDe(id)).nombre).toBe("Uno");
  });

  it("dos altas del mismo id a la vez (doble clic que llega doble): las dos salen bien y se crea un solo nodo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = nuevoId();
      const pedido = { id, padreId: null, nombre: nombreAlAzarDeProducto("Doble") };
      const [a, b] = await Promise.all([
        crearUnNodoDeClasificacion(d, e.gerente, pedido),
        crearUnNodoDeClasificacion(d, e.gerente, pedido),
      ]);
      expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it("dos pestañas: renombrar con la versión vieja sale como el genérico y no escribe; con la versión nueva, sí", async () => {
    const dep = await crear(null, "Original");
    const v0 = await nodoDe(dep);
    expect(
      codigoDe(
        await renombrarUnNodoDeClasificacion(d, e.gerente, {
          nodoId: dep,
          versionEsperada: v0.version,
          nombre: "Primera",
        }),
      ),
    ).toBe("OK");
    const vieja = await renombrarUnNodoDeClasificacion(d, e.gerente, {
      nodoId: dep,
      versionEsperada: v0.version,
      nombre: "Segunda",
    });
    expect(codigoDe(vieja)).toBe(GENERICO);
    expect(JSON.stringify(vieja)).not.toContain("VERSION_DESACTUALIZADA");
    expect((await nodoDe(dep)).nombre).toBe("Primera");
    expect(
      codigoDe(
        await renombrarUnNodoDeClasificacion(d, e.gerente, {
          nodoId: dep,
          versionEsperada: (await nodoDe(dep)).version,
          nombre: "Segunda",
        }),
      ),
    ).toBe("OK");
  });

  it(`dos movimientos a la vez que cerrarían un ciclo (${String(RONDAS)} rondas): solo uno se aplica y el árbol sigue sano`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const dep = await crear();
      const a = await crear(dep);
      const b = await crear(dep);
      const va = await nodoDe(a);
      const vb = await nodoDe(b);
      const [r1, r2] = await Promise.all([
        moverUnNodoDeClasificacion(d, e.gerente, {
          nodoId: a,
          versionEsperada: va.version,
          nuevoPadreId: b,
        }),
        moverUnNodoDeClasificacion(d, e.gerente, {
          nodoId: b,
          versionEsperada: vb.version,
          nuevoPadreId: a,
        }),
      ]);
      expect([codigoDe(r1), codigoDe(r2)].sort()).toEqual([GENERICO, "OK"]);
      const sano = await arbol();
      expect(sano.every((n) => n.nivel >= 1)).toBe(true);
    }
  });

  it("las reglas del árbol salen como el genérico: ciclo, tope de niveles, departamento que no se mueve, crear bajo un desactivado", async () => {
    const dep = await crear();
    const cat = await crear(dep);
    const sub = await crear(cat);
    const hoja = await crear(sub);
    expect(
      codigoDe(
        await crearUnNodoDeClasificacion(d, e.gerente, {
          id: nuevoId(),
          padreId: hoja,
          nombre: "Quinto",
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await moverUnNodoDeClasificacion(d, e.gerente, {
          nodoId: cat,
          versionEsperada: (await nodoDe(cat)).version,
          nuevoPadreId: hoja,
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await moverUnNodoDeClasificacion(d, e.gerente, {
          nodoId: dep,
          versionEsperada: (await nodoDe(dep)).version,
          nuevoPadreId: cat,
        }),
      ),
    ).toBe(GENERICO);
    const otro = await crear();
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: otro }))).toBe(
      "OK",
    );
    expect(
      codigoDe(
        await crearUnNodoDeClasificacion(d, e.gerente, {
          id: nuevoId(),
          padreId: otro,
          nombre: "Hijo",
        }),
      ),
    ).toBe(GENERICO);
  });

  it("desactivar con hijos activos sale con el aviso aprobado, sin campo, y no escribe; sin hijos activos se puede", async () => {
    const dep = await crear();
    const cat = await crear(dep);
    const r = await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: dep });
    expect(r).toMatchObject({
      ok: false,
      error: {
        codigo: "CATALOGO_PRIMERO_DESACTIVA",
        clave: "catalogo.error.primero_desactiva",
        presentacion: "AVISO",
      },
    });
    expect(r.ok ? null : r.error).not.toHaveProperty("campo");
    expect((await nodoDe(dep)).activo).toBe(true);
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: cat }))).toBe(
      "OK",
    );
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: dep }))).toBe(
      "OK",
    );
  });

  it("un nombre vacío o que no es un nombre, o un pedido sin la forma, salen como el genérico y no escriben", async () => {
    const antes = (await arbol()).length;
    for (const nombre of ["", "   ", "a".repeat(81)]) {
      expect(
        codigoDe(
          await crearUnNodoDeClasificacion(d, e.gerente, { id: nuevoId(), padreId: null, nombre }),
        ),
      ).toBe(GENERICO);
    }
    for (const malo of [
      null,
      {},
      { id: "x", padreId: null, nombre: "A" },
      { id: nuevoId(), padreId: "x", nombre: "A" },
    ]) {
      expect(codigoDe(await crearUnNodoDeClasificacion(d, e.gerente, malo))).toBe(GENERICO);
    }
    expect((await arbol()).length).toBe(antes);
  });

  it("lo que el pedido trae de más (empresa, persona, fecha) se descarta: el servidor pone la suya", async () => {
    const otra = await c.escenario();
    const id = nuevoId();
    const r = await crearUnNodoDeClasificacion(d, e.gerente, {
      id,
      padreId: null,
      nombre: nombreAlAzarDeProducto("Mia"),
      empresaId: otra.empresa,
      personaId: otra.personaDelGerente,
    });
    expect(r).toMatchObject({ ok: true });
    const filas = await c.filas("select empresa_id from nodo_de_clasificacion where id = $1", [id]);
    expect(filas[0]?.["empresa_id"]).toBe(e.empresa);
  });

  it("aislamiento: una empresa no ve el árbol de otra ni toca sus nodos, y no se distingue de un nodo que no existe", async () => {
    const otra = await c.escenario();
    const ajeno = await crear(null, "Reservado", otra.gerente);
    expect(JSON.stringify(await arbol())).not.toContain("Reservado");
    const mio = await crear();
    expect(
      codigoDe(
        await renombrarUnNodoDeClasificacion(d, e.gerente, {
          nodoId: ajeno,
          versionEsperada: 1,
          nombre: "Mio",
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await moverUnNodoDeClasificacion(d, e.gerente, {
          nodoId: ajeno,
          versionEsperada: 1,
          nuevoPadreId: mio,
        }),
      ),
    ).toBe(GENERICO);
    expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: ajeno }))).toBe(
      GENERICO,
    );
    expect(
      codigoDe(
        await crearUnNodoDeClasificacion(d, e.gerente, {
          id: nuevoId(),
          padreId: ajeno,
          nombre: "Hijo",
        }),
      ),
    ).toBe(GENERICO);
    expect((await nodoDe(mio)).destinos).toEqual([]);
    const filas = await c.filas("select nombre, activo from nodo_de_clasificacion where id = $1", [
      ajeno,
    ]);
    expect(filas[0]).toMatchObject({ nombre: "Reservado", activo: true });
  });

  it("permisos: el operador ve el árbol pero no escribe (motivo del guard); un administrador de una sola sucursal no escribe (alcance total)", async () => {
    const dep = await crear();
    expect((await arbol(e.operador)).some((n) => n.id === dep)).toBe(true);
    for (const sin of [e.operador]) {
      expect(
        await crearUnNodoDeClasificacion(d, sin, { id: nuevoId(), padreId: null, nombre: "No" }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "SIN_PERMISO" },
      });
      expect(await desactivarUnNodoDeClasificacion(d, sin, { nodoId: dep })).toMatchObject({
        ok: false,
        error: { codigo: "SIN_PERMISO" },
      });
    }
    expect(
      codigoDe(
        await crearUnNodoDeClasificacion(d, e.administradorDeUnaSucursal, {
          id: nuevoId(),
          padreId: null,
          nombre: "No",
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await crearUnNodoDeClasificacion(d, e.administrador, {
          id: nuevoId(),
          padreId: null,
          nombre: nombreAlAzarDeProducto("Si"),
        }),
      ),
    ).toBe("OK");
  });

  it("con el catálogo en desarrollo (forzado: en el catálogo real es disponible, DEC-0463) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDeClasificacionWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    const producto = await productoDeBase(cerrado.dueno, x.empresa);
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      expect(await verElArbolDeClasificacion(dependencias, contexto)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO" },
      });
      expect(await verLaClasificacionDeUnProducto(dependencias, contexto, producto)).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO" },
      });
      expect(
        await crearUnNodoDeClasificacion(dependencias, contexto, {
          id: nuevoId(),
          padreId: null,
          nombre: "No",
        }),
      ).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(
        await clasificarUnProducto(dependencias, contexto, {
          id: nuevoId(),
          productoId: producto,
          nodoId: null,
        }),
      ).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
    }
  });

  describe("la clasificación de un producto", () => {
    it("sin clasificar no hay vigente (se ve «Sin elegir»); se ofrecen solo los nodos activos", async () => {
      const x = await c.escenario();
      const dep = await crear(null, "Restaurante", x.gerente);
      const apagado = await crear(null, "Viejo", x.gerente);
      expect(
        codigoDe(await desactivarUnNodoDeClasificacion(d, x.gerente, { nodoId: apagado })),
      ).toBe("OK");
      const producto = await nuevoProducto(x);
      const r = await verLaClasificacionDeUnProducto(d, x.gerente, producto);
      expect(r).toEqual({
        ok: true,
        dato: {
          productoId: producto,
          vigente: null,
          nodos: [{ id: dep, padreId: null, nombre: "Restaurante" }],
        },
      });
    });

    it("cambiar agrega un vínculo (el anterior queda), rige desde ahora con el día civil de Argentina y audita una vez", async () => {
      const nombreDeDep = nombreAlAzarDeProducto("Rest");
      const dep = await crear(null, nombreDeDep);
      const cat = await crear(dep, "Comidas");
      const producto = await nuevoProducto();
      const id1 = nuevoId();
      expect(
        await clasificarUnProducto(d, e.gerente, { id: id1, productoId: producto, nodoId: cat }),
      ).toEqual({
        ok: true,
        dato: { productoId: producto },
      });
      const v1 = await verLaClasificacionDeUnProducto(d, e.gerente, producto);
      if (!v1.ok) throw new Error("se esperaba la clasificación");
      expect(v1.dato.vigente?.camino).toEqual([
        { id: dep, nombre: nombreDeDep, activo: true },
        { id: cat, nombre: "Comidas", activo: true },
      ]);
      expect(v1.dato.vigente?.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // `comoEmpresa` fija el reloj: dos cambios del mismo producto necesitan instantes distintos (la única de la base), como en el uso real.
      const luego = (minutos: number): typeof e.gerente => ({
        ...e.gerente,
        ahora: new Date(e.gerente.ahora.getTime() + minutos * 60_000),
      });
      const id2 = nuevoId();
      expect(
        codigoDe(
          await clasificarUnProducto(d, luego(1), { id: id2, productoId: producto, nodoId: dep }),
        ),
      ).toBe("OK");
      expect(
        codigoDe(
          await clasificarUnProducto(d, luego(2), {
            id: nuevoId(),
            productoId: producto,
            nodoId: null,
          }),
        ),
      ).toBe("OK");
      const v3 = await verLaClasificacionDeUnProducto(d, e.gerente, producto);
      expect(v3).toMatchObject({ ok: true, dato: { vigente: { camino: [] } } });
      expect(await vinculos(producto)).toHaveLength(3);
      expect(await auditorias(producto)).toBe(3);
    });

    it("repetir el mismo cambio (doble toque, reintento): un solo vínculo y una sola auditoría; con otro contenido el mismo id sale como el genérico", async () => {
      const dep = await crear();
      const otro = await crear();
      const producto = await nuevoProducto();
      const id = nuevoId();
      for (let i = 0; i < 3; i += 1) {
        expect(
          codigoDe(
            await clasificarUnProducto(d, e.gerente, { id, productoId: producto, nodoId: dep }),
          ),
        ).toBe("OK");
      }
      expect(await vinculos(producto)).toHaveLength(1);
      expect(await auditorias(producto)).toBe(1);
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.gerente, { id, productoId: producto, nodoId: otro }),
        ),
      ).toBe(GENERICO);
      expect(await vinculos(producto)).toHaveLength(1);
    });

    it("el mismo cambio dos veces a la vez (doble clic que llega doble): los dos salen bien y se guarda un solo vínculo", async () => {
      const dep = await crear();
      for (let ronda = 0; ronda < RONDAS; ronda += 1) {
        const producto = await nuevoProducto();
        const pedido = { id: nuevoId(), productoId: producto, nodoId: dep };
        const [a, b] = await Promise.all([
          clasificarUnProducto(d, e.gerente, pedido),
          clasificarUnProducto(d, e.gerente, pedido),
        ]);
        expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
        expect(await vinculos(producto)).toHaveLength(1);
        expect(await auditorias(producto)).toBe(1);
      }
    });

    it("un nodo desactivado no se asigna; uno ya asignado se conserva con su camino y se ve desactivado", async () => {
      const dep = await crear(null, nombreAlAzarDeProducto("Rest"));
      const cat = await crear(dep, "Postres");
      const producto = await nuevoProducto();
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.gerente, {
            id: nuevoId(),
            productoId: producto,
            nodoId: cat,
          }),
        ),
      ).toBe("OK");
      expect(codigoDe(await desactivarUnNodoDeClasificacion(d, e.gerente, { nodoId: cat }))).toBe(
        "OK",
      );
      const r = await verLaClasificacionDeUnProducto(d, e.gerente, producto);
      if (!r.ok) throw new Error("se esperaba la clasificación");
      expect(r.dato.vigente?.camino.at(-1)).toEqual({ id: cat, nombre: "Postres", activo: false });
      expect(r.dato.nodos.some((n) => n.id === cat)).toBe(false);
      const otro = await nuevoProducto();
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.gerente, {
            id: nuevoId(),
            productoId: otro,
            nodoId: cat,
          }),
        ),
      ).toBe(GENERICO);
      expect(await vinculos(otro)).toEqual([]);
    });

    it("aislamiento: no se ve ni se clasifica un producto de otra empresa, ni con un nodo de otra empresa; un id mal escrito sale como el genérico", async () => {
      const otra = await c.escenario();
      const ajeno = await nuevoProducto(otra);
      const nodoAjeno = await crear(null, "Ajeno", otra.gerente);
      const mio = await nuevoProducto();
      const dep = await crear();
      expect(await verLaClasificacionDeUnProducto(d, e.gerente, ajeno)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(await verLaClasificacionDeUnProducto(d, e.gerente, "no-es-un-id")).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.gerente, {
            id: nuevoId(),
            productoId: ajeno,
            nodoId: dep,
          }),
        ),
      ).toBe(GENERICO);
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.gerente, {
            id: nuevoId(),
            productoId: mio,
            nodoId: nodoAjeno,
          }),
        ),
      ).toBe(GENERICO);
      expect(await vinculos(ajeno)).toEqual([]);
      expect(await vinculos(mio)).toEqual([]);
      expect(JSON.stringify(await verLaClasificacionDeUnProducto(d, e.gerente, mio))).not.toContain(
        "Ajeno",
      );
    });

    it("permisos: el operador ve la clasificación pero no la cambia; el administrador de una sola sucursal no la cambia (alcance total)", async () => {
      const dep = await crear();
      const producto = await nuevoProducto();
      expect((await verLaClasificacionDeUnProducto(d, e.operador, producto)).ok).toBe(true);
      expect(
        await clasificarUnProducto(d, e.operador, {
          id: nuevoId(),
          productoId: producto,
          nodoId: dep,
        }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "SIN_PERMISO" },
      });
      expect(
        codigoDe(
          await clasificarUnProducto(d, e.administradorDeUnaSucursal, {
            id: nuevoId(),
            productoId: producto,
            nodoId: dep,
          }),
        ),
      ).toBe(GENERICO);
      expect(await vinculos(producto)).toEqual([]);
    });
  });
});
