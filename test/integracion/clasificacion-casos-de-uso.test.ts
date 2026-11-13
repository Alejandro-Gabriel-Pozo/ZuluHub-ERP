import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MAXIMO_DE_NIVELES_DE_CLASIFICACION } from "../../src/primitivas/clasificacion/arbol";
import { agotadaEnElResultado, repetirSiAgotada } from "./concurrencia-apoyo";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * A2b T-B: los casos de uso y las consultas de la clasificación comercial contra una base real, con el rol de la aplicación y el contexto firmado: permisos y alcance,
 * aislamiento entre empresas, idempotencia de cada comando, las reglas del árbol (ciclo, tope, departamento fijo, activo e inactivo), la auditoría y dos pedidos a la vez.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("clasificación comercial: casos de uso y consultas", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Crea un nodo con el gerente y devuelve su id. */
  const nodo = async (padreId: string | null = null, nombre = nombreAlAzarDeProducto("Nodo")) =>
    valorDe(await c.casos.crearNodoDeClasificacion(e.gerente, { id: nuevoId(), padreId, nombre }))
      .nodoId;
  const fila = async (id: string) =>
    (await c.filas("select * from nodo_de_clasificacion where id = $1", [id]))[0];
  const version = async (id: string) => Number((await fila(id))?.["version"]);
  const auditorias = (id: string) =>
    c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1", [id]);

  describe("permisos y alcance", () => {
    it("el operador ve pero no crea, renombra, mueve, desactiva ni reactiva; un administrador de una sola sucursal tampoco (alcance total)", async () => {
      const dep = await nodo();
      const cat = await nodo(dep);
      const dep2 = await nodo();
      const antes = await c.contar(
        "select count(*) as n from nodo_de_clasificacion where empresa_id = $1",
        [e.empresa],
      );
      for (const actor of [e.operador]) {
        expect(
          await c.casos.crearNodoDeClasificacion(actor, {
            id: nuevoId(),
            padreId: null,
            nombre: "Nuevo",
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.renombrarNodoDeClasificacion(actor, {
            nodoId: cat,
            versionEsperada: 1,
            nombre: "Otro",
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(
          await c.casos.moverNodoDeClasificacion(actor, {
            nodoId: cat,
            versionEsperada: 1,
            nuevoPadreId: dep2,
          }),
        ).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(await c.casos.desactivarNodoDeClasificacion(actor, { nodoId: cat })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await c.casos.reactivarNodoDeClasificacion(actor, { nodoId: cat })).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
      }
      expect(
        await c.casos.crearNodoDeClasificacion(e.administradorDeUnaSucursal, {
          id: nuevoId(),
          padreId: null,
          nombre: "Nuevo",
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      expect(
        await c.casos.crearNodoDeClasificacion(
          { ...e.gerente, personaId: null },
          { id: nuevoId(), padreId: null, nombre: "Nuevo" },
        ),
      ).toMatchObject({ ok: false });
      expect(
        await c.contar("select count(*) as n from nodo_de_clasificacion where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(antes);
      // Mirar sí: los tres roles.
      const lista = valorDe(await c.consultas.listarClasificacion(e.operador));
      expect(lista.some((n) => n.id === cat)).toBe(true);
      // El administrador con todas las sucursales sí crea.
      expect(
        (
          await c.casos.crearNodoDeClasificacion(e.administrador, {
            id: nuevoId(),
            padreId: dep,
            nombre: nombreAlAzarDeProducto("Cat"),
          })
        ).ok,
      ).toBe(true);
    });
  });

  describe("crear", () => {
    it("crear: repetir con el mismo id deja un nodo y una auditoría; con otro contenido, ID_REUTILIZADO", async () => {
      const id = nuevoId();
      const pedido = { id, padreId: null, nombre: nombreAlAzarDeProducto("Depto") };
      expect(await c.casos.crearNodoDeClasificacion(e.gerente, pedido)).toEqual({
        ok: true,
        valor: { nodoId: id, yaExistia: false },
      });
      expect(await c.casos.crearNodoDeClasificacion(e.gerente, pedido)).toEqual({
        ok: true,
        valor: { nodoId: id, yaExistia: true },
      });
      expect(
        await c.contar("select count(*) as n from nodo_de_clasificacion where id = $1", [id]),
      ).toBe(1);
      expect(await auditorias(id)).toBe(1);
      const registro = await c.auditoria(e.empresa, "CLASIFICACION_NODO_CREADO");
      expect(registro.find((r) => r["entidad_id"] === id)).toMatchObject({
        entidad: "nodo_de_clasificacion",
        actor_persona_id: e.personaDelGerente,
        despues: { nombre: pedido.nombre, padreId: null },
      });
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          ...pedido,
          nombre: nombreAlAzarDeProducto("Otro"),
        }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      const hijo = await nodo(id);
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: hijo,
          padreId: null,
          nombre: "Cualquiera",
        }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
    });

    it("valida la entrada: nombre, identificadores, padre inexistente, nombre repetido entre hermanos", async () => {
      const dep = await nodo();
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: null,
          nombre: "",
        }),
      ).toEqual({ ok: false, error: "NOMBRE_DE_NODO_INVALIDO" });
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: null,
          nombre: "a<b",
        }),
      ).toEqual({ ok: false, error: "NOMBRE_DE_NODO_INVALIDO" });
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: "no-es-uuid",
          padreId: null,
          nombre: "X",
        }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: "no-es-uuid",
          nombre: "X",
        }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: nuevoId(),
          nombre: "X",
        }),
      ).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
      const nombre = nombreAlAzarDeProducto("Repetido");
      await nodo(dep, nombre);
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: dep,
          nombre: nombre.toUpperCase(),
        }),
      ).toEqual({ ok: false, error: "NODO_DUPLICADO" });
      expect(
        (
          await c.casos.crearNodoDeClasificacion(e.gerente, {
            id: nuevoId(),
            padreId: null,
            nombre,
          })
        ).ok,
      ).toBe(true); // el mismo nombre en otro nivel
    });

    it("el árbol no pasa del tope y no se crea bajo un nodo desactivado", async () => {
      let padre: string | null = null;
      for (let nivel = 1; nivel <= MAXIMO_DE_NIVELES_DE_CLASIFICACION; nivel += 1)
        padre = await nodo(padre);
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: padre,
          nombre: "Uno de más",
        }),
      ).toEqual({ ok: false, error: "TOPE_DE_NIVELES" });
      const dep = await nodo();
      const cat = await nodo(dep);
      valorDe(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: cat }));
      expect(
        await c.casos.crearNodoDeClasificacion(e.gerente, {
          id: nuevoId(),
          padreId: cat,
          nombre: "Bajo inactivo",
        }),
      ).toEqual({ ok: false, error: "PADRE_DESACTIVADO" });
    });
  });

  describe("renombrar", () => {
    it("renombrar: repetir con el mismo nombre devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const id = await nodo();
      const nombre = nombreAlAzarDeProducto("Nuevo nombre");
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: id,
          versionEsperada: 1,
          nombre,
        }),
      ).toEqual({ ok: true, valor: { version: 2 } });
      expect(await auditorias(id)).toBe(2);
      // La repetición con la versión vieja devuelve lo vigente: no escribe ni audita.
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: id,
          versionEsperada: 1,
          nombre,
        }),
      ).toEqual({ ok: true, valor: { version: 2 } });
      expect(await version(id)).toBe(2);
      expect(await auditorias(id)).toBe(2);
      const renombrado = await c.auditoria(e.empresa, "CLASIFICACION_NODO_RENOMBRADO");
      expect(renombrado.find((r) => r["entidad_id"] === id)).toMatchObject({ despues: { nombre } });
    });

    it("con una versión vieja y otro nombre se rechaza; un nombre repetido entre hermanos, también; uno inexistente o ajeno no existe", async () => {
      const dep = await nodo();
      const a = await nodo(dep);
      const b = await nodo(dep, nombreAlAzarDeProducto("B"));
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: a,
          versionEsperada: 7,
          nombre: "Otro nombre",
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: a,
          versionEsperada: 1,
          nombre: String((await fila(b))?.["nombre"]),
        }),
      ).toEqual({ ok: false, error: "NODO_DUPLICADO" });
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: a,
          versionEsperada: 1,
          nombre: "",
        }),
      ).toEqual({ ok: false, error: "NOMBRE_DE_NODO_INVALIDO" });
      expect(
        await c.casos.renombrarNodoDeClasificacion(e.gerente, {
          nodoId: nuevoId(),
          versionEsperada: 1,
          nombre: "X",
        }),
      ).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
      expect(await version(a)).toBe(1);
    });
  });

  describe("mover", () => {
    it("mover: repetir el movimiento ya aplicado es yaEstaba, aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const dep1 = await nodo();
      const dep2 = await nodo();
      const cat = await nodo(dep1);
      expect(
        await c.casos.moverNodoDeClasificacion(e.gerente, {
          nodoId: cat,
          versionEsperada: 1,
          nuevoPadreId: dep2,
        }),
      ).toEqual({ ok: true, valor: { version: 2, yaEstaba: false } });
      expect(await auditorias(cat)).toBe(2);
      expect(
        await c.casos.moverNodoDeClasificacion(e.gerente, {
          nodoId: cat,
          versionEsperada: 1,
          nuevoPadreId: dep2,
        }),
      ).toEqual({ ok: true, valor: { version: 2, yaEstaba: true } });
      expect(await version(cat)).toBe(2);
      expect(await auditorias(cat)).toBe(2);
      const movido = await c.auditoria(e.empresa, "CLASIFICACION_NODO_MOVIDO");
      expect(movido.find((r) => r["entidad_id"] === cat)).toMatchObject({
        antes: { padreId: dep1 },
        despues: { padreId: dep2 },
      });
      expect(String((await fila(cat))?.["padre_id"])).toBe(dep2);
    });

    it("rechaza el ciclo, el departamento, el tope (con todo el subárbol), un destino desactivado y una versión vieja; no cambia nada", async () => {
      const dep = await nodo();
      const a = await nodo(dep);
      const b = await nodo(a);
      const otro = await nodo();
      const o1 = await nodo(otro);
      const o2 = await nodo(o1);
      const inactivo = await nodo();
      valorDe(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: inactivo }));
      const mover = (nodoId: string, nuevoPadreId: string, versionEsperada = 1) =>
        c.casos.moverNodoDeClasificacion(e.gerente, { nodoId, versionEsperada, nuevoPadreId });
      expect(await mover(a, b)).toEqual({ ok: false, error: "CICLO" });
      expect(await mover(a, a)).toEqual({ ok: false, error: "CICLO" });
      expect(await mover(dep, otro)).toEqual({ ok: false, error: "DEPARTAMENTO_NO_SE_MUEVE" });
      // `a` con `b` debajo (altura 2) bajo `o1` (nivel 2) llega al nivel 4: justo, pasa; bajo `o2` (nivel 3) llegaría al 5.
      expect(await mover(a, o2)).toEqual({ ok: false, error: "TOPE_DE_NIVELES" });
      expect(await mover(a, inactivo)).toEqual({ ok: false, error: "PADRE_DESACTIVADO" });
      expect(await mover(a, nuevoId())).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
      expect(await mover(a, otro, 9)).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
      expect(await mover(nuevoId(), otro)).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
      expect(await mover("no-es-uuid", otro)).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(String((await fila(a))?.["padre_id"])).toBe(dep);
      expect(await version(a)).toBe(1);
      expect((await mover(a, o1)).ok).toBe(true);
    });
  });

  describe("desactivar y reactivar", () => {
    it("desactivar y reactivar: repetir cada uno es yaEstaba y no audita la segunda vez", async () => {
      const dep = await nodo();
      const cat = await nodo(dep);
      expect(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: cat })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: cat })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect(await auditorias(cat)).toBe(2);
      expect(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: cat })).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: cat })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect(await auditorias(cat)).toBe(3);
      expect(
        (await c.auditoria(e.empresa, "CLASIFICACION_NODO_DESACTIVADO")).find(
          (r) => r["entidad_id"] === cat,
        ),
      ).toMatchObject({ antes: { activo: true }, despues: { activo: false } });
      expect(
        (await c.auditoria(e.empresa, "CLASIFICACION_NODO_REACTIVADO")).find(
          (r) => r["entidad_id"] === cat,
        ),
      ).toMatchObject({ antes: { activo: false }, despues: { activo: true } });
    });

    it("no se desactiva con hijos activos ni se reactiva con el padre desactivado; un nodo inexistente no existe", async () => {
      const dep = await nodo();
      const cat = await nodo(dep);
      expect(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: dep })).toEqual({
        ok: false,
        error: "TIENE_HIJOS_ACTIVOS",
      });
      valorDe(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: cat }));
      valorDe(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: dep }));
      expect(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: cat })).toEqual({
        ok: false,
        error: "PADRE_DESACTIVADO",
      });
      valorDe(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: dep }));
      valorDe(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: cat }));
      expect(await c.casos.desactivarNodoDeClasificacion(e.gerente, { nodoId: nuevoId() })).toEqual(
        { ok: false, error: "NODO_INEXISTENTE" },
      );
      expect(await c.casos.reactivarNodoDeClasificacion(e.gerente, { nodoId: nuevoId() })).toEqual({
        ok: false,
        error: "NODO_INEXISTENTE",
      });
    });
  });

  describe("aislamiento entre empresas", () => {
    it("la empresa B no ve ni cambia nodos de la empresa A (por id): mismo error que si no existieran", async () => {
      const b = await c.escenario();
      const dep = await nodo();
      const cat = await nodo(dep);
      const propio = valorDe(
        await c.casos.crearNodoDeClasificacion(b.gerente, {
          id: nuevoId(),
          padreId: null,
          nombre: nombreAlAzarDeProducto("De B"),
        }),
      ).nodoId;
      expect(valorDe(await c.consultas.listarClasificacion(b.gerente)).map((n) => n.id)).toEqual([
        propio,
      ]);
      expect(
        await c.casos.renombrarNodoDeClasificacion(b.gerente, {
          nodoId: cat,
          versionEsperada: 1,
          nombre: "Hackeado",
        }),
      ).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
      expect(
        await c.casos.moverNodoDeClasificacion(b.gerente, {
          nodoId: cat,
          versionEsperada: 1,
          nuevoPadreId: propio,
        }),
      ).toEqual({ ok: false, error: "NODO_INEXISTENTE" });
      const propiaCategoria = valorDe(
        await c.casos.crearNodoDeClasificacion(b.gerente, {
          id: nuevoId(),
          padreId: propio,
          nombre: nombreAlAzarDeProducto("Cat de B"),
        }),
      ).nodoId;
      // Un destino de otra empresa es indistinguible de uno inexistente.
      expect(
        await c.casos.moverNodoDeClasificacion(b.gerente, {
          nodoId: propiaCategoria,
          versionEsperada: 1,
          nuevoPadreId: dep,
        }),
      ).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
      expect(await c.casos.desactivarNodoDeClasificacion(b.gerente, { nodoId: cat })).toEqual({
        ok: false,
        error: "NODO_INEXISTENTE",
      });
      expect(
        await c.casos.crearNodoDeClasificacion(b.gerente, {
          id: nuevoId(),
          padreId: dep,
          nombre: "Colado",
        }),
      ).toEqual({ ok: false, error: "PADRE_INEXISTENTE" });
      expect(
        await c.casos.crearNodoDeClasificacion(b.gerente, {
          id: cat,
          padreId: null,
          nombre: "Reuso de id ajeno",
        }),
      ).toMatchObject({ ok: false });
      expect(await version(cat)).toBe(1);
      expect(String((await fila(cat))?.["padre_id"])).toBe(dep);
    });
  });

  describe("consultas", () => {
    it("la lista trae todos los nodos con su nivel y por nombre; los destinos de un movimiento son los que el servidor acepta", async () => {
      const x = await c.escenario();
      const mk = async (padreId: string | null, nombre: string) =>
        valorDe(
          await c.casos.crearNodoDeClasificacion(x.gerente, { id: nuevoId(), padreId, nombre }),
        ).nodoId;
      const restaurante = await mk(null, "Restaurante");
      const alojamiento = await mk(null, "Alojamiento");
      const bebidas = await mk(restaurante, "Bebidas");
      const gaseosas = await mk(bebidas, "Gaseosas");
      valorDe(await c.casos.desactivarNodoDeClasificacion(x.gerente, { nodoId: gaseosas }));
      const lista = valorDe(await c.consultas.listarClasificacion(x.operador));
      expect(lista.map((n) => [n.nombre, n.nivel, n.activo])).toEqual([
        ["Alojamiento", 1, true],
        ["Bebidas", 2, true],
        ["Gaseosas", 3, false],
        ["Restaurante", 1, true],
      ]);
      expect(lista.find((n) => n.id === bebidas)).toMatchObject({
        padreId: restaurante,
        version: 1,
      });
      // Bebidas (con Gaseosas debajo, altura 2) puede ir bajo Alojamiento o bajo Restaurante (ya está ahí), no bajo sí misma ni bajo su hija.
      expect(
        valorDe(await c.consultas.destinosParaMoverNodo(x.operador, { nodoId: bebidas })),
      ).toEqual([alojamiento, restaurante].sort());
      expect(
        valorDe(await c.consultas.destinosParaMoverNodo(x.operador, { nodoId: restaurante })),
      ).toEqual([]);
      expect(await c.consultas.destinosParaMoverNodo(x.operador, { nodoId: nuevoId() })).toEqual({
        ok: false,
        error: "NODO_INEXISTENTE",
      });
    });
  });

  describe("dos pedidos a la vez", () => {
    const firme = <R extends { readonly ok: boolean }>(trabajo: () => Promise<R>) =>
      repetirSiAgotada(trabajo, { esAgotada: (r) => agotadaEnElResultado(r as never) });
    const aLaVez = async <A, B>(
      pedidos: readonly [() => Promise<A>, () => Promise<B>],
    ): Promise<[A, B]> => {
      c.armarBarrera(2);
      try {
        return await Promise.all([pedidos[0](), pedidos[1]()]);
      } finally {
        c.soltarBarrera();
      }
    };

    it("dos movimientos cruzados, cada uno válido por separado, no dejan un ciclo: uno se aplica y el otro se rechaza", async () => {
      for (let ronda = 0; ronda < 4; ronda += 1) {
        const dep = await nodo();
        const a = await nodo(dep);
        const b = await nodo(dep);
        const [r1, r2] = await aLaVez([
          () =>
            firme(() =>
              c.casos.moverNodoDeClasificacion(e.gerente, {
                nodoId: a,
                versionEsperada: 1,
                nuevoPadreId: b,
              }),
            ),
          () =>
            firme(() =>
              c.casos.moverNodoDeClasificacion(e.gerente, {
                nodoId: b,
                versionEsperada: 1,
                nuevoPadreId: a,
              }),
            ),
        ]);
        const resultados = [r1, r2];
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, error: "CICLO" });
        // El árbol quedó sin ciclo: exactamente uno de los dos colgó del otro.
        const padres = [
          String((await fila(a))?.["padre_id"]),
          String((await fila(b))?.["padre_id"]),
        ];
        expect(padres.filter((p) => p === dep)).toHaveLength(1);
      }
    });

    it("el mismo alta a la vez crea un nodo: una es nueva y la otra yaExistia", async () => {
      const pedido = { id: nuevoId(), padreId: null, nombre: nombreAlAzarDeProducto("Doble") };
      const [r1, r2] = await aLaVez([
        () => firme(() => c.casos.crearNodoDeClasificacion(e.gerente, pedido)),
        () => firme(() => c.casos.crearNodoDeClasificacion(e.gerente, pedido)),
      ]);
      expect([r1, r2].every((r) => r.ok)).toBe(true);
      expect([r1, r2].map((r) => (r.ok ? r.valor.yaExistia : null)).sort()).toEqual([false, true]);
      expect(
        await c.contar("select count(*) as n from nodo_de_clasificacion where id = $1", [
          pedido.id,
        ]),
      ).toBe(1);
      expect(await auditorias(pedido.id)).toBe(1);
    });

    it("dos altas con el mismo nombre entre hermanos: una gana y la otra recibe NODO_DUPLICADO", async () => {
      const dep = await nodo();
      const nombre = nombreAlAzarDeProducto("Mismo nombre");
      const [r1, r2] = await aLaVez([
        () =>
          firme(() =>
            c.casos.crearNodoDeClasificacion(e.gerente, { id: nuevoId(), padreId: dep, nombre }),
          ),
        () =>
          firme(() =>
            c.casos.crearNodoDeClasificacion(e.gerente, { id: nuevoId(), padreId: dep, nombre }),
          ),
      ]);
      expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
      expect([r1, r2].find((r) => !r.ok)).toEqual({ ok: false, error: "NODO_DUPLICADO" });
    });
  });
});
