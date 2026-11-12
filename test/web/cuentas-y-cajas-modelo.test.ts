import { describe, expect, it } from "vitest";
import { TIPOS_DE_CUENTA } from "../../src/modulos/caja/publico";
import { RUTAS_DE_CAJA, estadoDeLista } from "../../apps/web/ui/plantillas/caja/lista-de-caja";
import {
  armarLaListaDeCajas,
  RUTAS_DE_CAJAS,
  rutaDeUnaCaja,
} from "../../apps/web/ui/plantillas/caja/modelo-de-cajas";
import {
  TIPOS_DE_CUENTA_CON_TEXTO,
  armarLaListaDeCuentas,
  opcionesDeSucursal,
  opcionesDeTipoDeCuenta,
  RUTAS_DE_CUENTAS,
  rutaDeUnaCuenta,
  type CuentaDeLaLista,
} from "../../apps/web/ui/plantillas/caja/modelo-de-cuentas-de-cobro";
import { pestanasDeCaja } from "../../apps/web/ui/plantillas/caja/pestanas-de-caja";

/**
 * Los modelos de vista de «Cuentas de cobro» y «Cajas» y lo que comparten las tres listas (maqueta `medios.html`, 09/11/2026), con los textos reales del catálogo.
 */
const cuenta = (cambios: Partial<CuentaDeLaLista> = {}): CuentaDeLaLista => ({
  id: "c1",
  tipo: "TERMINAL",
  nombre: "Posnet 1",
  identificadorExterno: "T-0481",
  sucursalId: "s1",
  activa: true,
  version: 4,
  ...cambios,
});
const SUCURSALES = [
  { id: "s1", nombre: "Sucursal Centro" },
  { id: "s2", nombre: "Sucursal Norte" },
];

describe("lo común de las listas", () => {
  it("el estado: Activo en verde, Desactivado como aviso", () => {
    expect(estadoDeLista(true)).toEqual({ texto: "Activo", tono: "exito" });
    expect(estadoDeLista(false)).toEqual({ texto: "Desactivado", tono: "aviso" });
  });

  it("las direcciones de las tres pantallas", () => {
    expect(RUTAS_DE_CAJA).toEqual({
      medios: "/caja/medios-de-pago",
      cuentas: "/caja/cuentas-de-cobro",
      cajas: "/caja/cajas",
    });
  });

  it("las pestañas llevan el título de cada pantalla, en orden, y marcan solo la actual", () => {
    expect(pestanasDeCaja("cuentas")).toEqual([
      { href: "/caja/medios-de-pago", texto: "Medios de pago", actual: false },
      { href: "/caja/cuentas-de-cobro", texto: "Cuentas de cobro", actual: true },
      { href: "/caja/cajas", texto: "Cajas", actual: false },
    ]);
    expect(pestanasDeCaja("medios").map((p) => p.actual)).toEqual([true, false, false]);
    expect(pestanasDeCaja("cajas").map((p) => p.actual)).toEqual([false, false, true]);
  });
});

describe("cuentas de cobro", () => {
  it("los tipos de la pantalla coinciden con los del dominio de caja, en el mismo orden", () => {
    expect([...TIPOS_DE_CUENTA_CON_TEXTO]).toEqual([...TIPOS_DE_CUENTA]);
  });

  it("una tarjeta lleva el nombre y, debajo, tipo · identificador · sucursal", () => {
    const [fila] = armarLaListaDeCuentas([cuenta()], SUCURSALES);
    expect(fila).toMatchObject({
      id: "c1",
      titulo: "Posnet 1",
      detalle: "Terminal · T-0481 · Sucursal Centro",
      activo: true,
      estado: { texto: "Activo", tono: "exito" },
      sePuedeDesactivar: true,
      version: 4,
      href: "/caja/cuentas-de-cobro/c1",
    });
  });

  it("sin identificador no hay hueco; el QR dice «QR» y la cuenta bancaria, «Cuenta bancaria»", () => {
    const filas = armarLaListaDeCuentas(
      [
        cuenta({ id: "a", tipo: "QR", identificadorExterno: null }),
        cuenta({ id: "b", tipo: "CUENTA_BANCARIA", sucursalId: "s2", activa: false }),
      ],
      SUCURSALES,
    );
    expect(filas.map((f) => f.detalle)).toEqual([
      "QR · Sucursal Centro",
      "Cuenta bancaria · T-0481 · Sucursal Norte",
    ]);
    expect(filas[1]?.estado.texto).toBe("Desactivado");
  });

  it("una sucursal que la persona ya no puede elegir se dice con su id (no se esconde la cuenta); un tipo desconocido, con su valor", () => {
    const [fila] = armarLaListaDeCuentas(
      [cuenta({ tipo: "CHEQUE", identificadorExterno: null, sucursalId: "s9" })],
      SUCURSALES,
    );
    expect(fila?.detalle).toBe("CHEQUE · s9");
  });

  it("las opciones del formulario: los tipos con su texto y las sucursales con su nombre", () => {
    expect(opcionesDeTipoDeCuenta()).toEqual([
      { valor: "TERMINAL", etiqueta: "Terminal" },
      { valor: "QR", etiqueta: "QR" },
      { valor: "CUENTA_BANCARIA", etiqueta: "Cuenta bancaria" },
    ]);
    expect(opcionesDeSucursal(SUCURSALES)).toEqual([
      { valor: "s1", etiqueta: "Sucursal Centro" },
      { valor: "s2", etiqueta: "Sucursal Norte" },
    ]);
  });

  it("las direcciones", () => {
    expect(RUTAS_DE_CUENTAS).toEqual({
      lista: "/caja/cuentas-de-cobro",
      nuevo: "/caja/cuentas-de-cobro/nuevo",
    });
    expect(rutaDeUnaCuenta("x")).toBe("/caja/cuentas-de-cobro/x");
  });
});

describe("cajas", () => {
  it("una tarjeta lleva el nombre y el estado, sin línea de detalle (la maqueta no la tiene)", () => {
    const filas = armarLaListaDeCajas([
      { id: "k1", nombre: "Caja 1", activa: true, version: 2 },
      { id: "k2", nombre: "Caja del salón", activa: false, version: 5 },
    ]);
    expect(filas).toEqual([
      {
        id: "k1",
        titulo: "Caja 1",
        detalle: "",
        activo: true,
        estado: { texto: "Activo", tono: "exito" },
        sePuedeDesactivar: true,
        version: 2,
        href: "/caja/cajas/k1",
      },
      {
        id: "k2",
        titulo: "Caja del salón",
        detalle: "",
        activo: false,
        estado: { texto: "Desactivado", tono: "aviso" },
        sePuedeDesactivar: true,
        version: 5,
        href: "/caja/cajas/k2",
      },
    ]);
  });

  it("las direcciones", () => {
    expect(RUTAS_DE_CAJAS).toEqual({ lista: "/caja/cajas", nuevo: "/caja/cajas/nuevo" });
    expect(rutaDeUnaCaja("x")).toBe("/caja/cajas/x");
  });
});
