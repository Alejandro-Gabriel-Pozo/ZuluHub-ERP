import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  accionesParaElegir,
  archivar,
  crear,
  editar,
  fichaDeRol,
  listarLosRoles,
  type DependenciasDeRolesWeb,
} from "../../src/composicion/roles-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";

/**
 * La pantalla «Roles» de /cuenta con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el CABLEADO de la web (las reglas de los
 * casos de uso están en `roles-casos-de-uso.test.ts`): solo el gerente; aislamiento entre empresas; crear es idempotente (también con dos pedidos a la vez); editar con una versión vieja no pisa
 * lo de otro; archivar repetido es inocuo; una forma inválida no llega a la base.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };
const AHORA = new Date("2026-11-26T15:00:00.000Z");

describe.skipIf(base === null)("roles: pantalla de la empresa (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  const d = (): DependenciasDeRolesWeb => ({
    casosDeUso: web.casosDeUsoDeIdentidad,
    consultas: web.consultasDeIdentidad,
    respuesta: { registrar: (x) => registrados.push(x) },
  });

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    const fuente = {
      PEDERNAL_CLAVE_CONTEXTO: `${propia.base.clave.kid}:${propia.base.clave.secreto.toString("hex")}`,
      PEDERNAL_DB_APP: propia.base.app,
      PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
    };
    conexiones = armarConexiones({ fuente: () => fuente, registrar: (x) => registrados.push(x) });
    web = armarWeb(conexiones);
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
    crearEscenarioDeConfiguracion(dueno, { rol });
  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const filas = async (empresa: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from rol_de_empresa where empresa_id = $1",
          [empresa],
        )
      ).rows[0]?.n,
    );
  const vacio = (rolId: string, nombre: string) => ({
    rolId,
    nombre,
    origen: { tipo: "VACIO" },
  });

  it("el gerente crea un rol, lo ve en la lista y en su ficha, y el catálogo de casillas trae todos los módulos", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();

    const creado = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Cajero")));
    const lista = datosDe(await listarLosRoles(d(), e.como(AHORA)));
    const ficha = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    const modulos = datosDe(await accionesParaElegir(d(), e.como(AHORA)));

    expect(creado).toEqual({ rolId, yaExistia: false });
    expect(lista.map((r) => r.nombre)).toEqual(["Cajero"]);
    expect(ficha).toMatchObject({ rolId, nombre: "Cajero", activo: true, personasActivas: 0 });
    expect(modulos.some((m) => m.modulo === "administracion" && m.enElPlan)).toBe(true);
  });

  it("repetir el mismo pedido de crear (doble clic, reintento) devuelve el mismo rol y no escribe otro", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();

    const primera = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));
    const segunda = datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Mozo")));

    expect([primera, segunda]).toEqual([
      { rolId, yaExistia: false },
      { rolId, yaExistia: true },
    ]);
    expect(await filas(e.mundo.empresa)).toBe(1);
  });

  it("dos pedidos de crear a la vez con el mismo id dejan UN solo rol y los dos responden bien, de cualquier lado que gane", async () => {
    const e = await nuevo("GERENTE");

    for (let ronda = 0; ronda < 6; ronda++) {
      const rolId = randomUUID();
      const [a, b] = await Promise.all([
        crear(d(), e.como(AHORA), vacio(rolId, `Encargado ${ronda}`)),
        crear(d(), e.como(AHORA), vacio(rolId, `Encargado ${ronda}`)),
      ]);

      expect([datosDe(a).rolId, datosDe(b).rolId]).toEqual([rolId, rolId]);
      expect([datosDe(a).yaExistia, datosDe(b).yaExistia].sort()).toEqual([false, true]);
    }
    expect(await filas(e.mundo.empresa)).toBe(6);
  });

  it("dos pedidos de crear a la vez con el mismo nombre y ids distintos dejan UN solo rol activo con ese nombre", async () => {
    const e = await nuevo("GERENTE");

    const [a, b] = await Promise.all([
      crear(d(), e.como(AHORA), vacio(randomUUID(), "Supervisor")),
      crear(d(), e.como(AHORA), vacio(randomUUID(), "Supervisor")),
    ]);

    expect(datosDe(a).rolId).toBe(datosDe(b).rolId);
    expect(await filas(e.mundo.empresa)).toBe(1);
  });

  it("quien no es el gerente recibe el genérico en todo y no se escribe nada", async () => {
    for (const rol of ["ADMINISTRADOR", "OPERADOR"] as const) {
      const e = await nuevo(rol);
      const rolId = randomUUID();
      const ctx = e.como(AHORA);

      const respuestas = [
        await listarLosRoles(d(), ctx),
        await fichaDeRol(d(), ctx, { rolId }),
        await accionesParaElegir(d(), ctx),
        await crear(d(), ctx, vacio(rolId, "Intruso")),
        await editar(d(), ctx, { rolId, nombre: "Otro" }),
        await archivar(d(), ctx, { rolId }),
      ];

      for (const r of respuestas) expect(r).toMatchObject(GENERICO);
      expect(await filas(e.mundo.empresa)).toBe(0);
    }
  });

  it("un rol de otra empresa es indistinguible de uno inexistente y no figura en la lista", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), a.como(AHORA), vacio(rolId, "De A")));

    const ajeno = await fichaDeRol(d(), b.como(AHORA), { rolId });
    const inexistente = await fichaDeRol(d(), b.como(AHORA), { rolId: randomUUID() });
    const listaDeB = datosDe(await listarLosRoles(d(), b.como(AHORA)));
    const editarAjeno = await editar(d(), b.como(AHORA), { rolId, nombre: "Robado" });
    const archivarAjeno = await archivar(d(), b.como(AHORA), { rolId });

    expect(ajeno).toMatchObject(GENERICO);
    expect(inexistente).toMatchObject(GENERICO);
    expect(ajeno).toEqual(inexistente);
    expect(listaDeB).toEqual([]);
    expect(editarAjeno).toMatchObject(GENERICO);
    expect(archivarAjeno).toMatchObject(GENERICO);
    expect(datosDe(await fichaDeRol(d(), a.como(AHORA), { rolId })).nombre).toBe("De A");
  });

  it("editar con una versión vieja no pisa lo que otra persona ya cambió; con la vigente cambia y repetir no vuelve a escribir", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Caja")));
    const vista = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    datosDe(await editar(d(), e.como(AHORA), { rolId, nombre: "Caja 1" }));

    const vieja = await editar(d(), e.como(AHORA), {
      rolId,
      nombre: "Caja 2",
      versionEsperada: vista.version,
    });
    const vigente = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    const buena = datosDe(
      await editar(d(), e.como(AHORA), {
        rolId,
        nombre: "Caja 3",
        versionEsperada: vigente.version,
      }),
    );
    const repetida = datosDe(await editar(d(), e.como(AHORA), { rolId, nombre: "Caja 3" }));

    expect(vieja).toMatchObject(GENERICO);
    expect(buena.cambio).toBe(true);
    expect(repetida.cambio).toBe(false);
    expect(datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId })).nombre).toBe("Caja 3");
  });

  it("archivar y reactivar: archivar repetido es inocuo y editar con reactivar lo vuelve a activar", async () => {
    const e = await nuevo("GERENTE");
    const rolId = randomUUID();
    datosDe(await crear(d(), e.como(AHORA), vacio(rolId, "Temporal")));

    const una = datosDe(await archivar(d(), e.como(AHORA), { rolId }));
    const otra = datosDe(await archivar(d(), e.como(AHORA), { rolId }));
    const archivado = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));
    datosDe(await editar(d(), e.como(AHORA), { rolId, reactivar: true }));
    const activo = datosDe(await fichaDeRol(d(), e.como(AHORA), { rolId }));

    expect(una).toEqual({ yaEstabaArchivado: false });
    expect(otra).toEqual({ yaEstabaArchivado: true });
    expect(archivado.activo).toBe(false);
    expect(activo.activo).toBe(true);
  });

  it("una forma inválida (id que no es identificador, origen desconocido, acciones que no son texto) es el genérico y no llega a la base", async () => {
    const e = await nuevo("GERENTE");
    const ctx = e.como(AHORA);

    const invalidas = [
      await crear(d(), ctx, { rolId: "no-es-un-id", nombre: "X", origen: { tipo: "VACIO" } }),
      await crear(d(), ctx, { rolId: randomUUID(), nombre: "X", origen: { tipo: "OTRO" } }),
      await editar(d(), ctx, { rolId: randomUUID(), acciones: [1, 2] }),
      await fichaDeRol(d(), ctx, { rolId: "../etc" }),
      await archivar(d(), ctx, undefined),
    ];

    for (const r of invalidas) expect(r).toMatchObject(GENERICO);
    expect(await filas(e.mundo.empresa)).toBe(0);
  });
});
