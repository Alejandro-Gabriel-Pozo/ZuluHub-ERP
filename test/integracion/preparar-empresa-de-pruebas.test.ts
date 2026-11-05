import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  armarCasosDeLaLista,
  type CasosDeLaLista,
} from "../../scripts/ejecutar-caso-desde-archivo";
import { ejecutarCreacionDelPrimerAdmin } from "../../scripts/ejecutar-crear-primer-admin";
import {
  ejecutorDeCasos,
  prepararEmpresaDePruebas,
  type EntradaDePreparacion,
} from "../../scripts/ejecutar-preparar-empresa-de-pruebas";
import { armarPlataforma } from "../../src/composicion/plataforma";
import { crearBaseAparte } from "./entorno";

/**
 * «Preparar la empresa de pruebas» de punta a punta contra Postgres REAL y los casos de uso REALES (no el ejecutor falso):
 * administrador → plan → marca (borrador y confirmación, con la marca neutra por defecto) → dominio (agregar, verificar,
 * activar) → alta de la empresa → módulo `facturacion`. Es la prueba que detecta que el paquete quede corto de datos para
 * confirmar la marca (`DEFINICION_INCOMPLETA`). Repetirlo no duplica nada. La cola (el mail) se verifica solo como
 * «encolada»: el despacho al cron es un pedido HTTP que acá se reemplaza.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const HORA = 3_600_000;

describe.skipIf(base === null)("preparar la empresa de pruebas (base y casos reales)", () => {
  let aparte: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: Record<string, string | undefined>;
  let plataforma: ReturnType<typeof armarPlataforma>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    aparte = await crearBaseAparte(base, { sinMarcaDePrueba: true });
    const paquete = {
      adminEmail: "admin.ficticio@ejemplo.test",
      // Futuro cercano: la confirmación no admite fecha pasada y el alta espera a que la marca rija.
      vigenteDesde: new Date(Date.now() + 5_000).toISOString(),
      marca: { codigo: "marca-ficticia", nombreVisible: "Marca Ficticia" },
      plan: {
        codigo: "plan-ficticio",
        nombreComercial: "Plan Ficticio",
        modulos: ["administracion", "facturacion"],
        perillas: { empresas_por_tenant: { tipo: "LIMITE", limite: 1 } },
      },
      dominio: {
        host: "app-prueba.ejemplo.test",
        titular: "OPERADOR",
        verificadoEn: new Date(Date.now() - HORA).toISOString(),
      },
      empresa: {
        nombreDeTenant: "Cliente Ficticio",
        cuit: "20123456786",
        razonSocial: "Empresa Ficticia SRL",
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
        emailGerente: "gerente.ficticio@ejemplo.test",
      },
    };
    entorno = {
      PEDERNAL_PREPARAR_PREVIEW: JSON.stringify(paquete),
      PEDERNAL_DB_MIGRACIONES: aparte.base.dueno,
      PEDERNAL_DB_PLATAFORMA: aparte.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: `${aparte.base.clave.kid}:${aparte.base.clave.secreto.toString("hex")}`,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
      CRON_SECRET: `cron-${randomBytes(16).toString("hex")}`,
    };
    plataforma = armarPlataforma({ fuente: () => entorno });
    dueno = new pg.Client({ connectionString: aparte.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await plataforma?.cerrar();
    await dueno?.end();
    await aparte?.destruir();
  });

  const correr = async () => {
    const salida: string[] = [];
    const despachos: string[] = [];
    const casos: CasosDeLaLista = armarCasosDeLaLista(plataforma);
    const entrada: EntradaDePreparacion = {
      entorno,
      sembrarAdmin: (email, s) =>
        ejecutarCreacionDelPrimerAdmin({
          argumentos: [email],
          entorno,
          info: s.info,
          error: s.error,
        }),
      ejecutarCaso: ejecutorDeCasos({
        entorno,
        ahora: () => new Date(),
        buscarAdmin: plataforma.buscarAdmin,
        casos,
      }),
      info: (l) => salida.push(l),
      error: (l) => salida.push(l),
      comando: () => undefined,
      despacharCola: (url) => {
        despachos.push(url);
        return Promise.resolve(200);
      },
    };
    const codigo = await prepararEmpresaDePruebas(entrada);
    return { codigo, salida: salida.join("\n"), despachos };
  };

  const contar = async (consulta: string): Promise<number> =>
    Number((await dueno.query<{ n: string }>(consulta)).rows[0]?.n);

  it("recorre todo el flujo real: la marca neutra se confirma y la empresa queda con facturación", async () => {
    const r = await correr();
    expect(r.salida).not.toContain("DEFINICION_INCOMPLETA");
    expect(r.codigo, r.salida).toBe(0);
    expect(r.despachos).toEqual(["https://app-prueba.ejemplo.test/api/trabajos/cron"]);

    expect(
      await contar("SELECT count(*) AS n FROM version_de_marca WHERE confirmada_en IS NOT NULL"),
    ).toBeGreaterThanOrEqual(1);
    const dominio = await dueno.query<{ estado: string }>(
      "SELECT estado FROM dominio WHERE host = 'app-prueba.ejemplo.test'",
    );
    expect(dominio.rows[0]?.estado).toBe("ACTIVO");
    const modulo = await dueno.query<{ activo: boolean }>(
      "SELECT activo FROM modulo_de_empresa WHERE modulo = 'facturacion'",
    );
    expect(modulo.rows[0]?.activo).toBe(true);
    expect(await contar("SELECT count(*) AS n FROM trabajo WHERE tipo = 'enviar_invitacion'")).toBe(
      1,
    );
  });

  it("repetirlo no duplica nada (misma empresa, misma invitación, mismo dominio)", async () => {
    const antes = {
      empresas: await contar("SELECT count(*) AS n FROM empresa"),
      trabajos: await contar("SELECT count(*) AS n FROM trabajo WHERE tipo = 'enviar_invitacion'"),
      dominios: await contar("SELECT count(*) AS n FROM dominio"),
      admins: await contar("SELECT count(*) AS n FROM admin_plataforma"),
    };
    const r = await correr();
    expect(r.codigo, r.salida).toBe(0);
    expect({
      empresas: await contar("SELECT count(*) AS n FROM empresa"),
      trabajos: await contar("SELECT count(*) AS n FROM trabajo WHERE tipo = 'enviar_invitacion'"),
      dominios: await contar("SELECT count(*) AS n FROM dominio"),
      admins: await contar("SELECT count(*) AS n FROM admin_plataforma"),
    }).toEqual(antes);
  });

  it("con otros datos y las mismas claves, el paso rechaza y no cambia nada (CLAVE_REUTILIZADA)", async () => {
    const paquete = JSON.parse(entorno["PEDERNAL_PREPARAR_PREVIEW"] as string) as {
      marca: { codigo: string };
    };
    const original = entorno["PEDERNAL_PREPARAR_PREVIEW"];
    entorno["PEDERNAL_PREPARAR_PREVIEW"] = JSON.stringify({
      ...paquete,
      marca: { ...paquete.marca, codigo: "otra-marca" },
    });
    const empresas = await contar("SELECT count(*) AS n FROM empresa");
    const r = await correr();
    entorno["PEDERNAL_PREPARAR_PREVIEW"] = original;
    expect(r.codigo).toBe(1);
    expect(await contar("SELECT count(*) AS n FROM empresa")).toBe(empresas);
  });
});
