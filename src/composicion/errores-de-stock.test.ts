import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import { err, ok } from "../primitivas/resultado/resultado";
import { identificador, leer } from "./entradas-de-facturacion";
import { accionDeStock, traducirErrorDeStock } from "./errores-de-stock";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const entradaDePrueba = (crudo: unknown) => leer(z.object({ id: identificador }), crudo);

describe("traducirErrorDeStock", () => {
  it.each([
    ["NOMBRE_DUPLICADO", "STOCK_NOMBRE_DUPLICADO"],
    ["TRANSFERENCIA_AL_MISMO_DEPOSITO", "STOCK_TRANSFERENCIA_AL_MISMO_DEPOSITO"],
    ["DETALLE_REQUERIDO", "STOCK_DETALLE_REQUERIDO"],
    ["CANTIDAD_INVALIDA", "STOCK_CANTIDAD_INVALIDA"],
    ["CONTEO_EN_CURSO", "STOCK_CONTEO_EN_CURSO"],
  ])("%s tiene su texto propio: sale como %s", (error, codigo) => {
    expect(traducirErrorDeStock(error)).toEqual({ codigo });
  });

  it.each([
    "SUCURSAL_FUERA_DE_ALCANCE",
    "IDENTIFICADOR_INVALIDO",
    "ID_REUTILIZADO",
    "CLAVE_REUTILIZADA",
    "NOMBRE_INVALIDO",
    "USO_INVALIDO",
    "USO_NO_VENDIBLE",
    "YA_HAY_DEPOSITO_DE_VENTA",
    "DEPOSITO_NO_ENCONTRADO",
    "DEPOSITO_DESACTUALIZADO",
    "DEPOSITO_CON_EXISTENCIA",
    "MOVIMIENTO_NO_ANULABLE",
    "HORA_FUERA_DE_VENTANA",
    "REVISION_DESACTUALIZADA",
    "SIN_CAMBIOS",
  ])("%s no tiene texto propio: sale como el genérico", (error) => {
    expect(traducirErrorDeStock(error)).toEqual({ codigo: "STOCK_ACCION_NO_PERMITIDA" });
  });

  it("el control de existencia negativa: avisa pide confirmar, bloquea dice que no hay stock; ninguno deja salir el detalle de los saldos", () => {
    const detalle = [{ productoId: "p", depositoId: "d", existenciaResultante: "-3" }];
    const avisa = traducirErrorDeStock({
      error: "CONTROL_REQUIERE_CONFIRMACION",
      control: "stock.existencia_negativa",
      detalle,
    });
    const bloquea = traducirErrorDeStock({
      error: "CONTROL_BLOQUEA",
      control: "stock.existencia_negativa",
      detalle,
    });
    expect(avisa).toEqual({ codigo: "STOCK_CONTROL_AVISA" });
    expect(bloquea).toEqual({ codigo: "STOCK_CONTROL_BLOQUEA" });
  });

  it("una función que el plan no incluye sale como el genérico, sin la perilla", () => {
    expect(traducirErrorDeStock({ error: "FUNCION_NO_INCLUIDA", perilla: "lotes" })).toEqual({
      codigo: "STOCK_ACCION_NO_PERMITIDA",
    });
  });

  it.each(Object.keys(CODIGOS_PUBLICOS))(
    "el código público %s (el guard, la sesión, otros módulos) pasa sin cambios",
    (codigo) => {
      expect(traducirErrorDeStock(codigo)).toBe(codigo);
    },
  );

  it.each([
    { codigo: "EMPRESA_NO_OPERA", motivo: "EMPRESA_SUSPENDIDA" },
    { tipo: "Inesperado", mensaje: "boom" },
    { tipo: "Unicidad", restriccion: "deposito_nombre_uk" },
    7,
    null,
    undefined,
  ])("lo que no es de stock ni de su dominio pasa sin cambios (%j)", (error) => {
    expect(traducirErrorDeStock(error)).toBe(error);
  });

  it("un nombre heredado de Object.prototype no se confunde con un error conocido", () => {
    for (const error of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(traducirErrorDeStock(error)).toBe(error);
      expect(traducirErrorDeStock({ error })).toEqual({ error });
    }
  });

  it("en un error con forma de objeto solo un TEXTO es el nombre: una lista que se lee como uno pasa sin cambios", () => {
    const disfrazado = { error: ["CONTROL_BLOQUEA"] };
    expect(traducirErrorDeStock(disfrazado)).toBe(disfrazado);
  });

  it("solo un TEXTO es un error: un objeto que se lee como uno (toString) pasa sin cambios", () => {
    const disfrazado = { toString: () => "NOMBRE_DUPLICADO" };
    expect(traducirErrorDeStock(disfrazado)).toBe(disfrazado);
  });
});

describe("accionDeStock", () => {
  const registrados: string[] = [];
  const respuesta = {
    registrar: (d: string) => registrados.push(d),
    azar: () => new Uint8Array(4),
  };
  const pedido = { id: ID };

  it("un pedido sin forma da el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeStock(
      respuesta,
      { id: "no" },
      entradaDePrueba,
      () => {
        corrio = true;
        return Promise.resolve(ok(1));
      },
      (n) => n,
    );
    expect(corrio).toBe(false);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "STOCK_ACCION_NO_PERMITIDA",
        clave: "stock.error.sin_permiso",
        presentacion: "AVISO",
      },
    });
  });

  it("un resultado ok se presenta con lo que la pantalla necesita, nada más", async () => {
    const r = await accionDeStock(
      respuesta,
      pedido,
      entradaDePrueba,
      (e) => Promise.resolve(ok({ id: e.id, interno: "secreto" })),
      (s) => ({ id: s.id }),
    );
    expect(r).toEqual({ ok: true, dato: { id: ID } });
  });

  it("un error del dominio sale con su código público de stock", async () => {
    const r = await accionDeStock(
      respuesta,
      pedido,
      entradaDePrueba,
      () => Promise.resolve(err("NOMBRE_DUPLICADO")),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("STOCK_NOMBRE_DUPLICADO");
  });

  it("un error del guard pasa con su motivo", async () => {
    const r = await accionDeStock(
      respuesta,
      pedido,
      entradaDePrueba,
      () => Promise.resolve(err("SIN_PERMISO")),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const r = await accionDeStock(
      respuesta,
      pedido,
      entradaDePrueba,
      () => Promise.reject(new Error("la base dijo: password=secreto")),
      () => 1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.codigo).toBe("ERROR_INTERNO");
      expect(JSON.stringify(r)).not.toContain("secreto");
    }
    expect(registrados.some((x) => x.includes("secreto"))).toBe(true);
  });
});
