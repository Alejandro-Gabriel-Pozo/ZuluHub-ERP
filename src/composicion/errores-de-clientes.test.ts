import { describe, expect, it } from "vitest";
import { err, ok } from "../primitivas/resultado/resultado";
import { accionDeClientes, traducirErrorDeClientes } from "./errores-de-clientes";
import { entradaDeEstadoDeParte } from "./entradas-de-directorio";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const GENERICO = { codigo: "CLIENTES_ACCION_NO_PERMITIDA" };
const datos = (...codigos: string[]) => ({
  error: "DATOS_INVALIDOS",
  campos: codigos.map((codigo) => ({ campo: "x", codigo })),
});

describe("traducirErrorDeClientes", () => {
  it.each([
    "SUCURSAL_FUERA_DE_ALCANCE",
    "IDENTIFICADOR_INVALIDO",
    "CLAVE_REUTILIZADA",
    "PARTE_NO_ENCONTRADA",
    "VERSION_DESACTUALIZADA",
    "ROL_DE_PARTE_INVALIDO",
    "TIPO_DE_VINCULO_INVALIDO",
    "VINCULO_CONSIGO_MISMA",
    "CONTACTO_DEBE_SER_HUMANA",
    "VINCULO_DEBE_SER_CON_EMPRESA",
    "CARGO_INVALIDO",
    "PARTE_CON_VINCULOS",
    "CURSOR_INVALIDO",
    "UN_ERROR_QUE_NADIE_CONOCE",
  ])("%s sale como el genérico", (error) => {
    expect(traducirErrorDeClientes(error)).toEqual(GENERICO);
  });

  it("un documento ya registrado sale con su texto y su campo, sin el id de la otra parte", () => {
    for (const [nombre, codigo] of [
      ["DOCUMENTO_YA_REGISTRADO", "CLIENTES_DOCUMENTO_REPETIDO"],
      ["PARTE_INACTIVA_CON_ESE_DOCUMENTO", "CLIENTES_DOCUMENTO_DE_DESACTIVADA"],
    ] as const) {
      expect(traducirErrorDeClientes({ error: nombre, parteId: ID })).toEqual({
        codigo,
        campo: "documentoNumero",
      });
    }
  });

  it.each([
    ["NOMBRE_REQUERIDO", "CLIENTES_FALTA_EL_NOMBRE", "nombre"],
    ["CUIT_INVALIDO", "CLIENTES_CUIT_INVALIDO", "documentoNumero"],
    ["DNI_INVALIDO", "CLIENTES_DNI_INVALIDO", "documentoNumero"],
    ["DOCUMENTO_NO_ADMITIDO_PARA_EMPRESA", "CLIENTES_EMPRESA_SOLO_CUIT", "documentoNumero"],
    ["EMAIL_INVALIDO", "CLIENTES_EMAIL_INVALIDO", "email"],
    ["TELEFONO_INVALIDO", "CLIENTES_TELEFONO_INVALIDO", "telefono"],
  ])("el dato inválido %s sale como %s en el campo %s", (codigo, publico, campo) => {
    expect(traducirErrorDeClientes(datos(codigo))).toEqual({ codigo: publico, campo });
  });

  it("de varios datos inválidos sale el primero con texto propio; sin ninguno, el genérico", () => {
    expect(
      traducirErrorDeClientes(datos("APELLIDO_INVALIDO", "EMAIL_INVALIDO", "DNI_INVALIDO")),
    ).toEqual({
      codigo: "CLIENTES_EMAIL_INVALIDO",
      campo: "email",
    });
    expect(traducirErrorDeClientes(datos("APELLIDO_INVALIDO", "NOTA_INVALIDA"))).toEqual(GENERICO);
    expect(traducirErrorDeClientes(datos())).toEqual(GENERICO);
  });

  it.each([
    { error: "DATOS_INVALIDOS" },
    { error: "DATOS_INVALIDOS", campos: "no" },
    { error: "DATOS_INVALIDOS", campos: [null, 7, { codigo: 1 }, { codigo: "constructor" }] },
  ])("datos inválidos con una forma que no es la esperada es el genérico (%j)", (error) => {
    expect(traducirErrorDeClientes(error)).toEqual(GENERICO);
  });

  it("un error de negocio con forma de objeto y sin texto propio sale como el genérico", () => {
    expect(traducirErrorDeClientes({ error: "ALGO_NUEVO" })).toEqual(GENERICO);
  });

  it.each([
    "SIN_PERMISO",
    "MODULO_EN_DESARROLLO",
    "SESION_VENCIDA",
    { codigo: "EMPRESA_NO_OPERA" },
    { tipo: "Inesperado" },
    7,
    null,
    undefined,
  ])("lo que ya es público o no es de negocio pasa sin cambios (%j)", (error) => {
    expect(traducirErrorDeClientes(error)).toBe(error);
  });

  it("solo un TEXTO es un código: un objeto que se lee como uno (toString) pasa sin cambios", () => {
    const disfrazado = { toString: () => "PARTE_NO_ENCONTRADA" };
    expect(traducirErrorDeClientes(disfrazado)).toBe(disfrazado);
  });

  it("un nombre heredado del prototipo no es un código: es un texto sin conocer, el genérico", () => {
    expect(traducirErrorDeClientes("constructor")).toEqual(GENERICO);
    expect(traducirErrorDeClientes({ error: "constructor" })).toEqual(GENERICO);
  });
});

describe("accionDeClientes", () => {
  const registrados: string[] = [];
  const respuesta = {
    registrar: (d: string) => registrados.push(d),
    azar: () => new Uint8Array(4),
  };

  it("un pedido sin forma da el genérico y no corre nada", async () => {
    let corrio = false;
    const r = await accionDeClientes(
      respuesta,
      { parteId: "no" },
      entradaDeEstadoDeParte,
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
        codigo: "CLIENTES_ACCION_NO_PERMITIDA",
        clave: "clientes.error.sin_permiso",
        presentacion: "AVISO",
      },
    });
  });

  it("un resultado ok se presenta con lo que la pantalla necesita", async () => {
    const r = await accionDeClientes(
      respuesta,
      { parteId: ID },
      entradaDeEstadoDeParte,
      (e) => Promise.resolve(ok({ id: e.parteId, interno: "secreto" })),
      (s) => ({ id: s.id }),
    );
    expect(r).toEqual({ ok: true, dato: { id: ID } });
  });

  it("un error del dominio sale con su código público del directorio", async () => {
    const r = await accionDeClientes(
      respuesta,
      { parteId: ID },
      entradaDeEstadoDeParte,
      () => Promise.resolve(err({ error: "DOCUMENTO_YA_REGISTRADO", parteId: ID })),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_DOCUMENTO_REPETIDO");
  });

  it("un error del guard pasa con su motivo", async () => {
    const r = await accionDeClientes(
      respuesta,
      { parteId: ID },
      entradaDeEstadoDeParte,
      () => Promise.resolve(err("SIN_PERMISO")),
      () => 1,
    );
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const r = await accionDeClientes(
      respuesta,
      { parteId: ID },
      entradaDeEstadoDeParte,
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
