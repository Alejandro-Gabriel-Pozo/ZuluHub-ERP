import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  cargarCertificado,
  generarPedidoDeCertificado,
  type DependenciasDeAccionesDeCertificadoDeArcaWeb,
} from "./certificado-de-arca-web";

/**
 * Lo que sale de generar el pedido y de cargar el certificado es una LISTA BLANCA, campo por campo: si mañana el caso de uso
 * devolviera de más (la clave, lo cifrado, la huella, el certificado que reemplazó), la pantalla no lo recibe. Acá el caso de uso es
 * un falso que devuelve de más a propósito; con la base real, lo mismo se prueba en `test/integracion/fiscal-certificados-web.test.ts`.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-10-29T12:00:00.000Z"),
};
const SECRETOS = {
  clavePrivada: "CLAVE-PRIVADA-SECRETA",
  claveCifrada: "CLAVE-CIFRADA-SECRETA",
  huellaSha256: "HUELLA-SECRETA",
  certificadoPem: "PEM-SECRETO",
  reemplazoA: "CERTIFICADO-ANTERIOR",
};
const VENCE = new Date("2028-10-29T00:00:00.000Z");
const PEDIDO = "-----BEGIN CERTIFICATE REQUEST-----\nAAAA\n-----END CERTIFICATE REQUEST-----\n";

const pedirGenerar = (resultado: () => Resultado<unknown, unknown>) =>
  generarPedidoDeCertificado(
    con({ generarPedidoDeCertificado: () => resultado() }),
    contexto,
    pedidoValido(),
  );

function con(casos: Record<string, () => unknown>): DependenciasDeAccionesDeCertificadoDeArcaWeb {
  return {
    casosDeUso: () =>
      Object.fromEntries(
        Object.entries(casos).map(([nombre, caso]) => [nombre, () => Promise.resolve(caso())]),
      ) as unknown as ReturnType<DependenciasDeAccionesDeCertificadoDeArcaWeb["casosDeUso"]>,
    respuesta: { registrar: () => undefined },
  };
}

const pedidoValido = () => ({
  id: randomUUID(),
  emisorId: randomUUID(),
  ambiente: "HOMOLOGACION",
  alias: "pedernal1",
  cuitTitular: "20123456786",
  organizacion: "Zulu SA",
});

const sinSecretos = (r: unknown) => {
  const texto = JSON.stringify(r);
  for (const secreto of Object.values(SECRETOS)) expect(texto).not.toContain(secreto);
};

describe("generar el pedido de un certificado deja pasar solo el pedido (CSR, público)", () => {
  it("el id del certificado, el pedido en PEM y si ya existía; nada más", async () => {
    const r = await pedirGenerar(() =>
      ok({ certificadoId: "c-1", pedidoPem: PEDIDO, yaExistia: false, ...SECRETOS }),
    );
    expect(r).toEqual({
      ok: true,
      dato: { certificadoId: "c-1", pedidoPem: PEDIDO, yaExistia: false },
    });
    sinSecretos(r);
  });

  it("un pedido mal armado sale como dato inválido de ese campo, sin llegar al caso de uso", async () => {
    let corrio = false;
    const d = con({
      generarPedidoDeCertificado: () => {
        corrio = true;
        return ok(null);
      },
    });
    const r = await generarPedidoDeCertificado(d, contexto, { ...pedidoValido(), ambiente: "X" });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "ambiente" },
    });
    expect(corrio).toBe(false);
  });

  it("un error sin texto aprobado sale como error inesperado con referencia, sin el código interno", async () => {
    const r = await pedirGenerar(() => err("ALIAS_INVALIDO"));
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "ERROR_INTERNO", referencia: expect.stringMatching(/^PD-/) as string },
    });
    expect(JSON.stringify(r)).not.toContain("ALIAS_INVALIDO");
  });

  it("el motivo del guard pasa tal cual", async () => {
    const r = await pedirGenerar(() => err("SIN_PERMISO"));
    expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
  });
});

describe("cargar un certificado deja pasar solo cuándo vence", () => {
  const pedido = () => ({
    certificadoId: randomUUID(),
    certificadoPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
  });

  it("el vencimiento como texto y si ya estaba; ni el certificado que reemplazó ni la huella", async () => {
    const r = await cargarCertificado(
      con({ cargarCertificado: () => ok({ vence: VENCE, yaEstaba: false, ...SECRETOS }) }),
      contexto,
      pedido(),
    );
    expect(r).toEqual({ ok: true, dato: { venceEn: VENCE.toISOString(), yaEstaba: false } });
    sinSecretos(r);
  });

  it("lo que no es texto no llega al caso de uso", async () => {
    let corrio = false;
    const d = con({
      cargarCertificado: () => {
        corrio = true;
        return ok(null);
      },
    });
    const r = await cargarCertificado(d, contexto, { ...pedido(), certificadoPem: 5 });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "certificadoPem" },
    });
    expect(corrio).toBe(false);
  });

  it("un certificado que no sirve sale como error inesperado con referencia, sin repetir lo pegado", async () => {
    const d = con({ cargarCertificado: () => err("NO_CORRESPONDE_A_LA_CLAVE") });
    const r = await cargarCertificado(d, contexto, pedido());
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("NO_CORRESPONDE");
  });

  it("una excepción (la base caída, un defecto) sale sin detalle y con referencia", async () => {
    const d: DependenciasDeAccionesDeCertificadoDeArcaWeb = {
      casosDeUso: () => {
        throw new Error("DETALLE-INTERNO password=secreto");
      },
      respuesta: { registrar: () => undefined },
    };
    const r = await cargarCertificado(d, contexto, pedido());
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toMatch(/DETALLE-INTERNO|secreto/);
  });
});
