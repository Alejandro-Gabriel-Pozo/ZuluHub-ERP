import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitAlAzar } from "./entorno";
import {
  acepta,
  check,
  clave,
  conAppDe,
  crearMundo,
  crearPuntoDeVenta,
  denegado,
  referencia,
  sinConfirmar,
} from "./fiscal-apoyo";
import {
  confirmarDueno,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  datosDeLetraC,
  marcarAutorizado,
  entrarEnValidacion,
  insertarComprobante,
  RENGLON_DE_100_SIN_ALICUOTA,
  RENGLON_DE_121,
  viaDueno,
  viaSesion,
  type Contenido,
  type Desglose,
  type Escenario,
  type Renglon,
} from "./facturacion-apoyo";

/**
 * Facturación F2, migración 0009 contra una base real. Qué prueba, en cinco bloques:
 *  1. Catálogo: lo que la base DECLARA de las seis tablas nuevas (columnas, restricciones, índices,
 *     disparadores, políticas, funciones y privilegios exactos). Los privilegios por columna de la
 *     aplicación están en `catalogo.test.ts`.
 *  2. Alta del comprobante: cada CHECK, cada clave foránea compuesta y los disparadores de alta (foto
 *     del emisor, punto de venta, nota asociada).
 *  3. El comprobante cuadra: renglones y desglose suman lo informado (restricción diferida).
 *  4. Identidad e idempotencia: un origen no da dos comprobantes vigentes.
 *  5. Renglones y desglose: sus CHECK y su inserción tardía.
 * La máquina de estados, la coherencia con la serie y el ambiente están en `facturacion-estados.test.ts`;
 * los certificados, el ticket de acceso y los intentos en `facturacion-acceso.test.ts`; el aislamiento en
 * `facturacion-aislamiento.test.ts`; la concurrencia en `facturacion-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const TABLAS = [
  "comprobante",
  "comprobante_linea",
  "comprobante_alicuota",
  "certificado_arca",
  "acceso_arca",
  "intento_arca",
] as const;
const SEARCH_PATH_FIJO = "search_path=pg_catalog, public, pg_temp";

/** Las funciones que agrega 0009 (la de la serie la reemplaza; el resto son nuevas). */
const FUNCIONES_NUEVAS = [
  "certificado_arca_validar_alta",
  "certificado_arca_validar_cambio",
  "comprobante_hijo_validar_alta",
  "comprobante_serie_con_reserva",
  "comprobante_validar_alta",
  "comprobante_validar_cambio",
  "comprobante_verificar_cuadre",
  "comprobante_verificar_serie",
  "punto_de_venta_validar_ambiente",
  "serie_comprobante_validar_alta",
  "texto_fiscal_valido",
] as const;

describe.skipIf(base === null)("facturación: la migración 0009 contra una base real", () => {
  let dueno: pg.Client;
  let e: Escenario;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    e = await crearEscenario(dueno);
  });
  afterAll(async () => {
    await dueno.end();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const intento = viaDueno;
  const deshacible = <T>(trabajo: () => Promise<T>) => sinConfirmar(dueno, trabajo);

  // ===============================================================================================
  // 1. Catálogo
  // ===============================================================================================
  describe("catálogo", () => {
    const columnasDe = async (tabla: string) =>
      (
        await consultar<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabla],
        )
      ).map((c) => c.column_name);

    it("las tablas existen con exactamente estas columnas, en este orden", async () => {
      expect(await columnasDe("comprobante")).toEqual([
        "id",
        "empresa_id",
        "emisor_id",
        "punto_de_venta_id",
        "ambiente",
        "origen_tipo",
        "origen_id",
        "clase",
        "tipo_comprobante",
        "concepto",
        "servicio_desde",
        "servicio_hasta",
        "vencimiento_pago",
        "moneda",
        "modo_de_precio",
        "total",
        "neto_gravado",
        "iva",
        "exento",
        "no_gravado",
        "datos_fiscales_id",
        "emisor_cuit",
        "emisor_razon_social",
        "emisor_condicion_iva",
        "emisor_domicilio_fiscal",
        "emisor_inicio_actividades",
        "emisor_iibb_numero",
        "emisor_iibb_condicion",
        "punto_de_venta_numero",
        "punto_de_venta_domicilio",
        "receptor_parte_id",
        "receptor_nombre",
        "receptor_documento_tipo",
        "receptor_documento_numero",
        "receptor_condicion_iva",
        "receptor_domicilio",
        "comprobante_asociado_id",
        "motivo",
        "estado",
        "envios",
        "numero_reservado",
        "fecha_emision",
        "numero",
        "cae",
        "cae_vence",
        "autorizado_en",
        "resuelto_por",
        "motivo_descarte",
        "huella",
        "version_de_representacion",
        "creado_por",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("comprobante_linea")).toEqual([
        "empresa_id",
        "comprobante_id",
        "posicion",
        "descripcion",
        "cantidad",
        "precio_unitario",
        "descuento",
        "alicuota",
        "importe",
      ]);
      expect(await columnasDe("comprobante_alicuota")).toEqual([
        "empresa_id",
        "comprobante_id",
        "alicuota",
        "total",
        "neto",
        "iva",
      ]);
      expect(await columnasDe("certificado_arca")).toEqual([
        "id",
        "empresa_id",
        "emisor_id",
        "ambiente",
        "alias",
        "cuit_titular",
        "estado",
        "pedido_pem",
        "certificado_pem",
        "huella_sha256",
        "vence_en",
        "autorizacion_verificada_en",
        "clave_cifrada",
        "clave_nonce",
        "clave_etiqueta",
        "clave_kid",
        "creado_por",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("acceso_arca")).toEqual([
        "empresa_id",
        "certificado_id",
        "servicio",
        "credencial_cifrada",
        "credencial_nonce",
        "credencial_etiqueta",
        "credencial_kid",
        "generado_en",
        "expira_en",
        "renovando_hasta",
        "creado_en",
        "actualizado_en",
        "version",
      ]);
      expect(await columnasDe("intento_arca")).toEqual([
        "id",
        "empresa_id",
        "comprobante_id",
        "operacion",
        "numero",
        "desenlace",
        "mensajes",
        "respuesta",
        "huella_pedido",
        "iniciado_en",
        "duracion_ms",
      ]);
    });

    it("el dinero es numeric exacto con la escala del dominio (nunca flotante) y la moneda es explícita", async () => {
      const tipos = await consultar<{ t: string; c: string; tipo: string; escala: number | null }>(
        `select table_name as t, column_name as c, data_type as tipo, numeric_scale as escala
           from information_schema.columns
          where table_schema = 'public' and table_name = any ($1)
            and (data_type in ('numeric', 'real', 'double precision', 'money') or column_name = 'moneda')
          order by 1, 2`,
        [[...TABLAS]],
      );
      expect(tipos.map((f) => `${f.t}.${f.c}:${f.tipo}:${f.escala ?? "-"}`)).toEqual([
        "comprobante.exento:numeric:2",
        "comprobante.iva:numeric:2",
        "comprobante.moneda:character:-",
        "comprobante.neto_gravado:numeric:2",
        "comprobante.no_gravado:numeric:2",
        "comprobante.total:numeric:2",
        "comprobante_alicuota.iva:numeric:2",
        "comprobante_alicuota.neto:numeric:2",
        "comprobante_alicuota.total:numeric:2",
        "comprobante_linea.cantidad:numeric:4",
        "comprobante_linea.descuento:numeric:4",
        "comprobante_linea.importe:numeric:2",
        "comprobante_linea.precio_unitario:numeric:6",
      ]);
      // La moneda no tiene valor por defecto: se dice siempre.
      const [moneda] = await consultar<{ d: string | null; nulo: string }>(
        `select column_default as d, is_nullable as nulo from information_schema.columns
          where table_schema = 'public' and table_name = 'comprobante' and column_name = 'moneda'`,
      );
      expect(moneda).toEqual({ d: null, nulo: "NO" });
    });

    it("las restricciones de cada tabla son exactamente estas", async () => {
      const restricciones = await consultar<{ t: string; c: string }>(
        // Postgres 18 registra cada NOT NULL como restricción propia (contype 'n'); Postgres 16 no.
        `select conrelid::regclass::text as t, conname || ':' || contype::text as c from pg_constraint
          where conrelid = any ($1::text[]::regclass[]) and contype <> 'n' order by 1, 2`,
        [[...TABLAS]],
      );
      const de = (tabla: string) => restricciones.filter((r) => r.t === tabla).map((r) => r.c);
      expect(de("comprobante")).toEqual([
        "comprobante_ambiente_ck:c",
        "comprobante_asociado_ck:c",
        "comprobante_asociado_fkey:f",
        "comprobante_autorizado_ck:c",
        "comprobante_c_sin_iva_ck:c",
        "comprobante_cae_vence_ck:c",
        "comprobante_clase_ck:c",
        "comprobante_clase_tipo_ck:c",
        "comprobante_coherente_con_serie:t",
        "comprobante_concepto_ck:c",
        "comprobante_creado_por_fkey:f",
        "comprobante_cuadra:t",
        "comprobante_datos_fiscales_fkey:f",
        "comprobante_descarte_ck:c",
        "comprobante_emisor_condicion_ck:c",
        "comprobante_emisor_cuit_ck:c",
        "comprobante_emisor_domicilio_ck:c",
        "comprobante_emisor_fkey:f",
        "comprobante_emisor_iibb_condicion_ck:c",
        "comprobante_emisor_iibb_numero_ck:c",
        "comprobante_emisor_inicio_ck:c",
        "comprobante_emisor_razon_social_ck:c",
        "comprobante_empresa_id_fkey:f",
        "comprobante_envios_ck:c",
        "comprobante_estado_ck:c",
        "comprobante_huella_ck:c",
        "comprobante_id_empresa_emisor_uk:u",
        "comprobante_id_empresa_uk:u",
        "comprobante_importes_ck:c",
        "comprobante_modo_c_ck:c",
        "comprobante_modo_ck:c",
        "comprobante_moneda_ck:c",
        "comprobante_motivo_ck:c",
        "comprobante_origen_id_ck:c",
        "comprobante_origen_tipo_ck:c",
        "comprobante_pkey:p",
        "comprobante_pv_domicilio_ck:c",
        "comprobante_pv_fkey:f",
        "comprobante_pv_numero_ck:c",
        "comprobante_receptor_ck:c",
        "comprobante_receptor_condicion_ck:c",
        "comprobante_receptor_doc_tipo_ck:c",
        "comprobante_receptor_documento_ck:c",
        "comprobante_receptor_domicilio_ck:c",
        "comprobante_receptor_nombre_ck:c",
        "comprobante_representacion_ck:c",
        "comprobante_reserva_ck:c",
        "comprobante_servicio_ck:c",
        "comprobante_tipo_ck:c",
      ]);
      expect(de("comprobante_linea")).toEqual([
        "comprobante_linea_alicuota_ck:c",
        "comprobante_linea_cantidad_ck:c",
        "comprobante_linea_comprobante_fkey:f",
        "comprobante_linea_descripcion_ck:c",
        "comprobante_linea_descuento_ck:c",
        "comprobante_linea_empresa_id_fkey:f",
        "comprobante_linea_importe_ck:c",
        "comprobante_linea_pkey:p",
        "comprobante_linea_posicion_ck:c",
        "comprobante_linea_precio_ck:c",
      ]);
      expect(de("comprobante_alicuota")).toEqual([
        "comprobante_alicuota_ck:c",
        "comprobante_alicuota_codigo_ck:c",
        "comprobante_alicuota_comprobante_fkey:f",
        "comprobante_alicuota_empresa_id_fkey:f",
        "comprobante_alicuota_pkey:p",
      ]);
      expect(de("certificado_arca")).toEqual([
        "certificado_alias_ck:c",
        "certificado_ambiente_ck:c",
        "certificado_arca_creado_por_fkey:f",
        "certificado_arca_empresa_id_fkey:f",
        "certificado_arca_pkey:p",
        "certificado_cargado_ck:c",
        "certificado_cifrado_ck:c",
        "certificado_clave_ck:c",
        "certificado_cuit_titular_ck:c",
        "certificado_emisor_fkey:f",
        "certificado_estado_ck:c",
        "certificado_huella_ck:c",
        "certificado_id_empresa_uk:u",
        "certificado_kid_ck:c",
        "certificado_pedido_ck:c",
        "certificado_pem_ck:c",
      ]);
      expect(de("acceso_arca")).toEqual([
        "acceso_arca_empresa_id_fkey:f",
        "acceso_certificado_fkey:f",
        "acceso_completo_ck:c",
        "acceso_pkey:p",
        "acceso_servicio_ck:c",
      ]);
      expect(de("intento_arca")).toEqual([
        "intento_arca_empresa_id_fkey:f",
        "intento_arca_pkey:p",
        "intento_comprobante_fkey:f",
        "intento_desenlace_ck:c",
        "intento_duracion_ck:c",
        "intento_huella_ck:c",
        "intento_mensajes_ck:c",
        "intento_numero_ck:c",
        "intento_operacion_ck:c",
        "intento_operacion_desenlace_ck:c",
        "intento_respuesta_ck:c",
      ]);
    });

    it("las claves foráneas compuestas atan cada hijo a la misma empresa (y el comprobante, a su emisor, su punto de venta y sus datos fiscales)", async () => {
      const fk = await consultar<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where contype = 'f' and conrelid = any ($1::text[]::regclass[]) and conname !~ '_empresa_id_fkey$'
            and conname !~ '_por_fkey$'
          order by 1`,
        [[...TABLAS]],
      );
      expect(Object.fromEntries(fk.map((f) => [f.conname, f.def]))).toEqual({
        acceso_certificado_fkey:
          "FOREIGN KEY (certificado_id, empresa_id) REFERENCES certificado_arca(id, empresa_id)",
        certificado_emisor_fkey:
          "FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor(id, empresa_id)",
        comprobante_alicuota_comprobante_fkey:
          "FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante(id, empresa_id)",
        comprobante_asociado_fkey:
          "FOREIGN KEY (comprobante_asociado_id, empresa_id, emisor_id) REFERENCES comprobante(id, empresa_id, emisor_id)",
        comprobante_datos_fiscales_fkey:
          "FOREIGN KEY (datos_fiscales_id, empresa_id, emisor_id) REFERENCES datos_fiscales(id, empresa_id, emisor_id)",
        comprobante_emisor_fkey:
          "FOREIGN KEY (emisor_id, empresa_id) REFERENCES emisor(id, empresa_id)",
        comprobante_linea_comprobante_fkey:
          "FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante(id, empresa_id)",
        comprobante_pv_fkey:
          "FOREIGN KEY (punto_de_venta_id, emisor_id, empresa_id) REFERENCES punto_de_venta(id, emisor_id, empresa_id)",
        intento_comprobante_fkey:
          "FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante(id, empresa_id)",
      });
    });

    it("los índices son exactamente estos, y todos los únicos incluyen empresa_id", async () => {
      const indices = await consultar<{ t: string; i: string; def: string }>(
        `select tablename as t, indexname as i, indexdef as def from pg_indexes
          where schemaname = 'public' and tablename = any ($1) order by 1, 2`,
        [[...TABLAS]],
      );
      expect(indices.map((i) => `${i.t}.${i.i}`)).toEqual([
        "acceso_arca.acceso_pkey",
        "certificado_arca.certificado_arca_pkey",
        "certificado_arca.certificado_huella_uk",
        "certificado_arca.certificado_id_empresa_uk",
        "certificado_arca.certificado_vigente_uk",
        "comprobante.comprobante_asociado_ix",
        "comprobante.comprobante_en_vuelo_uk",
        "comprobante.comprobante_id_empresa_emisor_uk",
        "comprobante.comprobante_id_empresa_uk",
        "comprobante.comprobante_identidad_uk",
        "comprobante.comprobante_listado_ix",
        "comprobante.comprobante_manual_uk",
        "comprobante.comprobante_numero_uk",
        "comprobante.comprobante_origen_ix",
        "comprobante.comprobante_pkey",
        "comprobante_alicuota.comprobante_alicuota_pkey",
        "comprobante_linea.comprobante_linea_pkey",
        "intento_arca.intento_arca_pkey",
        "intento_arca.intento_comprobante_ix",
      ]);
      const def = (nombre: string) => indices.find((i) => i.i === nombre)?.def ?? "";
      expect(def("comprobante_identidad_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, origen_tipo, origen_id, emisor_id, clase\) WHERE \(estado <> ALL \(ARRAY\['RECHAZADO'::text, 'DESCARTADO'::text\]\)\)/,
      );
      expect(def("comprobante_manual_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, origen_id\) WHERE \(origen_tipo = 'MANUAL'::text\)/,
      );
      expect(def("comprobante_numero_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, punto_de_venta_id, tipo_comprobante, ambiente, numero\) WHERE \(numero IS NOT NULL\)/,
      );
      expect(def("comprobante_en_vuelo_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, punto_de_venta_id, tipo_comprobante, ambiente\) WHERE \(estado = ANY \(ARRAY\['EN_VALIDACION'::text, 'INCIERTO'::text\]\)\)/,
      );
      expect(def("certificado_vigente_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, emisor_id, ambiente\) WHERE \(estado = 'VIGENTE'::text\)/,
      );
      expect(def("certificado_huella_uk")).toMatch(
        /UNIQUE INDEX .*\(empresa_id, huella_sha256\) WHERE \(huella_sha256 IS NOT NULL\)/,
      );
    });

    it("los disparadores son exactamente estos", async () => {
      const disparadores = await consultar<{ n: string; def: string }>(
        `select c.relname || '.' || t.tgname as n, pg_get_triggerdef(t.oid) as def
           from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and c.relname = any ($1) order by 1`,
        [[...TABLAS]],
      );
      expect(disparadores.map((d) => d.n)).toEqual([
        "acceso_arca.acceso_arca_sin_borrado",
        "acceso_arca.acceso_arca_sin_truncate",
        "acceso_arca.acceso_arca_version",
        "certificado_arca.certificado_arca_alta",
        "certificado_arca.certificado_arca_cambio",
        "certificado_arca.certificado_arca_sin_borrado",
        "certificado_arca.certificado_arca_sin_truncate",
        "certificado_arca.certificado_arca_version",
        "comprobante.comprobante_alta",
        "comprobante.comprobante_cambio",
        "comprobante.comprobante_coherente_con_serie",
        "comprobante.comprobante_cuadra",
        "comprobante.comprobante_sin_borrado",
        "comprobante.comprobante_sin_truncate",
        "comprobante.comprobante_version",
        "comprobante_alicuota.comprobante_alicuota_alta",
        "comprobante_alicuota.comprobante_alicuota_sin_truncate",
        "comprobante_alicuota.comprobante_alicuota_solo_insercion",
        "comprobante_linea.comprobante_linea_alta",
        "comprobante_linea.comprobante_linea_sin_truncate",
        "comprobante_linea.comprobante_linea_solo_insercion",
        "intento_arca.intento_arca_sin_truncate",
        "intento_arca.intento_arca_solo_insercion",
      ]);
      const def = (n: string) => disparadores.find((d) => d.n === n)?.def ?? "";
      // Las dos restricciones de coherencia y de cuadre son diferidas: se evalúan al confirmar.
      for (const n of [
        "comprobante.comprobante_coherente_con_serie",
        "comprobante.comprobante_cuadra",
      ]) {
        expect(def(n), n).toMatch(
          /CONSTRAINT TRIGGER .*DEFERRABLE INITIALLY DEFERRED FOR EACH ROW/,
        );
      }
      expect(def("comprobante.comprobante_coherente_con_serie")).toMatch(
        /AFTER INSERT OR UPDATE ON/,
      );
      expect(def("comprobante.comprobante_cuadra")).toMatch(/AFTER INSERT ON/);
      // La otra mitad de la coherencia vive sobre la serie y solo mira cuando se suelta una reserva.
      const [serie] = await consultar<{ def: string }>(
        `select pg_get_triggerdef(oid) as def from pg_trigger
          where tgname = 'serie_comprobante_con_reserva' and not tgisinternal`,
      );
      expect(serie?.def).toMatch(
        /CONSTRAINT TRIGGER .*AFTER UPDATE ON .*serie_comprobante DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN \(\(old\.estado = 'EN_CURSO'::text\)\)/i,
      );
      // `_cambio` valida con OLD/NEW antes de que `_version` los toque: Postgres los dispara por orden alfabético.
      for (const t of ["comprobante", "certificado_arca"]) {
        const nombres = disparadores
          .filter((d) => d.n.startsWith(`${t}.`) && d.def.includes("BEFORE UPDATE"))
          .map((d) => d.n);
        expect(nombres, t).toEqual([`${t}.${t}_cambio`, `${t}.${t}_version`]);
      }
      for (const n of [
        "comprobante.comprobante_sin_borrado",
        "certificado_arca.certificado_arca_sin_borrado",
        "acceso_arca.acceso_arca_sin_borrado",
      ]) {
        expect(def(n), n).toMatch(/BEFORE DELETE ON .* FOR EACH ROW/);
      }
      for (const n of [
        "comprobante.comprobante_sin_truncate",
        "comprobante_linea.comprobante_linea_sin_truncate",
        "comprobante_alicuota.comprobante_alicuota_sin_truncate",
        "intento_arca.intento_arca_sin_truncate",
        "certificado_arca.certificado_arca_sin_truncate",
        "acceso_arca.acceso_arca_sin_truncate",
      ]) {
        expect(def(n), n).toMatch(/BEFORE TRUNCATE ON .* FOR EACH STATEMENT/);
      }
    });

    it("las políticas son exactamente estas: una por comando, solo para la aplicación, ninguna restrictiva ni FOR ALL", async () => {
      const politicas = await consultar<{ p: string }>(
        `select format('%s.%s:%s:%s:%s', tablename, policyname, cmd, permissive, array_to_string(roles, '+')) as p
           from pg_policies where schemaname = 'public' and tablename = any ($1) order by 1`,
        [[...TABLAS]],
      );
      expect(politicas.map((f) => f.p)).toEqual(
        [
          "acceso_arca.acceso_arca_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "acceso_arca.acceso_arca_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "acceso_arca.acceso_arca_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "certificado_arca.certificado_arca_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "certificado_arca.certificado_arca_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "certificado_arca.certificado_arca_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "comprobante.comprobante_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "comprobante.comprobante_app_cambiar:UPDATE:PERMISSIVE:zuluhub_app",
          "comprobante.comprobante_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "comprobante_alicuota.comprobante_alicuota_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "comprobante_alicuota.comprobante_alicuota_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "comprobante_linea.comprobante_linea_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "comprobante_linea.comprobante_linea_app_leer:SELECT:PERMISSIVE:zuluhub_app",
          "intento_arca.intento_arca_app_alta:INSERT:PERMISSIVE:zuluhub_app",
          "intento_arca.intento_arca_app_leer:SELECT:PERMISSIVE:zuluhub_app",
        ].sort(),
      );
      // Toda política de alta o cambio exige empresa_operable y la empresa del contexto.
      const escritura = await consultar<{
        tablename: string;
        policyname: string;
        qual: string | null;
        with_check: string | null;
      }>(
        `select tablename, policyname, qual, with_check from pg_policies
          where schemaname = 'public' and tablename = any ($1) and cmd in ('INSERT', 'UPDATE')`,
        [[...TABLAS]],
      );
      expect(escritura).toHaveLength(9);
      for (const p of escritura) {
        const texto = `${p.qual ?? ""} ${p.with_check ?? ""}`;
        expect(texto, p.policyname).toContain("empresa_operable(empresa_id)");
        expect(texto, p.policyname).toContain("app_empresa_id()");
      }
      // Los que registran un autor lo atan a la persona del contexto.
      for (const nombre of ["comprobante_app_alta", "certificado_arca_app_alta"]) {
        const p = escritura.find((f) => f.policyname === nombre);
        expect(p?.with_check, nombre).toMatch(/NOT \(creado_por IS DISTINCT FROM/);
      }
    });

    it("las funciones nuevas fijan su search_path, no son SECURITY DEFINER y no son ejecutables por PUBLIC; solo la validación de textos se otorga, a la aplicación", async () => {
      const funciones = await consultar<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
        publico: boolean;
        app: boolean;
        plataforma: boolean;
      }>(
        `select p.proname, p.prosecdef, p.proconfig,
                coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
                            from aclexplode(p.proacl) a), false) or p.proacl is null as publico,
                has_function_privilege('zuluhub_app', p.oid, 'EXECUTE') as app,
                has_function_privilege('zuluhub_plataforma', p.oid, 'EXECUTE') as plataforma
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any ($1) order by 1`,
        [[...FUNCIONES_NUEVAS]],
      );
      expect(funciones.map((f) => f.proname)).toEqual([...FUNCIONES_NUEVAS].sort());
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig ?? [], f.proname).toContain(SEARCH_PATH_FIJO);
        expect(f.publico, `${f.proname} para PUBLIC`).toBe(false);
        // Las de disparador no se otorgan; la de textos, solo a quien escribe lo que valida.
        expect(f.app, `${f.proname} para la aplicación`).toBe(f.proname === "texto_fiscal_valido");
        expect(f.plataforma, `${f.proname} para la plataforma`).toBe(false);
      }
    });

    it("los demás roles no tienen ningún privilegio sobre las tablas nuevas (ni por tabla ni por columna), y PUBLIC tampoco", async () => {
      const otros = [
        "zuluhub_grupo",
        "zuluhub_trabajos",
        "zuluhub_plataforma",
        "zuluhub_autenticacion",
        "zuluhub_publico",
        "zuluhub_captacion",
      ];
      expect(
        await consultar(
          `select grantee, table_name, privilege_type from information_schema.table_privileges
            where table_schema = 'public' and table_name = any ($1) and (grantee = any ($2) or grantee = 'PUBLIC')`,
          [[...TABLAS], otros],
        ),
      ).toEqual([]);
      expect(
        await consultar(
          `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
            where table_schema = 'public' and table_name = any ($1) and (grantee = any ($2) or grantee = 'PUBLIC')`,
          [[...TABLAS], otros],
        ),
      ).toEqual([]);
    });
  });

  // ===============================================================================================
  // 2. Alta del comprobante
  // ===============================================================================================
  describe("alta del comprobante", () => {
    it("la aplicación crea una factura B completa, con su renglón y su desglose, en una transacción", async () => {
      const datos = datosDeComprobante(e);
      await conAppDe(base!, e, async (s) => {
        acepta(await insertarComprobante(viaSesion(s), datos));
        acepta(await s.confirmar());
      });
      const [fila] = await consultar<Record<string, unknown>>(
        "select estado, envios, numero, cae, total::text, moneda, version, creado_por from comprobante where id = $1",
        [datos["id"]],
      );
      expect(fila).toMatchObject({
        estado: "PENDIENTE",
        envios: 0,
        numero: null,
        cae: null,
        total: "121.00",
        moneda: "ARS",
        version: 1,
        creado_por: e.persona,
      });
    });

    it("una factura A con tres alícuotas (10,5 %, 21 % y exento) se crea y cuadra; también la C sin alícuotas", async () => {
      const receptor = cuitAlAzar();
      const a = datosDeComprobante(e, {
        tipo_comprobante: "FACTURA_A",
        modo_de_precio: "IVA_DISCRIMINADO",
        total: "281.50",
        neto_gravado: "200.00",
        iva: "31.50",
        exento: "50.00",
        receptor_nombre: "Cliente SA",
        receptor_documento_tipo: "CUIT",
        receptor_documento_numero: receptor,
        receptor_condicion_iva: "RESPONSABLE_INSCRIPTO",
      });
      const renglones: Renglon[] = [
        { ...RENGLON_DE_121, posicion: 1, alicuota: "10.5", importe: "110.50" },
        { ...RENGLON_DE_121, posicion: 2, alicuota: "21", importe: "121.00" },
        { ...RENGLON_DE_121, posicion: 3, alicuota: "EXENTO", importe: "50.00" },
      ];
      const desglose: Desglose[] = [
        { alicuota: "10.5", total: "110.50", neto: "100.00", iva: "10.50" },
        { alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00" },
        { alicuota: "EXENTO", total: "50.00", neto: "50.00", iva: "0.00" },
      ];
      await conAppDe(base!, e, async (s) => {
        acepta(await insertarComprobante(viaSesion(s), a, renglones, desglose));
        acepta(await s.confirmar());
      });
      const eC = await crearEscenario(dueno, {
        condicionIva: "MONOTRIBUTO",
        razonSocial: "Kiosco Zulú",
      });
      await conAppDe(base!, eC, async (s) => {
        acepta(
          await insertarComprobante(
            viaSesion(s),
            datosDeLetraC(eC),
            [RENGLON_DE_100_SIN_ALICUOTA],
            [],
          ),
        );
        acepta(await s.confirmar());
      });
    });

    it("el emisor secundario factura con su propio CUIT; con el del principal, no (la foto coincide con su fuente)", async () => {
      const m = await crearMundo(dueno);
      const cuitSecundario = cuitAlAzar();
      const { rows } = await dueno.query<{ id: string }>(
        "insert into emisor (empresa_id, es_principal, cuit) values ($1, false, $2) returning id",
        [m.empresa, cuitSecundario],
      );
      const secundario = rows[0]?.id as string;
      const principal = await crearEscenario(dueno, { mundo: m, razonSocial: "Principal SA" });
      // Datos fiscales confirmados y punto de venta del secundario.
      const domicilio = principal.domicilio;
      const datos = randomUUID();
      await dueno.query(
        `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                inicio_actividades, creado_por) values ($1, $2, $3, 'Secundaria SRL', 'MONOTRIBUTO', $4, '2021-05-01', $5)`,
        [datos, m.empresa, secundario, domicilio, m.persona],
      );
      await dueno.query(
        `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
                confirmada_por = $2, motivo = 'alta' where id = $1`,
        [datos, m.persona],
      );
      const pv = await crearPuntoDeVenta(dueno, m, {
        numero: 2,
        emisor: secundario,
        domicilio,
        activo: true,
      });
      const comunes: Contenido = {
        emisor_id: secundario,
        punto_de_venta_id: pv,
        punto_de_venta_numero: 2,
        datos_fiscales_id: datos,
        emisor_razon_social: "Secundaria SRL",
        emisor_condicion_iva: "MONOTRIBUTO",
        emisor_inicio_actividades: "2021-05-01",
        emisor_iibb_numero: null,
        emisor_iibb_condicion: null,
        tipo_comprobante: "FACTURA_C",
        total: "100.00",
        neto_gravado: "100.00",
        iva: "0.00",
      };
      await deshacible(async () => {
        acepta(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(principal, { ...comunes, emisor_cuit: cuitSecundario }),
            [RENGLON_DE_100_SIN_ALICUOTA],
            [],
          ),
        );
      });
      await deshacible(async () => {
        const r = await insertarComprobante(
          intento(dueno),
          datosDeComprobante(principal, { ...comunes, emisor_cuit: m.cuit }),
          [RENGLON_DE_100_SIN_ALICUOTA],
          [],
        );
        check(r, "comprobante_alta_invalida");
      });
      // Y los datos fiscales de OTRO emisor de la misma empresa no valen (la clave foránea incluye el emisor).
      await deshacible(async () => {
        const r = await insertarComprobante(
          intento(dueno),
          datosDeComprobante(principal, {
            ...comunes,
            emisor_cuit: cuitSecundario,
            datos_fiscales_id: principal.datosFiscales,
          }),
          [RENGLON_DE_100_SIN_ALICUOTA],
          [],
        );
        referencia(r, "comprobante_datos_fiscales_fkey");
      });
    });

    /**
     * Cada CHECK, uno por uno. El disparador de alta se apaga (dentro de la transacción que se deshace) para que
     * las restricciones se prueben solas: BEFORE INSERT corre antes que los CHECK y se llevaría las fotos
     * inválidas con su propio error.
     */
    const CASOS_DE_CHECK: ReadonlyArray<readonly [string, Contenido, string]> = [
      ["un ambiente que no existe", { ambiente: "PRUEBAS" }, "comprobante_ambiente_ck"],
      ["un tipo de origen que no existe", { origen_tipo: "VENTA" }, "comprobante_origen_tipo_ck"],
      ["un origen con blancos al inicio", { origen_id: " x" }, "comprobante_origen_id_ck"],
      ["un origen con blancos al final", { origen_id: "x " }, "comprobante_origen_id_ck"],
      ["un origen vacío", { origen_id: "" }, "comprobante_origen_id_ck"],
      ["un origen de 101 caracteres", { origen_id: "x".repeat(101) }, "comprobante_origen_id_ck"],
      [
        "una clase que no es la del tipo",
        {
          clase: "NOTA_DEBITO",
          tipo_comprobante: "NOTA_CREDITO_B",
          comprobante_asociado_id: randomUUID(),
        },
        "comprobante_clase_tipo_ck",
      ],
      [
        "una clase que no existe",
        {
          clase: "TICKET",
          tipo_comprobante: "TICKET_B",
          comprobante_asociado_id: randomUUID(),
          motivo: "x",
        },
        "comprobante_clase_ck",
      ],
      [
        "una letra que no existe",
        { tipo_comprobante: "FACTURA_Z", clase: "FACTURA" },
        "comprobante_tipo_ck",
      ],
      ["un concepto que no existe", { concepto: "OTRO" }, "comprobante_concepto_ck"],
      ["servicios sin fechas", { concepto: "SERVICIOS" }, "comprobante_servicio_ck"],
      [
        "productos con fechas de servicio",
        {
          servicio_desde: "2026-10-01",
          servicio_hasta: "2026-10-31",
          vencimiento_pago: "2026-11-10",
        },
        "comprobante_servicio_ck",
      ],
      [
        "servicios con solo el fin del período (el hueco del CHECK de la especificación)",
        { concepto: "SERVICIOS", servicio_hasta: "2026-10-31" },
        "comprobante_servicio_ck",
      ],
      [
        "servicios sin vencimiento de pago",
        { concepto: "SERVICIOS", servicio_desde: "2026-10-01", servicio_hasta: "2026-10-31" },
        "comprobante_servicio_ck",
      ],
      [
        "un período al revés",
        {
          concepto: "PRODUCTOS_Y_SERVICIOS",
          servicio_desde: "2026-10-31",
          servicio_hasta: "2026-10-01",
          vencimiento_pago: "2026-11-10",
        },
        "comprobante_servicio_ck",
      ],
      ["otra moneda", { moneda: "USD" }, "comprobante_moneda_ck"],
      ["un modo de precio que no existe", { modo_de_precio: "NETO" }, "comprobante_modo_ck"],
      [
        "letra C con IVA discriminado",
        {
          tipo_comprobante: "FACTURA_C",
          total: "100.00",
          neto_gravado: "100.00",
          iva: "0.00",
          modo_de_precio: "IVA_DISCRIMINADO",
        },
        "comprobante_modo_c_ck",
      ],
      [
        "un total en cero",
        { total: "0.00", neto_gravado: "0.00", iva: "0.00" },
        "comprobante_importes_ck",
      ],
      [
        "un total negativo",
        { total: "-121.00", neto_gravado: "-100.00", iva: "-21.00" },
        "comprobante_importes_ck",
      ],
      ["un total NaN (numeric lo acepta)", { total: "NaN" }, "comprobante_importes_ck"],
      [
        "un total por encima de lo que cabe en ImpTotal (13 enteros y 2 decimales)",
        { total: "10000000000000.00", neto_gravado: "10000000000000.00", iva: "0.00" },
        "comprobante_importes_ck",
      ],
      ["importes que no suman el total", { iva: "20.00" }, "comprobante_importes_ck"],
      [
        "un neto mayor que el total",
        { neto_gravado: "122.00", iva: "-1.00" },
        "comprobante_importes_ck",
      ],
      [
        "un exento negativo",
        { exento: "-1.00", neto_gravado: "101.00" },
        "comprobante_importes_ck",
      ],
      [
        "letra C con IVA",
        {
          tipo_comprobante: "FACTURA_C",
          total: "100.00",
          neto_gravado: "90.00",
          iva: "10.00",
        },
        "comprobante_c_sin_iva_ck",
      ],
      ["un CUIT de emisor inválido", { emisor_cuit: "20123456787" }, "comprobante_emisor_cuit_ck"],
      [
        "una razón social con blancos al inicio",
        { emisor_razon_social: " Mi SA" },
        "comprobante_emisor_razon_social_ck",
      ],
      [
        "una razón social con un carácter de control",
        { emisor_razon_social: "Mi\tSA" },
        "comprobante_emisor_razon_social_ck",
      ],
      [
        "una razón social de 201 caracteres",
        { emisor_razon_social: "x".repeat(201) },
        "comprobante_emisor_razon_social_ck",
      ],
      [
        "una condición del emisor que no existe",
        { emisor_condicion_iva: "CONSUMIDOR_FINAL" },
        "comprobante_emisor_condicion_ck",
      ],
      [
        "un domicilio fiscal vacío",
        { emisor_domicilio_fiscal: "" },
        "comprobante_emisor_domicilio_ck",
      ],
      [
        "un inicio de actividades imposible",
        { emisor_inicio_actividades: "0001-12-31 BC" },
        "comprobante_emisor_inicio_ck",
      ],
      [
        "un número de IIBB en blanco",
        { emisor_iibb_numero: "  " },
        "comprobante_emisor_iibb_numero_ck",
      ],
      [
        "una condición de IIBB que no existe",
        { emisor_iibb_condicion: "OTRA" },
        "comprobante_emisor_iibb_condicion_ck",
      ],
      ["un punto de venta en cero", { punto_de_venta_numero: 0 }, "comprobante_pv_numero_ck"],
      [
        "un punto de venta de seis dígitos",
        { punto_de_venta_numero: 100000 },
        "comprobante_pv_numero_ck",
      ],
      [
        "un domicilio de punto de venta vacío",
        { punto_de_venta_domicilio: "" },
        "comprobante_pv_domicilio_ck",
      ],
      [
        "un tipo de documento que no existe",
        {
          receptor_documento_tipo: "LE",
          receptor_documento_numero: "30111222",
          receptor_nombre: "Ana",
        },
        "comprobante_receptor_doc_tipo_ck",
      ],
      [
        "sin identificar pero con número",
        { receptor_documento_numero: "30111222" },
        "comprobante_receptor_ck",
      ],
      [
        "identificado sin número",
        { receptor_documento_tipo: "DNI", receptor_nombre: "Ana Pérez" },
        "comprobante_receptor_ck",
      ],
      [
        "identificado sin nombre",
        { receptor_documento_tipo: "DNI", receptor_documento_numero: "30111222" },
        "comprobante_receptor_ck",
      ],
      [
        "un documento con letras",
        {
          receptor_documento_tipo: "DNI",
          receptor_documento_numero: "30A11222",
          receptor_nombre: "Ana",
        },
        "comprobante_receptor_documento_ck",
      ],
      [
        "un documento de 12 dígitos (DocNro es un Long de 11)",
        {
          receptor_documento_tipo: "PASAPORTE",
          receptor_documento_numero: "123456789012",
          receptor_nombre: "Ana",
        },
        "comprobante_receptor_documento_ck",
      ],
      [
        "un CUIT de receptor con el dígito verificador mal",
        {
          receptor_documento_tipo: "CUIT",
          receptor_documento_numero: "20123456787",
          receptor_nombre: "Ana",
        },
        "comprobante_receptor_documento_ck",
      ],
      [
        "una condición del receptor que no existe",
        { receptor_condicion_iva: "MONO" },
        "comprobante_receptor_condicion_ck",
      ],
      [
        "un nombre de receptor con blancos al final",
        {
          receptor_nombre: "Ana ",
          receptor_documento_tipo: "DNI",
          receptor_documento_numero: "30111222",
        },
        "comprobante_receptor_nombre_ck",
      ],
      [
        "un nombre de receptor de 201 caracteres",
        {
          receptor_nombre: "x".repeat(201),
          receptor_documento_tipo: "DNI",
          receptor_documento_numero: "30111222",
        },
        "comprobante_receptor_nombre_ck",
      ],
      [
        "un domicilio de receptor de 301 caracteres",
        { receptor_domicilio: "x".repeat(301) },
        "comprobante_receptor_domicilio_ck",
      ],
      [
        "una nota de crédito sin comprobante asociado",
        { clase: "NOTA_CREDITO", tipo_comprobante: "NOTA_CREDITO_B" },
        "comprobante_asociado_ck",
      ],
      [
        "una factura con comprobante asociado",
        { comprobante_asociado_id: randomUUID() },
        "comprobante_asociado_ck",
      ],
      ["una factura con motivo", { motivo: "porque sí" }, "comprobante_motivo_ck"],
      ["una huella que no es SHA-256", { huella: "abc" }, "comprobante_huella_ck"],
      ["una huella en mayúsculas", { huella: "A".repeat(64) }, "comprobante_huella_ck"],
      [
        "una versión de representación en cero",
        { version_de_representacion: 0 },
        "comprobante_representacion_ck",
      ],
      ["envíos negativos", { envios: -1 }, "comprobante_envios_ck"],
      [
        "un número reservado en un comprobante PENDIENTE",
        { numero_reservado: "5", fecha_emision: "2026-10-13" },
        "comprobante_reserva_ck",
      ],
    ];

    it.each(
      CASOS_DE_CHECK.map(
        ([nombre, cambios, restriccion]) => [nombre, cambios, restriccion] as const,
      ),
    )("rechaza %s", async (_nombre, cambios, restriccion) => {
      await deshacible(async () => {
        await dueno.query("alter table comprobante disable trigger comprobante_alta");
        const r = await insertarComprobante(intento(dueno), datosDeComprobante(e, cambios));
        check(r, restriccion);
      });
    });

    it("los campos obligatorios no aceptan NULL (la moneda y el ambiente no tienen valor por defecto)", async () => {
      for (const campo of [
        "moneda",
        "ambiente",
        "emisor_cuit",
        "huella",
        "creado_por",
        "total",
        "receptor_condicion_iva",
      ]) {
        await deshacible(async () => {
          await dueno.query("alter table comprobante disable trigger comprobante_alta");
          const r = await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, { [campo]: null }),
          );
          expect(r.ok, campo).toBe(false);
          if (!r.ok) expect(r.codigo, `${campo}: ${r.mensaje}`).toBe("23502");
        });
      }
    });

    // ---- los disparadores de alta, con la foto contra su fuente ----------------------------------

    it("nace PENDIENTE y sin envíos: ni el dueño lo crea en otro estado", async () => {
      await deshacible(async () => {
        check(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              estado: "EN_VALIDACION",
              envios: 1,
              numero_reservado: "1",
              fecha_emision: "2026-10-13",
            }),
          ),
          "comprobante_alta_invalida",
        );
      });
      await deshacible(async () => {
        check(
          await insertarComprobante(intento(dueno), datosDeComprobante(e, { envios: 1 })),
          "comprobante_alta_invalida",
        );
      });
    });

    it.each<[string, (x: Escenario) => Contenido]>([
      [
        "otra razón social que la de los datos fiscales",
        () => ({ emisor_razon_social: "Otra SA" }),
      ],
      ["otra condición frente al IVA", () => ({ emisor_condicion_iva: "EXENTO" })],
      ["otro inicio de actividades", () => ({ emisor_inicio_actividades: "2019-01-01" })],
      ["otro número de IIBB", () => ({ emisor_iibb_numero: "999" })],
      ["otra condición de IIBB", () => ({ emisor_iibb_condicion: "EXENTO" })],
      [
        "sin IIBB cuando los datos lo traen",
        () => ({ emisor_iibb_numero: null, emisor_iibb_condicion: null }),
      ],
      ["otro CUIT que el del emisor", () => ({ emisor_cuit: cuitAlAzar() })],
      ["otro número de punto de venta", (x) => ({ punto_de_venta_numero: x.pvNumero + 1 })],
      ["otro ambiente que el del punto de venta", () => ({ ambiente: "PRODUCCION" })],
    ])(
      "la foto del emisor y del punto de venta tiene que coincidir con su fuente: %s se rechaza",
      async (_n, cambios) => {
        await deshacible(async () => {
          check(
            await insertarComprobante(intento(dueno), datosDeComprobante(e, cambios(e))),
            "comprobante_alta_invalida",
          );
        });
      },
    );

    it("unos datos fiscales en BORRADOR no sirven, y un punto de venta INACTIVO tampoco", async () => {
      await deshacible(async () => {
        const borrador = randomUUID();
        await dueno.query(
          `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                  inicio_actividades, iibb_numero, iibb_condicion, creado_por)
           values ($1, $2, $3, $4, 'RESPONSABLE_INSCRIPTO', $5, '2020-01-01', '901-123456-7', 'LOCAL', $6)`,
          [borrador, e.empresa, e.emisor, e.razonSocial, e.domicilio, e.persona],
        );
        check(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, { datos_fiscales_id: borrador }),
          ),
          "comprobante_alta_invalida",
        );
      });
      await deshacible(async () => {
        const inactivo = await crearPuntoDeVenta(dueno, e, { numero: 77 });
        check(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, { punto_de_venta_id: inactivo, punto_de_venta_numero: 77 }),
          ),
          "comprobante_alta_invalida",
        );
      });
    });

    it("las claves foráneas compuestas rechazan un emisor, un punto de venta o unos datos fiscales de otra empresa", async () => {
      const otra = await crearEscenario(dueno);
      for (const [cambios, restriccion] of [
        [{ punto_de_venta_id: otra.pv }, "comprobante_pv_fkey"],
        [{ emisor_id: otra.emisor, punto_de_venta_id: otra.pv }, "comprobante_emisor_fkey"],
        [{ datos_fiscales_id: otra.datosFiscales }, "comprobante_datos_fiscales_fkey"],
      ] as const) {
        await deshacible(async () => {
          referencia(
            await insertarComprobante(intento(dueno), datosDeComprobante(e, cambios)),
            restriccion,
          );
        });
      }
      // Y la empresa tampoco puede ser una inexistente.
      await deshacible(async () => {
        referencia(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, { empresa_id: randomUUID() }),
          ),
          "comprobante_empresa_id_fkey",
        );
      });
    });

    // ---- la nota asociada -----------------------------------------------------------------------------

    /** Una factura B autorizada (en la transacción del dueño que se deshace) y el contenido de una nota de crédito sobre ella. */
    const conAsociadaAutorizada = async <T>(
      trabajo: (asociada: Contenido, nota: (cambios?: Contenido) => Contenido) => Promise<T>,
      cambiosDeLaAsociada: Contenido = {},
    ) =>
      deshacible(async () => {
        const asociada = datosDeComprobante(e, cambiosDeLaAsociada);
        acepta(await insertarComprobante(intento(dueno), asociada));
        acepta(await entrarEnValidacion(intento(dueno), asociada["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), asociada["id"] as string));
        const nota = (cambios: Contenido = {}) =>
          datosDeComprobante(e, {
            clase: "NOTA_CREDITO",
            tipo_comprobante: "NOTA_CREDITO_B",
            comprobante_asociado_id: asociada["id"],
            motivo: "devolución",
            ...cambios,
          });
        return trabajo(asociada, nota);
      });

    it("una nota de crédito nace sobre un comprobante AUTORIZADO, de la misma letra, el mismo receptor y el mismo ambiente", async () => {
      await conAsociadaAutorizada(async (_a, nota) => {
        acepta(await insertarComprobante(intento(dueno), nota()));
        // Una nota de débito también.
        acepta(
          await insertarComprobante(
            intento(dueno),
            nota({
              clase: "NOTA_DEBITO",
              tipo_comprobante: "NOTA_DEBITO_B",
              origen_id: randomUUID(),
            }),
          ),
        );
      });
    });

    it.each<[string, (nota: (c?: Contenido) => Contenido) => Contenido]>([
      ["de otra letra", (nota) => nota({ tipo_comprobante: "NOTA_CREDITO_A" })],
      [
        "a otro receptor (otro documento)",
        (nota) =>
          nota({
            receptor_documento_tipo: "DNI",
            receptor_documento_numero: "30111222",
            receptor_nombre: "Ana Pérez",
          }),
      ],
    ])("una nota %s que su asociado se rechaza", async (_n, armar) => {
      await conAsociadaAutorizada(async (_a, nota) => {
        check(
          await insertarComprobante(intento(dueno), armar(nota)),
          "comprobante_asociado_invalido",
        );
      });
    });

    it("una nota sobre un comprobante que no está AUTORIZADO, o sobre otra nota de crédito, se rechaza", async () => {
      await deshacible(async () => {
        const pendiente = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), pendiente));
        check(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              clase: "NOTA_CREDITO",
              tipo_comprobante: "NOTA_CREDITO_B",
              comprobante_asociado_id: pendiente["id"],
              motivo: "x",
            }),
          ),
          "comprobante_asociado_invalido",
        );
      });
      await conAsociadaAutorizada(async (_a, nota) => {
        const credito = nota();
        acepta(await insertarComprobante(intento(dueno), credito));
        acepta(await entrarEnValidacion(intento(dueno), credito["id"] as string, "2"));
        acepta(await marcarAutorizado(intento(dueno), credito["id"] as string));
        check(
          await insertarComprobante(
            intento(dueno),
            nota({ comprobante_asociado_id: credito["id"], origen_id: randomUUID() }),
          ),
          "comprobante_asociado_invalido",
        );
      });
    });

    it("una nota en otro ambiente que su asociado se rechaza; sobre un comprobante de otra empresa o de otro emisor, la clave foránea", async () => {
      await conAsociadaAutorizada(async (asociada) => {
        // Un segundo punto de venta ya en producción: la nota nace en ese ambiente.
        const pvProduccion = await crearPuntoDeVenta(dueno, e, {
          numero: 5,
          domicilio: e.domicilio,
          activo: true,
        });
        await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [
          pvProduccion,
        ]);
        check(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              clase: "NOTA_CREDITO",
              tipo_comprobante: "NOTA_CREDITO_B",
              comprobante_asociado_id: asociada["id"],
              motivo: "otro ambiente",
              punto_de_venta_id: pvProduccion,
              punto_de_venta_numero: 5,
              ambiente: "PRODUCCION",
            }),
          ),
          "comprobante_asociado_invalido",
        );
      });
      const otra = await crearEscenario(dueno);
      const ajena = await crearComprobante(dueno, otra);
      await deshacible(async () => {
        referencia(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              clase: "NOTA_CREDITO",
              tipo_comprobante: "NOTA_CREDITO_B",
              comprobante_asociado_id: ajena,
              motivo: "de otra empresa",
            }),
          ),
          "comprobante_asociado_fkey",
        );
      });
    });
  });

  // ===============================================================================================
  // 3. El comprobante cuadra (restricción diferida)
  // ===============================================================================================
  describe("el comprobante cuadra: renglones, desglose y columnas suman lo mismo", () => {
    /** Intenta crear y confirmar; devuelve el resultado de la CONFIRMACIÓN (donde saltan las restricciones diferidas). */
    const confirmando = async (
      datos: Contenido,
      renglones?: readonly Renglon[],
      desglose?: readonly Desglose[],
    ) => {
      await dueno.query("begin");
      const r = await insertarComprobante(intento(dueno), datos, renglones, desglose);
      acepta(r);
      return confirmarDueno(dueno);
    };

    it("el comprobante correcto confirma", async () => {
      acepta(await confirmando(datosDeComprobante(e)));
    });

    it.each<[string, Renglon[] | undefined, Desglose[] | undefined, Contenido]>([
      ["sin renglones", [], undefined, {}],
      [
        "con renglones que no suman el total",
        [{ ...RENGLON_DE_121, importe: "120.00" }],
        undefined,
        {},
      ],
      [
        "con renglones que se pasan del total",
        [{ ...RENGLON_DE_121, importe: "121.01" }],
        undefined,
        {},
      ],
      [
        "con renglones que no empiezan en la posición 1",
        [{ ...RENGLON_DE_121, posicion: 2 }],
        undefined,
        {},
      ],
      [
        "con un hueco entre las posiciones",
        [
          { ...RENGLON_DE_121, importe: "60.00" },
          { ...RENGLON_DE_121, posicion: 3, importe: "61.00" },
        ],
        [{ alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00" }],
        {},
      ],
      [
        "con un renglón sin alícuota en una letra B",
        [{ ...RENGLON_DE_121, alicuota: null }],
        undefined,
        {},
      ],
      ["sin desglose en una letra B", undefined, [], {}],
      [
        "con un desglose que no suma el total",
        undefined,
        [{ alicuota: "21", total: "120.00", neto: "99.00", iva: "21.00" }],
        {},
      ],
      [
        "con un desglose cuyo neto no es el de la columna del comprobante",
        undefined,
        [{ alicuota: "21", total: "121.00", neto: "99.00", iva: "22.00" }],
        {},
      ],
      [
        "con un desglose cuyo IVA no es el de la columna del comprobante",
        undefined,
        [{ alicuota: "21", total: "121.00", neto: "101.00", iva: "20.00" }],
        {},
      ],
      [
        "con un desglose de otra alícuota que la de sus renglones",
        undefined,
        [{ alicuota: "10.5", total: "121.00", neto: "100.00", iva: "21.00" }],
        {},
      ],
      [
        "con un exento en el desglose que el comprobante no declara",
        [{ ...RENGLON_DE_121, alicuota: "EXENTO" }],
        [{ alicuota: "EXENTO", total: "121.00", neto: "121.00", iva: "0.00" }],
        {},
      ],
      [
        "con un exento declarado en el comprobante que el desglose no trae",
        undefined,
        undefined,
        { total: "121.00", neto_gravado: "71.00", iva: "21.00", exento: "29.00" },
      ],
    ])("rechaza al confirmar un comprobante %s", async (_n, renglones, desglose, cambios) => {
      const r = await confirmando(datosDeComprobante(e, cambios), renglones, desglose);
      check(r, "comprobante_descuadrado");
    });

    it("una letra C no lleva alícuotas: ni en los renglones ni en el desglose", async () => {
      const eC = await crearEscenario(dueno, {
        condicionIva: "MONOTRIBUTO",
        razonSocial: "Kiosco Zulú",
      });
      acepta(await confirmando(datosDeLetraC(eC), [RENGLON_DE_100_SIN_ALICUOTA], []));
      check(
        await confirmando(
          datosDeLetraC(eC),
          [{ ...RENGLON_DE_100_SIN_ALICUOTA, alicuota: "21" }],
          [],
        ),
        "comprobante_descuadrado",
      );
      check(
        await confirmando(
          datosDeLetraC(eC),
          [RENGLON_DE_100_SIN_ALICUOTA],
          [{ alicuota: "21", total: "100.00", neto: "82.64", iva: "17.36" }],
        ),
        "comprobante_descuadrado",
      );
    });

    it("el cuadre se evalúa al confirmar, no antes: renglones y desglose se pueden insertar en cualquier orden dentro de la transacción", async () => {
      const datos = datosDeComprobante(e);
      await dueno.query("begin");
      acepta(await insertarComprobante(intento(dueno), datos, [], []));
      // Todavía sin renglones: la transacción sigue sana.
      acepta(
        await intento(dueno)(
          `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva)
           values ($1, $2, '21', 121.00, 100.00, 21.00)`,
          [e.empresa, datos["id"]],
        ),
      );
      acepta(
        await intento(dueno)(
          `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
           values ($1, $2, 1, 'Café', 1, 121, '21', 121.00)`,
          [e.empresa, datos["id"]],
        ),
      );
      acepta(await confirmarDueno(dueno));
    });
  });

  // ===============================================================================================
  // 4. Identidad e idempotencia
  // ===============================================================================================
  describe("identidad: un origen no da dos comprobantes vigentes", () => {
    it("el mismo origen, emisor y clase no se repite mientras el comprobante esté vigente (en cualquier estado salvo RECHAZADO y DESCARTADO)", async () => {
      const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `ticket-${randomUUID()}` };
      await deshacible(async () => {
        acepta(await insertarComprobante(intento(dueno), datosDeComprobante(e, origen)));
        clave(
          await insertarComprobante(intento(dueno), datosDeComprobante(e, origen)),
          "comprobante_identidad_uk",
        );
      });
    });

    it("el mismo origen sí admite otra clase (la nota de crédito del mismo ticket) y otro tipo de origen con el mismo id", async () => {
      const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `ticket-${randomUUID()}` };
      await deshacible(async () => {
        const factura = datosDeComprobante(e, origen);
        acepta(await insertarComprobante(intento(dueno), factura));
        acepta(await entrarEnValidacion(intento(dueno), factura["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), factura["id"] as string));
        acepta(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              ...origen,
              clase: "NOTA_CREDITO",
              tipo_comprobante: "NOTA_CREDITO_B",
              comprobante_asociado_id: factura["id"],
              motivo: "corrección",
            }),
          ),
        );
        acepta(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, {
              origen_tipo: "PROPINA_DE_TICKET",
              origen_id: origen.origen_id,
            }),
          ),
        );
      });
    });

    it("rechazado o descartado, un origen que NO es manual vuelve a quedar libre para emitir uno nuevo", async () => {
      for (const estadoFinal of ["RECHAZADO", "DESCARTADO"] as const) {
        const origen = { origen_tipo: "EJEMPLAR_DE_TICKET", origen_id: `ticket-${randomUUID()}` };
        await deshacible(async () => {
          const primero = datosDeComprobante(e, origen);
          acepta(await insertarComprobante(intento(dueno), primero));
          if (estadoFinal === "RECHAZADO") {
            acepta(await entrarEnValidacion(intento(dueno), primero["id"] as string, "1"));
            acepta(
              await intento(dueno)("update comprobante set estado = 'RECHAZADO' where id = $1", [
                primero["id"],
              ]),
            );
          } else {
            acepta(
              await intento(dueno)(
                "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'me equivoqué' where id = $1",
                [primero["id"]],
              ),
            );
          }
          acepta(await insertarComprobante(intento(dueno), datosDeComprobante(e, origen)));
        });
      }
    });

    it("pero una clave MANUAL nunca da dos comprobantes, ni siquiera después de un rechazo ni de un descarte", async () => {
      for (const estadoFinal of ["RECHAZADO", "DESCARTADO"] as const) {
        const clavePantalla = randomUUID();
        await deshacible(async () => {
          const primero = datosDeComprobante(e, { origen_id: clavePantalla });
          acepta(await insertarComprobante(intento(dueno), primero));
          if (estadoFinal === "RECHAZADO") {
            acepta(await entrarEnValidacion(intento(dueno), primero["id"] as string, "1"));
            acepta(
              await intento(dueno)("update comprobante set estado = 'RECHAZADO' where id = $1", [
                primero["id"],
              ]),
            );
          } else {
            acepta(
              await intento(dueno)(
                "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'me equivoqué' where id = $1",
                [primero["id"]],
              ),
            );
          }
          clave(
            await insertarComprobante(
              intento(dueno),
              datosDeComprobante(e, { origen_id: clavePantalla }),
            ),
            "comprobante_manual_uk",
          );
        });
      }
    });

    it("la clave manual es de la empresa: otra empresa puede usar la misma (y no se entera de la ajena)", async () => {
      const otra = await crearEscenario(dueno);
      const clavePantalla = randomUUID();
      await deshacible(async () => {
        acepta(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(e, { origen_id: clavePantalla }),
          ),
        );
        acepta(
          await insertarComprobante(
            intento(dueno),
            datosDeComprobante(otra, { origen_id: clavePantalla }),
          ),
        );
      });
    });

    it("repetir el alta con ON CONFLICT DO NOTHING es idempotente: no duplica ni cambia el primero", async () => {
      const clavePantalla = randomUUID();
      await conAppDe(base!, e, async (s) => {
        acepta(
          await insertarComprobante(
            viaSesion(s),
            datosDeComprobante(e, { origen_id: clavePantalla }),
          ),
        );
        // Segundo envío de la misma pantalla (otro id de fila, misma clave): no inserta nada.
        const columnas = Object.keys(datosDeComprobante(e));
        const segundo = datosDeComprobante(e, { origen_id: clavePantalla });
        const r = await s.intentar(
          `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
           on conflict (empresa_id, origen_id) where origen_tipo = 'MANUAL' do nothing returning id`,
          columnas.map((c) => segundo[c]),
        );
        acepta(r);
        expect(r.ok && r.filas).toBe(0);
        const cuenta = await s.intentar(
          "select count(*)::int as n from comprobante where origen_id = $1",
          [clavePantalla],
        );
        expect(cuenta.ok && cuenta.rows[0]).toEqual({ n: 1 });
      });
    });

    it("un solo comprobante lleva un número autorizado: el número es único por serie (comprobante_numero_uk)", async () => {
      await deshacible(async () => {
        const a = datosDeComprobante(e);
        const b = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), a));
        acepta(await insertarComprobante(intento(dueno), b));
        acepta(await entrarEnValidacion(intento(dueno), a["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), a["id"] as string));
        // El segundo reserva el mismo número (el dueño se salta la serie, que se verifica al confirmar).
        acepta(await entrarEnValidacion(intento(dueno), b["id"] as string, "1"));
        clave(await marcarAutorizado(intento(dueno), b["id"] as string), "comprobante_numero_uk");
      });
    });

    it("el número autorizado de homologación y el de producción del MISMO punto de venta y tipo no chocan (el ambiente es parte de la clave)", async () => {
      await deshacible(async () => {
        const pvX = await crearPuntoDeVenta(dueno, e, {
          numero: 9,
          domicilio: e.domicilio,
          activo: true,
        });
        const enHomologacion = datosDeComprobante(e, {
          punto_de_venta_id: pvX,
          punto_de_venta_numero: 9,
        });
        acepta(await insertarComprobante(intento(dueno), enHomologacion));
        acepta(await entrarEnValidacion(intento(dueno), enHomologacion["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), enHomologacion["id"] as string));
        // El punto de venta pasa a producción (sin series en curso: la serie de la prueba no se creó) y emite su número 1.
        acepta(
          await intento(dueno)("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [
            pvX,
          ]),
        );
        const enProduccion = datosDeComprobante(e, {
          punto_de_venta_id: pvX,
          punto_de_venta_numero: 9,
          ambiente: "PRODUCCION",
        });
        acepta(await insertarComprobante(intento(dueno), enProduccion));
        acepta(await entrarEnValidacion(intento(dueno), enProduccion["id"] as string, "1"));
        acepta(await marcarAutorizado(intento(dueno), enProduccion["id"] as string));
        // Y dos del mismo ambiente con el mismo número sí chocan.
        const otro = datosDeComprobante(e, {
          punto_de_venta_id: pvX,
          punto_de_venta_numero: 9,
          ambiente: "PRODUCCION",
        });
        acepta(await insertarComprobante(intento(dueno), otro));
        acepta(await entrarEnValidacion(intento(dueno), otro["id"] as string, "1"));
        clave(
          await marcarAutorizado(intento(dueno), otro["id"] as string),
          "comprobante_numero_uk",
        );
      });
    });
  });

  // ===============================================================================================
  // 5. Renglones y desglose
  // ===============================================================================================
  describe("renglones y desglose", () => {
    const lineaCon = (cambios: Record<string, unknown>) => ({
      posicion: 1,
      descripcion: "Café",
      cantidad: "1",
      precio_unitario: "121",
      descuento: null,
      alicuota: "21",
      importe: "121.00",
      ...cambios,
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["una cantidad en cero", { cantidad: "0" }, "comprobante_linea_cantidad_ck"],
      ["una cantidad negativa", { cantidad: "-1" }, "comprobante_linea_cantidad_ck"],
      ["una cantidad NaN", { cantidad: "NaN" }, "comprobante_linea_cantidad_ck"],
      ["un precio negativo", { precio_unitario: "-0.01" }, "comprobante_linea_precio_ck"],
      ["un precio NaN", { precio_unitario: "NaN" }, "comprobante_linea_precio_ck"],
      ["un descuento mayor a 100", { descuento: "100.0001" }, "comprobante_linea_descuento_ck"],
      ["un descuento negativo", { descuento: "-1" }, "comprobante_linea_descuento_ck"],
      ["una alícuota que no existe", { alicuota: "7" }, "comprobante_linea_alicuota_ck"],
      ["un importe negativo", { importe: "-1.00" }, "comprobante_linea_importe_ck"],
      ["un importe NaN", { importe: "NaN" }, "comprobante_linea_importe_ck"],
      ["una descripción vacía", { descripcion: "" }, "comprobante_linea_descripcion_ck"],
      [
        "una descripción con blancos al final",
        { descripcion: "Café " },
        "comprobante_linea_descripcion_ck",
      ],
      [
        "una descripción con un salto de línea",
        { descripcion: "Café\ncon leche" },
        "comprobante_linea_descripcion_ck",
      ],
      [
        "una descripción de 201 caracteres",
        { descripcion: "x".repeat(201) },
        "comprobante_linea_descripcion_ck",
      ],
      ["la posición 0", { posicion: 0 }, "comprobante_linea_posicion_ck"],
      [
        "la posición 201 (el tope son 200 renglones)",
        { posicion: 201 },
        "comprobante_linea_posicion_ck",
      ],
    ])("un renglón con %s se rechaza", async (_n, cambios, restriccion) => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos, [], []));
        check(
          await intento(dueno)(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, descuento, alicuota, importe)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            (() => {
              const l = lineaCon(cambios);
              return [
                e.empresa,
                datos["id"],
                l.posicion,
                l.descripcion,
                l.cantidad,
                l.precio_unitario,
                l.descuento,
                l.alicuota,
                l.importe,
              ];
            })(),
          ),
          restriccion,
        );
      });
    });

    it("el mismo número de posición no se repite en un comprobante", async () => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos, [RENGLON_DE_121], []));
        clave(
          await intento(dueno)(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
             values ($1, $2, 1, 'Otra', 1, 1, '21', 1.00)`,
            [e.empresa, datos["id"]],
          ),
          "comprobante_linea_pkey",
        );
      });
    });

    it.each<[string, Record<string, unknown>, string]>([
      ["un código de alícuota que no existe", { alicuota: "8" }, "comprobante_alicuota_codigo_ck"],
      [
        "un total que no es neto más IVA",
        { total: "121.00", neto: "100.00", iva: "20.00" },
        "comprobante_alicuota_ck",
      ],
      [
        "un IVA negativo",
        { total: "100.00", neto: "110.00", iva: "-10.00" },
        "comprobante_alicuota_ck",
      ],
      ["un total NaN", { total: "NaN" }, "comprobante_alicuota_ck"],
      [
        "un exento con IVA",
        { alicuota: "EXENTO", total: "121.00", neto: "100.00", iva: "21.00" },
        "comprobante_alicuota_ck",
      ],
      [
        "un no gravado cuyo neto no es el total",
        { alicuota: "NO_GRAVADO", total: "121.00", neto: "100.00", iva: "21.00" },
        "comprobante_alicuota_ck",
      ],
    ])("un desglose con %s se rechaza", async (_n, cambios, restriccion) => {
      await deshacible(async () => {
        const datos = datosDeComprobante(e);
        acepta(await insertarComprobante(intento(dueno), datos, [], []));
        const fila = { alicuota: "21", total: "121.00", neto: "100.00", iva: "21.00", ...cambios };
        check(
          await intento(dueno)(
            `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva)
             values ($1, $2, $3, $4, $5, $6)`,
            [e.empresa, datos["id"], fila.alicuota, fila.total, fila.neto, fila.iva],
          ),
          restriccion,
        );
      });
    });

    it("un renglón o un desglose TARDÍO (en otra transacción que la del comprobante) se rechaza aun si el comprobante sigue PENDIENTE", async () => {
      const id = await crearComprobante(dueno, e);
      await deshacible(async () => {
        check(
          await intento(dueno)(
            `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
             values ($1, $2, 2, 'Agregado después', 1, 0, '21', 0.00)`,
            [e.empresa, id],
          ),
          "comprobante_linea_tardia",
        );
        check(
          await intento(dueno)(
            `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva)
             values ($1, $2, '10.5', 0.00, 0.00, 0.00)`,
            [e.empresa, id],
          ),
          "comprobante_alicuota_tardia",
        );
      });
    });

    it("renglones y desglose no se modifican ni se borran, ni los vacía nadie, tampoco el dueño (42501)", async () => {
      const id = await crearComprobante(dueno, e);
      for (const tabla of ["comprobante_linea", "comprobante_alicuota"]) {
        const col = tabla === "comprobante_linea" ? "importe" : "total";
        await deshacible(async () => {
          denegado(
            await intento(dueno)(
              `update ${tabla} set ${col} = ${col} + 1 where comprobante_id = $1`,
              [id],
            ),
          );
          denegado(await intento(dueno)(`delete from ${tabla} where comprobante_id = $1`, [id]));
          denegado(await intento(dueno)(`truncate ${tabla}`));
        });
      }
    });
  });
});
