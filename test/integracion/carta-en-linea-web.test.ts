import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  cambiarElEstadoDeLaCartaEnLinea,
  guardarLaCartaEnLinea,
  verLaCartaEnLinea,
  type DependenciasDeCartaEnLineaWeb,
} from "../../src/composicion/carta-en-linea-web";
import {
  montarCatalogo,
  precioDeBase,
  productoDeBase,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La pantalla «Carta en línea» de la web (`carta-en-linea-web.ts`, C1) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita; crear y poner en línea
 * dos veces (una sola carta, una sola auditoría), dos «Poner en línea» A LA VEZ, dos altas A LA VEZ con la misma clave, una versión vieja, el aislamiento entre empresas y el permiso del servidor
 * (el operador ve y no cambia; sin la perilla del QR nadie pone una carta en línea). Los casos de uso en sí tienen sus pruebas en `carta-publica-casos-de-uso.test.ts` y `carta-publica-concurrencia.test.ts`.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 6;
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const HOST = "app.ejemplo.test";

describe.skipIf(base === null)("carta en línea de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let d: DependenciasDeCartaEnLineaWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real: `vidriera` es disponible (DEC-0826) y rechaza quien no tiene permiso o no tiene la perilla `vidriera_por_qr`.
    cerrado = await montarCatalogo(base, {
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
    });
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

  /** Una empresa con productos: uno que sale (con sección y precio), uno sin precio y uno sin sección. */
  const conProductos = async (conSalida = true) => {
    const e = await c.escenario();
    const seccionId = randomUUID();
    await c.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, 'Postres', 'postres', 0)",
      [seccionId, e.empresa],
    );
    if (conSalida) {
      const id = await productoDeBase(c.dueno, e.empresa, { nombre: "Flan" });
      await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
        id,
        seccionId,
      ]);
      await precioDeBase(c.dueno, {
        empresa: e.empresa,
        producto: id,
        precio: "1000",
        desde: "2026-10-01T00:00:00Z",
      });
    }
    const sinPrecio = await productoDeBase(c.dueno, e.empresa, { nombre: "Helado" });
    await c.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      sinPrecio,
      seccionId,
    ]);
    await productoDeBase(c.dueno, e.empresa, { nombre: "Sopa" });
    return e;
  };
  const pedidoDeGuardar = (e: EscenarioDeCatalogo, extra: Record<string, unknown> = {}) => ({
    cartaId: randomUUID(),
    sucursalId: e.sucursal,
    versionEsperada: null,
    nombre: "Parador El Ensayo",
    rubro: "Parrilla",
    lugar: "Huinganco",
    ...extra,
  });
  const crear = async (e: EscenarioDeCatalogo) => {
    const pedido = pedidoDeGuardar(e);
    const r = await guardarLaCartaEnLinea(d, e.gerente, pedido, e.sucursal);
    if (!r.ok) throw new Error(`se esperaba la carta y vino ${r.error.codigo}`);
    return { ...r.dato, id: pedido.cartaId };
  };
  const ver = async (e: EscenarioDeCatalogo, contexto = e.gerente) => {
    const r = await verLaCartaEnLinea(d, contexto, { sucursalId: e.sucursal, hostDeApp: HOST });
    if (!r.ok) throw new Error(`se esperaba la carta y vino ${r.error.codigo}`);
    return r.dato;
  };
  const poner = (e: EscenarioDeCatalogo, cartaId: string, version: number, contexto = e.gerente) =>
    cambiarElEstadoDeLaCartaEnLinea(
      d,
      contexto,
      { cartaId, sucursalId: e.sucursal, versionEsperada: version, estado: "EN_LINEA" },
      e.sucursal,
    );
  const sacar = (e: EscenarioDeCatalogo, cartaId: string, version: number) =>
    cambiarElEstadoDeLaCartaEnLinea(
      d,
      e.gerente,
      { cartaId, sucursalId: e.sucursal, versionEsperada: version, estado: "FUERA_DE_LINEA" },
      e.sucursal,
    );
  const cuantas = (e: EscenarioDeCatalogo) =>
    c.contar("select count(*) as n from carta_publica where empresa_id = $1", [e.empresa]);
  const auditorias = async (e: EscenarioDeCatalogo, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const fila = async (id: string) =>
    (await c.filas("select * from carta_publica where id = $1", [id]))[0];
  /** Un pedido que perdió la carrera se repite igual: es seguro por su clave o por su estado. */
  const firme = async <R extends { ok: boolean }>(trabajo: () => Promise<R>): Promise<R> => {
    const primero = await trabajo();
    return primero.ok ? primero : trabajo();
  };

  it("sin carta: ver dice que no hay, sin dirección ni QR, y cuenta los productos que salen y los que no, con su motivo", async () => {
    const e = await conProductos();
    const v = await ver(e);
    expect(v.carta).toBeNull();
    expect(v.direccion).toBeNull();
    expect(v.qrSvg).toBeNull();
    expect(v.salen).toBe(1);
    expect(v.faltan).toEqual({ sinPrecio: 1, sinSeccion: 1, desactivados: 0, ocultos: 0 });
  });

  it("guardar crea la carta FUERA de línea, con su dirección y un QR que no lleva el texto de la dirección; una auditoría", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    expect(creada).toMatchObject({ estado: "FUERA_DE_LINEA", version: 1, yaExistia: false });
    const v = await ver(e);
    expect(v.carta).toMatchObject({
      id: creada.id,
      nombre: "Parador El Ensayo",
      rubro: "Parrilla",
      lugar: "Huinganco",
      estado: "FUERA_DE_LINEA",
    });
    const codigo = (await fila(creada.id))?.["codigo"] as string;
    expect(v.direccion).toBe(`https://${HOST}/${codigo}`);
    expect(v.qrSvg).toMatch(/^<svg /);
    expect(v.qrSvg).not.toContain(codigo);
    expect(Object.keys(v.carta ?? {}).sort()).not.toContain("codigo");
    expect(await auditorias(e, "CARTA_PUBLICA_CREADA")).toBe(1);
  });

  it("la misma alta repetida (clic doble, reintento) deja UNA carta y devuelve yaExistia sin escribir ni auditar de nuevo", async () => {
    const e = await conProductos();
    const pedido = pedidoDeGuardar(e);
    const a = await guardarLaCartaEnLinea(d, e.gerente, pedido, e.sucursal);
    const b = await guardarLaCartaEnLinea(d, e.gerente, pedido, e.sucursal);
    expect(a).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(b).toMatchObject({ ok: true, dato: { yaExistia: true, version: 1 } });
    expect(await cuantas(e)).toBe(1);
    expect(await auditorias(e, "CARTA_PUBLICA_CREADA")).toBe(1);
  });

  it("dos altas A LA VEZ con la misma clave dejan UNA carta y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await conProductos();
      const pedido = pedidoDeGuardar(e);
      const r = await Promise.all([
        firme(() => guardarLaCartaEnLinea(d, e.gerente, pedido, e.sucursal)),
        firme(() => guardarLaCartaEnLinea(d, e.gerente, pedido, e.sucursal)),
      ]);
      expect(r.map((x) => x.ok)).toEqual([true, true]);
      expect(
        r.filter((x) => x.ok && !x.dato.yaExistia),
        `ronda ${ronda}`,
      ).toHaveLength(1);
      expect(await cuantas(e)).toBe(1);
      expect(await auditorias(e, "CARTA_PUBLICA_CREADA")).toBe(1);
    }
  });

  it("una segunda carta para la misma sucursal (otra clave) sale con el genérico y no escribe", async () => {
    const e = await conProductos();
    await crear(e);
    const r = await guardarLaCartaEnLinea(d, e.gerente, pedidoDeGuardar(e), e.sucursal);
    expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await cuantas(e)).toBe(1);
  });

  it("nombre vacío: «Falta el nombre» sobre el campo; nombre inválido o demasiado largo: el genérico; en ambos no se escribe nada", async () => {
    const e = await conProductos();
    const vacio = await guardarLaCartaEnLinea(
      d,
      e.gerente,
      pedidoDeGuardar(e, { nombre: "  " }),
      e.sucursal,
    );
    expect(vacio).toMatchObject({ ok: false, error: { codigo: "CATALOGO_FALTA_EL_NOMBRE" } });
    for (const nombre of ["x".repeat(81), "Con <etiqueta>"]) {
      const r = await guardarLaCartaEnLinea(
        d,
        e.gerente,
        pedidoDeGuardar(e, { nombre }),
        e.sucursal,
      );
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    }
    expect(await cuantas(e)).toBe(0);
  });

  it("editar los textos con la versión vista cambia solo los textos: no pone ni saca la carta de línea ni borra el mensaje de portada", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    await c.dueno.query(
      "update carta_publica set mensaje_de_portada = 'Desliza para ver el menú' where id = $1",
      [creada.id],
    );
    const v1 = (await ver(e)).carta;
    const enLinea = await poner(e, creada.id, v1?.version ?? 0);
    expect(enLinea).toMatchObject({ ok: true, dato: { estado: "EN_LINEA" } });
    const version = (await ver(e)).carta?.version ?? 0;
    const editada = await guardarLaCartaEnLinea(
      d,
      e.gerente,
      pedidoDeGuardar(e, {
        cartaId: creada.id,
        versionEsperada: version,
        nombre: "Otro nombre",
        rubro: "",
        lugar: "",
      }),
      e.sucursal,
    );
    expect(editada).toMatchObject({ ok: true, dato: { estado: "EN_LINEA" } });
    const f = await fila(creada.id);
    expect(f).toMatchObject({
      nombre: "Otro nombre",
      rubro: null,
      lugar: null,
      estado: "EN_LINEA",
      mensaje_de_portada: "Desliza para ver el menú",
    });
    expect(await auditorias(e, "CARTA_PUBLICA_EDITADA")).toBe(1);
  });

  it("poner en línea y repetirlo: queda en línea, la segunda es «ya estaba» y hay UNA sola auditoría; sacar la deja fuera", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    const a = await poner(e, creada.id, creada.version);
    expect(a).toMatchObject({
      ok: true,
      dato: { estado: "EN_LINEA", yaExistia: false, version: 2 },
    });
    const b = await poner(e, creada.id, creada.version);
    expect(b).toMatchObject({ ok: true, dato: { estado: "EN_LINEA", yaExistia: true } });
    expect(await auditorias(e, "CARTA_PUBLICA_PUESTA_EN_LINEA")).toBe(1);
    const fuera = await sacar(e, creada.id, 2);
    expect(fuera).toMatchObject({ ok: true, dato: { estado: "FUERA_DE_LINEA" } });
    expect(await auditorias(e, "CARTA_PUBLICA_RETIRADA")).toBe(1);
    // El código no cambia: el QR impreso vuelve a andar.
    expect((await fila(creada.id))?.["codigo"]).toBe((await ver(e)).direccion?.split("/").pop());
  });

  it("dos «Poner en línea» A LA VEZ dejan la carta en línea con UNA sola auditoría (una gana, la otra es «ya estaba»)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await conProductos();
      const creada = await crear(e);
      const r = await Promise.all([
        firme(() => poner(e, creada.id, creada.version)),
        firme(() => poner(e, creada.id, creada.version)),
      ]);
      expect(
        r.map((x) => x.ok),
        `ronda ${ronda}`,
      ).toEqual([true, true]);
      expect((await fila(creada.id))?.["estado"]).toBe("EN_LINEA");
      expect((await fila(creada.id))?.["version"]).toBe(2);
      expect(await auditorias(e, "CARTA_PUBLICA_PUESTA_EN_LINEA")).toBe(1);
    }
  });

  it("poner en línea y sacarla a la vez termina en un estado válido, nunca a medias, y cada cambio que se aplicó está auditado", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const e = await conProductos();
      const creada = await crear(e);
      const puesta = await poner(e, creada.id, creada.version);
      expect(puesta.ok).toBe(true);
      await Promise.all([sacar(e, creada.id, 2), poner(e, creada.id, 2)]);
      const f = await fila(creada.id);
      expect(["EN_LINEA", "FUERA_DE_LINEA"]).toContain(f?.["estado"]);
      const retiradas = await auditorias(e, "CARTA_PUBLICA_RETIRADA");
      expect(retiradas, `ronda ${ronda}`).toBeLessThanOrEqual(1);
      expect(Number(f?.["version"])).toBe(
        2 + retiradas + (await auditorias(e, "CARTA_PUBLICA_PUESTA_EN_LINEA")) - 1,
      );
    }
  });

  it("con una versión vieja se rechaza (el genérico) y no se escribe", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    const editada = await guardarLaCartaEnLinea(
      d,
      e.gerente,
      pedidoDeGuardar(e, { cartaId: creada.id, versionEsperada: 1, nombre: "Nuevo nombre" }),
      e.sucursal,
    );
    expect(editada.ok).toBe(true);
    const vieja = await poner(e, creada.id, 1);
    expect(vieja).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    const otraEdicion = await guardarLaCartaEnLinea(
      d,
      e.gerente,
      pedidoDeGuardar(e, { cartaId: creada.id, versionEsperada: 1, nombre: "Pisado" }),
      e.sucursal,
    );
    expect(otraEdicion).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect((await fila(creada.id))?.["nombre"]).toBe("Nuevo nombre");
    expect((await fila(creada.id))?.["estado"]).toBe("FUERA_DE_LINEA");
  });

  it("sin ningún producto que salga no se puede poner en línea (el genérico) y la carta sigue fuera de línea", async () => {
    const e = await conProductos(false);
    const creada = await crear(e);
    const r = await poner(e, creada.id, creada.version);
    expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect((await fila(creada.id))?.["estado"]).toBe("FUERA_DE_LINEA");
    expect((await ver(e)).salen).toBe(0);
  });

  it("con la perilla del QR apagada no se puede poner en línea, pero sí sacar una carta ya puesta", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    const puesta = await poner(e, creada.id, creada.version);
    expect(puesta.ok).toBe(true);
    c.perillaDeCarta(false);
    try {
      expect(await sacar(e, creada.id, 2)).toMatchObject({
        ok: true,
        dato: { estado: "FUERA_DE_LINEA" },
      });
      expect(await poner(e, creada.id, 3)).toMatchObject({
        ok: false,
        error: { codigo: GENERICO },
      });
      expect((await fila(creada.id))?.["estado"]).toBe("FUERA_DE_LINEA");
    } finally {
      c.perillaDeCarta(true);
    }
  });

  it("aislamiento: otra empresa no ve la carta ni la cambia (el genérico, igual que si no existiera) y no se escribe", async () => {
    const a = await conProductos();
    const b = await conProductos();
    const creada = await crear(a);
    // La sucursal de A mirada con el contexto de B: fuera del alcance / inexistente.
    const mirada = await verLaCartaEnLinea(d, b.gerente, {
      sucursalId: a.sucursal,
      hostDeApp: HOST,
    });
    expect(mirada.ok).toBe(false);
    expect(JSON.stringify(mirada)).not.toContain("Parador El Ensayo");
    // B pide cambiar la carta de A con SU sucursal: la carta no es de esa sucursal.
    const cambiar = await cambiarElEstadoDeLaCartaEnLinea(
      d,
      b.gerente,
      { cartaId: creada.id, sucursalId: b.sucursal, versionEsperada: 1, estado: "EN_LINEA" },
      b.sucursal,
    );
    expect(cambiar).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    // B intenta guardar con la clave de la carta de A (id reutilizado): rechazado.
    const pisar = await guardarLaCartaEnLinea(
      d,
      b.gerente,
      { ...pedidoDeGuardar(b), cartaId: creada.id, nombre: "De B" },
      b.sucursal,
    );
    expect(pisar.ok).toBe(false);
    expect((await fila(creada.id))?.["nombre"]).toBe("Parador El Ensayo");
    expect((await fila(creada.id))?.["estado"]).toBe("FUERA_DE_LINEA");
    expect(await cuantas(b)).toBe(0);
  });

  it("la sucursal la fija el servidor: un pedido para otra sucursal que la mostrada se rechaza sin escribir", async () => {
    const e = await conProductos();
    const r = await guardarLaCartaEnLinea(
      d,
      e.gerente,
      pedidoDeGuardar(e, { sucursalId: e.otraSucursal }),
      e.sucursal,
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(await cuantas(e)).toBe(0);
  });

  it("el permiso lo decide el servidor: el operador ve la carta pero no guarda, ni pone, ni saca", async () => {
    const e = await conProductos();
    const creada = await crear(e);
    expect((await ver(e, e.operador)).carta?.id).toBe(creada.id);
    const guardar = await guardarLaCartaEnLinea(
      d,
      e.operador,
      pedidoDeGuardar(e, { cartaId: creada.id, versionEsperada: 1, nombre: "Del operador" }),
      e.sucursal,
    );
    expect(guardar).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(await poner(e, creada.id, 1, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect((await fila(creada.id))?.["nombre"]).toBe("Parador El Ensayo");
    expect((await fila(creada.id))?.["estado"]).toBe("FUERA_DE_LINEA");
  });

  it("con el catálogo real (`vidriera` disponible, DEC-0826): el gerente guarda y pone en línea con la perilla encendida; el operador no cambia nada; sin la perilla no se pone en línea", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDeCartaEnLineaWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    // Un producto que sale (con sección y precio): así lo único que cambia entre rechazar y aceptar es la perilla.
    const seccionId = randomUUID();
    await cerrado.dueno.query(
      "insert into seccion_de_carta (id, empresa_id, nombre, nombre_clave, orden) values ($1, $2, 'Postres', 'postres', 0)",
      [seccionId, x.empresa],
    );
    const productoId = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Flan" });
    await cerrado.dueno.query("update producto set seccion_de_carta_id = $2 where id = $1", [
      productoId,
      seccionId,
    ]);
    await precioDeBase(cerrado.dueno, {
      empresa: x.empresa,
      producto: productoId,
      precio: "1000",
      desde: "2026-10-01T00:00:00Z",
    });
    const pedido = pedidoDeGuardar(x);
    const delOperador = await guardarLaCartaEnLinea(dependencias, x.operador, pedido, x.sucursal);
    expect(delOperador).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(
      await cerrado.contar("select count(*) as n from carta_publica where empresa_id = $1", [
        x.empresa,
      ]),
    ).toBe(0);
    const creada = await guardarLaCartaEnLinea(dependencias, x.gerente, pedido, x.sucursal);
    expect(creada).toMatchObject({ ok: true, dato: { estado: "FUERA_DE_LINEA", version: 1 } });
    const ponerEnLinea = (version: number) =>
      cambiarElEstadoDeLaCartaEnLinea(
        dependencias,
        x.gerente,
        {
          cartaId: pedido.cartaId,
          sucursalId: x.sucursal,
          versionEsperada: version,
          estado: "EN_LINEA",
        },
        x.sucursal,
      );
    cerrado.perillaDeCarta(false);
    try {
      expect(await ponerEnLinea(1)).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    } finally {
      cerrado.perillaDeCarta(true);
    }
    expect(await ponerEnLinea(1)).toMatchObject({ ok: true, dato: { estado: "EN_LINEA" } });
    const otra = await cerrado.escenario();
    expect(
      await verLaCartaEnLinea(dependencias, otra.gerente, {
        sucursalId: otra.sucursal,
        hostDeApp: HOST,
      }),
    ).toMatchObject({ ok: true, dato: { carta: null } });
  });

  describe("identidad: cara, color y logo", () => {
    const LOGO = "https://res.cloudinary.com/demo/image/upload/v1700000000/logos/parador.png";
    const IDENTIDAD = { cara: "BOLICHE", paleta: "otro", colorPropio: "#0e7490", logo: LOGO };
    const guardarIdentidad = (
      e: EscenarioDeCatalogo,
      cartaId: string,
      versionEsperada: number | null,
      extra: Record<string, unknown>,
      contexto = e.gerente,
    ) =>
      guardarLaCartaEnLinea(
        d,
        contexto,
        pedidoDeGuardar(e, { cartaId, versionEsperada, ...extra }),
        e.sucursal,
      );

    it("guardar la identidad la escribe (el color como se eligió, el logo en partes), la muestra al volver a ver y audita UNA vez", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      const r = await guardarIdentidad(e, creada.id, creada.version, {
        ...IDENTIDAD,
        paleta: "otro",
        colorPropio: "#808080",
      });
      expect(r).toMatchObject({ ok: true, dato: { version: 2, yaExistia: false } });
      expect(await fila(creada.id)).toMatchObject({
        cara: "BOLICHE",
        color_propio: "#808080",
        logo_proveedor: "CLOUDINARY",
        logo_cuenta: "demo",
        logo_id_publico: "logos/parador",
        logo_version: "1700000000",
        logo_extension: "png",
      });
      expect((await ver(e)).carta).toMatchObject({
        cara: "BOLICHE",
        colorPropio: "#808080",
        logo: LOGO,
      });
      expect(await auditorias(e, "CARTA_PUBLICA_EDITADA")).toBe(1);
    });

    it("el mismo formulario enviado dos veces (doble toque) escribe una sola vez: la segunda es «ya existía» y no audita", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      const a = await guardarIdentidad(e, creada.id, creada.version, IDENTIDAD);
      const b = await guardarIdentidad(e, creada.id, creada.version, IDENTIDAD);
      expect(a).toMatchObject({ ok: true, dato: { yaExistia: false, version: 2 } });
      expect(b).toMatchObject({ ok: true, dato: { yaExistia: true, version: 2 } });
      expect(await auditorias(e, "CARTA_PUBLICA_EDITADA")).toBe(1);
      expect((await fila(creada.id))?.["version"]).toBe(2);
    });

    it("poner en línea y sacar de línea conservan la cara, el color y el logo", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      await guardarIdentidad(e, creada.id, creada.version, IDENTIDAD);
      expect(await poner(e, creada.id, 2)).toMatchObject({ ok: true });
      expect(await sacar(e, creada.id, 3)).toMatchObject({ ok: true });
      expect(await fila(creada.id)).toMatchObject({
        cara: "BOLICHE",
        color_propio: "#0e7490",
        logo_id_publico: "logos/parador",
      });
    });

    it("guardar solo los textos (un pedido sin identidad) la conserva; con la identidad vacía la deja «sin elegir»", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      await guardarIdentidad(e, creada.id, creada.version, IDENTIDAD);
      const soloTextos = await guardarLaCartaEnLinea(
        d,
        e.gerente,
        pedidoDeGuardar(e, { cartaId: creada.id, versionEsperada: 2, nombre: "Solo el nombre" }),
        e.sucursal,
      );
      expect(soloTextos).toMatchObject({ ok: true, dato: { version: 3 } });
      expect(await fila(creada.id)).toMatchObject({
        nombre: "Solo el nombre",
        cara: "BOLICHE",
        color_propio: "#0e7490",
        logo_id_publico: "logos/parador",
      });
      const vaciada = await guardarIdentidad(e, creada.id, 3, {
        cara: "",
        paleta: "",
        logo: "",
      });
      expect(vaciada).toMatchObject({ ok: true });
      expect(await fila(creada.id)).toMatchObject({
        cara: null,
        color_propio: null,
        logo_proveedor: null,
        logo_id_publico: null,
      });
    });

    it("dos administradores guardan una cara distinta con la MISMA versión A LA VEZ: gana uno, el otro recibe el genérico y la carta queda con una sola cara", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const e = await conProductos();
        const creada = await crear(e);
        const r = await Promise.all([
          guardarIdentidad(e, creada.id, creada.version, { cara: "NOCHE" }),
          guardarIdentidad(e, creada.id, creada.version, { cara: "BOLICHE" }, e.administrador),
        ]);
        expect(
          r.filter((x) => x.ok),
          `ronda ${ronda}`,
        ).toHaveLength(1);
        expect(r.find((x) => !x.ok)).toMatchObject({ ok: false, error: { codigo: GENERICO } });
        const f = await fila(creada.id);
        expect(["NOCHE", "BOLICHE"]).toContain(f?.["cara"]);
        expect(f?.["version"]).toBe(2);
        expect(await auditorias(e, "CARTA_PUBLICA_EDITADA")).toBe(1);
      }
    });

    it("el operador ve la identidad y no la cambia (SIN_PERMISO) y no se escribe nada", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      const r = await guardarIdentidad(e, creada.id, creada.version, IDENTIDAD, e.operador);
      expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
      expect(await fila(creada.id)).toMatchObject({ cara: null, color_propio: null });
      expect((await ver(e, e.operador)).carta).toMatchObject({ cara: null });
    });

    it("aislamiento: con la sucursal de otra empresa no se cambia la identidad ni se ve la de otra carta", async () => {
      const a = await conProductos();
      const b = await conProductos();
      const creada = await crear(a);
      await guardarIdentidad(a, creada.id, creada.version, IDENTIDAD);
      const intruso = await guardarLaCartaEnLinea(
        d,
        b.gerente,
        pedidoDeGuardar(a, { cartaId: creada.id, versionEsperada: 2, cara: "NOCHE" }),
        b.sucursal,
      );
      expect(intruso).toMatchObject({ ok: false, error: { codigo: GENERICO } });
      expect((await fila(creada.id))?.["cara"]).toBe("BOLICHE");
      expect((await ver(b)).carta).toBeNull();
    });

    it("valores raros (cara «X», color «#12345», un script en el color y un logo de otro proveedor) se rechazan con el genérico y no escriben nada", async () => {
      const e = await conProductos();
      const creada = await crear(e);
      for (const malo of [
        { cara: "X" },
        { paleta: "#12345" },
        { paleta: "otro", colorPropio: "<script>alert(1)</script>" },
        { logo: "https://ejemplo.com/logo.png" },
      ]) {
        expect(
          await guardarIdentidad(e, creada.id, creada.version, malo),
          JSON.stringify(malo),
        ).toMatchObject({ ok: false, error: { codigo: GENERICO } });
      }
      expect(await fila(creada.id)).toMatchObject({
        cara: null,
        color_propio: null,
        logo_proveedor: null,
        version: 1,
      });
      expect(await auditorias(e, "CARTA_PUBLICA_EDITADA")).toBe(0);
    });
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const e = await conProductos();
    await crear(e);
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    await ver(e);
    await ver(e, e.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
  });
});
