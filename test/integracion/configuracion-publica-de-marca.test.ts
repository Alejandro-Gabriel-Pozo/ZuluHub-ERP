import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearConfiguracionPublicaDeHost } from "../../src/adaptadores/postgres/configuracion-publica-de-marca";
import { crearResolucionDeHost } from "../../src/adaptadores/postgres/resolucion-de-host";
import type { SuperficieDeHost } from "../../src/puertos/marcas";
import { crearBaseAparte } from "./entorno";
import {
  codigoAlAzar,
  confirmarVersionDeMarca,
  crearBorradorDeMarca,
  crearDominio,
  crearDominioDeEmpresa,
  crearMarca,
  crearMundoDeMarca,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
  type DatosDeVersionDeMarca,
} from "./marcas-apoyo";
import { crearEntornoPublico } from "./resolucion-apoyo";

/**
 * Configuración pública de la marca de un host (M4b, marcas y planes §B.2.3) contra el rol REAL
 * `zuluhub_publico`: nombre, tema validado con herencia y host canónico, y NADA más. Lo central:
 *  (1) el mismo criterio que la resolución del host (lo no servible responde igual que «no existe»);
 *  (2) aislamiento entre marcas (el tema de B nunca sale en un host de A);
 *  (3) cada lectura es UNA foto de la base: una versión nueva que se confirma en medio se ve entera o no
 *      se ve, nunca a medias. Base propia.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const NEUTRAL = { ok: true, valor: null } as const;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const TEMA_PRINCIPAL = {
  primary: "#101010",
  "on-primary": "#ffffff",
  secondary: "#202020",
  accent: "#303030",
} as const;

describe.skipIf(base === null)("configuración pública de la marca de un host", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoPublico>;
  let puerto: ReturnType<typeof crearConfiguracionPublicaDeHost>;
  let resolucion: ReturnType<typeof crearResolucionDeHost>;
  let principal: string;
  let hostDeLaPrincipal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoPublico(propia.base);
    puerto = crearConfiguracionPublicaDeHost(entorno);
    resolucion = crearResolucionDeHost(entorno);
    principal = await marcaPrincipal(dueno);
    // La marca principal, servible y con todo el tema: si algún host ajeno cayera en ella, se vería.
    await crearVersionDeMarcaConfirmada(dueno, principal, {
      nombreVisible: "Principal",
      tema: TEMA_PRINCIPAL,
    });
    hostDeLaPrincipal = "app.principal.prueba.test";
    await crearDominio(dueno, principal, { canonico: true, host: hostDeLaPrincipal });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const leer = async (host: string, superficie: SuperficieDeHost = "APP") => {
    const r = await puerto.porHost(host, superficie);
    if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  /** Una marca con su versión vigente y, si se pide, su host canónico de aplicación; devuelve sus hosts. */
  async function marca(
    opciones: {
      padre?: string | null;
      datos?: DatosDeVersionDeMarca;
      canonico?: boolean;
      alias?: boolean;
    } = {},
  ) {
    const id = await crearMarca(dueno, {
      padre: opciones.padre === undefined ? principal : opciones.padre,
    });
    await crearVersionDeMarcaConfirmada(dueno, id, {
      nombreVisible: `Marca ${codigoAlAzar("n")}`,
      ...opciones.datos,
    });
    const canonico =
      opciones.canonico === false ? null : await crearDominio(dueno, id, { canonico: true });
    const alias = opciones.alias === true ? await crearDominio(dueno, id) : null;
    return { id, canonico: canonico?.host ?? null, alias: alias?.host ?? null };
  }

  // ===============================================================================================
  describe("un host servible devuelve nombre, tema y host canónico, y nada más", () => {
    it("la forma exacta, sin ningún identificador interno", async () => {
      const m = await marca({ datos: { nombreVisible: "Mi Calendario", tema: TEMA_PRINCIPAL } });
      const r = await leer(m.canonico as string);
      expect(r).toEqual({
        nombre: "Mi Calendario",
        tema: TEMA_PRINCIPAL,
        hostCanonico: m.canonico,
      });
      expect(Object.keys(r ?? {}).sort()).toEqual(["hostCanonico", "nombre", "tema"]);
      expect(JSON.stringify(r)).not.toMatch(UUID);
    });

    it("el host se normaliza antes de buscar: mayúsculas, puerto y punto final dan lo mismo", async () => {
      const m = await marca({ datos: { nombreVisible: "Normal" } });
      const host = m.canonico as string;
      const esperado = await leer(host);
      expect(esperado?.nombre).toBe("Normal");
      for (const crudo of [
        host.toUpperCase(),
        `${host}:443`,
        `${host}.`,
        `${host.toUpperCase()}.:8080`,
      ]) {
        expect(await leer(crudo), crudo).toEqual(esperado);
      }
    });

    it("un host dedicado de una EMPRESA da la configuración de la marca del tenant, sin rastro de la empresa", async () => {
      const m = await marca({ datos: { nombreVisible: "Producto" } });
      const mundo = await crearMundoDeMarca(dueno, { marca: m.id });
      const dedicado = await crearDominioDeEmpresa(dueno, mundo.empresa, { superficie: "APP" });
      const r = await leer(dedicado.host);
      expect(r).toEqual({
        nombre: "Producto",
        tema: TEMA_PRINCIPAL,
        hostCanonico: m.canonico,
      });
      const texto = JSON.stringify(r);
      expect(texto).not.toContain(mundo.empresa);
      expect(texto).not.toContain(mundo.tenant);
      expect(texto).not.toMatch(UUID);
    });

    it("la misma marca da la misma configuración en cada superficie que sirve", async () => {
      const m = await marca({ datos: { nombreVisible: "Varias" }, alias: true });
      const landing = await crearDominio(dueno, m.id, { superficie: "LANDING" });
      const carta = await crearDominio(dueno, m.id, { superficie: "CARTA" });
      const deLaApp = await leer(m.canonico as string, "APP");
      expect(await leer(landing.host, "LANDING")).toEqual(deLaApp);
      expect(await leer(carta.host, "CARTA")).toEqual(deLaApp);
      expect(await leer(m.alias as string, "APP")).toEqual(deLaApp);
    });
  });

  // ===============================================================================================
  describe("el host canónico es el de la aplicación de LA MISMA marca, activo", () => {
    it("consultando un alias, o el host de la landing, devuelve el canónico (no el consultado)", async () => {
      const m = await marca({ alias: true });
      const landing = await crearDominio(dueno, m.id, { superficie: "LANDING" });
      expect((await leer(m.alias as string))?.hostCanonico).toBe(m.canonico);
      expect((await leer(landing.host, "LANDING"))?.hostCanonico).toBe(m.canonico);
      expect(m.alias).not.toBe(m.canonico);
    });

    it("sin dominio canónico, hostCanonico es null y el resto se sirve igual", async () => {
      const m = await marca({ canonico: false });
      const alias = await crearDominio(dueno, m.id);
      const r = await leer(alias.host);
      expect(r).toMatchObject({ hostCanonico: null });
      expect(r?.nombre).toBeTruthy();
    });

    it("un canónico que todavía no está ACTIVO no se publica (la política del rol público solo ve activos)", async () => {
      const m = await marca({ canonico: false });
      const alias = await crearDominio(dueno, m.id);
      const pendiente = await crearDominio(dueno, m.id, {
        canonico: true,
        estado: "PENDIENTE_VERIFICACION",
      });
      expect((await leer(alias.host))?.hostCanonico).toBeNull();
      await dueno.query(
        "update dominio set estado = 'VERIFICADO', verificado_en = now() where id = $1",
        [pendiente.id],
      );
      expect((await leer(alias.host))?.hostCanonico).toBeNull();
      await dueno.query("update dominio set estado = 'ACTIVO' where id = $1", [pendiente.id]);
      expect((await leer(alias.host))?.hostCanonico).toBe(pendiente.host);
    });

    it("el canónico de OTRA superficie (landing, carta) no es el de la aplicación", async () => {
      const m = await marca({ canonico: false });
      const alias = await crearDominio(dueno, m.id);
      await crearDominio(dueno, m.id, { superficie: "LANDING", canonico: true });
      await crearDominio(dueno, m.id, { superficie: "CARTA", canonico: true });
      expect((await leer(alias.host))?.hostCanonico).toBeNull();
    });

    it("no se hereda: un producto sin canónico propio no toma el de su marca padre", async () => {
      const hijo = await marca({ canonico: false });
      const alias = await crearDominio(dueno, hijo.id);
      // La principal sí tiene canónico, y el hijo cuelga de ella.
      expect((await leer(hostDeLaPrincipal))?.hostCanonico).toBe(hostDeLaPrincipal);
      expect((await leer(alias.host))?.hostCanonico).toBeNull();
    });
  });

  // ===============================================================================================
  describe("aislamiento: el host de una marca NUNCA devuelve la configuración de otra", () => {
    it("tres marcas, una hija de otra: cada host da lo suyo y solo lo suyo", async () => {
      const a = await marca({
        datos: { nombreVisible: "Marca A", tema: { primary: "#aa0000", accent: "#aa0001" } },
        alias: true,
      });
      const b = await marca({
        datos: {
          nombreVisible: "Marca B",
          tema: {
            primary: "#00bb00",
            "on-primary": "#00bb01",
            secondary: "#00bb02",
            accent: "#00bb03",
          },
        },
        alias: true,
      });
      const hijaDeA = await marca({
        padre: a.id,
        datos: { nombreVisible: "Hija de A", tema: { secondary: "#cc0000" } },
      });

      const deA = await leer(a.canonico as string);
      const deB = await leer(b.canonico as string);
      const deLaHija = await leer(hijaDeA.canonico as string);

      // A hereda de la principal lo que no define; jamás nada de B.
      expect(deA).toEqual({
        nombre: "Marca A",
        tema: { ...TEMA_PRINCIPAL, primary: "#aa0000", accent: "#aa0001" },
        hostCanonico: a.canonico,
      });
      expect(deB).toEqual({
        nombre: "Marca B",
        tema: {
          primary: "#00bb00",
          "on-primary": "#00bb01",
          secondary: "#00bb02",
          accent: "#00bb03",
        },
        hostCanonico: b.canonico,
      });
      // La hija de A hereda de A (y por A, de la principal), nunca de B.
      expect(deLaHija).toEqual({
        nombre: "Hija de A",
        tema: { ...TEMA_PRINCIPAL, primary: "#aa0000", accent: "#aa0001", secondary: "#cc0000" },
        hostCanonico: hijaDeA.canonico,
      });
      // Los alias dan lo mismo que su canónico.
      expect(await leer(a.alias as string)).toEqual(deA);
      expect(await leer(b.alias as string)).toEqual(deB);

      // Ningún color de B aparece en las respuestas de A ni de su hija, y viceversa.
      for (const respuesta of [deA, deLaHija]) {
        expect(JSON.stringify(respuesta)).not.toMatch(/#00bb0/);
        expect(JSON.stringify(respuesta)).not.toContain("Marca B");
        expect(respuesta?.hostCanonico).not.toBe(b.canonico);
      }
      expect(JSON.stringify(deB)).not.toMatch(/#aa000|#cc0000/);
      expect(JSON.stringify(deB)).not.toContain("Marca A");
    });

    it("dos marcas hermanas que heredan de la principal no se ven entre sí ni se mezclan al pedir seguido", async () => {
      const x = await marca({
        datos: { nombreVisible: "Hermana X", tema: { primary: "#0000a1" } },
      });
      const y = await marca({
        datos: { nombreVisible: "Hermana Y", tema: { primary: "#0000b2" } },
      });
      for (let i = 0; i < 5; i++) {
        expect((await leer(x.canonico as string))?.tema.primary).toBe("#0000a1");
        expect((await leer(y.canonico as string))?.tema.primary).toBe("#0000b2");
      }
    });

    it("un host dedicado de empresa de la marca X no da la configuración de la marca Y", async () => {
      const x = await marca({ datos: { nombreVisible: "Dueña X", tema: { primary: "#0000a1" } } });
      const y = await marca({ datos: { nombreVisible: "Vecina Y", tema: { primary: "#0000b2" } } });
      const mundo = await crearMundoDeMarca(dueno, { marca: x.id });
      const dedicado = await crearDominioDeEmpresa(dueno, mundo.empresa, { superficie: "APP" });
      const r = await leer(dedicado.host);
      expect(r?.nombre).toBe("Dueña X");
      expect(r?.hostCanonico).toBe(x.canonico);
      expect(JSON.stringify(r)).not.toContain(y.canonico as string);
    });

    it("el tema de la principal no se cuela en una marca sin ancestros (su propio tema manda y nada más)", async () => {
      const raiz = await marca({
        padre: null,
        datos: { nombreVisible: "Raíz", tema: { primary: "#0000c3" } },
      });
      expect((await leer(raiz.canonico as string))?.tema).toEqual({ primary: "#0000c3" });
    });
  });

  // ===============================================================================================
  describe("herencia del tema y versión que rige", () => {
    it("tres niveles (marca, padre, abuelo): cada token sale del primero que lo define", async () => {
      const abuelo = await marca({
        padre: null,
        datos: {
          nombreVisible: "Abuelo",
          tema: { secondary: "#000004", accent: "#000005", "on-primary": "#000006" },
        },
      });
      const padre = await marca({
        padre: abuelo.id,
        datos: { nombreVisible: "Padre", tema: { primary: "#000002", accent: "#000003" } },
      });
      const hijo = await marca({
        padre: padre.id,
        datos: { nombreVisible: "Hijo", tema: { primary: "#000001" } },
      });
      expect((await leer(hijo.canonico as string))?.tema).toEqual({
        primary: "#000001",
        accent: "#000003",
        secondary: "#000004",
        "on-primary": "#000006",
      });
    });

    it("el nombre es el propio: una versión sin nombre NO se sirve ni toma el del padre", async () => {
      const sinNombre = await marca({ datos: { nombreVisible: null } });
      expect(await leer(sinNombre.canonico as string)).toBeNull();
      expect(await leer(hostDeLaPrincipal)).not.toBeNull();
    });

    it("rige la versión de mayor número que ya empezó; una programada o un borrador no cuentan", async () => {
      const m = await marca({
        datos: { nombreVisible: "Uno", tema: { primary: "#000001", accent: "#0000a1" } },
      });
      expect((await leer(m.canonico as string))?.nombre).toBe("Uno");
      await crearVersionDeMarcaConfirmada(dueno, m.id, {
        nombreVisible: "Futura",
        desdeSegundos: 3600,
      });
      const borrador = await crearBorradorDeMarca(dueno, m.id, {
        nombreVisible: "Dos",
        tema: { primary: "#000002" },
      });
      expect((await leer(m.canonico as string))?.nombre).toBe("Uno");
      await confirmarVersionDeMarca(dueno, borrador);
      const r = await leer(m.canonico as string);
      expect(r?.nombre).toBe("Dos");
      // Las versiones no se mezclan: el accent de la versión 1 no pasa a la 2 (lo hereda de la principal).
      expect(r?.tema).toEqual({ ...TEMA_PRINCIPAL, primary: "#000002" });
    });

    it("un ancestro RETIRADO corta la herencia (la política pública solo ve marcas activas): lo propio se sirve igual", async () => {
      const padre = await marca({
        datos: { nombreVisible: "Padre", tema: { secondary: "#000004" } },
      });
      const hijo = await marca({
        padre: padre.id,
        datos: { nombreVisible: "Hijo", tema: { primary: "#000001" } },
      });
      expect((await leer(hijo.canonico as string))?.tema).toMatchObject({ secondary: "#000004" });
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [padre.id]);
      // Sin el padre ni la principal: queda solo lo que el hijo define.
      expect(await leer(hijo.canonico as string)).toEqual({
        nombre: "Hijo",
        tema: { primary: "#000001" },
        hostCanonico: hijo.canonico,
      });
    });
  });

  // ===============================================================================================
  describe("lo no servible responde LO MISMO que «no existe», igual que la resolución del host", () => {
    it("una docena y media de motivos, todos exactamente `ok(null)` y de acuerdo con la resolución", async () => {
      const servible = await marca({ alias: true });
      const pendiente = await crearDominio(dueno, servible.id, {
        estado: "PENDIENTE_VERIFICACION",
      });
      const verificado = await crearDominio(dueno, servible.id, { estado: "VERIFICADO" });
      const retirado = await crearDominio(dueno, servible.id, { estado: "RETIRADO" });
      const sinVersion = await crearMarca(dueno, { padre: principal });
      const deSinVersion = await crearDominio(dueno, sinVersion);
      const conBorrador = await crearMarca(dueno, { padre: principal });
      await crearBorradorDeMarca(dueno, conBorrador, { nombreVisible: "Todavía no" });
      const deBorrador = await crearDominio(dueno, conBorrador);
      const soloProgramada = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, soloProgramada, { desdeSegundos: 3600 });
      const deProgramada = await crearDominio(dueno, soloProgramada);
      const archivada = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, archivada, { nombreVisible: "Archivada" });
      const deArchivada = await crearDominio(dueno, archivada, { canonico: true });
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [archivada]);
      const sinNombre = await marca({ datos: { nombreVisible: null } });

      const casos: [string, string, SuperficieDeHost][] = [
        ["host desconocido", "no-existe.prueba.test", "APP"],
        ["pendiente de verificación", pendiente.host, "APP"],
        ["verificado pero no activo", verificado.host, "APP"],
        ["retirado", retirado.host, "APP"],
        ["de una marca sin versión", deSinVersion.host, "APP"],
        ["de una marca con solo un borrador", deBorrador.host, "APP"],
        ["de una marca con solo una versión programada", deProgramada.host, "APP"],
        ["de una marca archivada", deArchivada.host, "APP"],
        ["de una marca sin nombre que mostrar", sinNombre.canonico as string, "APP"],
        ["activo pero de otra superficie", servible.canonico as string, "LANDING"],
        ["con sufijo engañoso", `${servible.canonico}.otro.net`, "APP"],
        ["con prefijo", `x.${servible.canonico}`, "APP"],
        ["con www. sin alias", `www.${servible.canonico}`, "APP"],
        ["literal IPv4", "127.0.0.1", "APP"],
        ["literal IPv6", "[::1]", "APP"],
        ["vacío", "", "APP"],
        ["con espacios", `${servible.canonico} `, "APP"],
        ["no ASCII", "ñandú.prueba.test", "APP"],
        ["con barra", `${servible.canonico}/x`, "APP"],
        ["una superficie inventada", servible.canonico as string, "OTRA" as SuperficieDeHost],
      ];
      for (const [motivo, host, superficie] of casos) {
        expect(await puerto.porHost(host, superficie), motivo).toEqual(NEUTRAL);
      }
      // La respuesta es siempre la misma estructura: nada que distinga un motivo de otro.
      const respuestas = await Promise.all(casos.map(([, h, s]) => puerto.porHost(h, s)));
      expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);

      // Y la resolución del host dice lo mismo en cada caso, salvo el que no se puede nombrar (la resolución
      // solo mira que haya versión; la configuración, además, que se pueda mostrar el nombre).
      for (const [motivo, host, superficie] of casos) {
        if (motivo === "de una marca sin nombre que mostrar") continue;
        expect(await resolucion.porHost(host, superficie), motivo).toEqual(NEUTRAL);
      }
    });

    it("la configuración y la resolución sirven exactamente los mismos hosts", async () => {
      const m = await marca({ alias: true });
      const dedicado = await crearDominioDeEmpresa(
        dueno,
        (await crearMundoDeMarca(dueno, { marca: m.id })).empresa,
        { superficie: "CARTA" },
      );
      const landing = await crearDominio(dueno, m.id, { superficie: "LANDING" });
      for (const [host, superficie] of [
        [m.canonico as string, "APP"],
        [m.alias as string, "APP"],
        [landing.host, "LANDING"],
        [dedicado.host, "CARTA"],
        [m.canonico as string, "CARTA"],
        [dedicado.host, "APP"],
        [hostAlAzar(), "APP"],
      ] as [string, SuperficieDeHost][]) {
        const resuelto = await resolucion.porHost(host, superficie);
        const configurado = await puerto.porHost(host, superficie);
        expect(resuelto.ok && configurado.ok, `${host} ${superficie}`).toBe(true);
        expect(resuelto.ok && resuelto.valor !== null, `${host} ${superficie}`).toBe(
          configurado.ok && configurado.valor !== null,
        );
      }
    });

    it("un host retirado deja de dar configuración en la lectura siguiente y su marca no se confunde con la del nuevo titular", async () => {
      const vieja = await marca({ datos: { nombreVisible: "Marca vieja" } });
      expect((await leer(vieja.canonico as string))?.nombre).toBe("Marca vieja");
      // Un canónico no se retira (lo impide la base): se retira el alias.
      const alias = await crearDominio(dueno, vieja.id);
      await dueno.query("update dominio set estado = 'RETIRADO', motivo = 'baja' where id = $1", [
        alias.id,
      ]);
      expect(await leer(alias.host)).toBeNull();
      // Otro cliente toma el host: se sirve su nueva marca, no la anterior.
      const nueva = await marca({ datos: { nombreVisible: "Marca nueva" }, canonico: false });
      await crearDominio(dueno, nueva.id, { host: alias.host });
      const r = await leer(alias.host);
      expect(r?.nombre).toBe("Marca nueva");
      expect(r?.hostCanonico).toBeNull();
    });

    it("al confirmar la primera versión el host pasa de neutral a servido, sin tocar el dominio", async () => {
      const id = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, id, { canonico: true });
      expect(await leer(dominio.host)).toBeNull();
      await crearVersionDeMarcaConfirmada(dueno, id, { nombreVisible: "Ya sí" });
      expect(await leer(dominio.host)).toMatchObject({
        nombre: "Ya sí",
        hostCanonico: dominio.host,
      });
    });
  });

  // ===============================================================================================
  describe("cada lectura es de solo lectura, con una sola foto, y sin sesión", () => {
    it("corre en UNA transacción de solo lectura, REPEATABLE READ, con el rol público y sin contexto", async () => {
      const m = await marca();
      const vistas: {
        rol: string;
        lectura: string;
        aislamiento: string;
        contexto: string | null;
      }[] = [];
      let transacciones = 0;
      const espiado = crearEntornoPublico(propia.base, {
        ajustar: (tx) => {
          transacciones += 1;
          return {
            ...tx,
            marcas: {
              ...tx.marcas,
              async configuracionDeHost(host, superficie) {
                const { rows } = await sql<{
                  rol: string;
                  lectura: string;
                  aislamiento: string;
                  contexto: string | null;
                }>`
                  select current_user::text as rol, current_setting('transaction_read_only') as lectura,
                         current_setting('transaction_isolation') as aislamiento,
                         nullif(current_setting('app.ctx', true), '') as contexto`.execute(tx.db);
                vistas.push(rows[0] as (typeof vistas)[number]);
                return tx.marcas.configuracionDeHost(host, superficie);
              },
            },
          };
        },
      });
      try {
        const r = await crearConfiguracionPublicaDeHost(espiado).porHost(
          m.canonico as string,
          "APP",
        );
        expect(r.ok && r.valor?.hostCanonico).toBe(m.canonico);
      } finally {
        await espiado.cerrar();
      }
      expect(transacciones).toBe(1);
      expect(vistas).toEqual([
        { rol: "zuluhub_publico", lectura: "on", aislamiento: "repeatable read", contexto: null },
      ]);
    });

    it("la transacción pública no puede escribir aunque se lo intente desde la lectura de marcas", async () => {
      const r = await entorno.leer(async (tx) => {
        await sql`update dominio set es_canonico = false`.execute(tx.db);
        return "escribió";
      });
      expect(r.ok).toBe(false);
    });

    it("con una clave mala vuelve err (nunca ok(null) ni la marca principal)", async () => {
      if (base === null) return;
      const url = new URL(propia.base.publico);
      url.password = "clave-equivocada";
      const roto = crearEntornoPublico(propia.base, { url: url.toString() });
      try {
        const r = await crearConfiguracionPublicaDeHost(roto).porHost(
          "cualquiera.prueba.test",
          "APP",
        );
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error.tipo).toBe("Inesperado");
      } finally {
        await roto.cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("lecturas contra una escritura de versión nueva: la anterior entera o la nueva entera", () => {
    /**
     * Confirma, en UNA transacción del dueño, una versión nueva (nombre y tema) y, si se pide, el host
     * canónico de la aplicación: lo que cambia entre «antes» y «después» toca las tres consultas de la lectura.
     */
    async function confirmarEntera(
      marcaId: string,
      datos: { nombre: string; tema: Record<string, string>; canonico?: string },
    ): Promise<void> {
      await dueno.query("begin");
      try {
        const borrador = await crearBorradorDeMarca(dueno, marcaId, {
          nombreVisible: datos.nombre,
          tema: datos.tema,
        });
        await confirmarVersionDeMarca(dueno, borrador);
        if (datos.canonico !== undefined) {
          await crearDominio(dueno, marcaId, { canonico: true, host: datos.canonico });
        }
        await dueno.query("commit");
      } catch (error) {
        await dueno.query("rollback");
        throw error;
      }
    }

    it.each([1, 2, 3, 4])(
      "si la escritura se confirma justo después de la consulta %i de la lectura, la lectura sigue viendo la foto de antes ENTERA",
      async (corte) => {
        const m = await marca({
          canonico: false,
          datos: { nombreVisible: "Viejo", tema: { primary: "#000001" } },
        });
        const alias = await crearDominio(dueno, m.id);
        const nuevoCanonico = hostAlAzar();
        let escrito = false;
        const entornoConCorte = crearEntornoPublico(propia.base, {
          alTerminarConsulta: async (n) => {
            if (n === corte && !escrito) {
              escrito = true;
              await confirmarEntera(m.id, {
                nombre: "Nuevo",
                tema: { primary: "#000002" },
                canonico: nuevoCanonico,
              });
            }
          },
        });
        try {
          const durante = await crearConfiguracionPublicaDeHost(entornoConCorte).porHost(
            alias.host,
            "APP",
          );
          expect(escrito).toBe(true);
          // La foto de antes, entera: ni el nombre nuevo, ni el tema nuevo, ni el canónico nuevo.
          expect(durante).toEqual({
            ok: true,
            valor: {
              nombre: "Viejo",
              tema: { ...TEMA_PRINCIPAL, primary: "#000001" },
              hostCanonico: null,
            },
          });
          // Y la lectura siguiente ve la nueva, entera.
          expect(await leer(alias.host)).toEqual({
            nombre: "Nuevo",
            tema: { ...TEMA_PRINCIPAL, primary: "#000002" },
            hostCanonico: nuevoCanonico,
          });
        } finally {
          await entornoConCorte.cerrar();
        }
      },
    );

    it("lo mismo si lo que se confirma en medio es el retiro de la marca: la lectura en curso no queda a medias", async () => {
      const m = await marca({ datos: { nombreVisible: "Se va" } });
      let escrito = false;
      const entornoConCorte = crearEntornoPublico(propia.base, {
        alTerminarConsulta: async (n) => {
          if (n === 2 && !escrito) {
            escrito = true;
            await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m.id]);
          }
        },
      });
      try {
        const durante = await crearConfiguracionPublicaDeHost(entornoConCorte).porHost(
          m.canonico as string,
          "APP",
        );
        expect(escrito).toBe(true);
        expect(durante).toMatchObject({
          ok: true,
          valor: { nombre: "Se va", hostCanonico: m.canonico },
        });
        expect(await leer(m.canonico as string)).toBeNull();
      } finally {
        await entornoConCorte.cerrar();
      }
    });

    it("lectores en bucle contra una secuencia de versiones: cada lectura es alguna de las versiones, entera, y nunca se vuelve atrás", async () => {
      const m = await marca({
        canonico: false,
        datos: { nombreVisible: "N1", tema: { primary: "#000001" } },
      });
      const alias = await crearDominio(dueno, m.id);
      const canonico = hostAlAzar();
      const colores = ["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"];
      // El estado esperado de cada versión k (1 a 6): el canónico aparece con la versión 3.
      const estado = (k: number) =>
        JSON.stringify({
          nombre: `N${k}`,
          tema: { ...TEMA_PRINCIPAL, primary: colores[k - 1] },
          hostCanonico: k >= 3 ? canonico : null,
        });
      const conocidos = [1, 2, 3, 4, 5, 6].map(estado);

      let terminoElEscritor = false;
      const lector = async () => {
        const vistas: number[] = [];
        for (let i = 0; i < 400 && (!terminoElEscritor || i < 8); i++) {
          const r = await leer(alias.host);
          const k = conocidos.indexOf(JSON.stringify(r));
          if (k === -1) throw new Error(`lectura a medias: ${JSON.stringify(r)}`);
          vistas.push(k);
        }
        return vistas;
      };
      const lectores = Promise.all([lector(), lector(), lector(), lector()]);
      for (let k = 2; k <= 6; k++) {
        await new Promise((r) => setTimeout(r, 15));
        await confirmarEntera(m.id, {
          nombre: `N${k}`,
          tema: { primary: colores[k - 1] as string },
          ...(k === 3 ? { canonico } : {}),
        });
      }
      terminoElEscritor = true;
      for (const vistas of await lectores) {
        expect(
          [...vistas].sort((a, b) => a - b),
          JSON.stringify(vistas),
        ).toEqual(vistas);
      }
      expect(JSON.stringify(await leer(alias.host))).toBe(conocidos[5]);
    });

    it("mientras se retira el alias, cada lector ve servido y después neutral, y nunca vuelve atrás", async () => {
      const m = await marca({ alias: true });
      const secuencias = Promise.all(
        Array.from({ length: 4 }, async () => {
          const vistas: string[] = [];
          for (let i = 0; i < 40; i++)
            vistas.push((await leer(m.alias as string)) === null ? "n" : "s");
          return vistas.join("");
        }),
      );
      await new Promise((r) => setTimeout(r, 20));
      await dueno.query(
        "update dominio set estado = 'RETIRADO', motivo = 'baja' where host = $1 and estado = 'ACTIVO'",
        [m.alias],
      );
      for (const secuencia of await secuencias) expect(secuencia, secuencia).toMatch(/^s*n*$/);
    });

    it("muchas lecturas simultáneas de lo mismo dan lo mismo y no agotan el pool", async () => {
      const m = await marca({ datos: { nombreVisible: "Muchas" } });
      const respuestas = await Promise.all(
        Array.from({ length: 60 }, () => leer(m.canonico as string)),
      );
      expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(respuestas[0]?.nombre).toBe("Muchas");
    });
  });
});

// =================================================================================================
describe.skipIf(base === null)(
  "un tema inválido en la base cae al neutro (segunda barrera)",
  () => {
    // La base ya impide guardar un tema inválido (`tema_valido`). Para probar la segunda barrera del dominio
    // se saca ese CHECK en una base propia, y recién ahí se inserta lo que la base nunca dejaría pasar.
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoPublico>;
    let principal: string;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      entorno = crearEntornoPublico(propia.base);
      principal = await marcaPrincipal(dueno);
      await crearVersionDeMarcaConfirmada(dueno, principal, {
        nombreVisible: "Principal",
        tema: TEMA_PRINCIPAL,
      });
      await dueno.query("alter table version_de_marca drop constraint version_de_marca_tema_ck");
    });
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const leer = async (host: string) => {
      const r = await crearConfiguracionPublicaDeHost(entorno).porHost(host, "APP");
      if (!r.ok) throw new Error("falló la lectura");
      return r.valor;
    };

    it.each([
      ["un color de tres dígitos", { primary: "#fff" }],
      ["CSS libre", { primary: "url(javascript:alert(1))" }],
      ["una clave fuera de la lista", { fondo: "#112233" }],
      ["un valor que no es texto", { primary: 123 }],
    ])(
      "el tema propio con %s deja el tema neutro (vacío), aunque la principal tenga uno completo",
      async (_m, temaMalo) => {
        const id = await crearMarca(dueno, { padre: principal });
        const host = (await crearDominio(dueno, id, { canonico: true })).host;
        await crearVersionDeMarcaConfirmada(dueno, id, {
          nombreVisible: "Con tema roto",
          tema: temaMalo as unknown as Record<string, string>,
        });
        expect(await leer(host)).toEqual({ nombre: "Con tema roto", tema: {}, hostCanonico: host });
      },
    );

    it("el tema inválido de un ANCESTRO también deja el tema neutro (nunca el de otra marca)", async () => {
      const padre = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, padre, {
        nombreVisible: "Padre",
        tema: { secondary: "rojo" },
      });
      const hijo = await crearMarca(dueno, { padre });
      const host = (await crearDominio(dueno, hijo, { canonico: true })).host;
      await crearVersionDeMarcaConfirmada(dueno, hijo, {
        nombreVisible: "Hijo",
        tema: { primary: "#000001" },
      });
      expect(await leer(host)).toEqual({ nombre: "Hijo", tema: {}, hostCanonico: host });
    });

    it("un tema válido sigue pasando intacto en la misma base", async () => {
      const id = await crearMarca(dueno, { padre: principal });
      const host = (await crearDominio(dueno, id, { canonico: true })).host;
      await crearVersionDeMarcaConfirmada(dueno, id, {
        nombreVisible: "Sano",
        tema: { primary: "#000001" },
      });
      expect(await leer(host)).toEqual({
        nombre: "Sano",
        tema: { ...TEMA_PRINCIPAL, primary: "#000001" },
        hostCanonico: host,
      });
    });
  },
);
