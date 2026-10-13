import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearMarcasDeMail } from "../../src/adaptadores/postgres/marcas-de-mail";
import {
  crearTransacciones,
  type TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import {
  crearLecturaDeMarcaParaMail,
  type MarcasParaMailDb,
} from "../../src/modulos/marcas/publico";
import {
  empresaId,
  marcaComercialId,
  tenantId,
  type TenantId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import type { MarcaDeMailResuelta, MarcasDeMail } from "../../src/puertos/marcas";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import {
  crearDominio,
  crearMarca,
  crearMundoDeMarca,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * `MarcasDeMail` contra Postgres real y el rol de la aplicación (M4, marcas y planes §B.10): el mail sale
 * de la marca DEL TENANT, con el nombre de su versión vigente y el host canónico de su aplicación, y
 * nunca con los de otra marca; solo la principal cae en el respaldo de las variables. Base propia.
 */

const base = inject("baseDePruebas");

type Tx = Readonly<{ mails: MarcasDeMail }>;

const RESPALDO = { nombre: "Respaldo del entorno", urlBase: "https://respaldo.ejemplo.test" };

describe.skipIf(base === null)("marcas de mail: desde qué marca sale el mail de un tenant", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<Tx>;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    principal = await marcaPrincipal(dueno);
    entorno = crearTransacciones<Tx>({
      urls: { OPERATIVO: propia.base.app },
      clave: propia.base.clave,
      armar: (db) => ({
        mails: crearMarcasDeMail(
          crearLecturaDeMarcaParaMail(db.withTables<MarcasParaMailDb>()),
          RESPALDO,
        ),
      }),
      maximoDeConexiones: 4,
    });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Pregunta, como la empresa dada, por el tenant dado (con el `ahora` real salvo que se indique otro). */
  async function delTenant(
    empresa: string,
    tenant: string,
    marcaDeEntrada: string,
    ahora: Date = new Date(),
  ): Promise<MarcaDeMailResuelta | null> {
    const r = await entorno.ejecutar(
      { contexto: comoEmpresa(empresaId(empresa), null, marcaComercialId(marcaDeEntrada)) },
      async (tx) => ok(await tx.mails.delTenant(tenantId(tenant), ahora)),
    );
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  }

  /** Un producto con su tenant y su empresa. */
  async function producto() {
    const marca = await crearMarca(dueno, { padre: principal });
    return crearMundoDeMarca(dueno, { marca });
  }

  // ===============================================================================================
  describe("el mail sale con la identidad de la marca del tenant", () => {
    it("un producto con versión vigente y host canónico de su aplicación: su nombre y su dominio", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Mi Calendario" });
      const host = hostAlAzar();
      await crearDominio(dueno, p.marca, { host, canonico: true });
      expect(await delTenant(p.empresa, p.tenant, p.marca)).toEqual({
        nombre: "Mi Calendario",
        urlBase: `https://${host}`,
      });
    });

    it("nunca el nombre ni el dominio de OTRA marca, aunque la principal esté completa", async () => {
      await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "ZuluHub" });
      const hostPrincipal = hostAlAzar();
      await crearDominio(dueno, principal, { host: hostPrincipal, canonico: true });
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Mi Calendario" });
      const hostProducto = hostAlAzar();
      await crearDominio(dueno, p.marca, { host: hostProducto, canonico: true });
      const mundoPrincipal = await crearMundoDeMarca(dueno);

      const delProducto = await delTenant(p.empresa, p.tenant, p.marca);
      expect(delProducto).toEqual({ nombre: "Mi Calendario", urlBase: `https://${hostProducto}` });
      const delaPrincipal = await delTenant(
        mundoPrincipal.empresa,
        mundoPrincipal.tenant,
        principal,
      );
      expect(delaPrincipal).toEqual({ nombre: "ZuluHub", urlBase: `https://${hostPrincipal}` });
    });

    it("la última versión vigente manda: el nombre es el de la de mayor número", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Nombre viejo" });
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Nombre nuevo" });
      const host = hostAlAzar();
      await crearDominio(dueno, p.marca, { host, canonico: true });
      expect((await delTenant(p.empresa, p.tenant, p.marca))?.nombre).toBe("Nombre nuevo");
    });

    it("una versión programada no cuenta hasta que empieza: rige la vigente", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Vigente" });
      await crearVersionDeMarcaConfirmada(dueno, p.marca, {
        nombreVisible: "Futura",
        desdeSegundos: 3600,
      });
      await crearDominio(dueno, p.marca, { canonico: true });
      expect((await delTenant(p.empresa, p.tenant, p.marca))?.nombre).toBe("Vigente");
    });

    it("el `ahora` del llamador manda sobre la vigencia: antes de que empiece la versión no hay nombre", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Desde hace un rato" });
      await crearDominio(dueno, p.marca, { canonico: true });
      const haceUnaHora = new Date(Date.now() - 3_600_000);
      expect(await delTenant(p.empresa, p.tenant, p.marca, haceUnaHora)).toBeNull();
      expect(await delTenant(p.empresa, p.tenant, p.marca)).not.toBeNull();
    });
  });

  // ===============================================================================================
  describe("a un producto al que le falta algo no se le presta la identidad de otra marca", () => {
    it.each([
      ["sin versión ni dominio", false, false],
      ["con versión pero sin host canónico", true, false],
      ["con host canónico pero sin versión", false, true],
    ])("un producto %s: null (ni el respaldo ni la principal)", async (_c, conVersion, conHost) => {
      await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "ZuluHub" });
      const p = await producto();
      if (conVersion) {
        await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Mi Calendario" });
      }
      if (conHost) await crearDominio(dueno, p.marca, { canonico: true });
      expect(await delTenant(p.empresa, p.tenant, p.marca)).toBeNull();
    });

    it("una versión del producto SIN nombre no hereda el de la principal", async () => {
      await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "ZuluHub" });
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { tema: { primary: "#112233" } });
      await crearDominio(dueno, p.marca, { canonico: true });
      expect(await delTenant(p.empresa, p.tenant, p.marca)).toBeNull();
    });

    it("el host de otra superficie, el que no es canónico y el que no está activo no sirven de origen", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Mi Calendario" });
      await crearDominio(dueno, p.marca, { superficie: "CARTA", canonico: true });
      await crearDominio(dueno, p.marca, { canonico: false });
      await crearDominio(dueno, p.marca, { canonico: true, estado: "PENDIENTE_VERIFICACION" });
      expect(await delTenant(p.empresa, p.tenant, p.marca)).toBeNull();
    });

    it("un dominio canónico que vuelve a pendiente deja de ser el origen de los enlaces", async () => {
      const p = await producto();
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "Mi Calendario" });
      const d = await crearDominio(dueno, p.marca, { canonico: true });
      expect(await delTenant(p.empresa, p.tenant, p.marca)).not.toBeNull();
      await dueno.query(
        "update dominio set estado = 'PENDIENTE_VERIFICACION', verificado_en = null where id = $1",
        [d.id],
      );
      expect(await delTenant(p.empresa, p.tenant, p.marca)).toBeNull();
    });
  });

  // ===============================================================================================
  describe("el respaldo es solo de la marca principal", () => {
    /** Una base sin nada de la principal, para ver qué hace el respaldo; `preparar` la deja como se quiera. */
    async function conPrincipalDe(
      preparar: (c: pg.Client, principal: string) => Promise<void>,
    ): Promise<MarcaDeMailResuelta | null> {
      if (base === null) throw new Error("sin base");
      const aparte = await crearBaseAparte(base);
      const c = new pg.Client({ connectionString: aparte.base.dueno });
      await c.connect();
      const e = crearTransacciones<Tx>({
        urls: { OPERATIVO: aparte.base.app },
        clave: aparte.base.clave,
        armar: (db) => ({
          mails: crearMarcasDeMail(
            crearLecturaDeMarcaParaMail(db.withTables<MarcasParaMailDb>()),
            RESPALDO,
          ),
        }),
      });
      try {
        await preparar(c, await marcaPrincipal(c));
        const m = await crearMundoDeMarca(c);
        const r = await e.ejecutar(
          { contexto: comoEmpresa(empresaId(m.empresa), null, marcaComercialId(m.marca)) },
          async (tx) => ok(await tx.mails.delTenant(tenantId(m.tenant), new Date())),
        );
        if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
        return r.valor;
      } finally {
        await e.cerrar();
        await c.end();
        await aparte.destruir();
      }
    }

    it("la principal sin versión vigente ni host canónico usa las variables, completas", async () => {
      expect(await conPrincipalDe(() => Promise.resolve())).toEqual(RESPALDO);
    });

    it("la principal con versión pero sin host canónico también usa el respaldo (nunca mezcla)", async () => {
      expect(
        await conPrincipalDe(async (c, principalAparte) => {
          await crearVersionDeMarcaConfirmada(c, principalAparte, { nombreVisible: "ZuluHub" });
        }),
      ).toEqual(RESPALDO);
    });

    it("la principal con host canónico pero sin versión también usa el respaldo", async () => {
      expect(
        await conPrincipalDe(async (c, principalAparte) => {
          await crearDominio(c, principalAparte, { canonico: true });
        }),
      ).toEqual(RESPALDO);
    });
  });

  // ===============================================================================================
  describe("aislamiento: solo se ve la marca del tenant del contexto", () => {
    it("pedir otro tenant desde una empresa ajena devuelve null, no la marca de ese tenant", async () => {
      const a = await producto();
      const b = await producto();
      for (const p of [a, b]) {
        await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: `Marca ${p.marca}` });
        await crearDominio(dueno, p.marca, { canonico: true });
      }
      expect(await delTenant(a.empresa, a.tenant, a.marca)).not.toBeNull();
      expect(await delTenant(a.empresa, b.tenant, a.marca)).toBeNull();
      expect(await delTenant(b.empresa, a.tenant, b.marca)).toBeNull();
    });

    it("un tenant inexistente devuelve null", async () => {
      const p = await producto();
      const inexistente: TenantId = tenantId("00000000-0000-4000-8000-00000000dead");
      const r = await entorno.ejecutar(
        { contexto: comoEmpresa(empresaId(p.empresa), null, marcaComercialId(p.marca)) },
        async (tx) => ok(await tx.mails.delTenant(inexistente, new Date())),
      );
      expect(r).toEqual({ ok: true, valor: null });
    });
  });

  // ===============================================================================================
  describe("lecturas y escrituras a la vez", () => {
    it("mientras se confirma la versión y se activa el host, cada lector pasa de «sin identidad» a «con identidad» y no vuelve atrás", async () => {
      const p = await producto();
      const host = hostAlAzar();
      const lectores = Promise.all(
        Array.from({ length: 4 }, async () => {
          const vistas: string[] = [];
          for (let i = 0; i < 25; i++) {
            const r = await delTenant(p.empresa, p.tenant, p.marca);
            vistas.push(r === null ? "n" : r.urlBase === `https://${host}` ? "s" : "?");
          }
          return vistas.join("");
        }),
      );
      await new Promise((resolver) => setTimeout(resolver, 20));
      await crearVersionDeMarcaConfirmada(dueno, p.marca, { nombreVisible: "En medio" });
      await crearDominio(dueno, p.marca, { host, canonico: true });
      for (const secuencia of await lectores) expect(secuencia, secuencia).toMatch(/^n*s*$/);
    });
  });
});
