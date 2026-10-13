import pg from "pg";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearResolucionDeHost } from "../../src/adaptadores/postgres/resolucion-de-host";
import { crearTransaccionesPublicas } from "../../src/adaptadores/postgres/transacciones-publicas";
import { empresaId, marcaComercialId } from "../../src/primitivas/identificadores/marca";
import type { SuperficieDeHost } from "../../src/puertos/marcas";
import {
  comoAdminDePlataforma,
  crearCasosDeDominios,
  crearEntornoDeDominios,
} from "./dominios-apoyo";
import { crearBaseAparte } from "./entorno";
import {
  codigoAlAzar,
  crearBorradorDeMarca,
  crearDominio,
  crearDominioDeEmpresa,
  crearMarca,
  crearMundoDeMarca,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";
import { crearEntornoPublico } from "./resolucion-apoyo";

/**
 * Resolución de un host por la puerta pública contra el rol REAL `zuluhub_publico` (M4, marcas y planes
 * §B.2). Lo central: (1) un host solo se sirve si su marca tiene una versión confirmada y vigente (el
 * hueco que dejó M4a: la vista `resolucion_de_host` no lo exige y `activarDominio` tampoco) y (2) todo lo
 * que no se puede servir responde EXACTAMENTE lo mismo, sin pistas de por qué. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("resolución de host por la puerta pública", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoPublico>;
  let resolucion: ReturnType<typeof crearResolucionDeHost>;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoPublico(propia.base);
    resolucion = crearResolucionDeHost(entorno);
    principal = await marcaPrincipal(dueno);
    // La marca principal, servible: si algún host desconocido cayera en ella, estas pruebas lo verían.
    await crearVersionDeMarcaConfirmada(dueno, principal, { nombreVisible: "Principal" });
    await crearDominio(dueno, principal, { canonico: true, host: "app.principal.prueba.test" });
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const NEUTRAL = { ok: true, valor: null } as const;
  const resolver = (host: string, superficie: SuperficieDeHost = "APP") =>
    resolucion.porHost(host, superficie);

  /** Una marca (producto) ACTIVA con su versión vigente y un dominio de aplicación ACTIVO. */
  async function marcaServible(opciones: { host?: string; canonico?: boolean } = {}) {
    const marca = await crearMarca(dueno, { padre: principal });
    await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Marca de prueba" });
    const dominio = await crearDominio(dueno, marca, {
      ...(opciones.host === undefined ? {} : { host: opciones.host }),
      canonico: opciones.canonico ?? false,
    });
    return { marca, ...dominio };
  }

  // ===============================================================================================
  describe("un host servible se resuelve a su dueño y su marca, y a nada más", () => {
    it("devuelve host, superficie, dueño y marca, y solo eso", async () => {
      const m = await marcaServible();
      const r = await resolver(m.host);
      expect(r).toEqual({
        ok: true,
        valor: {
          host: m.host,
          superficie: "APP",
          duenio: { tipo: "MARCA", marcaId: marcaComercialId(m.marca) },
          marcaId: marcaComercialId(m.marca),
        },
      });
      if (!r.ok || r.valor === null) throw new Error("tenía que resolver");
      expect(Object.keys(r.valor).sort()).toEqual(["duenio", "host", "marcaId", "superficie"]);
    });

    it("el host se normaliza antes de buscar: mayúsculas, puerto y punto final resuelven el mismo dominio", async () => {
      const m = await marcaServible({ host: `app${hostAlAzar()}` });
      for (const crudo of [
        m.host.toUpperCase(),
        `${m.host}:443`,
        `${m.host}.`,
        `${m.host.toUpperCase()}.:8080`,
      ]) {
        const r = await resolver(crudo);
        expect(r.ok && r.valor?.host, crudo).toBe(m.host);
      }
    });

    it("un host dedicado de una EMPRESA resuelve con la marca del tenant de la empresa", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Producto" });
      const mundo = await crearMundoDeMarca(dueno, { marca });
      const dedicado = await crearDominioDeEmpresa(dueno, mundo.empresa, { superficie: "CARTA" });
      const r = await resolver(dedicado.host, "CARTA");
      expect(r).toEqual({
        ok: true,
        valor: {
          host: dedicado.host,
          superficie: "CARTA",
          duenio: { tipo: "EMPRESA", empresaId: empresaId(mundo.empresa) },
          marcaId: marcaComercialId(marca),
        },
      });
    });

    it("la misma marca sirve varias superficies, cada una por su host", async () => {
      const m = await marcaServible();
      const landing = await crearDominio(dueno, m.marca, { superficie: "LANDING" });
      expect((await resolver(landing.host, "LANDING")).ok).toBe(true);
      const r = await resolver(landing.host, "LANDING");
      expect(r.ok && r.valor?.superficie).toBe("LANDING");
      expect(r.ok && r.valor?.marcaId).toBe(m.marca);
    });
  });

  // ===============================================================================================
  describe("el hueco de M4a: sin versión confirmada y vigente, el host no se sirve (§B.2.1)", () => {
    it("una marca SIN ninguna versión: su dominio activo igual responde la página neutra", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, marca, { canonico: true }); // ACTIVO
      // La vista de 0007 lo deja pasar (dominio ACTIVO de marca ACTIVA)...
      const { rows } = await dueno.query("select 1 from resolucion_de_host where host = $1", [
        dominio.host,
      ]);
      expect(rows).toHaveLength(1);
      // ...y la resolución, no.
      expect(await resolver(dominio.host)).toEqual(NEUTRAL);
    });

    it("una marca con un BORRADOR sin confirmar tampoco se sirve", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      await crearBorradorDeMarca(dueno, marca, { nombreVisible: "Todavía no" });
      const dominio = await crearDominio(dueno, marca);
      expect(await resolver(dominio.host)).toEqual(NEUTRAL);
    });

    it("una versión confirmada pero PROGRAMADA (futura) no cuenta: recién cuando empieza se sirve", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, marca);
      await crearVersionDeMarcaConfirmada(dueno, marca, { desdeSegundos: 3600 });
      expect(await resolver(dominio.host)).toEqual(NEUTRAL);
      // Cuando una versión ya empezó, el host se sirve (la futura no le quita nada).
      await crearVersionDeMarcaConfirmada(dueno, marca, { desdeSegundos: -30 });
      const r = await resolver(dominio.host);
      expect(r.ok && r.valor?.marcaId).toBe(marca);
    });

    it("al confirmar la primera versión vigente el host pasa de neutral a servido, sin tocar el dominio", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, marca);
      expect(await resolver(dominio.host)).toEqual(NEUTRAL);
      await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Ya sí" });
      const r = await resolver(dominio.host);
      expect(r.ok && r.valor?.host).toBe(dominio.host);
    });

    it("también vale para un host dedicado de empresa: su marca de entrada necesita versión", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const mundo = await crearMundoDeMarca(dueno, { marca });
      const dedicado = await crearDominioDeEmpresa(dueno, mundo.empresa, { superficie: "APP" });
      expect(await resolver(dedicado.host)).toEqual(NEUTRAL);
      await crearVersionDeMarcaConfirmada(dueno, marca, {});
      expect((await resolver(dedicado.host)).ok).toBe(true);
      const r = await resolver(dedicado.host);
      expect(r.ok && r.valor?.duenio.tipo).toBe("EMPRESA");
    });

    it("la versión de OTRA marca no habilita el host (ni la de la principal ni la de su padre)", async () => {
      const hija = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, hija);
      expect(await resolver(dominio.host)).toEqual(NEUTRAL);
    });
  });

  // ===============================================================================================
  describe("todo lo desconocido o no servible responde LO MISMO (neutral, sin oráculo)", () => {
    it("más de una docena de motivos distintos, todos exactamente `ok(null)`", async () => {
      const servible = await marcaServible();

      const pendiente = await crearDominio(dueno, servible.marca, {
        estado: "PENDIENTE_VERIFICACION",
      });
      const verificado = await crearDominio(dueno, servible.marca, { estado: "VERIFICADO" });
      const retirado = await crearDominio(dueno, servible.marca, { estado: "RETIRADO" });
      const sinVersion = await crearMarca(dueno, { padre: principal });
      const deSinVersion = await crearDominio(dueno, sinVersion);
      const retiradaConVersion = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, retiradaConVersion, {});
      const deRetirada = await crearDominio(dueno, retiradaConVersion);
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [retiradaConVersion]);

      const casos: [string, string, SuperficieDeHost][] = [
        ["host desconocido", "no-existe.prueba.test", "APP"],
        ["pendiente de verificación", pendiente.host, "APP"],
        ["verificado pero no activo", verificado.host, "APP"],
        ["retirado", retirado.host, "APP"],
        ["de una marca sin versión", deSinVersion.host, "APP"],
        ["de una marca retirada", deRetirada.host, "APP"],
        ["activo pero de otra superficie", servible.host, "CARTA"],
        ["con sufijo engañoso", `${servible.host}.otro.net`, "APP"],
        ["con prefijo", `x.${servible.host}`, "APP"],
        ["con www. sin alias", `www.${servible.host}`, "APP"],
        ["literal IPv4", "127.0.0.1", "APP"],
        ["literal IPv6", "[::1]", "APP"],
        ["vacío", "", "APP"],
        ["con espacios", `${servible.host} `, "APP"],
        ["no ASCII", "ñandú.prueba.test", "APP"],
        ["internacional sin punycode", "bücher.prueba.test", "APP"],
        ["demasiado largo", `${"a".repeat(64)}.prueba.test`, "APP"],
        ["con barra", `${servible.host}/x`, "APP"],
        ["la principal por omisión (host que no es suyo)", "otra-cosa.principal.test", "APP"],
      ];
      for (const [motivo, host, superficie] of casos) {
        expect(await resolver(host, superficie), motivo).toEqual(NEUTRAL);
      }
      // La respuesta es siempre la misma estructura: no hay un `motivo`, ni un código que distinga.
      const respuestas = await Promise.all(casos.map(([, h, s]) => resolver(h, s)));
      expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
    });

    it("un host desconocido NUNCA cae en la marca principal, aunque la principal esté servible", async () => {
      expect((await resolver("app.principal.prueba.test")).ok).toBe(true);
      for (let i = 0; i < 5; i++) {
        expect(await resolver(hostAlAzar())).toEqual(NEUTRAL);
      }
    });

    it("un host retirado deja de resolverse en la lectura siguiente (no hay caché en el adaptador) y puede volver a registrarse", async () => {
      const m = await marcaServible();
      expect((await resolver(m.host)).ok && (await resolver(m.host))).toMatchObject({
        valor: { host: m.host },
      });
      await dueno.query("update dominio set estado = 'RETIRADO', motivo = 'baja' where id = $1", [
        m.id,
      ]);
      expect(await resolver(m.host)).toEqual(NEUTRAL);
      // Otro cliente toma el host: se sirve su nueva marca, no la anterior.
      const otra = await crearMarca(dueno, { padre: principal });
      await crearVersionDeMarcaConfirmada(dueno, otra, { nombreVisible: "Otra" });
      await crearDominio(dueno, otra, { host: m.host });
      const r = await resolver(m.host);
      expect(r.ok && r.valor?.marcaId).toBe(otra);
    });

    it("un dominio que vuelve a pendiente deja de servirse (la comprobación falló)", async () => {
      const m = await marcaServible();
      expect((await resolver(m.host)).ok).toBe(true);
      await dueno.query(
        "update dominio set estado = 'PENDIENTE_VERIFICACION', verificado_en = null where id = $1",
        [m.id],
      );
      expect(await resolver(m.host)).toEqual(NEUTRAL);
    });

    it("un llamador sin tipos con una superficie inventada también recibe lo neutral, sin tocar la base", async () => {
      const m = await marcaServible();
      expect(await resolver(m.host, "OTRA" as SuperficieDeHost)).toEqual(NEUTRAL);
    });
  });

  // ===============================================================================================
  describe("es una puerta de solo lectura, sin sesión, y un fallo de la base no se disfraza de neutral", () => {
    it("la transacción pública no puede escribir: ni con el permiso (solo lectura) ni sin él (rol sin INSERT)", async () => {
      const r = await entorno.leer(async (tx) => {
        await sql`insert into marca (codigo) values (${codigoAlAzar()})`.execute(tx.db);
        return "escribió";
      });
      expect(r.ok).toBe(false);
      // Postgres chequea la transacción de solo lectura (25006) antes que el permiso (42501).
      expect(!r.ok && r.error.tipo).toMatch(/Inesperado|AccesoDenegado/);
    });

    it("corre con el rol público y sin contexto firmado ni de empresa", async () => {
      const r = await entorno.leer(async (tx) => {
        const { rows } = await sql<{
          rol: string;
          contexto: string | null;
          solo_lectura: string;
        }>`select current_user::text as rol, nullif(current_setting('app.ctx', true), '') as contexto,
                  current_setting('transaction_read_only') as solo_lectura`.execute(tx.db);
        return rows[0];
      });
      expect(r).toEqual({
        ok: true,
        valor: { rol: "zuluhub_publico", contexto: null, solo_lectura: "on" },
      });
    });

    it("con un rol que no existe, vuelve err (nunca ok(null) ni la marca principal)", async () => {
      if (base === null) return;
      // Rol inexistente y no clave mala: el CI levanta Postgres con `trust` (acepta cualquier clave),
      // así que solo el rol que no existe falla igual con autenticación por clave o sin ella.
      const url = new URL(propia.base.publico);
      url.username = "zuluhub_rol_que_no_existe";
      const roto = crearEntornoPublico(propia.base, { url: url.toString() });
      try {
        const r = await crearResolucionDeHost(roto).porHost("cualquiera.prueba.test", "APP");
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error.tipo).toBe("Inesperado");
      } finally {
        await roto.cerrar();
      }
    });

    it("sin cadena de conexión no se construye (falla cerrado, no cae en otra puerta)", () => {
      expect(() => crearTransaccionesPublicas({ url: "", armar: () => ({}) })).toThrowError(
        /puerta pública/,
      );
    });
  });

  // ===============================================================================================
  describe("lecturas y escrituras a la vez", () => {
    it("mientras se confirma la primera versión, cada lector ve neutral y después servido, y nunca vuelve atrás", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const dominio = await crearDominio(dueno, marca);
      const lectores = 4;
      const lecturas = 30;
      const secuencias = Promise.all(
        Array.from({ length: lectores }, async () => {
          const vistas: string[] = [];
          for (let i = 0; i < lecturas; i++) {
            const r = await resolver(dominio.host);
            if (!r.ok) throw new Error(`falló la lectura: ${JSON.stringify(r.error)}`);
            vistas.push(r.valor === null ? "n" : "s");
          }
          return vistas.join("");
        }),
      );
      // El escritor confirma mientras los lectores leen.
      await new Promise((resolverEspera) => setTimeout(resolverEspera, 25));
      await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Entra en medio" });
      const vistas = await secuencias;
      for (const secuencia of vistas) {
        expect(secuencia, secuencia).toMatch(/^n*s*$/);
      }
      // Y después de confirmar, todos los lectores nuevos lo ven.
      expect((await resolver(dominio.host)).ok && (await resolver(dominio.host))).toMatchObject({
        valor: { marcaId: marca },
      });
    });

    it("mientras se retira el dominio, cada lector ve servido y después neutral, y nunca vuelve atrás", async () => {
      const m = await marcaServible();
      const secuencias = Promise.all(
        Array.from({ length: 4 }, async () => {
          const vistas: string[] = [];
          for (let i = 0; i < 30; i++) {
            const r = await resolver(m.host);
            if (!r.ok) throw new Error("falló la lectura");
            vistas.push(r.valor === null ? "n" : "s");
          }
          return vistas.join("");
        }),
      );
      await new Promise((resolverEspera) => setTimeout(resolverEspera, 25));
      await dueno.query("update dominio set estado = 'RETIRADO', motivo = 'baja' where id = $1", [
        m.id,
      ]);
      for (const secuencia of await secuencias) expect(secuencia, secuencia).toMatch(/^s*n*$/);
    });

    it("muchas resoluciones simultáneas de lo mismo dan lo mismo y no agotan el pool", async () => {
      const m = await marcaServible();
      const respuestas = await Promise.all(Array.from({ length: 60 }, () => resolver(m.host)));
      expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(respuestas[0]?.ok && respuestas[0].valor?.host).toBe(m.host);
    });
  });

  // ===============================================================================================
  describe("de punta a punta con los casos de uso de dominios (M4a)", () => {
    it("un dominio agregado, verificado y activado por la plataforma NO se sirve hasta que su marca confirma una versión; retirarlo lo saca", async () => {
      const entornoDeCasos = crearEntornoDeDominios(propia.base, 4);
      const casos = crearCasosDeDominios(entornoDeCasos);
      try {
        const marca = await crearMarca(dueno, { padre: principal });
        const host = hostAlAzar();
        const clave = () => claveAlAzar();
        const agregado = await casos.agregarDominio(comoAdminDePlataforma(), {
          claveDeIdempotencia: clave(),
          host,
          superficie: "APP",
          titular: "OPERADOR",
          esCanonico: false,
          duenio: { tipo: "MARCA", marcaId: marcaComercialId(marca) },
        });
        if (!agregado.ok) throw new Error(`no se pudo agregar: ${JSON.stringify(agregado.error)}`);
        const id = agregado.valor.dominioId;
        const verificado = await casos.verificarDominio(comoAdminDePlataforma(), {
          claveDeIdempotencia: clave(),
          dominioId: id,
          verificadoEn: new Date("2026-10-11T11:00:00.000Z"),
        });
        expect(verificado.ok).toBe(true);
        // Agregado y verificado: nada.
        expect(await resolver(host)).toEqual(NEUTRAL);
        const activado = await casos.activarDominio(comoAdminDePlataforma(), {
          claveDeIdempotencia: clave(),
          dominioId: id,
        });
        expect(activado.ok && activado.valor.estado).toBe("ACTIVO");
        // El caso de uso lo dejó ACTIVO, la vista de 0007 ya lo muestra... y la puerta sigue neutral:
        // la marca todavía no tiene versión confirmada.
        const enVista = await dueno.query("select 1 from resolucion_de_host where host = $1", [
          host,
        ]);
        expect(enVista.rowCount).toBe(1);
        expect(await resolver(host)).toEqual(NEUTRAL);
        // Confirmada la versión 1 de la marca, el host se sirve.
        await crearVersionDeMarcaConfirmada(dueno, marca, { nombreVisible: "Mi producto" });
        const r = await resolver(host);
        expect(r.ok && r.valor?.marcaId).toBe(marca);
        // Retirarlo (la baja del dominio) lo saca de la puerta enseguida.
        const retirado = await casos.retirarDominio(comoAdminDePlataforma(), {
          claveDeIdempotencia: clave(),
          dominioId: id,
          motivo: "se fue el cliente",
        });
        expect(retirado.ok).toBe(true);
        expect(await resolver(host)).toEqual(NEUTRAL);
      } finally {
        await entornoDeCasos.cerrar();
      }
    });
  });
});
