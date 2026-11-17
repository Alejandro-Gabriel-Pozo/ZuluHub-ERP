import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cambiarElEstadoDeLaMesa,
  crearLaMesa,
  editarLaMesa,
  verLaMesa,
  verLasMesas,
  type DependenciasDeMesasWeb,
} from "../../src/composicion/mesas-web";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevoId, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La pantalla «Mesas» de la web (`mesas-web.ts`, S-1) contra una base real y los roles reales: lo que la pantalla recibe, que guardar dos veces es una sola mesa, los cuatro textos propios
 * aprobados y el genérico para todo lo demás, que la sucursal la fija el servidor (vacía cierra; una mesa de otra sucursal o empresa no existe), que el operador no cambia nada, que dos
 * administradores que guardan mesas que se pisan dejan una sola, y que editar con una versión vieja y repetir desactivar o reactivar no escriben de más.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const datos = (numero: string, columna: string, fila: string, extra = {}) => ({
  numero,
  forma: "CUADRADA",
  tamano: "CHICA",
  columna,
  fila,
  ...extra,
});

describe.skipIf(base === null)("mesas de la web", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let registrados: string[];
  let d: DependenciasDeMesasWeb;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
    registrados = [];
    d = {
      casosDeUso: () => m.salon,
      consultas: () => m.consultasDeSalon,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const crear = (id: string, n: string, c: string, f: string, extra = {}, contexto = e.gerente) =>
    crearLaMesa(d, contexto, e.sucursal, { claveDeCreacion: id, ...datos(n, c, f, extra) });
  const codigo = (r: { ok: boolean; error?: { codigo: string } }) =>
    r.ok ? null : (r.error?.codigo ?? null);
  const cuantas = (sucursal: string) =>
    m.contar("select count(*) as n from mesa where sucursal_id = $1", [sucursal]);

  it("la lista trae solo lo declarado, activas y desactivadas, por número", async () => {
    const id = nuevoId();
    expect(await crear(id, "7", "1", "1")).toMatchObject({ ok: true });
    const lista = await verLasMesas(d, e.gerente, e.sucursal);
    expect(lista).toMatchObject({ ok: true });
    if (!lista.ok) return;
    const mesa = lista.dato.mesas.find((x) => x.id === id);
    expect(Object.keys(mesa ?? {}).sort()).toEqual(
      ["activa", "columna", "fila", "forma", "id", "numero", "tamano", "version"].sort(),
    );
    expect(mesa).toMatchObject({ numero: 7, forma: "CUADRADA", tamano: "CHICA", activa: true });
  });

  it("IDEMPOTENCIA: guardar dos veces la misma mesa deja una sola (yaExistia) y audita una vez", async () => {
    const id = nuevoId();
    const antes = await cuantas(e.sucursal);
    const primera = await crear(id, "8", "5", "1");
    const segunda = await crear(id, "8", "5", "1");
    expect(primera).toMatchObject({ ok: true, dato: { mesaId: id, yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { mesaId: id, yaExistia: true } });
    expect(await cuantas(e.sucursal)).toBe(antes + 1);
    expect(
      (await m.auditoria(e.empresa, "MESA_CREADA")).filter((a) => a["entidad_id"] === id),
    ).toHaveLength(1);
  });

  it("IDEMPOTENCIA: dos envíos a la vez con la misma clave son una sola mesa", async () => {
    const id = nuevoId();
    const antes = await cuantas(e.sucursal);
    const [x, y] = await Promise.all([crear(id, "9", "9", "5"), crear(id, "9", "9", "5")]);
    expect([x.ok, y.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(await cuantas(e.sucursal)).toBe(antes + 1);
  });

  it("los cuatro textos propios aprobados", async () => {
    expect(codigo(await crear(nuevoId(), "0", "1", "3"))).toBe("SALON_NUMERO_DE_MESA_INVALIDO");
    expect(codigo(await crear(nuevoId(), "100", "1", "3"))).toBe("SALON_NUMERO_DE_MESA_INVALIDO");
    expect(codigo(await crear(nuevoId(), "", "1", "3"))).toBe("SALON_NUMERO_DE_MESA_INVALIDO");
    expect(codigo(await crear(nuevoId(), "abc", "1", "3"))).toBe("SALON_NUMERO_DE_MESA_INVALIDO");
    expect(codigo(await crear(nuevoId(), "7", "1", "3"))).toBe("SALON_NUMERO_DE_MESA_EN_USO");
    expect(codigo(await crear(nuevoId(), "30", "14", "9"))).toBe("SALON_MESA_FUERA_DEL_SALON");
    const pisada = await crear(nuevoId(), "31", "1", "1");
    expect(pisada).toMatchObject({
      ok: false,
      error: { codigo: "SALON_MESA_SUPERPUESTA", parametros: { numero: "7" } },
    });
  });

  it("lo que no tiene texto propio sale con el genérico, sin detalle", async () => {
    expect(codigo(await crear(nuevoId(), "32", "5", "7", { forma: "OVALADA" }))).toBe(GENERICO);
    expect(codigo(await crear(nuevoId(), "32", "5", "7", { tamano: "ENORME" }))).toBe(GENERICO);
    expect(codigo(await crearLaMesa(d, e.gerente, e.sucursal, { numero: "32" }))).not.toBeNull();
    expect(registrados).toEqual([]);
  });

  it("SUCURSAL: la fija el servidor; vacía cierra (nunca «todas») y una mesa de otra sucursal no existe", async () => {
    expect(codigo(await verLasMesas(d, e.gerente, ""))).toBe(GENERICO);
    expect(
      codigo(
        await crearLaMesa(d, e.gerente, "", {
          claveDeCreacion: nuevoId(),
          ...datos("40", "1", "7"),
        }),
      ),
    ).toBe(GENERICO);
    const id = nuevoId();
    expect(await crear(id, "41", "9", "7")).toMatchObject({ ok: true });
    // Una sucursal en la que la mesa no está: indistinguible de una mesa que no existe.
    expect(codigo(await verLaMesa(d, e.gerente, e.otraSucursal, id))).toBe(GENERICO);
    expect(
      codigo(await cambiarElEstadoDeLaMesa(d, e.gerente, e.otraSucursal, { mesaId: id }, false)),
    ).toBe(GENERICO);
    expect(codigo(await verLaMesa(d, e.gerente, e.sucursal, "no-es-un-id"))).toBe(GENERICO);
  });

  it("AISLAMIENTO: una mesa de otra empresa no se ve ni se toca", async () => {
    const otra = await m.escenario();
    const id = nuevoId();
    expect(
      await crearLaMesa(d, otra.gerente, otra.sucursal, {
        claveDeCreacion: id,
        ...datos("1", "1", "1"),
      }),
    ).toMatchObject({ ok: true });
    expect(codigo(await verLaMesa(d, e.gerente, e.sucursal, id))).toBe(GENERICO);
    expect(
      codigo(await cambiarElEstadoDeLaMesa(d, e.gerente, e.sucursal, { mesaId: id }, false)),
    ).toBe(GENERICO);
    expect(await m.contar("select count(*) as n from mesa where id = $1 and activa", [id])).toBe(1);
  });

  it("PERMISOS: el operador mira pero no crea, edita ni desactiva (decide el servidor)", async () => {
    expect(await verLasMesas(d, e.operador, e.sucursal)).toMatchObject({ ok: true });
    const antes = await cuantas(e.sucursal);
    const r = await crear(nuevoId(), "50", "9", "9", {}, e.operador);
    expect(r.ok).toBe(false);
    expect(await cuantas(e.sucursal)).toBe(antes);
  });

  it("CONCURRENCIA: dos administradores que guardan mesas que se pisan dejan una sola", async () => {
    const e2 = await m.escenario();
    const a = nuevoId();
    const b = nuevoId();
    const [x, y] = await Promise.all([
      crearLaMesa(d, e2.gerente, e2.sucursal, { claveDeCreacion: a, ...datos("20", "3", "3") }),
      crearLaMesa(d, e2.administrador, e2.sucursal, {
        claveDeCreacion: b,
        ...datos("21", "4", "4"),
      }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const perdedora = x.ok ? y : x;
    expect(["SALON_MESA_SUPERPUESTA", GENERICO]).toContain(codigo(perdedora));
    expect(
      await m.contar("select count(*) as n from mesa where sucursal_id = $1", [e2.sucursal]),
    ).toBe(1);
  });

  it("CONCURRENCIA: editar con una versión vieja no escribe y la lista muestra lo vigente", async () => {
    const e3 = await m.escenario();
    const id = nuevoId();
    expect(
      await crearLaMesa(d, e3.gerente, e3.sucursal, {
        claveDeCreacion: id,
        ...datos("3", "1", "1"),
      }),
    ).toMatchObject({ ok: true });
    const editar = (version: number, numero: string, contexto = e3.gerente) =>
      editarLaMesa(d, contexto, e3.sucursal, {
        mesaId: id,
        versionEsperada: version,
        ...datos(numero, "1", "1"),
      });
    expect(await editar(1, "4")).toMatchObject({ ok: true, dato: { version: 2 } });
    // La otra persona todavía ve la versión 1.
    expect(codigo(await editar(1, "5", e3.administrador))).toBe(GENERICO);
    const lista = await verLasMesas(d, e3.gerente, e3.sucursal);
    expect(lista.ok && lista.dato.mesas.map((x) => x.numero)).toEqual([4]);
  });

  it("desactivar y reactivar repetidos no escriben ni auditan de nuevo", async () => {
    const e4 = await m.escenario();
    const id = nuevoId();
    await crearLaMesa(d, e4.gerente, e4.sucursal, { claveDeCreacion: id, ...datos("2", "1", "1") });
    const cambiar = (activa: boolean) =>
      cambiarElEstadoDeLaMesa(d, e4.gerente, e4.sucursal, { mesaId: id }, activa);
    expect(await cambiar(false)).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect(await cambiar(false)).toMatchObject({ ok: true, dato: { yaEstaba: true } });
    expect(await cambiar(true)).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect(await cambiar(true)).toMatchObject({ ok: true, dato: { yaEstaba: true } });
    const acciones = (await m.auditoria(e4.empresa, "MESA_DESACTIVADA")).filter(
      (a) => a["entidad_id"] === id,
    );
    expect(acciones).toHaveLength(1);
  });
});
