import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import type { ContextoOperativo } from "../contexto/contexto";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { ok } from "../primitivas/resultado/resultado";
import { estadoDeCertificados } from "./certificado-de-arca-web";
import {
  datosFiscalesDelEmisor,
  estadoDeLaConfiguracionFiscal,
  puntosDeVentaDelEmisor,
  type DependenciasDeConfiguracionFiscalWeb,
} from "./configuracion-fiscal-web";

/**
 * Lo que las pantallas de Configuración fiscal reciben es una LISTA BLANCA, campo por campo: si mañana la consulta del módulo
 * trajera de más (una clave, el pedido, el PEM, la huella, Ingresos Brutos), la pantalla no lo recibe. Acá la consulta es un
 * falso que devuelve de más a propósito; con la base real, lo mismo se prueba en `test/integracion/fiscal-configuracion-web.test.ts`.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-10-29T12:00:00.000Z"),
};
const SECRETOS = {
  claveCifrada: "CLAVE-SECRETA",
  pedidoPem: "PEDIDO-SECRETO",
  certificadoPem: "PEM-SECRETO",
  huellaSha256: "HUELLA-SECRETA",
  iibbNumero: "IIBB-902-123456",
  iibbCondicion: "CONVENIO_MULTILATERAL",
  creadoPor: "PERSONA-INTERNA",
  empresaId: "EMPRESA-INTERNA",
};
const VENCE = new Date("2027-01-01T00:00:00.000Z");
const DOMICILIO = {
  id: "d-1",
  calle: "Av. Corrientes",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
  ...SECRETOS,
};

function con(consultas: Record<string, () => unknown>): DependenciasDeConfiguracionFiscalWeb {
  return {
    casosDeUso: () => {
      throw new Error("estas pantallas de lectura no corren casos de uso");
    },
    consultas: () =>
      Object.fromEntries(
        Object.entries(consultas).map(([nombre, valor]) => [
          nombre,
          () => Promise.resolve(valor()),
        ]),
      ) as unknown as ReturnType<DependenciasDeConfiguracionFiscalWeb["consultas"]>,
    respuesta: { registrar: () => undefined },
  };
}

const textoDe = (r: unknown) => JSON.stringify(r);
const sinSecretos = (r: unknown) => {
  for (const secreto of Object.values(SECRETOS)) expect(textoDe(r)).not.toContain(secreto);
};

describe("la lista de lo que falta deja pasar solo lo suyo", () => {
  it("el emisor, el estado de cada fila y por certificado su ambiente, situación y vencimiento", async () => {
    const r = await estadoDeLaConfiguracionFiscal(
      con({
        estadoDeLaConfiguracionFiscal: () =>
          ok({
            emisorId: "emisor-1",
            ...SECRETOS,
            datosFiscales: { estado: "VIGENTES", ...SECRETOS },
            puntosDeVenta: {
              estado: "CON_ACTIVOS",
              total: 2,
              activos: 1,
              ambientesEnUso: ["HOMOLOGACION"],
              ...SECRETOS,
            },
            certificados: [
              {
                ambiente: "HOMOLOGACION",
                situacion: "VIGENTE",
                venceEn: VENCE,
                vencido: false,
                alias: "pedernal1",
                ...SECRETOS,
              },
              {
                ambiente: "PRODUCCION",
                situacion: "FALTA_CARGAR",
                venceEn: null,
                vencido: false,
                ...SECRETOS,
              },
            ],
          }),
      }),
      contexto,
    );
    expect(r).toEqual({
      ok: true,
      dato: {
        emisorId: "emisor-1",
        datosFiscales: { estado: "VIGENTES" },
        puntosDeVenta: {
          estado: "CON_ACTIVOS",
          total: 2,
          activos: 1,
          ambientesEnUso: ["HOMOLOGACION"],
        },
        certificados: [
          {
            ambiente: "HOMOLOGACION",
            situacion: "VIGENTE",
            venceEn: VENCE.toISOString(),
            vencido: false,
          },
          { ambiente: "PRODUCCION", situacion: "FALTA_CARGAR", venceEn: null, vencido: false },
        ],
      },
    });
    sinSecretos(r);
    expect(textoDe(r)).not.toContain("pedernal1");
  });
});

describe("los datos fiscales y los puntos de venta dejan pasar solo lo suyo (sin Ingresos Brutos, D-45)", () => {
  it("datos fiscales: la versión que rige y el borrador, con su domicilio y los instantes como texto", async () => {
    const r = await datosFiscalesDelEmisor(
      con({
        datosFiscalesDelEmisor: () =>
          ok({
            emisorId: "emisor-1",
            cuit: "20123456786",
            ...SECRETOS,
            vigente: {
              id: "v-1",
              numero: 2,
              vigenteDesde: VENCE,
              razonSocial: "Zulu SA",
              condicionIva: "MONOTRIBUTO",
              domicilio: DOMICILIO,
              inicioActividades: "2020-03-01",
              ...SECRETOS,
            },
            borrador: {
              id: "b-1",
              version: 4,
              razonSocial: null,
              condicionIva: null,
              domicilio: DOMICILIO,
              inicioActividades: null,
              ...SECRETOS,
            },
          }),
      }),
      contexto,
      { emisorId: "7b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60" },
    );
    const domicilio = {
      id: "d-1",
      calle: "Av. Corrientes",
      numero: "1234",
      piso: null,
      departamento: null,
      localidad: "Rosario",
      provincia: "AR-S",
      codigoPostal: "S2000",
    };
    expect(r).toEqual({
      ok: true,
      dato: {
        emisorId: "emisor-1",
        // D-65: el CUIT del emisor, solo para leer.
        cuit: "20123456786",
        vigente: {
          id: "v-1",
          numero: 2,
          vigenteDesde: VENCE.toISOString(),
          razonSocial: "Zulu SA",
          condicionIva: "MONOTRIBUTO",
          domicilio,
          inicioActividades: "2020-03-01",
        },
        borrador: {
          id: "b-1",
          version: 4,
          razonSocial: null,
          condicionIva: null,
          domicilio,
          inicioActividades: null,
        },
      },
    });
    sinSecretos(r);
  });

  it("puntos de venta: número, estado, ambiente, sucursal, domicilio, números usados y versión", async () => {
    const r = await puntosDeVentaDelEmisor(
      con({
        puntosDeVentaDelEmisor: () =>
          ok({
            emisorId: "emisor-1",
            ...SECRETOS,
            items: [
              {
                id: "pv-1",
                numero: 3,
                activo: true,
                ambiente: "PRODUCCION",
                sucursal: { id: "s-1", nombre: "Casa central", activa: true, ...SECRETOS },
                tieneDomicilio: true,
                domicilio: DOMICILIO,
                hayNumerosUsados: true,
                version: 7,
                ...SECRETOS,
              },
            ],
          }),
      }),
      contexto,
      { emisorId: "7b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60" },
    );
    expect(r).toEqual({
      ok: true,
      dato: {
        emisorId: "emisor-1",
        items: [
          {
            id: "pv-1",
            numero: 3,
            activo: true,
            ambiente: "PRODUCCION",
            sucursal: { id: "s-1", nombre: "Casa central", activa: true },
            tieneDomicilio: true,
            domicilio: {
              id: "d-1",
              calle: "Av. Corrientes",
              numero: "1234",
              piso: null,
              departamento: null,
              localidad: "Rosario",
              provincia: "AR-S",
              codigoPostal: "S2000",
            },
            hayNumerosUsados: true,
            version: 7,
          },
        ],
      },
    });
    sinSecretos(r);
  });
});

describe("el estado del certificado deja pasar solo lo suyo: nunca la clave, el pedido, el PEM ni la huella", () => {
  it("falta cargar, pedido generado y vigente (con su renovación en curso)", async () => {
    const pedido = {
      certificadoId: "c-2",
      alias: "pedernal2",
      cuitTitular: "20123456786",
      creadoEn: new Date("2026-10-01T00:00:00.000Z"),
    };
    const r = await estadoDeCertificados(
      {
        consultas: () =>
          ({
            estadoDeCertificados: () =>
              Promise.resolve(
                ok([
                  { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR", ...SECRETOS },
                  { ambiente: "PRODUCCION", situacion: "PEDIDO_GENERADO", ...pedido, ...SECRETOS },
                  {
                    ambiente: "PRODUCCION",
                    situacion: "VIGENTE",
                    certificadoId: "c-1",
                    alias: "pedernal1",
                    cuitTitular: "20123456786",
                    venceEn: VENCE,
                    vencido: false,
                    autorizacion: { estado: "VERIFICADA", en: VENCE, ...SECRETOS },
                    pedidoPendiente: { ...pedido, ...SECRETOS },
                    ...SECRETOS,
                  },
                ]),
              ),
          }) as unknown as ReturnType<DependenciasDeConfiguracionFiscalWeb["consultas"]>,
        respuesta: { registrar: () => undefined },
      },
      contexto,
      { emisorId: "7b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60" },
    );
    const creadoEn = pedido.creadoEn.toISOString();
    expect(r).toEqual({
      ok: true,
      dato: [
        { ambiente: "HOMOLOGACION", situacion: "FALTA_CARGAR" },
        { ambiente: "PRODUCCION", situacion: "PEDIDO_GENERADO", ...pedido, creadoEn },
        {
          ambiente: "PRODUCCION",
          situacion: "VIGENTE",
          certificadoId: "c-1",
          alias: "pedernal1",
          cuitTitular: "20123456786",
          venceEn: VENCE.toISOString(),
          vencido: false,
          autorizacion: { estado: "VERIFICADA", en: VENCE.toISOString() },
          pedidoPendiente: { ...pedido, creadoEn },
        },
      ],
    });
    sinSecretos(r);
  });
});
