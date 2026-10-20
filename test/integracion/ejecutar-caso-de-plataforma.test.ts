import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  armarCasosDeLaLista,
  ejecutarCasoDePlataforma,
} from "../../scripts/ejecutar-caso-desde-archivo";
import { armarPlataforma } from "../../src/composicion/plataforma";
import { crearMarcaLista, type MarcaLista } from "./altas-apoyo";
import { crearBaseAparte, cuitAlAzar } from "./entorno";
import { crearAdminDeBase, claveAlAzar } from "./plataforma-apoyo";

/**
 * `ejecutar-caso-de-plataforma` de punta a punta contra una base real, con la puerta de plataforma REAL
 * (`armarPlataforma`): un plan se crea, se arma y se publica, y se da de alta una empresa con él, todo desde
 * archivos, con la clave de idempotencia en el archivo. Repetir no duplica; sin administrador válido, con un
 * caso fuera de la lista o con un archivo mal formado no se escribe nada; y los scripts no imprimen valores del
 * entorno ni cuando fallan.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
const ejecutarArchivo = promisify(execFile);

describe.skipIf(base === null)("ejecutar un caso de plataforma desde un archivo", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let plataforma: ReturnType<typeof armarPlataforma>;
  let entorno: Record<string, string>;
  let marca: MarcaLista;
  let admin: { id: string; email: string };
  const carpeta = mkdtempSync(join(tmpdir(), "pedernal-caso-"));

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = {
      PEDERNAL_DB_PLATAFORMA: propia.base.plataforma,
      PEDERNAL_CLAVE_CONTEXTO: `${base.clave.kid}:${base.clave.secreto.toString("hex")}`,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    };
    plataforma = armarPlataforma({ fuente: () => entorno });
    marca = await crearMarcaLista(dueno);
    admin = await crearAdminDeBase(dueno, { rol: "ADMIN" });
  });
  afterAll(async () => {
    await plataforma.cerrar();
    await dueno.end();
    await propia.destruir();
    rmSync(carpeta, { recursive: true, force: true });
  });

  type Corrida = Awaited<ReturnType<typeof correr>>;

  /** Corre un caso con un archivo en memoria y la puerta real; devuelve el código y lo que imprimió. */
  async function correr(
    caso: string,
    contenido: unknown,
    emailDelAdmin: string = admin.email,
    opciones: { casos?: ReturnType<typeof armarCasosDeLaLista> } = {},
  ) {
    const salida: string[] = [];
    const errores: string[] = [];
    const buscar = vi.fn(plataforma.buscarAdmin);
    const codigo = await ejecutarCasoDePlataforma({
      argumentos: [caso, "archivo.json", "--admin-email", emailDelAdmin],
      entorno,
      leerArchivo: () =>
        Promise.resolve(typeof contenido === "string" ? contenido : JSON.stringify(contenido)),
      ahora: () => new Date(),
      buscarAdmin: buscar,
      casos: opciones.casos ?? armarCasosDeLaLista(plataforma),
      info: (l) => salida.push(l),
      error: (l) => errores.push(l),
    });
    return { codigo, salida, errores, buscar, texto: [...salida, ...errores].join("\n") };
  }

  const n = async (consulta: string, parametros: unknown[] = []) =>
    Number(((await dueno.query<{ n: string }>(consulta, parametros)).rows[0] as { n: string }).n);

  /** Cuántas filas tiene cada tabla que estos casos escriben, para comparar antes y después. */
  const huella = async () => ({
    planes: await n("select count(*)::int as n from plan"),
    versiones: await n("select count(*)::int as n from version_de_plan"),
    tenants: await n("select count(*)::int as n from tenant"),
    empresas: await n("select count(*)::int as n from empresa"),
    invitaciones: await n("select count(*)::int as n from invitacion"),
    trabajos: await n("select count(*)::int as n from trabajo"),
    claves: await n("select count(*)::int as n from idempotencia_plataforma"),
    auditoria: await n("select count(*)::int as n from auditoria_plataforma"),
    auditoriaDeEmpresa: await n("select count(*)::int as n from auditoria_empresa"),
  });

  const idDe = async (consulta: string, parametros: unknown[]) =>
    ((await dueno.query<{ id: string }>(consulta, parametros)).rows[0] as { id: string }).id;

  const lineaDe = (r: Corrida, campo: string) =>
    r.salida.find((l) => l.startsWith(`  ${campo}: `))?.slice(campo.length + 4);

  describe("un recorrido completo: crear un plan, armarlo, publicarlo y dar de alta una empresa con él", () => {
    const codigo = `plan-${randomBytes(3).toString("hex")}`;
    const pedidos = {
      crearPlan: { claveDeIdempotencia: claveAlAzar(), codigo },
      guardarBorradorDePlan: (planId: string) => ({
        claveDeIdempotencia: claveAlAzar(),
        planId,
        versionEsperada: null,
        nombreComercial: "Plan de prueba",
        modulos: [],
        perillas: {},
      }),
      publicarVersionDePlan: (planId: string) => ({
        claveDeIdempotencia: claveAlAzar(),
        planId,
        motivo: "Versión inicial",
      }),
      altaDeEmpresa: (versionDePlanId: string) => ({
        claveDeIdempotencia: claveAlAzar(),
        nombreDeTenant: `tenant-${randomBytes(3).toString("hex")}`,
        marcaId: marca.marca,
        versionDePlanId,
        cuit: cuitAlAzar(),
        razonSocial: "Empresa del recorrido S.A.",
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
        emailGerente: `gerente-${randomBytes(4).toString("hex")}@prueba.test`,
      }),
    };
    let ids: { planId: string; versionId: string };
    let archivos: Record<string, unknown>;

    it("cada caso se ejecuta, deja su constancia con el administrador como actor, y su resultado se lee en castellano", async () => {
      const crear = await correr("crearPlan", pedidos.crearPlan);
      expect(crear.errores).toEqual([]);
      expect(crear.codigo).toBe(0);
      expect(crear.salida[0]).toBe("RESULTADO: OK. Se ejecutó «crearPlan».");
      const planId = lineaDe(crear, "planId") as string;
      expect(planId).toBe(await idDe("select id from plan where codigo = $1", [codigo]));

      const borrador = pedidos.guardarBorradorDePlan(planId);
      const guardar = await correr("guardarBorradorDePlan", borrador);
      expect(guardar.errores).toEqual([]);
      expect(guardar.codigo).toBe(0);

      const publicacion = pedidos.publicarVersionDePlan(planId);
      const publicar = await correr("publicarVersionDePlan", publicacion);
      expect(publicar.errores).toEqual([]);
      expect(publicar.codigo).toBe(0);
      expect(lineaDe(publicar, "numero")).toBe("1");
      const versionId = await idDe(
        "select id from version_de_plan where plan_id = $1 and estado = 'PUBLICADA'",
        [planId],
      );
      ids = { planId, versionId };

      const alta = pedidos.altaDeEmpresa(versionId);
      const darDeAlta = await correr("altaDeEmpresa", alta);
      expect(darDeAlta.errores).toEqual([]);
      expect(darDeAlta.codigo).toBe(0);
      expect(darDeAlta.texto).toMatch(/empresaId: [0-9a-f-]{36}/);
      expect(darDeAlta.texto).not.toContain(alta.emailGerente);
      archivos = {
        crearPlan: pedidos.crearPlan,
        guardarBorradorDePlan: borrador,
        publicarVersionDePlan: publicacion,
        altaDeEmpresa: alta,
      };

      // Lo que quedó en la base: el plan, su versión publicada y una empresa en alta con su invitación en cola.
      const empresa = lineaDe(darDeAlta, "empresaId") as string;
      expect(
        (await dueno.query("select estado from empresa where id = $1", [empresa])).rows,
      ).toEqual([{ estado: "PROVISIONING" }]);
      expect(
        await n(
          "select count(*)::int as n from trabajo where empresa_id = $1 and tipo = 'enviar_invitacion'",
          [empresa],
        ),
      ).toBe(1);
      // La auditoría nombra al administrador que se identificó, no a un actor genérico.
      const actores = (
        await dueno.query<{ actor: string; accion: string }>(
          `select actor, accion from auditoria_plataforma
           where accion in ('PLAN_CREADO', 'PLAN_BORRADOR_GUARDADO', 'PLAN_VERSION_PUBLICADA', 'EMPRESA_ALTA')
             and actor = $1`,
          [admin.id],
        )
      ).rows;
      expect(actores.map((a) => a.accion).sort()).toEqual([
        "EMPRESA_ALTA",
        "PLAN_BORRADOR_GUARDADO",
        "PLAN_CREADO",
        "PLAN_VERSION_PUBLICADA",
      ]);
    });

    it("repetir los mismos comandos con los mismos archivos no duplica nada y lo dice", async () => {
      const antes = await huella();
      for (const caso of [
        "crearPlan",
        "guardarBorradorDePlan",
        "publicarVersionDePlan",
        "altaDeEmpresa",
      ]) {
        const repetido = await correr(caso, archivos[caso]);
        expect(repetido.errores, caso).toEqual([]);
        expect(repetido.codigo, caso).toBe(0);
      }
      expect(await huella()).toEqual(antes);
      const otra = await correr("crearPlan", archivos["crearPlan"]);
      expect(otra.salida.at(-1)).toMatch(/^Nada cambió/);
    });

    it("la misma clave con OTROS datos se rechaza y no escribe", async () => {
      const antes = await huella();
      const r = await correr("crearPlan", {
        ...(archivos["crearPlan"] as object),
        codigo: `${codigo}-otro`,
      });
      expect(r.codigo).toBe(1);
      expect(r.errores.join("\n")).toContain("ya se usó con OTROS datos");
      expect(r.errores.at(-1)).toContain("RECHAZADO");
      expect(await huella()).toEqual(antes);
    });

    it("un rechazo del caso se explica y no deja nada (un plan inexistente)", async () => {
      const antes = await huella();
      const r = await correr("publicarVersionDePlan", {
        claveDeIdempotencia: claveAlAzar(),
        planId: "99999999-9999-4999-8999-999999999999",
        motivo: "no existe",
      });
      expect(r.codigo).toBe(1);
      expect(r.errores.join("\n")).toContain("No se encontró el plan indicado.");
      expect(await huella()).toEqual(antes);
    });

    it("el alta repetida con otra clave pero el mismo CUIT se rechaza con una explicación", async () => {
      const antes = await huella();
      const alta = archivos["altaDeEmpresa"] as { cuit: string };
      const r = await correr("altaDeEmpresa", {
        ...pedidos.altaDeEmpresa(ids.versionId),
        cuit: alta.cuit,
      });
      expect(r.codigo).toBe(1);
      expect(r.errores.join("\n")).toContain("Ya hay una empresa vigente con ese CUIT.");
      expect(await huella()).toEqual(antes);
    });
  });

  describe("sin un administrador válido, o con un pedido que no corresponde, no se ejecuta nada", () => {
    const archivoValido = () => ({
      claveDeIdempotencia: claveAlAzar(),
      codigo: `cero-${randomBytes(3).toString("hex")}`,
    });

    async function noEscribeNada<T>(accion: () => Promise<T>) {
      const antes = await huella();
      const r = await accion();
      expect(await huella()).toEqual(antes);
      return r;
    }

    it("un administrador que no existe", async () => {
      const r = await noEscribeNada(() =>
        correr("crearPlan", archivoValido(), "nadie@prueba.test"),
      );
      expect(r.codigo).toBe(1);
      expect(r.errores[0]).toContain("no existe ningún administrador de plataforma con ese email");
    });

    it("un administrador dado de baja", async () => {
      const baja = await crearAdminDeBase(dueno, { rol: "ADMIN", activo: false });
      const r = await noEscribeNada(() => correr("crearPlan", archivoValido(), baja.email));
      expect(r.codigo).toBe(1);
      expect(r.errores[0]).toContain("dado de baja");
    });

    it("un SOPORTE", async () => {
      const soporte = await crearAdminDeBase(dueno, { rol: "SOPORTE" });
      const r = await noEscribeNada(() => correr("crearPlan", archivoValido(), soporte.email));
      expect(r.codigo).toBe(1);
      expect(r.errores[0]).toContain("no es ADMIN");
    });

    it("un administrador dado de baja entre que se lo busca y que se ejecuta (el guard lo corta igual)", async () => {
      const efimero = await crearAdminDeBase(dueno, { rol: "ADMIN" });
      const casos = armarCasosDeLaLista(plataforma);
      const conBajaEntreMedio = {
        ...casos,
        crearPlan: async (...argumentos: Parameters<typeof casos.crearPlan>) => {
          await dueno.query("update admin_plataforma set activo = false where id = $1", [
            efimero.id,
          ]);
          return casos.crearPlan(...argumentos);
        },
      };
      const r = await noEscribeNada(() =>
        correr("crearPlan", archivoValido(), efimero.email, { casos: conBajaEntreMedio }),
      );
      expect(r.codigo).toBe(1);
      expect(r.errores.join("\n")).toContain("no tiene permiso");
    });

    it.each([
      "suspenderTenant",
      "cancelarAlta",
      "cancelarAltasVencidas",
      "ajustarPerilla",
      "constructor",
    ])("el caso «%s», fuera de la lista, ni siquiera busca al administrador", async (caso) => {
      const r = await noEscribeNada(() => correr(caso, archivoValido()));
      expect(r.codigo).toBe(2);
      expect(r.buscar).not.toHaveBeenCalled();
    });

    it.each([
      ["un JSON roto", "{ roto"],
      ["un campo con otro nombre", { claveDeIdempotencia: claveAlAzar(), codgio: "x" }],
      ["una clave corta", { claveDeIdempotencia: "corta", codigo: "plan-x" }],
    ])(
      "un archivo con %s no busca al administrador ni abre una transacción",
      async (_cual, contenido) => {
        const r = await noEscribeNada(() => correr("crearPlan", contenido));
        expect(r.codigo).toBe(2);
        expect(r.buscar).not.toHaveBeenCalled();
      },
    );

    it("un SOPORTE al que el script dejara pasar igual no podría: el guard del caso y la base lo frenan", async () => {
      // Se saltea la comprobación del script a propósito: el caso y la base son la segunda y la tercera barrera.
      const soporte = await crearAdminDeBase(dueno, { rol: "SOPORTE" });
      const errores: string[] = [];
      const codigo = await noEscribeNada(() =>
        ejecutarCasoDePlataforma({
          argumentos: ["crearPlan", "a.json", "--admin-email", soporte.email],
          entorno,
          leerArchivo: () => Promise.resolve(JSON.stringify(archivoValido())),
          ahora: () => new Date(),
          buscarAdmin: () => Promise.resolve({ id: soporte.id, rol: "ADMIN", activo: true }),
          casos: armarCasosDeLaLista(plataforma),
          info: () => undefined,
          error: (l) => errores.push(l),
        }),
      );
      expect(codigo).toBe(1);
      expect(errores.join("\n")).toContain("no tiene permiso");
    });
  });

  describe("concurrencia: dos ejecuciones simultáneas", () => {
    it("el mismo archivo dos veces a la vez: un solo plan, una sola constancia", async () => {
      const archivo = {
        claveDeIdempotencia: claveAlAzar(),
        codigo: `a-la-vez-${randomBytes(3).toString("hex")}`,
      };
      const antes = await huella();
      const [a, b, c] = await Promise.all([
        correr("crearPlan", archivo),
        correr("crearPlan", archivo),
        correr("crearPlan", archivo),
      ]);
      expect([a.codigo, b.codigo, c.codigo]).toEqual([0, 0, 0]);
      const despues = await huella();
      expect(despues.planes).toBe(antes.planes + 1);
      expect(despues.claves).toBe(antes.claves + 1);
      expect(despues.auditoria).toBe(antes.auditoria + 1);
      expect(new Set([a, b, c].map((r) => lineaDe(r, "planId"))).size).toBe(1);
    });

    it("el mismo plan con dos claves distintas a la vez: uno lo crea y el otro ve que ya existía", async () => {
      const codigoCompartido = `compartido-${randomBytes(3).toString("hex")}`;
      const [a, b] = await Promise.all([
        correr("crearPlan", { claveDeIdempotencia: claveAlAzar(), codigo: codigoCompartido }),
        correr("crearPlan", { claveDeIdempotencia: claveAlAzar(), codigo: codigoCompartido }),
      ]);
      expect([a.codigo, b.codigo]).toEqual([0, 0]);
      expect(
        await n("select count(*)::int as n from plan where codigo = $1", [codigoCompartido]),
      ).toBe(1);
      expect([lineaDe(a, "yaExistia"), lineaDe(b, "yaExistia")].sort()).toEqual(["no", "sí"]);
    });

    it("el mismo alta dos veces a la vez: una empresa, una invitación, un trabajo", async () => {
      const alta = {
        claveDeIdempotencia: claveAlAzar(),
        nombreDeTenant: `tenant-${randomBytes(3).toString("hex")}`,
        marcaId: marca.marca,
        cuit: cuitAlAzar(),
        razonSocial: "Alta simultánea S.A.",
        zonaHoraria: "America/Argentina/Buenos_Aires",
        moneda: "ARS",
        emailGerente: `gerente-${randomBytes(4).toString("hex")}@prueba.test`,
      };
      const antes = await huella();
      const [a, b] = await Promise.all([
        correr("altaDeEmpresa", alta),
        correr("altaDeEmpresa", alta),
      ]);
      expect([a.codigo, b.codigo]).toEqual([0, 0]);
      const despues = await huella();
      expect(despues.empresas).toBe(antes.empresas + 1);
      expect(despues.invitaciones).toBe(antes.invitaciones + 1);
      expect(despues.trabajos).toBe(antes.trabajos + 1);
      expect(lineaDe(a, "empresaId")).toBe(lineaDe(b, "empresaId"));
    });
  });

  describe("los scripts no imprimen valores del entorno (probado arrancando Node de verdad)", () => {
    const comandoDe = (nombre: string) => {
      const scripts = (
        JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
          scripts: Record<string, string>;
        }
      ).scripts;
      const comando = scripts[nombre];
      expect(comando?.startsWith("node ")).toBe(true);
      return (comando as string).split(" ").slice(1);
    };

    const arrancar = async (argumentos: string[], env: Record<string, string>) => {
      try {
        const { stdout, stderr } = await ejecutarArchivo(
          process.execPath,
          [...comandoDe("plataforma:caso"), ...argumentos],
          {
            cwd: join(import.meta.dirname, "../.."),
            env: { NODE_ENV: "test", PATH: process.env["PATH"] ?? "", ...env },
          },
        );
        return { codigo: 0, stdout, stderr };
      } catch (falla) {
        const f = falla as { code: number; stdout: string; stderr: string };
        return { codigo: f.code, stdout: f.stdout, stderr: f.stderr };
      }
    };

    const archivo = (nombre: string, contenido: unknown) => {
      const ruta = join(carpeta, nombre);
      writeFileSync(ruta, typeof contenido === "string" ? contenido : JSON.stringify(contenido));
      return ruta;
    };

    it("arranca con Node sin compilar: ejecuta un caso, es idempotente y no imprime la cadena, la clave ni el secreto", async () => {
      const pedido = {
        claveDeIdempotencia: claveAlAzar(),
        codigo: `node-${randomBytes(3).toString("hex")}`,
      };
      const ruta = archivo("crear-plan.json", pedido);
      const argumentos = ["crearPlan", ruta, "--admin-email", admin.email];
      const antes = await huella();
      const primera = await arrancar(argumentos, entorno);
      expect(primera.stderr).toBe("");
      expect(primera.codigo).toBe(0);
      expect(primera.stdout).toContain("RESULTADO: OK. Se ejecutó «crearPlan».");
      const segunda = await arrancar(argumentos, entorno);
      expect(segunda.codigo).toBe(0);
      expect(segunda.stdout).toContain("Nada cambió");
      expect((await huella()).planes).toBe(antes.planes + 1);
      const claveSecreta = entorno["PEDERNAL_CLAVE_CONTEXTO"]?.split(":")[1] as string;
      for (const texto of [primera.stdout, primera.stderr, segunda.stdout, segunda.stderr]) {
        expect(texto).not.toContain(entorno["PEDERNAL_DB_PLATAFORMA"] as string);
        expect(texto).not.toContain(new URL(propia.base.plataforma).password);
        expect(texto).not.toContain(claveSecreta);
        expect(texto).not.toContain(entorno["PEDERNAL_SECRETO_INVITACIONES"] as string);
        expect(texto).not.toContain(admin.email);
      }
    });

    it("con un valor centinela en cada variable, ni un éxito, ni un archivo roto, ni una base caída lo imprimen", async () => {
      const centinelas = {
        PEDERNAL_DB_PLATAFORMA:
          "postgres://usuario-centinela:contrasena-centinela@127.0.0.1:1/base-centinela",
        PEDERNAL_CLAVE_CONTEXTO: `1:${"ce".repeat(32)}`,
        PEDERNAL_SECRETO_INVITACIONES: "5e".repeat(32),
      };
      const prohibidos = [
        "usuario-centinela",
        "contrasena-centinela",
        "base-centinela",
        "ce".repeat(32),
        "5e".repeat(32),
      ];
      const valido = archivo("ok.json", {
        claveDeIdempotencia: claveAlAzar(),
        codigo: "centinela-1",
      });
      const roto = archivo("roto.json", "{ roto");
      const malFormado = archivo("mal.json", { claveDeIdempotencia: "corta" });
      const escenarios: Array<[string, string[], number]> = [
        ["la base no responde", ["crearPlan", valido, "--admin-email", admin.email], 1],
        ["un archivo roto", ["crearPlan", roto, "--admin-email", admin.email], 2],
        ["un archivo mal formado", ["crearPlan", malFormado, "--admin-email", admin.email], 2],
        ["un caso fuera de la lista", ["suspenderTenant", valido, "--admin-email", admin.email], 2],
        ["sin argumentos", [], 2],
      ];
      for (const [cual, argumentos, esperado] of escenarios) {
        const r = await arrancar(argumentos, centinelas);
        expect(r.codigo, cual).toBe(esperado);
        for (const prohibido of prohibidos) {
          expect(r.stdout, `${cual}: stdout`).not.toContain(prohibido);
          expect(r.stderr, `${cual}: stderr`).not.toContain(prohibido);
        }
      }
    });

    it("sin las variables, falla con un mensaje que nombra solo los NOMBRES que faltan", async () => {
      const r = await arrancar(
        [
          "crearPlan",
          archivo("sin-env.json", { claveDeIdempotencia: claveAlAzar(), codigo: "sin-env" }),
          "--admin-email",
          admin.email,
        ],
        {},
      );
      expect(r.codigo).toBe(1);
      expect(r.stderr).toContain("RESULTADO: FALLA");
      expect(r.stderr).toContain("PEDERNAL_DB_PLATAFORMA falta");
    });
  });
});
