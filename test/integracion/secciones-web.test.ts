import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  cambiarElEstadoDeLaSeccion,
  crearLaSeccion,
  moverUnaSeccion,
  renombrarLaSeccion,
  verLaSeccion,
  verLasSecciones,
  verUnaSeccion,
  type DependenciasDeSeccionesWeb,
} from "../../src/composicion/secciones-web";
import {
  agregarElProducto,
  quitarElProducto,
  verLosCandidatos,
  type DependenciasDeProductosDeSeccionWeb,
} from "../../src/composicion/productos-de-seccion-web";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La pantalla «Secciones de la carta» de la web (`secciones-web.ts`, A8 parte 1) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita, que una
 * empresa no ve ni toca las secciones de otra, que el permiso y el módulo en desarrollo los deciden la consulta y el caso de uso, crear dos veces con el mismo id (una sola sección, aunque
 * el orden que se calcule ahora sea otro), dos reordenamientos a la vez con la misma versión (uno gana, el otro recibe el genérico y no escribe), renombrar con una versión vieja y
 * que desactivar y reactivar repetidos no escriben ni auditan de nuevo. Los casos de uso en sí tienen sus pruebas en `catalogo-casos-de-uso.test.ts` y `catalogo-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("secciones de la carta de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDeSeccionesWeb & DependenciasDeProductosDeSeccionWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real: `catalogo` sigue `en_desarrollo` y el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
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

  const nombre = (parte: string) => nombreAlAzarDeProducto(parte);
  const crear = (nombreDeLaSeccion: string, x: EscenarioDeCatalogo = e, id = nuevoId()) =>
    crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nombreDeLaSeccion });
  const nueva = async (nombreDeLaSeccion: string, x: EscenarioDeCatalogo = e): Promise<string> => {
    const r = await crear(nombreDeLaSeccion, x);
    if (!r.ok) throw new Error(`se esperaba la sección y vino ${r.error.codigo}`);
    return r.dato.seccionId;
  };
  const fila = (id: string) =>
    c.filas("select * from seccion_de_carta where id = $1", [id]).then((f) => f[0]);
  const auditorias = (id: string, accion: string) =>
    c.contar("select count(*) as n from auditoria_empresa where entidad_id = $1 and accion = $2", [
      id,
      accion,
    ]);
  const lista = async (contexto = e.gerente) => {
    const r = await verLasSecciones(d, contexto);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato.secciones;
  };
  const codigoDe = (r: { ok: true } | { ok: false; error: { codigo: string } }) =>
    r.ok ? "OK" : r.error.codigo;
  const nuevoProducto = async (x: EscenarioDeCatalogo, seccionDeCartaId: string) =>
    valorDe(
      await c.casos.crearProducto(x.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        seccionDeCartaId,
      }),
    ).productoId;
  /** Las secciones activas como las vería la pantalla: en orden, con su versión. */
  const vistas = async (x: EscenarioDeCatalogo) =>
    (await lista(x.gerente))
      .filter((s) => s.activa)
      .map((s) => ({ seccionId: s.id, versionEsperada: s.version }));

  it("crear escribe la sección con el siguiente orden, la deja en la lista y audita una vez", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    expect((await fila(a))?.["orden"]).toBe(0);
    expect((await fila(b))?.["orden"]).toBe(1);
    expect((await lista(x.gerente)).map((s) => s.id)).toEqual([a, b]);
    expect(await auditorias(a, "SECCION_DE_CARTA_CREADA")).toBe(1);
  });

  it("la lista trae todas, activas y desactivadas, con solo id, nombre, estado y versión", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    expect(codigoDe(await cambiarElEstadoDeLaSeccion(d, x.gerente, { seccionId: b }, false))).toBe(
      "OK",
    );
    const todas = await lista(x.gerente);
    expect(todas.map((s) => [s.id, s.activa])).toEqual([
      [a, true],
      [b, false],
    ]);
    for (const s of todas)
      expect(Object.keys(s).sort()).toEqual(["activa", "id", "nombre", "version"]);
  });

  it("la misma creación repetida (el mismo id) deja UNA sola sección y devuelve la misma, aunque la lista ya tenga otro máximo", async () => {
    const x = await c.escenario();
    const id = nuevoId();
    const nom = nombre("Entradas");
    const primera = await crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nom });
    expect(primera).toEqual({ ok: true, dato: { seccionId: id, yaExistia: false } });
    // Entre medio otra sección se agrega: el orden que se calcularía ahora para el mismo id sería otro.
    await nueva(nombre("Otra"), x);
    const segunda = await crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nom });
    expect(segunda).toEqual({ ok: true, dato: { seccionId: id, yaExistia: true } });
    expect(await c.contar("select count(*) as n from seccion_de_carta where id = $1", [id])).toBe(
      1,
    );
    expect(await auditorias(id, "SECCION_DE_CARTA_CREADA")).toBe(1);
    expect((await fila(id))?.["orden"]).toBe(0);
  });

  it("dos creaciones A LA VEZ con el mismo id dan una sola sección", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await c.escenario();
      const id = nuevoId();
      const nom = nombre("Simultánea");
      const r = await Promise.all([
        crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nom }),
        crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nom }),
      ]);
      expect(r.map(codigoDe)).toEqual(["OK", "OK"]);
      expect(
        await c.contar("select count(*) as n from seccion_de_carta where empresa_id = $1", [
          x.empresa,
        ]),
      ).toBe(1);
      expect(await auditorias(id, "SECCION_DE_CARTA_CREADA")).toBe(1);
    }
  });

  it("el mismo id con otro nombre se rechaza como el genérico y no pisa la sección", async () => {
    const x = await c.escenario();
    const id = nuevoId();
    await crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nombre("Original") });
    const antes = await fila(id);
    const r = await crearLaSeccion(d, x.gerente, { claveDeCreacion: id, nombre: nombre("Pisada") });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(await fila(id)).toEqual(antes);
  });

  it("un nombre repetido (sin distinguir mayúsculas) sale con su texto aprobado y no crea nada; un nombre vacío, como «Falta el nombre»", async () => {
    const x = await c.escenario();
    const nom = nombre("Cafés");
    await nueva(nom, x);
    const antes = await c.contar(
      "select count(*) as n from seccion_de_carta where empresa_id = $1",
      [x.empresa],
    );
    expect(await crear(nom.toUpperCase(), x)).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_SECCION_REPETIDA", campo: "nombre" },
    });
    expect(await crear("   ", x)).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" },
    });
    expect(
      await c.contar("select count(*) as n from seccion_de_carta where empresa_id = $1", [
        x.empresa,
      ]),
    ).toBe(antes);
  });

  it("renombrar escribe el nombre, conserva el orden, sube la versión una vez y audita", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    await nueva(nombre("Postres"), x);
    const { version, orden } = (await lista(x.gerente))[0] as { version: number; orden?: number };
    const nom = nombre("Cafetería");
    const r = await renombrarLaSeccion(d, x.gerente, {
      seccionId: a,
      versionEsperada: version,
      nombre: nom,
    });
    expect(r).toEqual({ ok: true, dato: { seccionId: a, version: version + 1 } });
    expect(await fila(a)).toMatchObject({ nombre: nom, orden: orden ?? 0, version: version + 1 });
    expect(await auditorias(a, "SECCION_DE_CARTA_EDITADA")).toBe(1);
  });

  it("renombrar con una versión vieja se rechaza como el genérico y no escribe", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const v = (await lista(x.gerente))[0]?.version as number;
    expect(
      codigoDe(
        await renombrarLaSeccion(d, x.gerente, {
          seccionId: a,
          versionEsperada: v,
          nombre: nombre("Primero"),
        }),
      ),
    ).toBe("OK");
    const despues = await fila(a);
    const vieja = await renombrarLaSeccion(d, x.gerente, {
      seccionId: a,
      versionEsperada: v,
      nombre: nombre("Segundo"),
    });
    expect(codigoDe(vieja)).toBe(GENERICO);
    expect(await fila(a)).toEqual(despues);
  });

  it("renombrar con el nombre de otra sección sale con el texto de nombre repetido y no escribe", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const otra = nombre("Postres");
    await nueva(otra, x);
    const v = (await lista(x.gerente))[0]?.version as number;
    const antes = await fila(a);
    expect(
      await renombrarLaSeccion(d, x.gerente, { seccionId: a, versionEsperada: v, nombre: otra }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_SECCION_REPETIDA", campo: "nombre" },
    });
    expect(await fila(a)).toEqual(antes);
  });

  it("dos renombrados A LA VEZ con la misma versión: uno gana, el otro recibe el genérico, la versión sube una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await c.escenario();
      const a = await nueva(nombre("Cafés"), x);
      const v = (await lista(x.gerente))[0]?.version as number;
      const r = await Promise.all(
        ["Uno", "Dos"].map((parte) =>
          renombrarLaSeccion(d, x.gerente, {
            seccionId: a,
            versionEsperada: v,
            nombre: nombre(parte),
          }),
        ),
      );
      expect(r.map(codigoDe).sort()).toEqual([GENERICO, "OK"]);
      expect((await fila(a))?.["version"]).toBe(v + 1);
      expect(await auditorias(a, "SECCION_DE_CARTA_EDITADA")).toBe(1);
    }
  });

  it("desactivar no toca los productos y reactivar los devuelve; repetirlos no escribe ni audita de nuevo", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const producto = await nuevoProducto(x, a);
    expect(codigoDe(await cambiarElEstadoDeLaSeccion(d, x.gerente, { seccionId: a }, false))).toBe(
      "OK",
    );
    expect(codigoDe(await cambiarElEstadoDeLaSeccion(d, x.gerente, { seccionId: a }, false))).toBe(
      "OK",
    );
    expect((await fila(a))?.["activa"]).toBe(false);
    expect(await auditorias(a, "SECCION_DE_CARTA_DESACTIVADA")).toBe(1);
    const p = await c.filas("select seccion_de_carta_id from producto where id = $1", [producto]);
    expect(p[0]?.["seccion_de_carta_id"]).toBe(a);
    expect(codigoDe(await cambiarElEstadoDeLaSeccion(d, x.gerente, { seccionId: a }, true))).toBe(
      "OK",
    );
    expect(codigoDe(await cambiarElEstadoDeLaSeccion(d, x.gerente, { seccionId: a }, true))).toBe(
      "OK",
    );
    expect((await fila(a))?.["activa"]).toBe(true);
    expect(await auditorias(a, "SECCION_DE_CARTA_REACTIVADA")).toBe(1);
  });

  it("la sección con sus productos: solo los activos de esa sección, en orden alfabético, con id y nombre", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const p1 = await nuevoProducto(x, a);
    const p2 = await nuevoProducto(x, a);
    const inactivo = await nuevoProducto(x, a);
    valorDe(await c.casos.desactivarProducto(x.gerente, { productoId: inactivo }));
    await nuevoProducto(x, b);
    const r = await verUnaSeccion(d, x.gerente, { seccionId: a, despues: "" });
    if (!r.ok) throw new Error(r.error.codigo);
    expect(r.dato.seccion.id).toBe(a);
    expect(r.dato.productos.map((p) => p.id).sort()).toEqual([p1, p2].sort());
    const nombres = r.dato.productos.map((p) => p.nombre);
    expect(nombres).toEqual(
      [...nombres].sort((m, n) => m.toLowerCase().localeCompare(n.toLowerCase())),
    );
    for (const p of r.dato.productos)
      expect(Object.keys(p).sort()).toEqual(["id", "nombre", "version"]);
    expect(r.dato.siguiente).toBeNull();
    // Una sección desactivada se ve, con sus productos.
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId: b }));
    const apagada = await verUnaSeccion(d, x.gerente, { seccionId: b, despues: "" });
    expect(apagada.ok && [apagada.dato.seccion.activa, apagada.dato.productos.length]).toEqual([
      false,
      1,
    ]);
  });

  it("reordenar: un toque intercambia con la vecina, escribe el orden nuevo una vez y audita; subir la primera no escribe", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const cc = await nueva(nombre("Bebidas"), x);
    const r = await moverUnaSeccion(d, x.gerente, {
      vistas: await vistas(x),
      seccionId: cc,
      sentido: "ARRIBA",
    });
    expect(r).toEqual({ ok: true, dato: { movidas: 2 } });
    expect((await lista(x.gerente)).map((s) => s.id)).toEqual([a, cc, b]);
    expect(await auditorias(cc, "SECCIONES_DE_CARTA_REORDENADAS")).toBe(1);
    const antes = await c.filas(
      "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
      [x.empresa],
    );
    const borde = await moverUnaSeccion(d, x.gerente, {
      vistas: await vistas(x),
      seccionId: a,
      sentido: "ARRIBA",
    });
    expect(borde).toEqual({ ok: true, dato: { movidas: 0 } });
    expect(
      await c.filas(
        "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
        [x.empresa],
      ),
    ).toEqual(antes);
  });

  it("las desactivadas no entran en el orden: reordenar mueve solo a las activas y la desactivada conserva el suyo", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const apagada = await nueva(nombre("Postres"), x);
    const cc = await nueva(nombre("Bebidas"), x);
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId: apagada }));
    const ordenAntes = (await fila(apagada))?.["orden"];
    const r = await moverUnaSeccion(d, x.gerente, {
      vistas: await vistas(x),
      seccionId: cc,
      sentido: "ARRIBA",
    });
    expect(codigoDe(r)).toBe("OK");
    expect((await fila(apagada))?.["orden"]).toBe(ordenAntes);
    expect((await fila(cc))?.["orden"]).toBe(0);
    expect((await fila(a))?.["orden"]).toBe(1);
  });

  it("dos reordenamientos A LA VEZ con las mismas versiones: uno gana, el otro recibe el genérico y no escribe", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await c.escenario();
      const a = await nueva(nombre("Cafés"), x);
      const b = await nueva(nombre("Postres"), x);
      const cc = await nueva(nombre("Bebidas"), x);
      const vistas0 = await vistas(x);
      const r = await Promise.all([
        moverUnaSeccion(d, x.gerente, { vistas: vistas0, seccionId: cc, sentido: "ARRIBA" }),
        moverUnaSeccion(d, x.gerente, { vistas: vistas0, seccionId: a, sentido: "ABAJO" }),
      ]);
      expect(r.map(codigoDe).sort()).toEqual([GENERICO, "OK"]);
      // El orden que quedó es el de UNO de los dos toques, completo: nunca una mezcla.
      const orden = (await lista(x.gerente)).map((s) => s.id);
      expect([[a, cc, b].join(), [b, a, cc].join()]).toContain(orden.join());
      expect(await auditorias(cc, "SECCIONES_DE_CARTA_REORDENADAS")).toBeLessThanOrEqual(1);
    }
  });

  it("el mismo toque repetido (doble toque) con las mismas versiones es éxito y no escribe de nuevo", async () => {
    const x = await c.escenario();
    await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const vistas0 = await vistas(x);
    const pedido = { vistas: vistas0, seccionId: b, sentido: "ARRIBA" };
    expect(await moverUnaSeccion(d, x.gerente, pedido)).toMatchObject({ ok: true });
    const despues = await c.filas(
      "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
      [x.empresa],
    );
    expect(await moverUnaSeccion(d, x.gerente, pedido)).toEqual({ ok: true, dato: { movidas: 0 } });
    expect(
      await c.filas(
        "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
        [x.empresa],
      ),
    ).toEqual(despues);
  });

  it("reordenar con una versión vieja, o sin una de las activas (la creó otra persona), se rechaza como el genérico y no escribe", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const vistas0 = await vistas(x);
    // Otra persona renombra a la primera: su versión cambió.
    valorDe(
      await c.casos.editarSeccionDeCarta(x.gerente, {
        seccionId: a,
        versionEsperada: vistas0[0]?.versionEsperada as number,
        nombre: nombre("Renombrada"),
        orden: 0,
      }),
    );
    const antes = await c.filas(
      "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
      [x.empresa],
    );
    expect(
      codigoDe(
        await moverUnaSeccion(d, x.gerente, { vistas: vistas0, seccionId: b, sentido: "ARRIBA" }),
      ),
    ).toBe(GENERICO);
    // Y con una sección menos (alguien creó otra: la lista que se vio está incompleta).
    await nueva(nombre("Nueva"), x);
    const actuales = await vistas(x);
    expect(
      codigoDe(
        await moverUnaSeccion(d, x.gerente, {
          vistas: actuales.slice(0, 2),
          seccionId: b,
          sentido: "ARRIBA",
        }),
      ),
    ).toBe(GENERICO);
    const despues = await c.filas(
      "select id, orden, version from seccion_de_carta where empresa_id = $1 order by id",
      [x.empresa],
    );
    expect(despues.filter((f) => antes.some((q) => q["id"] === f["id"]))).toEqual(antes);
  });

  it("aislamiento: una empresa no ve ni toca las secciones de otra, y no se distingue de una que no existe", async () => {
    const otra = await c.escenario();
    const reservada = await nueva(nombre("Reservada"), otra);
    const antes = await fila(reservada);
    expect((await lista(e.gerente)).some((s) => s.id === reservada)).toBe(false);
    for (const r of [
      await verLaSeccion(d, e.gerente, reservada),
      await verUnaSeccion(d, e.gerente, { seccionId: reservada, despues: "" }),
      await verLaSeccion(d, e.gerente, nuevoId()),
      await renombrarLaSeccion(d, e.gerente, {
        seccionId: reservada,
        versionEsperada: 1,
        nombre: nombre("Robada"),
      }),
      await cambiarElEstadoDeLaSeccion(d, e.gerente, { seccionId: reservada }, false),
      await moverUnaSeccion(d, e.gerente, {
        vistas: [{ seccionId: reservada, versionEsperada: 1 }],
        seccionId: reservada,
        sentido: "ARRIBA",
      }),
    ]) {
      expect(codigoDe(r)).toBe(GENERICO);
      expect(JSON.stringify(r)).not.toContain("Reservada");
    }
    expect(await fila(reservada)).toEqual(antes);
  });

  it("el permiso lo deciden la consulta y el caso de uso: el operador ve pero no cambia; el administrador de una sola sucursal no cambia (alcance)", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const antes = await fila(a);
    expect((await lista(x.operador)).map((s) => s.id)).toEqual([a]);
    expect(
      await crearLaSeccion(d, x.operador, { claveDeCreacion: nuevoId(), nombre: nombre("N") }),
    ).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const v = (await lista(x.gerente))[0]?.version as number;
    expect(
      await renombrarLaSeccion(d, x.operador, {
        seccionId: a,
        versionEsperada: v,
        nombre: nombre("X"),
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(await cambiarElEstadoDeLaSeccion(d, x.operador, { seccionId: a }, false)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(
      await moverUnaSeccion(d, x.operador, {
        vistas: await vistas(x),
        seccionId: a,
        sentido: "ABAJO",
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await cambiarElEstadoDeLaSeccion(d, x.administradorDeUnaSucursal, { seccionId: a }, false),
    ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await fila(a)).toEqual(antes);
    expect(
      codigoDe(await cambiarElEstadoDeLaSeccion(d, x.administrador, { seccionId: a }, false)),
    ).toBe("OK");
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDeSeccionesWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const resultados = [
        await verLasSecciones(dependencias, contexto),
        await verLaSeccion(dependencias, contexto, nuevoId()),
        await verUnaSeccion(dependencias, contexto, { seccionId: nuevoId(), despues: "" }),
        await crearLaSeccion(dependencias, contexto, {
          claveDeCreacion: nuevoId(),
          nombre: "Cerrada",
        }),
        await cambiarElEstadoDeLaSeccion(dependencias, contexto, { seccionId: nuevoId() }, false),
        await moverUnaSeccion(dependencias, contexto, {
          vistas: [{ seccionId: nuevoId(), versionEsperada: 1 }],
          seccionId: nuevoId(),
          sentido: "ARRIBA",
        }),
      ];
      for (const r of resultados) {
        expect(r).toMatchObject({ ok: false });
        expect(JSON.stringify(r)).not.toContain("Cerrada");
      }
      expect(resultados[0]).toMatchObject({
        error: { codigo: "MODULO_EN_DESARROLLO", presentacion: "POR_QUE_NO_PUEDO" },
      });
    }
  });

  // ---------- Parte 2: agregar y quitar productos de una sección ----------

  /** Un producto de la clase dada, con o sin sección; devuelve su id y su versión vigente. */
  const productoDe = async (
    x: EscenarioDeCatalogo,
    seccionDeCartaId: string | null,
    claseDeUso: "VENDIBLE" | "REVENTA" | "INSUMO" = "VENDIBLE",
    parte = "Producto",
  ) => {
    const id = nuevoId();
    valorDe(
      await c.casos.crearProducto(x.gerente, {
        id,
        claseDeUso,
        nombre: nombreAlAzarDeProducto(parte),
        unidadBaseId: "UNIDAD",
        ...(claseDeUso === "INSUMO" ? {} : { alicuota: "21" }),
        ...(seccionDeCartaId === null ? {} : { seccionDeCartaId }),
      }),
    );
    return id;
  };
  const productoEnBase = (id: string) =>
    c
      .filas("select seccion_de_carta_id, version from producto where id = $1", [id])
      .then((f) => f[0] as { seccion_de_carta_id: string | null; version: number });
  const auditoriasDelProducto = (id: string) => auditorias(id, "PRODUCTO_EDITADO");
  /** Lo que la pantalla de la sección o de «Agregar» liga a la acción: el producto como se vio, con su versión. */
  const visto = async (id: string) => [
    { productoId: id, versionEsperada: (await productoEnBase(id)).version },
  ];
  const tocar = async (
    que: typeof agregarElProducto,
    x: EscenarioDeCatalogo,
    seccionId: string,
    productoId: string,
    vistasDe?: { productoId: string; versionEsperada: number }[],
  ) => que(d, x.gerente, { seccionId, vistas: vistasDe ?? (await visto(productoId)), productoId });

  it("agregar pone el producto en la sección (aunque estuviera en otra), sube su versión una vez y audita una; la sección se ve en su lista", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const p = await productoDe(x, b);
    const antes = await productoEnBase(p);
    const r = await tocar(agregarElProducto, x, a, p);
    expect(r).toEqual({ ok: true, dato: { productoId: p, version: antes.version + 1 } });
    expect((await productoEnBase(p)).seccion_de_carta_id).toBe(a);
    expect(await auditoriasDelProducto(p)).toBe(1);
    const enLaSeccion = await verUnaSeccion(d, x.gerente, { seccionId: a, despues: "" });
    expect(enLaSeccion.ok && enLaSeccion.dato.productos.map((q) => q.id)).toEqual([p]);
  });

  it("quitar deja el producto sin sección (no lo desactiva ni lo borra), sube su versión una vez y audita una", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const p = await productoDe(x, a);
    const antes = await productoEnBase(p);
    expect(await tocar(quitarElProducto, x, a, p)).toEqual({
      ok: true,
      dato: { productoId: p, version: antes.version + 1 },
    });
    expect((await productoEnBase(p)).seccion_de_carta_id).toBeNull();
    expect((await c.filas("select activo from producto where id = $1", [p]))[0]?.["activo"]).toBe(
      true,
    );
    expect(await auditoriasDelProducto(p)).toBe(1);
  });

  it("IDEMPOTENCIA: agregar o quitar dos veces seguidas con lo mismo que vio la pantalla escribe y audita UNA vez; la segunda es éxito sin escribir", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const p = await productoDe(x, null);
    const vistaVieja = await visto(p);
    for (let i = 0; i < 2; i++) {
      expect(codigoDe(await tocar(agregarElProducto, x, a, p, vistaVieja))).toBe("OK");
    }
    const tras = await productoEnBase(p);
    expect(tras.seccion_de_carta_id).toBe(a);
    expect(tras.version).toBe((vistaVieja[0]?.versionEsperada as number) + 1);
    expect(await auditoriasDelProducto(p)).toBe(1);
    const vistaDeQuitar = await visto(p);
    for (let i = 0; i < 2; i++) {
      expect(codigoDe(await tocar(quitarElProducto, x, a, p, vistaDeQuitar))).toBe("OK");
    }
    expect((await productoEnBase(p)).seccion_de_carta_id).toBeNull();
    expect((await productoEnBase(p)).version).toBe(tras.version + 1);
    expect(await auditoriasDelProducto(p)).toBe(2);
  });

  it("CONCURRENCIA: dos «Agregar» a la vez del mismo producto (misma versión) dejan UNA escritura, una auditoría y la sección elegida", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await c.escenario();
      const a = await nueva(nombre("Cafés"), x);
      const p = await productoDe(x, null);
      const vistaDe = await visto(p);
      const r = await Promise.all([
        tocar(agregarElProducto, x, a, p, vistaDe),
        tocar(agregarElProducto, x, a, p, vistaDe),
      ]);
      expect(r.map(codigoDe)).toEqual(["OK", "OK"]);
      expect((await productoEnBase(p)).seccion_de_carta_id).toBe(a);
      expect((await productoEnBase(p)).version).toBe((vistaDe[0]?.versionEsperada as number) + 1);
      expect(await auditoriasDelProducto(p)).toBe(1);
    }
  });

  it("CONCURRENCIA: dos personas llevan el MISMO producto a secciones distintas a la vez: una gana, la otra recibe el genérico, y no se pisa (queda la ganadora)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const x = await c.escenario();
      const a = await nueva(nombre("Cafés"), x);
      const b = await nueva(nombre("Postres"), x);
      const p = await productoDe(x, null);
      const vistaDe = await visto(p);
      const r = await Promise.all([
        tocar(agregarElProducto, x, a, p, vistaDe),
        tocar(agregarElProducto, x, b, p, vistaDe),
      ]);
      expect(r.map(codigoDe).sort()).toEqual([GENERICO, "OK"]);
      const ganadora = r[0]?.ok ? a : b;
      expect((await productoEnBase(p)).seccion_de_carta_id).toBe(ganadora);
      expect(await auditoriasDelProducto(p)).toBe(1);
    }
  });

  it("con una versión vieja (otra persona editó el producto antes) se rechaza como el genérico, sin escribir ni auditar de más; quitar lo que otra persona ya movió también", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const p = await productoDe(x, a);
    const vistaVieja = await visto(p);
    // Otra persona lo pasa a «Postres» (sube la versión).
    valorDe(
      await c.casos.editarProducto(x.gerente, {
        productoId: p,
        versionEsperada: vistaVieja[0]?.versionEsperada as number,
        seccionDeCartaId: b,
      }),
    );
    const antes = await productoEnBase(p);
    expect(codigoDe(await tocar(quitarElProducto, x, a, p, vistaVieja))).toBe(GENERICO);
    expect(codigoDe(await tocar(agregarElProducto, x, a, p, vistaVieja))).toBe(GENERICO);
    expect(await productoEnBase(p)).toEqual(antes);
    expect(await auditoriasDelProducto(p)).toBe(1);
  });

  it("una versión que la persona no vio (el producto no está en lo ligado) no escribe: el genérico", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const p = await productoDe(x, null);
    const otro = await productoDe(x, null);
    const antes = await productoEnBase(p);
    expect(codigoDe(await tocar(agregarElProducto, x, a, p, await visto(otro)))).toBe(GENERICO);
    expect(await productoEnBase(p)).toEqual(antes);
  });

  it("agregar a una sección desactivada o de otra empresa, o un producto de otra empresa o desactivado, es el genérico y no escribe", async () => {
    const x = await c.escenario();
    const y = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const apagada = await nueva(nombre("Apagada"), x);
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId: apagada }));
    const ajena = await nueva(nombre("Ajena"), y);
    const p = await productoDe(x, null);
    const pAjeno = await productoDe(y, null);
    const inactivo = await productoDe(x, null);
    valorDe(await c.casos.desactivarProducto(x.gerente, { productoId: inactivo }));
    const antes = [
      await productoEnBase(p),
      await productoEnBase(pAjeno),
      await productoEnBase(inactivo),
    ];
    expect(codigoDe(await tocar(agregarElProducto, x, apagada, p))).toBe(GENERICO);
    expect(codigoDe(await tocar(agregarElProducto, x, ajena, p))).toBe(GENERICO);
    expect(codigoDe(await tocar(agregarElProducto, x, a, pAjeno))).toBe(GENERICO);
    expect(codigoDe(await tocar(agregarElProducto, x, a, inactivo))).toBe(GENERICO);
    expect(codigoDe(await tocar(quitarElProducto, x, a, pAjeno))).toBe(GENERICO);
    expect([
      await productoEnBase(p),
      await productoEnBase(pAjeno),
      await productoEnBase(inactivo),
    ]).toEqual(antes);
  });

  it("los candidatos: solo lo que se vende (vendible y reventa), activo, sin los que ya están en la sección, con su sección de hoy; los insumos no aparecen y la búsqueda filtra por nombre", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const b = await nueva(nombre("Postres"), x);
    const marca = nombre("Zzcand");
    const vendible = await productoDe(x, null, "VENDIBLE", marca);
    const reventa = await productoDe(x, b, "REVENTA", marca);
    const yaEsta = await productoDe(x, a, "VENDIBLE", marca);
    await productoDe(x, null, "INSUMO", marca);
    const inactivo = await productoDe(x, null, "VENDIBLE", marca);
    valorDe(await c.casos.desactivarProducto(x.gerente, { productoId: inactivo }));
    const r = await verLosCandidatos(d, x.gerente, { seccionId: a, texto: marca, despues: "" });
    if (!r.ok) throw new Error(r.error.codigo);
    expect(r.dato.candidatos.map((q) => q.id).sort()).toEqual([vendible, reventa].sort());
    expect(r.dato.candidatos.find((q) => q.id === yaEsta)).toBeUndefined();
    expect(r.dato.candidatos.find((q) => q.id === reventa)?.seccion).toBe(
      (await lista(x.gerente)).find((s) => s.id === b)?.nombre,
    );
    expect(r.dato.candidatos.find((q) => q.id === vendible)?.seccion).toBeNull();
    for (const q of r.dato.candidatos)
      expect(Object.keys(q).sort()).toEqual([
        "faltaCompletar",
        "id",
        "nombre",
        "seccion",
        "version",
      ]);
    const sinCoincidencia = await verLosCandidatos(d, x.gerente, {
      seccionId: a,
      texto: `${marca}-no-existe`,
      despues: "",
    });
    expect(sinCoincidencia.ok && sinCoincidencia.dato.candidatos).toEqual([]);
  });

  it("los candidatos no mezclan empresas: una sección de otra empresa es el genérico y los productos de otra no salen", async () => {
    const x = await c.escenario();
    const y = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const ajena = await nueva(nombre("Ajena"), y);
    const marca = nombre("Zzaislado");
    await productoDe(y, null, "VENDIBLE", marca);
    expect(
      codigoDe(await verLosCandidatos(d, x.gerente, { seccionId: ajena, texto: "", despues: "" })),
    ).toBe(GENERICO);
    const r = await verLosCandidatos(d, x.gerente, { seccionId: a, texto: marca, despues: "" });
    expect(r.ok && r.dato.candidatos).toEqual([]);
  });

  it("el permiso lo decide el caso de uso: el operador ve los candidatos pero no agrega ni quita; el administrador de una sola sucursal tampoco (alcance)", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const p = await productoDe(x, null);
    const q = await productoDe(x, a);
    const antes = [await productoEnBase(p), await productoEnBase(q)];
    expect(
      (await verLosCandidatos(d, x.operador, { seccionId: a, texto: "", despues: "" })).ok,
    ).toBe(true);
    for (const contexto of [x.operador, x.administradorDeUnaSucursal]) {
      const agregado = await agregarElProducto(d, contexto, {
        seccionId: a,
        vistas: await visto(p),
        productoId: p,
      });
      const quitado = await quitarElProducto(d, contexto, {
        seccionId: a,
        vistas: await visto(q),
        productoId: q,
      });
      expect(agregado.ok || quitado.ok).toBe(false);
    }
    expect(
      await agregarElProducto(d, x.operador, {
        seccionId: a,
        vistas: await visto(p),
        productoId: p,
      }),
    ).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect([await productoEnBase(p), await productoEnBase(q)]).toEqual(antes);
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) agregar, quitar y los candidatos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDeSeccionesWeb & DependenciasDeProductosDeSeccionWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    const ids = {
      seccionId: nuevoId(),
      vistas: [] as { productoId: string; versionEsperada: number }[],
      productoId: nuevoId(),
    };
    ids.vistas.push({ productoId: ids.productoId, versionEsperada: 1 });
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      for (const r of [
        await verLosCandidatos(dependencias, contexto, {
          seccionId: ids.seccionId,
          texto: "",
          despues: "",
        }),
        await agregarElProducto(dependencias, contexto, ids),
        await quitarElProducto(dependencias, contexto, ids),
      ]) {
        expect(r).toMatchObject({ ok: false });
      }
    }
    expect(await agregarElProducto(dependencias, x.gerente, ids)).toMatchObject({
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
  });

  it("ver los candidatos es una lectura: no escribe ni audita", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const p = await productoDe(x, null);
    const auditoriaAntes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [x.empresa],
    );
    const antes = await productoEnBase(p);
    await verLosCandidatos(d, x.gerente, { seccionId: a, texto: "", despues: "" });
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        x.empresa,
      ]),
    ).toBe(auditoriaAntes);
    expect(await productoEnBase(p)).toEqual(antes);
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const x = await c.escenario();
    const a = await nueva(nombre("Cafés"), x);
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [x.empresa],
    );
    const filaAntes = await fila(a);
    await lista(x.gerente);
    await lista(x.operador);
    await verUnaSeccion(d, x.gerente, { seccionId: a, despues: "" });
    await verLaSeccion(d, x.gerente, a);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        x.empresa,
      ]),
    ).toBe(antes);
    expect(await fila(a)).toEqual(filaAntes);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const roto: DependenciasDeSeccionesWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base dijo: relation seccion_x does not exist");
      },
    };
    const r = await verLasSecciones(roto, e.gerente);
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("relation");
    expect(registrados.some((z) => z.includes("relation seccion_x"))).toBe(true);
  });
});
