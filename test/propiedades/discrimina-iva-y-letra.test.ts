import { describe, expect, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearConsultasDeFacturacion } from "../../src/modulos/fiscal/consultas/consultas";
import type { TxDeConsultasDeFacturacion } from "../../src/modulos/fiscal/consultas/contrato";
import { letraParaFactura } from "../../src/modulos/fiscal/dominio/letra-de-comprobante";
import {
  CONDICIONES_DE_IVA,
  domicilioId,
  emisorId,
  versionId,
} from "../../src/modulos/fiscal/publico";
import { CONDICIONES_DE_IVA as CONDICIONES_DEL_RECEPTOR } from "../../src/primitivas/identificacion-fiscal/condicion-iva";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { Transacciones } from "../../src/puertos/transacciones";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../utilidades/marcas";

/**
 * La pantalla de Emitir pide alícuota por renglón según `discriminaIvaAlEmitir` (consulta, sin dominio: regla `consultas-sin-dominio`),
 * y emitir decide la letra con `letraParaFactura` (dominio). Son la misma regla escrita dos veces; esta prueba las compara para TODAS
 * las condiciones del emisor y del receptor. Previene: que alguien cambie una (por ejemplo, la letra que emite un emisor exento,
 * pregunta C7 del contador) y la pantalla siga pidiendo alícuota donde la letra C la rechaza (`ALICUOTA_EN_LETRA_C`) o no la pida
 * donde A y B la exigen (`FALTA_ALICUOTA`). Si se quita la comparación, un cambio en una sola de las dos pasa sin que nada falle.
 */

const AHORA = new Date("2026-11-03T12:00:00.000Z");
const EMPRESA = empresaId("e-1");
const EMISOR = emisorId("emisor-1");
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: EMPRESA,
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
};
const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

const discriminaSegunLaConsulta = async (
  condicionIva: (typeof CONDICIONES_DE_IVA)[number],
): Promise<boolean> => {
  const tx = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: "GERENTE" as const,
          modulosActivados: ["facturacion"],
          modulosHabilitados: ["facturacion"],
        }),
    },
    emisores: {
      delPrincipal: () =>
        Promise.resolve({ id: EMISOR, empresaId: EMPRESA, esPrincipal: true, activo: true }),
    },
    datosFiscales: {
      confirmadas: () =>
        Promise.resolve([
          {
            id: versionId("v-1"),
            numero: 1,
            condicionIva,
            domicilioFiscalId: domicilioId("d-1"),
            vigenteDesde: new Date(AHORA.getTime() - 86_400_000),
          },
        ]),
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (_opciones, trabajo) => trabajo(tx),
  };
  const r = await crearConsultasDeFacturacion({
    transacciones,
    reglas: REGLAS,
  }).discriminaIvaAlEmitir(contexto);
  if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
  return r.valor.discriminaIva;
};

describe("discriminaIvaAlEmitir coincide con la letra que emite el dominio", () => {
  it.each(CONDICIONES_DE_IVA)(
    "un emisor %s: discrimina si y solo si la letra no es C, con cualquier receptor",
    async (emisor) => {
      const discrimina = await discriminaSegunLaConsulta(emisor);
      for (const receptor of CONDICIONES_DEL_RECEPTOR) {
        expect(letraParaFactura(emisor, receptor) !== "C", `${emisor} a ${receptor}`).toBe(
          discrimina,
        );
      }
    },
  );
});
