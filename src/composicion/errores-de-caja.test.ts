import { describe, expect, it } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import { accionDeCaja, traducirErrorDeCaja } from "./errores-de-caja";
import { entradaDeEstadoDeMedio } from "./entradas-de-caja";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";

describe("traducirErrorDeCaja", () => {
  it.each([
    ["MEDIO_DUPLICADO", "CAJA_MEDIO_REPETIDO"],
    ["MEDIO_INACTIVO_CON_ESE_NOMBRE", "CAJA_MEDIO_REPETIDO"],
    ["TIPO_DE_MEDIO_INVALIDO", "CAJA_ACCION_NO_PERMITIDA"],
    ["NOMBRE_DE_MEDIO_INVALIDO", "CAJA_ACCION_NO_PERMITIDA"],
    ["EFECTIVO_YA_EXISTE", "CAJA_ACCION_NO_PERMITIDA"],
    ["EFECTIVO_NO_SE_DESACTIVA", "CAJA_ACCION_NO_PERMITIDA"],
    ["MEDIO_NO_ENCONTRADO", "CAJA_ACCION_NO_PERMITIDA"],
    ["VERSION_DESACTUALIZADA", "CAJA_ACCION_NO_PERMITIDA"],
  ])("%s sale como %s", (error, codigo) => {
    expect(traducirErrorDeCaja(error)).toEqual({ codigo });
  });

  it("un dato que el medio no admite sale como el genérico", () => {
    expect(
      traducirErrorDeCaja({ codigo: "DATO_NO_ADMITIDO_POR_EL_MEDIO", dato: "cuotas" }),
    ).toEqual({ codigo: "CAJA_ACCION_NO_PERMITIDA" });
  });

  it.each([
    "SIN_PERMISO",
    "MODULO_EN_DESARROLLO",
    { codigo: "EMPRESA_NO_OPERA" },
    { tipo: "Inesperado" },
    7,
    null,
    undefined,
  ])("lo que no es de caja pasa sin cambios (%j)", (error) => {
    expect(traducirErrorDeCaja(error)).toBe(error);
  });

  it("solo un TEXTO es un código: un objeto que se lee como uno (toString) pasa sin cambios", () => {
    const disfrazado = { toString: () => "MEDIO_DUPLICADO" };
    expect(traducirErrorDeCaja(disfrazado)).toBe(disfrazado);
  });

  it("un nombre heredado del prototipo no es un código (ni `constructor`)", () => {
    expect(traducirErrorDeCaja("constructor")).toBe("constructor");
    expect(traducirErrorDeCaja({ codigo: "constructor" })).toEqual({ codigo: "constructor" });
  });
});

describe("accionDeCaja", () => {
  const registrados: string[] = [];
  const respuesta = {
    registrar: (d: string) => registrados.push(d),
    azar: () => new Uint8Array(4),
  };

  it("un pedido sin forma da el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeCaja(
      respuesta,
      { medioDePagoId: "no" },
      entradaDeEstadoDeMedio,
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
        codigo: "CAJA_ACCION_NO_PERMITIDA",
        clave: "caja.error.accion_no_permitida",
        presentacion: "AVISO",
      },
    });
  });

  it("un resultado ok se presenta con lo que la pantalla necesita", async () => {
    const r = await accionDeCaja(
      respuesta,
      { medioDePagoId: ID },
      entradaDeEstadoDeMedio,
      (e) => Promise.resolve(ok({ id: e.medioDePagoId, interno: "secreto" })),
      (s) => ({ id: s.id }),
    );
    expect(r).toEqual({ ok: true, dato: { id: ID } });
  });

  it("un error del dominio sale con su código público de caja", async () => {
    const r = await accionDeCaja(
      respuesta,
      { medioDePagoId: ID },
      entradaDeEstadoDeMedio,
      () => Promise.resolve(err("MEDIO_DUPLICADO")),
      () => 1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe("CAJA_MEDIO_REPETIDO");
  });

  it("un error del guard pasa con su motivo", async () => {
    const r = await accionDeCaja(
      respuesta,
      { medioDePagoId: ID },
      entradaDeEstadoDeMedio,
      () => Promise.resolve(err("SIN_PERMISO")),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const r = await accionDeCaja(
      respuesta,
      { medioDePagoId: ID },
      entradaDeEstadoDeMedio,
      () => Promise.reject(new Error("relation x does not exist")),
      () => 1,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r.error)).not.toContain("relation");
    expect(registrados.some((x) => x.includes("relation x does not exist"))).toBe(true);
  });
});
