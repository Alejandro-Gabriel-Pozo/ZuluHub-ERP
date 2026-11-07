import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  confirmarDatosFiscales,
  guardarBorradorDeDatosFiscales,
  type DependenciasDeConfiguracionFiscalWeb,
} from "../../src/composicion/configuracion-fiscal-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";

/**
 * Datos fiscales (D-88) con la composición REAL: guardar, confirmar rechazado, corregir el domicilio y confirmar. Es el recorrido de la
 * pantalla cuando falta el inicio de actividades y la persona, además, corrige la calle. Previene: que el formulario reenvíe el MISMO
 * id de domicilio con otro contenido (`ID_EN_USO`: un domicilio no se edita) y obligue a recargar la página. Lo que se prueba: el
 * segundo guardado sale con la versión devuelta por el primero y el mismo borrador, el domicilio corregido va con un id NUEVO, y el
 * mismo id con otro contenido SÍ se rechaza (la razón de la regla del formulario).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const uuid = (): string => randomUUID();
const domicilioNuevo = (cambios: Record<string, unknown> = {}) => ({
  tipo: "NUEVO",
  id: uuid(),
  calle: "Mitre",
  numero: "10",
  piso: null,
  departamento: null,
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "S2000",
  ...cambios,
});

describe.skipIf(base === null)(
  "fiscal: corregir Datos fiscales tras una confirmación rechazada",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let conexiones: Conexiones;
    let d: DependenciasDeConfiguracionFiscalWeb;
    const registrados: string[] = [];

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      const fuente = {
        PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.base.app,
      };
      conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
      const web = armarWeb(conexiones);
      d = {
        casosDeUso: web.casosDeUsoDeConfiguracionFiscal,
        consultas: web.consultasDeFacturacion,
        respuesta: { registrar: (x: string) => registrados.push(x) },
      };
    }, 120_000);
    afterAll(async () => {
      await conexiones.transaccionesDeApp().cerrar();
      await dueno.end();
      await propia.destruir();
    });

    const dato = <T>(r: { ok: true; dato: T } | { ok: false; error: unknown }): T => {
      if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
      return r.dato;
    };

    it("guardar, confirmar rechazado (falta el inicio), corregir el domicilio y confirmar: sin recargar", async () => {
      const e = await crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE" });
      const emisorId = e.mundo.emisor;
      const borradorId = uuid();
      const primero = domicilioNuevo();

      // 1. «Confirmar» guarda el borrador (sin inicio de actividades) ...
      const guardado = dato(
        await guardarBorradorDeDatosFiscales(d, e.como(new Date()), {
          emisorId,
          borradorId,
          razonSocial: "Panadería Zulu SA",
          condicionIva: "RESPONSABLE_INSCRIPTO",
          domicilio: primero,
        }),
      ) as { version: number };

      // 2. ... y la confirmación se rechaza por lo que falta.
      const pedidoDeConfirmacion = {
        emisorId,
        borradorId,
        motivo: "Confirmación de datos fiscales",
      };
      expect(
        await confirmarDatosFiscales(d, e.como(new Date()), {
          ...pedidoDeConfirmacion,
          versionEsperada: guardado.version,
        }),
      ).toMatchObject({
        ok: false,
        error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "inicioActividades" },
      });

      // El formulario de antes: el mismo id de domicilio con otra calle no se acepta (un domicilio no se edita).
      const mismoIdOtroContenido = await guardarBorradorDeDatosFiscales(d, e.como(new Date()), {
        emisorId,
        borradorId,
        versionEsperada: guardado.version,
        inicioActividades: "2018-03-01",
        domicilio: { ...primero, calle: "Belgrano" },
      });
      expect(mismoIdOtroContenido.ok).toBe(false);

      // 3. Lo de ahora: la versión devuelta, el mismo borrador y el domicilio corregido con un id nuevo.
      const corregido = domicilioNuevo({ calle: "Belgrano" });
      const segundo = dato(
        await guardarBorradorDeDatosFiscales(d, e.como(new Date()), {
          emisorId,
          borradorId,
          versionEsperada: guardado.version,
          razonSocial: "Panadería Zulu SA",
          condicionIva: "RESPONSABLE_INSCRIPTO",
          inicioActividades: "2018-03-01",
          iibbNumero: "901-123456-7",
          domicilio: corregido,
        }),
      ) as { version: number };
      expect(segundo.version).toBeGreaterThan(guardado.version);

      // 4. Y ahora sí se confirma, con la versión que dejó el segundo guardado.
      dato(
        await confirmarDatosFiscales(d, e.como(new Date()), {
          ...pedidoDeConfirmacion,
          versionEsperada: segundo.version,
        }),
      );

      const { rows } = await dueno.query<{ estado: string; domicilio: string; inicio: string }>(
        `select estado, domicilio_fiscal_id as domicilio, inicio_actividades::text as inicio
         from datos_fiscales where id = $1`,
        [borradorId],
      );
      expect(rows).toEqual([
        { estado: "CONFIRMADA", domicilio: corregido.id, inicio: "2018-03-01" },
      ]);
      const calles = await dueno.query<{ calle: string }>(
        "select calle from domicilio where empresa_id = $1 order by calle",
        [e.mundo.empresa],
      );
      expect(calles.rows.map((f) => f.calle)).toEqual(["Belgrano", "Mitre"]);
    });
  },
);
