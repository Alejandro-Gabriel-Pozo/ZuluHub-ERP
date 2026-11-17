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
  let d: DependenciasDeSeccionesWeb;

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
      error: {
        codigo: "CATALOGO_SECCION_REPETIDA",
        clave: "catalogo.error.seccion_repetida",
        presentacion: "AVISO",
        campo: "nombre",
      },
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
      error: {
        codigo: "CATALOGO_SECCION_REPETIDA",
        clave: "catalogo.error.seccion_repetida",
        presentacion: "AVISO",
        campo: "nombre",
      },
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
    for (const p of r.dato.productos) expect(Object.keys(p).sort()).toEqual(["id", "nombre"]);
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

  it("con el catálogo en desarrollo (forzado: en el catálogo real es disponible, DEC-0463) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
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
