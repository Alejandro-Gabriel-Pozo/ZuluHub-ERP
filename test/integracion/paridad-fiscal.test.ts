import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import { TIPOS_DE_DOCUMENTO_DE_PARTE } from "../../src/modulos/clientes/dominio/documento";
import { CODIGO_DE_TIPO_DE_DOCUMENTO } from "../../src/modulos/fiscal/dominio/codigos-de-arca";
import { MODOS_DE_PRECIO } from "../../src/modulos/fiscal/dominio/calculo-de-renglones";
import {
  TIPOS_DE_ORIGEN,
  TIPOS_DE_COMPROBANTE,
} from "../../src/modulos/fiscal/dominio/comprobante-emitido";
import { AMBIENTES, CONCEPTOS } from "../../src/modulos/fiscal/dominio/comprobante-nuevo";
import { CONDICIONES_DE_IIBB } from "../../src/modulos/fiscal/dominio/datos-fiscales";
import { CONDICIONES_DE_IVA as CONDICIONES_DE_IVA_DEL_EMISOR } from "../../src/modulos/fiscal/dominio/emisor";
import { CONDICIONES_DE_IVA as CONDICIONES_DE_IVA_DEL_RECEPTOR } from "../../src/primitivas/identificacion-fiscal/condicion-iva";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeLista } from "./paridad-apoyo";

/**
 * P3c-b de la comprobación primitivas ↔ base: lo FISCAL. Un ambiente, un concepto, una condición frente al IVA o al IIBB, un tipo de comprobante o de documento que el dominio acepta y la base
 * rechaza (o al revés) se descubre al emitir, con ARCA de por medio. Cada lista del dominio se compara con su copia en un CHECK de la base real (tras todas las migraciones) con
 * `paridadDeLista`; los valores salen del dominio, no de literales de la prueba. Una llamada por restricción, con el nombre como literal: así el escáner (C2) la ve como comparada.
 * Fuera: `tributo_tipo_ck` (el dominio no tiene una constante para ese catálogo).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("paridad dominio ↔ base: fiscal", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let c: pg.Client;
  beforeAll(async () => {
    aparte = await crearBaseAparte(base as BaseDePruebas);
    c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
    await aparte.destruir();
  });

  it("los ambientes de ARCA son los del dominio en toda tabla que los guarda", async () => {
    await paridadDeLista(c, "certificado_arca", "certificado_ambiente_ck", AMBIENTES);
    await paridadDeLista(c, "comprobante", "comprobante_ambiente_ck", AMBIENTES);
    await paridadDeLista(c, "punto_de_venta", "punto_de_venta_ambiente_ck", AMBIENTES);
    await paridadDeLista(c, "serie_comprobante", "serie_ambiente_ck", AMBIENTES);
  });

  it("el concepto y el modo de precio de un comprobante son los del dominio", async () => {
    await paridadDeLista(c, "comprobante", "comprobante_concepto_ck", CONCEPTOS);
    await paridadDeLista(c, "comprobante", "comprobante_modo_ck", MODOS_DE_PRECIO);
  });

  it("las condiciones frente al IVA: las del emisor (3) y las del receptor (11) son las del dominio", async () => {
    await paridadDeLista(
      c,
      "comprobante",
      "comprobante_emisor_condicion_ck",
      CONDICIONES_DE_IVA_DEL_EMISOR,
    );
    await paridadDeLista(
      c,
      "datos_fiscales",
      "datos_fiscales_condicion_iva_ck",
      CONDICIONES_DE_IVA_DEL_EMISOR,
    );
    await paridadDeLista(
      c,
      "comprobante",
      "comprobante_receptor_condicion_ck",
      CONDICIONES_DE_IVA_DEL_RECEPTOR,
    );
    await paridadDeLista(c, "parte", "parte_condicion_iva_ck", CONDICIONES_DE_IVA_DEL_RECEPTOR);
  });

  it("la condición frente a Ingresos Brutos es la del dominio", async () => {
    await paridadDeLista(
      c,
      "comprobante",
      "comprobante_emisor_iibb_condicion_ck",
      CONDICIONES_DE_IIBB,
    );
    await paridadDeLista(
      c,
      "datos_fiscales",
      "datos_fiscales_iibb_condicion_ck",
      CONDICIONES_DE_IIBB,
    );
  });

  it("los tipos de comprobante y de origen son los del dominio", async () => {
    await paridadDeLista(c, "comprobante", "comprobante_tipo_ck", TIPOS_DE_COMPROBANTE);
    await paridadDeLista(c, "serie_comprobante", "serie_tipo_ck", TIPOS_DE_COMPROBANTE);
    await paridadDeLista(
      c,
      "comprobante_de_la_ficha",
      "comprobante_de_la_ficha_tipo_ck",
      TIPOS_DE_COMPROBANTE,
    );
    await paridadDeLista(c, "comprobante_de_proveedor", "cp_tipo_ck", TIPOS_DE_COMPROBANTE);
    await paridadDeLista(c, "comprobante", "comprobante_origen_tipo_ck", TIPOS_DE_ORIGEN);
  });

  it("los tipos de documento: el del receptor (con SIN_IDENTIFICAR) y el de una parte son los del dominio", async () => {
    await paridadDeLista(
      c,
      "comprobante",
      "comprobante_receptor_doc_tipo_ck",
      Object.keys(CODIGO_DE_TIPO_DE_DOCUMENTO),
    );
    await paridadDeLista(c, "parte", "parte_documento_tipo_ck", TIPOS_DE_DOCUMENTO_DE_PARTE);
  });
});
