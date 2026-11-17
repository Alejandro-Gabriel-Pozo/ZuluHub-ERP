import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import {
  ALICUOTAS_DEL_PRODUCTO,
  CODIGOS_DE_ALICUOTA,
} from "../../src/modulos/fiscal/dominio/alicuota";
import {
  ESTADOS_DE_CUENTA,
  ESTADOS_DE_LINEA,
  ESTADOS_DE_TICKET,
} from "../../src/modulos/ventas/dominio/estados";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeLista } from "./paridad-apoyo";

/**
 * P3c-a de la comprobación primitivas ↔ base: las alícuotas de IVA y los estados de venta. Una alícuota que el dominio emite y la base rechaza (o al revés) se descubre al facturar; un estado que
 * una lista admite y la otra no, al cerrar una cuenta. Cada lista del dominio se compara con su copia en un CHECK de la base real (tras todas las migraciones) con `paridadDeLista`; los valores
 * salen del dominio, no de literales de la prueba. Queda fuera `tributo_alicuota_ck` (porcentaje de 0 a 100): el dominio no tiene una constante para ese rango.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("paridad dominio ↔ base: alícuotas y estados de venta", () => {
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

  it("toda columna de alícuota admite exactamente los códigos de alícuota del dominio", async () => {
    // Una llamada por restricción, con el nombre como literal: así el escáner (C2) la ve como comparada.
    await paridadDeLista(c, "linea_cuenta", "linea_alicuota_ck", CODIGOS_DE_ALICUOTA);
    // El producto ofrece y guarda solo las seis de ARCA (0075), sin «EXENTO» ni «NO_GRAVADO»; las demás columnas guardan las ocho.
    await paridadDeLista(c, "producto", "producto_alicuota_ck", ALICUOTAS_DEL_PRODUCTO);
    await paridadDeLista(
      c,
      "importe_por_alicuota",
      "importe_por_alicuota_alicuota_ck",
      CODIGOS_DE_ALICUOTA,
    );
    await paridadDeLista(
      c,
      "linea_de_comprobante",
      "linea_de_comprobante_alicuota_ck",
      CODIGOS_DE_ALICUOTA,
    );
    await paridadDeLista(
      c,
      "comprobante_linea",
      "comprobante_linea_alicuota_ck",
      CODIGOS_DE_ALICUOTA,
    );
  });

  it("los estados de la cuenta, de la línea y del ticket son los del dominio", async () => {
    await paridadDeLista(c, "cuenta_consumo", "cuenta_estado_ck", ESTADOS_DE_CUENTA);
    await paridadDeLista(c, "linea_cuenta", "linea_estado_ck", ESTADOS_DE_LINEA);
    await paridadDeLista(c, "ticket", "ticket_estado_ck", ESTADOS_DE_TICKET);
  });
});
