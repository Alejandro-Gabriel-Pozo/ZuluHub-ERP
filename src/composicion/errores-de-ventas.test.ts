import { describe, expect, it } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import { entradaDeCotizarElCarrito } from "./entradas-de-venta-rapida";
import {
  accionDeVentas,
  respuestaGenericaDeVentas,
  traducirErrorDeVentas,
} from "./errores-de-ventas";

const GENERICO = { codigo: "VENTAS_ACCION_NO_PERMITIDA" };
const respuesta = { registrar: () => undefined, azar: () => new Uint8Array([1, 2, 3, 4]) };

describe("traducirErrorDeVentas: lista de permitidos", () => {
  it.each(["SIN_PERMISO", "MODULO_NO_ACTIVO", "MODULO_EN_DESARROLLO", "SESION_VENCIDA"])(
    "el motivo %s (ya tiene su texto aprobado) pasa sin cambios",
    (motivo) => {
      expect(traducirErrorDeVentas(motivo)).toBe(motivo);
    },
  );

  it("`EMPRESA_NO_OPERA` pasa sin cambios, con su motivo", () => {
    const e = { codigo: "EMPRESA_NO_OPERA", empresaId: "e1", motivo: "EMPRESA_SUSPENDIDA" };
    expect(traducirErrorDeVentas(e)).toBe(e);
  });

  it.each([
    "PRODUCTO_OCULTO",
    "PRODUCTO_NO_ENCONTRADO",
    "PRODUCTO_INACTIVO",
    "OPCION_REPETIDA",
    "CANTIDAD_INVALIDA",
    "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    "IDENTIFICADOR_INVALIDO",
    "PRODUCTO_SIN_PRECIO",
    "PRECIO_ABIERTO_NO_PERMITIDO",
    "SUCURSAL_NO_ENCONTRADA",
    "SUCURSAL_FUERA_DE_ALCANCE",
    "SUCURSAL_INACTIVA",
    "UN_ERROR_QUE_NADIE_PENSO",
  ])("el error de negocio %s sale como el genérico (lo que nadie pensó también cierra)", (e) => {
    expect(traducirErrorDeVentas(e)).toEqual(GENERICO);
  });

  it("un error de negocio con forma de objeto sale como el genérico, sin sus datos (ids)", () => {
    expect(traducirErrorDeVentas({ error: "OPCIONES_INCOMPLETAS", grupoId: "g-secreto" })).toEqual(
      GENERICO,
    );
    expect(traducirErrorDeVentas({ error: "OPCION_INVALIDA", opcionId: "o" })).toEqual(GENERICO);
  });

  it("un fallo de la base pasa sin cambios (sale como inesperado con referencia, no como «no permitido»)", () => {
    const base = { tipo: "Inesperado", sqlstate: "XX000", mensaje: "boom" };
    expect(traducirErrorDeVentas(base)).toBe(base);
    expect(traducirErrorDeVentas("ERROR_DE_LA_BASE_NO_TRADUCIDO")).toBe(
      "ERROR_DE_LA_BASE_NO_TRADUCIDO",
    );
  });
});

describe("accionDeVentas", () => {
  const leer = entradaDeCotizarElCarrito;

  it("un pedido sin la forma pedida es el genérico y NO llega a correr", async () => {
    let corrio = false;
    const r = await accionDeVentas(
      respuesta,
      { lineas: "no es una lista" },
      leer,
      () => {
        corrio = true;
        return Promise.resolve(ok(1));
      },
      (x) => x,
    );
    expect(corrio).toBe(false);
    expect(r).toEqual(respuestaGenericaDeVentas());
    expect(r).toMatchObject({ ok: false, error: { codigo: "VENTAS_ACCION_NO_PERMITIDA" } });
  });

  it("un error de negocio del servidor sale como el genérico", async () => {
    const r = await accionDeVentas(
      respuesta,
      { lineas: [] },
      leer,
      () => Promise.resolve(err("PRODUCTO_OCULTO")),
      (x) => x,
    );
    expect(r).toMatchObject({ ok: false, error: { codigo: "VENTAS_ACCION_NO_PERMITIDA" } });
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const r = await accionDeVentas(
      respuesta,
      { lineas: [] },
      leer,
      () => Promise.reject(new Error("detalle secreto de la base")),
      (x) => x,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle secreto");
    expect(JSON.stringify(r)).toContain("PD-");
  });
});
