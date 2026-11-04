import { describe, expect, it } from "vitest";
import {
  armarElPedidoDeContacto,
  lugarDelErrorDeContacto,
  valoresDelContacto,
  type ContactoDeLaSucursal,
} from "./modelo-de-contacto-de-la-sucursal";

/** El modelo de «Contacto de la sucursal»: solo viaja lo que cambió, vaciar borra, sin cambios no se envía. */
const SUCURSAL = {
  sucursalId: "5b1e0f6c-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  nombre: "Centro",
  version: 7,
};
const CONTACTO: ContactoDeLaSucursal = {
  telefono: "011 4555-1234",
  correo: null,
  web: "www.hotelcentro.com",
};
const IGUALES = valoresDelContacto(CONTACTO);

describe("valoresDelContacto", () => {
  it("el contacto guardado se precarga y lo que no hay queda vacío", () => {
    expect(IGUALES).toEqual({ telefono: "011 4555-1234", correo: "", web: "www.hotelcentro.com" });
  });
});

describe("armarElPedidoDeContacto", () => {
  it("sin cambios no hay pedido", () => {
    expect(armarElPedidoDeContacto(SUCURSAL, CONTACTO, IGUALES)).toBeNull();
  });

  it("espacios de más no son un cambio", () => {
    expect(
      armarElPedidoDeContacto(SUCURSAL, CONTACTO, {
        ...IGUALES,
        telefono: "  011 4555-1234 ",
        correo: "   ",
      }),
    ).toBeNull();
  });

  it("solo lleva el campo que cambió, con la sucursal, el nombre y la versión esperada", () => {
    const pedido = armarElPedidoDeContacto(SUCURSAL, CONTACTO, {
      ...IGUALES,
      correo: " reservas@hotelcentro.com ",
    });
    expect(pedido).toEqual({
      sucursalId: SUCURSAL.sucursalId,
      versionEsperada: 7,
      nombre: "Centro",
      correo: "reservas@hotelcentro.com",
    });
    expect(pedido).not.toHaveProperty("telefono");
    expect(pedido).not.toHaveProperty("web");
  });

  it("vaciar un campo con valor manda null (lo borra); un campo en blanco que ya estaba vacío no viaja", () => {
    const pedido = armarElPedidoDeContacto(SUCURSAL, CONTACTO, { ...IGUALES, telefono: "  " });
    expect(pedido).toMatchObject({ telefono: null });
    expect(pedido).not.toHaveProperty("correo");
    expect(pedido).not.toHaveProperty("web");
  });

  it("cargar un dato donde no había manda el texto; la web viaja como se escribió, sin forzar el esquema", () => {
    const pedido = armarElPedidoDeContacto(SUCURSAL, CONTACTO, {
      ...IGUALES,
      correo: "a@b.com",
      web: "hotelcentro.com/reservas",
    });
    expect(pedido).toMatchObject({ correo: "a@b.com", web: "hotelcentro.com/reservas" });
  });

  it("varios cambios viajan juntos", () => {
    expect(
      armarElPedidoDeContacto(SUCURSAL, CONTACTO, { telefono: "", correo: "x@y.com", web: "" }),
    ).toEqual({
      sucursalId: SUCURSAL.sucursalId,
      versionEsperada: 7,
      nombre: "Centro",
      telefono: null,
      correo: "x@y.com",
      web: null,
    });
  });
});

describe("lugarDelErrorDeContacto", () => {
  it("un campo conocido se marca donde corresponde; uno desconocido o ausente va arriba", () => {
    expect(lugarDelErrorDeContacto("telefono")).toBe("telefono");
    expect(lugarDelErrorDeContacto("correo")).toBe("correo");
    expect(lugarDelErrorDeContacto("web")).toBe("web");
    expect(lugarDelErrorDeContacto("nombre")).toBeNull();
    expect(lugarDelErrorDeContacto(undefined)).toBeNull();
  });
});
