import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  crearUnaSucursal,
  listarLasSucursales,
  type DependenciasDeSucursalesWeb,
} from "../../src/composicion/sucursales-web";
import { armarWeb } from "../../src/composicion/web";
import { crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";

/**
 * La pantalla «Sucursales» de /cuenta con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el CABLEADO (las reglas de `crearSucursal` están
 * en `sucursales-casos-de-uso.test.ts`): gerente y administrador pueden ver y crear, el empleado no; aislamiento entre empresas; crear es idempotente por nombre (doble clic y dos pedidos a la vez dejan UNA
 * sucursal, UNA «Caja 1» y UNA auditoría); un nombre igual al de una sucursal desactivada da el genérico y no escribe; la lista trae solo las activas y solo id y nombre; una forma inválida no llega a la base.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };
const AHORA = new Date("2026-11-27T15:00:00.000Z");

describe.skipIf(base === null)("sucursales: lista y alta de la empresa (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  const d = (): DependenciasDeSucursalesWeb => ({
    casosDeUso: web.casosDeUsoDeEmpresas,
    consultas: web.consultasDeEmpresas,
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
  const cuenta = async (sql: string, parametros: readonly unknown[]): Promise<number> =>
    Number((await dueno.query<{ n: string }>(sql, [...parametros])).rows[0]?.n);
  const sucursalesConNombre = (empresa: string, nombre: string) =>
    cuenta(
      "select count(*) as n from sucursal where empresa_id = $1 and lower(nombre) = lower($2)",
      [empresa, nombre],
    );

  it("el gerente crea una sucursal y la ve en la lista, con su «Caja 1» y un solo registro de auditoría", async () => {
    const e = await nuevo("GERENTE");

    const creada = datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "  Centro  " }));
    const lista = datosDe(await listarLasSucursales(d(), e.como(AHORA)));

    expect(creada.yaExistia).toBe(false);
    expect(lista.find((s) => s.id === creada.sucursalId)).toEqual({
      id: creada.sucursalId,
      nombre: "Centro",
    });
    expect(
      await cuenta("select count(*) as n from caja where empresa_id = $1 and sucursal_id = $2", [
        e.mundo.empresa,
        creada.sucursalId,
      ]),
    ).toBe(1);
    expect(
      await cuenta(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and entidad_id = $2 and accion = 'SUCURSAL_CREADA'",
        [e.mundo.empresa, creada.sucursalId],
      ),
    ).toBe(1);
  });

  it("el administrador también ve y crea (permisos como están)", async () => {
    const e = await nuevo("ADMINISTRADOR");

    const creada = datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Terminal" }));
    const lista = datosDe(await listarLasSucursales(d(), e.como(AHORA)));

    expect(lista.map((s) => s.id)).toContain(creada.sucursalId);
  });

  it("repetir el mismo alta (doble clic, reintento) devuelve la misma sucursal y no escribe nada más", async () => {
    const e = await nuevo("GERENTE");

    const primera = datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Playa" }));
    const segunda = datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "playa" }));

    expect(segunda).toEqual({ sucursalId: primera.sucursalId, yaExistia: true });
    expect(await sucursalesConNombre(e.mundo.empresa, "Playa")).toBe(1);
    expect(
      await cuenta("select count(*) as n from caja where empresa_id = $1 and sucursal_id = $2", [
        e.mundo.empresa,
        primera.sucursalId,
      ]),
    ).toBe(1);
    expect(
      await cuenta(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and entidad_id = $2 and accion = 'SUCURSAL_CREADA'",
        [e.mundo.empresa, primera.sucursalId],
      ),
    ).toBe(1);
  });

  it("dos altas a la vez con el mismo nombre dejan UNA sucursal y las dos responden con la misma, de cualquier lado que gane", async () => {
    const e = await nuevo("GERENTE");

    for (let ronda = 0; ronda < 5; ronda++) {
      const nombre = `Local ${ronda}`;
      const [a, b] = await Promise.all([
        crearUnaSucursal(d(), e.como(AHORA), { nombre }),
        crearUnaSucursal(d(), e.como(AHORA), { nombre }),
      ]);

      expect(datosDe(a).sucursalId).toBe(datosDe(b).sucursalId);
      expect([datosDe(a).yaExistia, datosDe(b).yaExistia].sort()).toEqual([false, true]);
      expect(await sucursalesConNombre(e.mundo.empresa, nombre)).toBe(1);
    }
  });

  it("el empleado recibe el genérico al ver y al crear, y no se escribe nada", async () => {
    const e = await nuevo("OPERADOR");
    const antes = await cuenta("select count(*) as n from sucursal where empresa_id = $1", [
      e.mundo.empresa,
    ]);

    expect(await listarLasSucursales(d(), e.como(AHORA))).toMatchObject(GENERICO);
    expect(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Intruso" })).toMatchObject(
      GENERICO,
    );

    expect(
      await cuenta("select count(*) as n from sucursal where empresa_id = $1", [e.mundo.empresa]),
    ).toBe(antes);
  });

  it("las sucursales de otra empresa no figuran en la lista ni se mezclan con las de esta", async () => {
    const a = await nuevo("GERENTE");
    const b = await nuevo("GERENTE");
    datosDe(await crearUnaSucursal(d(), a.como(AHORA), { nombre: "Solo de A" }));
    const deB = datosDe(await crearUnaSucursal(d(), b.como(AHORA), { nombre: "Solo de A" }));

    const listaDeB = datosDe(await listarLasSucursales(d(), b.como(AHORA)));

    expect(listaDeB.filter((s) => s.nombre === "Solo de A").map((s) => s.id)).toEqual([
      deB.sucursalId,
    ]);
    expect(await sucursalesConNombre(a.mundo.empresa, "Solo de A")).toBe(1);
    expect(await sucursalesConNombre(b.mundo.empresa, "Solo de A")).toBe(1);
  });

  it("la lista trae solo las activas y solo id y nombre; un nombre igual al de una desactivada da el genérico y no escribe", async () => {
    const e = await nuevo("GERENTE");
    const vieja = datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Vieja" }));
    datosDe(await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Nueva" }));
    await dueno.query("update sucursal set activa = false where id = $1", [vieja.sucursalId]);

    const lista = datosDe(await listarLasSucursales(d(), e.como(AHORA)));
    const choque = await crearUnaSucursal(d(), e.como(AHORA), { nombre: "vieja" });

    expect(lista.map((s) => s.nombre)).toContain("Nueva");
    expect(lista.map((s) => s.nombre)).not.toContain("Vieja");
    for (const s of lista) expect(Object.keys(s).sort()).toEqual(["id", "nombre"]);
    expect(choque).toMatchObject(GENERICO);
    expect(await sucursalesConNombre(e.mundo.empresa, "Vieja")).toBe(1);
  });

  it("una forma inválida (sin nombre, con el nombre de otro tipo) o un nombre vacío no llega a la base", async () => {
    const e = await nuevo("GERENTE");
    const antes = await cuenta("select count(*) as n from sucursal where empresa_id = $1", [
      e.mundo.empresa,
    ]);

    const respuestas = [
      await crearUnaSucursal(d(), e.como(AHORA), {}),
      await crearUnaSucursal(d(), e.como(AHORA), undefined),
      await crearUnaSucursal(d(), e.como(AHORA), { nombre: 7 }),
      await crearUnaSucursal(d(), e.como(AHORA), { nombre: "   " }),
    ];

    for (const r of respuestas) expect(r.ok).toBe(false);
    expect(
      await cuenta("select count(*) as n from sucursal where empresa_id = $1", [e.mundo.empresa]),
    ).toBe(antes);
  });

  it("la empresa sale de la sesión: un campo de más que mande el navegador se ignora y la sucursal queda en la empresa de quien actúa", async () => {
    const e = await nuevo("GERENTE");
    const otra = await nuevo("GERENTE");

    const creada = datosDe(
      await crearUnaSucursal(d(), e.como(AHORA), { nombre: "Sur", empresaId: otra.mundo.empresa }),
    );

    expect(await sucursalesConNombre(e.mundo.empresa, "Sur")).toBe(1);
    expect(await sucursalesConNombre(otra.mundo.empresa, "Sur")).toBe(0);
    expect(creada.sucursalId).toBeTruthy();
  });
});
