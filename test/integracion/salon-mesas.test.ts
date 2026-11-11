import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { EscenarioDeVentas } from "./ventas-apoyo";
import { nuevoId, valorDe } from "./ventas-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";

/**
 * E7 (T4), mesas y plano con los casos de uso reales y el rol de la aplicación: alta idempotente, número único, casillas que no se pisan (también
 * con dos administradores a la vez), edición con control de versión, desactivar (no con cuenta abierta) y reactivar, aislamiento y permisos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const dato = (numero: number, columna: number, fila: number, extra = {}) => ({
  numero,
  forma: "CUADRADA",
  tamano: "CHICA",
  columna,
  fila,
  ...extra,
});

describe.skipIf(base === null)("salón: mesas y plano", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const crear = (
    numero: number,
    columna: number,
    fila: number,
    id = nuevoId(),
    contexto = e.gerente,
  ) =>
    m.salon.crearMesa(contexto, {
      mesaId: id,
      sucursalId: e.sucursal,
      ...dato(numero, columna, fila),
    });
  const auditorias = (accion: string) => m.auditoria(e.empresa, accion);

  it("I1: guardar dos veces la misma mesa deja una sola y devuelve yaExistia; con otro contenido, MESA_ID_EN_USO", async () => {
    const id = nuevoId();
    expect(valorDe(await crear(1, 1, 1, id))).toMatchObject({ yaExistia: false, version: 1 });
    expect(valorDe(await crear(1, 1, 1, id))).toMatchObject({ yaExistia: true });
    expect(await crear(1, 5, 5, id)).toEqual({ ok: false, error: "MESA_ID_EN_USO" });
    expect(await m.contar("select count(*) as n from mesa where id = $1", [id])).toBe(1);
    expect(
      await m.contar("select count(*) as n from mesa_celda where mesa_id = $1 and activa", [id]),
    ).toBe(4);
    expect((await auditorias("MESA_CREADA")).filter((a) => a["entidad_id"] === id)).toHaveLength(1);
  });

  it("el número de mesa es único en la sucursal, también entre las desactivadas", async () => {
    valorDe(await crear(2, 1, 4));
    expect(await crear(2, 8, 8)).toEqual({ ok: false, error: "NUMERO_DE_MESA_EN_USO" });
    const id = nuevoId();
    valorDe(await crear(3, 8, 4, id));
    valorDe(await m.salon.desactivarMesa(e.gerente, { mesaId: id }));
    expect(await crear(3, 11, 4)).toEqual({ ok: false, error: "NUMERO_DE_MESA_EN_USO" });
  });

  it("valida con lista de permitidos: número fuera de 1 a 99, forma o tamaño desconocidos, mesa que se sale del salón de 14 × 9", async () => {
    expect(await crear(0, 1, 7)).toEqual({ ok: false, error: "NUMERO_DE_MESA_INVALIDO" });
    expect(await crear(100, 1, 7)).toEqual({ ok: false, error: "NUMERO_DE_MESA_INVALIDO" });
    expect(
      await m.salon.crearMesa(e.gerente, {
        mesaId: nuevoId(),
        sucursalId: e.sucursal,
        ...dato(4, 1, 7, { forma: "OVALADA" }),
      }),
    ).toEqual({ ok: false, error: "FORMA_INVALIDA" });
    expect(
      await m.salon.crearMesa(e.gerente, {
        mesaId: nuevoId(),
        sucursalId: e.sucursal,
        ...dato(4, 1, 7, { tamano: "ENORME" }),
      }),
    ).toEqual({ ok: false, error: "TAMANO_INVALIDO" });
    expect(await crear(4, 14, 9)).toEqual({ ok: false, error: "MESA_FUERA_DEL_SALON" });
    expect(await crear(4, 0, 1)).toEqual({ ok: false, error: "MESA_FUERA_DEL_SALON" });
  });

  it("dos mesas no ocupan la misma casilla: MESA_SUPERPUESTA dice con cuál", async () => {
    valorDe(await crear(10, 6, 1));
    expect(await crear(11, 7, 2)).toEqual({
      ok: false,
      error: { error: "MESA_SUPERPUESTA", numeros: [10] },
    });
    valorDe(await crear(11, 8, 1));
  });

  it("P14: dos administradores guardan mesas con casillas que se pisan a la vez: queda una sola", async () => {
    const e2 = await m.escenario();
    const a = nuevoId();
    const b = nuevoId();
    const [x, y] = await Promise.all([
      m.salon.crearMesa(e2.gerente, { mesaId: a, sucursalId: e2.sucursal, ...dato(20, 3, 3) }),
      m.salon.crearMesa(e2.administrador, {
        mesaId: b,
        sucursalId: e2.sucursal,
        ...dato(21, 4, 4),
      }),
    ]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(
      await m.contar(
        "select count(*) as n from mesa_celda where empresa_id = $1 and activa and columna in (3,4,5) and fila in (3,4,5)",
        [e2.empresa],
      ),
    ).toBe(4);
  });

  it("I2: editar una mesa con los mismos datos no escribe ni audita y devuelve yaExistia", async () => {
    const id = nuevoId();
    valorDe(await crear(30, 1, 7, id));
    const antes = (await auditorias("MESA_EDITADA")).length;
    const r = valorDe(await m.salon.editarMesa(e.gerente, { mesaId: id, ...dato(30, 1, 7) }));
    expect(r).toMatchObject({ yaExistia: true, version: 1 });
    expect((await auditorias("MESA_EDITADA")).length).toBe(antes);
  });

  it("editar mueve las casillas (nunca se borran), controla la versión y no deja pisar a otra", async () => {
    const id = nuevoId();
    valorDe(await crear(31, 11, 1, id));
    const nueva = valorDe(
      await m.salon.editarMesa(e.gerente, { mesaId: id, versionEsperada: 1, ...dato(31, 11, 6) }),
    );
    expect(nueva).toMatchObject({ yaExistia: false, version: 2 });
    expect(
      await m.contar("select count(*) as n from mesa_celda where mesa_id = $1 and activa", [id]),
    ).toBe(4);
    expect(
      await m.contar("select count(*) as n from mesa_celda where mesa_id = $1 and not activa", [
        id,
      ]),
    ).toBe(4);
    // Otra pestaña con la versión vieja.
    expect(
      await m.salon.editarMesa(e.gerente, { mesaId: id, versionEsperada: 1, ...dato(31, 11, 7) }),
    ).toEqual({
      ok: false,
      error: "VERSION_DESACTUALIZADA",
    });
    // Pisar a la mesa 10 (columna 6, fila 1).
    expect(await m.salon.editarMesa(e.gerente, { mesaId: id, ...dato(31, 6, 1) })).toMatchObject({
      ok: false,
      error: { error: "MESA_SUPERPUESTA" },
    });
  });

  it("I3: desactivar dos veces la misma mesa es ok y no audita la segunda; sus casillas quedan libres", async () => {
    const id = nuevoId();
    valorDe(await crear(40, 4, 7, id));
    expect(valorDe(await m.salon.desactivarMesa(e.gerente, { mesaId: id }))).toMatchObject({
      yaExistia: false,
    });
    const antes = (await auditorias("MESA_DESACTIVADA")).length;
    expect(valorDe(await m.salon.desactivarMesa(e.gerente, { mesaId: id }))).toMatchObject({
      yaExistia: true,
    });
    expect((await auditorias("MESA_DESACTIVADA")).length).toBe(antes);
    expect(
      await m.contar("select count(*) as n from mesa_celda where mesa_id = $1 and activa", [id]),
    ).toBe(0);
    valorDe(await crear(41, 4, 7)); // la casilla quedó libre
  });

  it("no se desactiva una mesa con una cuenta abierta", async () => {
    const id = nuevoId();
    valorDe(await crear(42, 10, 8, id));
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: nuevoId(),
        sucursalId: e.sucursal,
        ancla: { tipo: "salon.mesa", id },
      }),
    );
    expect(await m.salon.desactivarMesa(e.gerente, { mesaId: id })).toEqual({
      ok: false,
      error: "MESA_CON_CUENTA",
    });
  });

  it("I4: reactivar dos veces la misma mesa es ok y no audita la segunda; vuelve a validar las casillas", async () => {
    const e3 = await m.escenario();
    const id = nuevoId();
    valorDe(
      await m.salon.crearMesa(e3.gerente, {
        mesaId: id,
        sucursalId: e3.sucursal,
        ...dato(50, 1, 1),
      }),
    );
    valorDe(await m.salon.desactivarMesa(e3.gerente, { mesaId: id }));
    // Otra mesa ocupa el lugar mientras tanto.
    valorDe(
      await m.salon.crearMesa(e3.gerente, {
        mesaId: nuevoId(),
        sucursalId: e3.sucursal,
        ...dato(51, 1, 1),
      }),
    );
    expect(await m.salon.reactivarMesa(e3.gerente, { mesaId: id })).toEqual({
      ok: false,
      error: { error: "MESA_SUPERPUESTA", numeros: [51] },
    });
    const e4 = await m.escenario();
    const otra = nuevoId();
    valorDe(
      await m.salon.crearMesa(e4.gerente, {
        mesaId: otra,
        sucursalId: e4.sucursal,
        ...dato(52, 1, 1),
      }),
    );
    valorDe(await m.salon.desactivarMesa(e4.gerente, { mesaId: otra }));
    expect(valorDe(await m.salon.reactivarMesa(e4.gerente, { mesaId: otra }))).toMatchObject({
      yaExistia: false,
    });
    const antes = (await m.auditoria(e4.empresa, "MESA_REACTIVADA")).length;
    expect(valorDe(await m.salon.reactivarMesa(e4.gerente, { mesaId: otra }))).toMatchObject({
      yaExistia: true,
    });
    expect((await m.auditoria(e4.empresa, "MESA_REACTIVADA")).length).toBe(antes);
  });

  it("P13: otra empresa, sucursal fuera de alcance y permisos: el operador mira pero no arma el plano; denegado por defecto", async () => {
    const otra = await m.escenario();
    const id = nuevoId();
    valorDe(await crear(60, 13, 3, id));
    // Una mesa de otra empresa es inexistente.
    expect(await m.salon.desactivarMesa(otra.gerente, { mesaId: id })).toEqual({
      ok: false,
      error: "MESA_NO_ENCONTRADA",
    });
    expect(await m.salon.editarMesa(otra.gerente, { mesaId: id, ...dato(60, 13, 3) })).toEqual({
      ok: false,
      error: "MESA_NO_ENCONTRADA",
    });
    // El operador no crea ni edita.
    expect(await crear(61, 6, 4, nuevoId(), e.operador)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    // Una sucursal que el operador no tiene asignada.
    expect(
      await m.salon.crearMesa(e.administrador, {
        mesaId: nuevoId(),
        sucursalId: otra.sucursal,
        ...dato(62, 1, 1),
      }),
    ).toMatchObject({ ok: false });
    // Mirar sí puede el operador, y solo ve lo suyo.
    const lista = valorDe(
      await m.consultasDeSalon.listarMesas(e.operador, { sucursalId: e.sucursal }),
    );
    expect(lista.map((x) => x.numero)).toContain(60);
    expect(
      await m.consultasDeSalon.listarMesas(e.operador, { sucursalId: e.otraSucursal }),
    ).toEqual({
      ok: false,
      error: "SUCURSAL_FUERA_DE_ALCANCE",
    });
    expect(
      valorDe(await m.consultasDeSalon.listarMesas(otra.gerente, { sucursalId: otra.sucursal })),
    ).toEqual([]);
  });

  it("listarMesas devuelve las activas por número y, si se pide, también las desactivadas", async () => {
    const e5 = await m.escenario();
    const a = nuevoId();
    valorDe(
      await m.salon.crearMesa(e5.gerente, {
        mesaId: nuevoId(),
        sucursalId: e5.sucursal,
        ...dato(2, 1, 1),
      }),
    );
    valorDe(
      await m.salon.crearMesa(e5.gerente, { mesaId: a, sucursalId: e5.sucursal, ...dato(1, 5, 1) }),
    );
    valorDe(await m.salon.desactivarMesa(e5.gerente, { mesaId: a }));
    const activas = valorDe(
      await m.consultasDeSalon.listarMesas(e5.gerente, { sucursalId: e5.sucursal }),
    );
    expect(activas.map((x) => x.numero)).toEqual([2]);
    const todas = valorDe(
      await m.consultasDeSalon.listarMesas(e5.gerente, {
        sucursalId: e5.sucursal,
        incluirInactivas: true,
      }),
    );
    expect(todas.map((x) => [x.numero, x.activa])).toEqual([
      [1, false],
      [2, true],
    ]);
  });
});
