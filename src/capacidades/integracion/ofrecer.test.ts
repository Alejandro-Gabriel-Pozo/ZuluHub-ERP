import { describe, expect, it } from "vitest";
import { operacionesOfrecidas, seOfrece, type PermisosParaOfrecer } from "./ofrecer";
import type { OperacionContextual } from "./tipos";

const CATALOGO = { ventas: { estado: "disponible" }, nuevo: { estado: "en_desarrollo" } };
const PERMISOS: PermisosParaOfrecer = {
  acciones: ["ventas.ver", "ventas.crear"],
  modulos: { activos: ["ventas"], enSoloLectura: [] },
  funcionesEncendidas: [],
};
const PEDIDO = { modulo: "ventas", accion: "ventas.ver" };
const con = (p: Partial<PermisosParaOfrecer>): PermisosParaOfrecer => ({ ...PERMISOS, ...p });

describe("seOfrece", () => {
  it("se ofrece con permisos, módulo disponible, acción y módulo activo", () => {
    expect(seOfrece(CATALOGO, PERMISOS, PEDIDO)).toBe(true);
  });
  it("sin permisos leídos, nada", () => {
    expect(seOfrece(CATALOGO, null, PEDIDO)).toBe(false);
  });
  it("módulo en desarrollo o inexistente, no", () => {
    const p = con({ acciones: ["x.ver"], modulos: { activos: ["nuevo", "x"], enSoloLectura: [] } });
    expect(seOfrece(CATALOGO, p, { modulo: "nuevo", accion: "x.ver" })).toBe(false);
    expect(seOfrece(CATALOGO, p, { modulo: "x", accion: "x.ver" })).toBe(false);
    expect(seOfrece(CATALOGO, p, { modulo: "constructor", accion: "x.ver" })).toBe(false);
  });
  it("módulo que no está activo, no", () => {
    expect(seOfrece(CATALOGO, con({ modulos: { activos: [], enSoloLectura: [] } }), PEDIDO)).toBe(
      false,
    );
  });
  it("activo pero sin la acción, no", () => {
    expect(seOfrece(CATALOGO, PERMISOS, { modulo: "ventas", accion: "ventas.anular" })).toBe(false);
  });
  it("en solo lectura: con la acción sí, sin ella no", () => {
    const soloLectura = con({ modulos: { activos: [], enSoloLectura: ["ventas"] } });
    expect(seOfrece(CATALOGO, soloLectura, PEDIDO)).toBe(true);
    expect(seOfrece(CATALOGO, con({ ...soloLectura, acciones: [] }), PEDIDO)).toBe(false);
  });
  it("con función de pago: sin leer no, apagada no, encendida sí", () => {
    const pedido = { ...PEDIDO, perilla: "salon" };
    expect(seOfrece(CATALOGO, { ...PERMISOS, funcionesEncendidas: undefined }, pedido)).toBe(false);
    expect(seOfrece(CATALOGO, PERMISOS, pedido)).toBe(false);
    expect(seOfrece(CATALOGO, con({ funcionesEncendidas: ["salon"] }), pedido)).toBe(true);
  });
});

describe("operacionesOfrecidas", () => {
  const op = (id: string, orden: number, contexto = "ventas.cuenta", accion = "ventas.ver") =>
    ({
      id,
      modulo: "ventas",
      contexto,
      accion,
      perilla: null,
      etiqueta: "x",
      orden,
      seAbreEn: "/a",
      alTerminar: "VUELVE",
    }) as unknown as OperacionContextual<string>;
  it("filtra por contexto y permiso y ordena por `orden`", () => {
    const lista = [
      op("ventas.b", 2),
      op("ventas.a", 1),
      op("ventas.otra", 1, "ventas.ticket"),
      op("ventas.c", 3, "ventas.cuenta", "ventas.anular"),
    ];
    expect(
      operacionesOfrecidas(CATALOGO, lista, PERMISOS, "ventas.cuenta").map((o) => o.id),
    ).toEqual(["ventas.a", "ventas.b"]);
  });
  it("sin permisos, ninguna", () => {
    expect(operacionesOfrecidas(CATALOGO, [op("ventas.a", 1)], null, "ventas.cuenta")).toEqual([]);
  });
});
