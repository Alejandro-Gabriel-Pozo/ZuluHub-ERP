import pg from "pg";
import { afterAll, beforeAll, describe, inject, it, vi } from "vitest";
import {
  ESTADOS_DE_EMPRESA,
  ESTADOS_DE_TENANT,
} from "../../src/adaptadores/postgres/soporte-de-plataforma-comunes";
import {
  CLASES_DE_MOVIMIENTO,
  ESTADOS_DE_CONTEO,
  ESTADOS_DE_SESION,
  TIPOS_DE_CUENTA,
  TIPOS_DE_MEDIO,
} from "../../src/modulos/caja/estados";
import { ALCANCES_DE_PRECIO } from "../../src/modulos/catalogo/dominio/alcance-de-precio";
import { CLASES_DE_USO } from "../../src/modulos/catalogo/dominio/clases";
import { SEVERIDADES } from "../../src/modulos/cierre/aporte-al-cierre";
import { ESTADOS_DE_JORNADA } from "../../src/modulos/cierre/estados";
import {
  ROLES_DE_RENGLON,
  SALIDAS_DE_LINEA,
  TIPOS_DE_ENVIO,
} from "../../src/modulos/comandas/dominio/envio";
import {
  ESTADOS_DE_TRABAJO,
  RESULTADOS_DE_INTENTO,
  TIPOS_DE_DOCUMENTO as TIPOS_DE_DOCUMENTO_DE_IMPRESION,
  USOS_DE_IMPRESORA,
} from "../../src/modulos/comandas/dominio/impresion";
import { ESTADOS_DE_COMPROBANTE_ARCA } from "../../src/modulos/fiscal/dominio/estados-de-comprobante";
import {
  DESENLACES_DE_INTENTO,
  OPERACIONES_DE_INTENTO,
} from "../../src/modulos/fiscal/persistencia/repositorio-de-intentos";
import { ESTADOS_DE_CERTIFICADO } from "../../src/modulos/fiscal/persistencia/tipos-de-certificados";
import { LISTAS_DEL_SISTEMA } from "../../src/modulos/listas/dominio/valor-de-lista";
import { ESTADOS_DE_ORDEN } from "../../src/modulos/produccion/dominio/orden";
import { FORMAS_DE_MESA, TAMANOS_DE_MESA } from "../../src/modulos/salon/dominio/mesa";
import { CALIDADES_DE_LOTE } from "../../src/modulos/stock/dominio/calidad";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import { paridadDeLista } from "./paridad-apoyo";

/**
 * P5a de la comprobación primitivas ↔ base: LISTAS CERRADAS de estados, tipos y clases que el dominio ya declara como constante. Cada lista se compara con su copia en un CHECK de la base real (tras todas las
 * migraciones) con `paridadDeLista`: una llamada por restricción y los valores salen del dominio, no de la prueba. Previene que un estado o un tipo nuevo se sume en el código y la base lo rechace (o al revés)
 * recién con un dato real. Quedan en deuda las listas sin constante en el dominio y los CHECK compuestos (estado + otras columnas), que no son una lista pura.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("paridad dominio ↔ base: listas cerradas", () => {
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

  it("caja y stock de lotes: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "calidad_de_lote", "calidad_de_lote_estado_ck", CALIDADES_DE_LOTE);
    await paridadDeLista(
      c,
      "conciliacion_de_jornada",
      "conciliacion_de_jornada_estado_ck",
      ESTADOS_DE_CONTEO,
    );
    await paridadDeLista(c, "cuenta_de_cobro", "cuenta_de_cobro_tipo_ck", TIPOS_DE_CUENTA);
    await paridadDeLista(c, "medio_de_pago", "medio_de_pago_tipo_ck", TIPOS_DE_MEDIO);
    await paridadDeLista(c, "movimiento_caja", "movimiento_caja_clase_ck", CLASES_DE_MOVIMIENTO);
    await paridadDeLista(c, "sesion_caja", "sesion_caja_estado_ck", ESTADOS_DE_SESION);
  });

  it("calidad de lote: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "lote", "lote_calidad_ck", CALIDADES_DE_LOTE);
  });

  it("fiscal (certificado, comprobante, intentos): cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "certificado_arca", "certificado_estado_ck", ESTADOS_DE_CERTIFICADO);
    await paridadDeLista(c, "comprobante", "comprobante_estado_ck", ESTADOS_DE_COMPROBANTE_ARCA);
    await paridadDeLista(c, "intento_arca", "intento_desenlace_ck", DESENLACES_DE_INTENTO);
    await paridadDeLista(c, "intento_arca", "intento_operacion_ck", OPERACIONES_DE_INTENTO);
  });

  it("cierre de jornada: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "control_de_jornada_cerrada", "control_severidad_ck", SEVERIDADES);
    await paridadDeLista(c, "jornada_de_sucursal", "jornada_estado_ck", ESTADOS_DE_JORNADA);
  });

  it("plataforma (empresa y tenant): cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "empresa", "empresa_estado_ck", ESTADOS_DE_EMPRESA);
    await paridadDeLista(c, "tenant", "tenant_estado_ck", ESTADOS_DE_TENANT);
  });

  it("comandas e impresión: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "envio_de_comanda", "envio_tipo_ck", TIPOS_DE_ENVIO);
    await paridadDeLista(c, "linea_de_comanda", "linea_de_comanda_salida_ck", SALIDAS_DE_LINEA);
    await paridadDeLista(c, "renglon_de_envio", "renglon_rol_ck", ROLES_DE_RENGLON);
    await paridadDeLista(c, "impresora", "impresora_uso_ck", USOS_DE_IMPRESORA);
    await paridadDeLista(c, "intento_de_impresion", "intento_resultado_ck", RESULTADOS_DE_INTENTO);
    await paridadDeLista(c, "trabajo_de_impresion", "trabajo_imp_estado_ck", ESTADOS_DE_TRABAJO);
    await paridadDeLista(
      c,
      "trabajo_de_impresion",
      "trabajo_imp_tipo_ck",
      TIPOS_DE_DOCUMENTO_DE_IMPRESION,
    );
  });

  it("catálogo y listas: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "linea_cuenta_opcion", "linea_opcion_origen_ck", ALCANCES_DE_PRECIO);
    await paridadDeLista(c, "producto", "producto_clase_de_uso_ck", CLASES_DE_USO);
    await paridadDeLista(c, "valor_de_lista", "valor_de_lista_lista_ck", LISTAS_DEL_SISTEMA);
  });

  it("salón: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "mesa", "mesa_forma_ck", FORMAS_DE_MESA);
    await paridadDeLista(c, "mesa", "mesa_tamano_ck", TAMANOS_DE_MESA);
  });

  it("producción: cada lista del dominio es exactamente la del CHECK", async () => {
    await paridadDeLista(c, "orden_de_produccion", "orden_estado_ck", ESTADOS_DE_ORDEN);
  });
});
