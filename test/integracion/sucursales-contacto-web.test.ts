import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  editarContactoDeSucursal,
  fichaDeContactoDeSucursal,
  type DependenciasDeSucursalWeb,
} from "../../src/composicion/contacto-de-sucursal-web";
import { armarWeb } from "../../src/composicion/web";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { perdedorAceptable, reintentarSiAgotada } from "./concurrencia-apoyo";
import { comoEmpresa, crearBaseAparte } from "./entorno";
import { crearEscenarioDeConfiguracion, otraPersona } from "./fiscal-configuracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  type RolDePrueba,
} from "./fixtures-identidad";
import { empresaId, personaId, sucursalId } from "../../src/primitivas/identificadores/marca";

/**
 * El «Contacto de la sucursal» de /cuenta (D-113) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas
 * reales de empresa). Lo que se prueba es el CABLEADO de `fichaDeContactoDeSucursal` y `editarContactoDeSucursal` (las reglas de cada dato
 * son de `primitivas/contacto` y las del caso de uso están en `sucursales-casos-de-uso.test.ts`):
 *  - solo gerente y administrador; un operador (con o sin la sucursal asignada) o quien no es de la empresa no lee ni escribe nada;
 *  - la sucursal la decide el servidor: otra empresa, inexistente o sin asignar se dicen igual y no tocan nada;
 *  - repetir el mismo guardado (clic doble, reintento) no escribe ni audita dos veces; una versión vieja con otros datos no pisa;
 *  - un dato inválido marca su campo con el texto genérico; vaciar un dato lo borra; lo que no se manda no se toca;
 *  - dos a la vez: el mismo pedido da una sola escritura y datos distintos con la misma versión no se pisan;
 *  - el nombre sale del servidor (el del navegador se ignora y un cambio ajeno no se pisa) y la respuesta es solo la lista blanca.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const uuid = (): string => randomUUID();
const GENERICO = "FISCAL_CONFIGURACION_DATOS_INVALIDOS";
const FUERA = { ok: false, error: { codigo: "FISCAL_SUCURSAL_FUERA_DE_ALCANCE" } };
const SIN_PERMISO = { ok: false, error: { codigo: "SIN_PERMISO" } };
const CONTACTO = { telefono: "+54 11 4321-0000", correo: "centro@hotel.com", web: "hotel.com" };

describe.skipIf(base === null)("sucursales: contacto de la sucursal elegida (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  /** Las dependencias con su propio registro: sirve para saber si UNA llamada agotó los reintentos de la base. */
  const dependencias = (registro: string[] = registrados): DependenciasDeSucursalWeb => ({
    casosDeUso: web.casosDeUsoDeEmpresas,
    consultas: web.consultasDeEmpresas,
    respuesta: { registrar: (x) => registro.push(x) },
  });
  const d = (): DependenciasDeSucursalWeb => dependencias();

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
    web = armarWeb(conexiones);
  }, 120_000);
  afterAll(async () => {
    await conexiones.transaccionesDeApp().cerrar();
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows;
  const guardado = async (sucursal: string) =>
    (
      await filas<{
        nombre: string;
        telefono: string | null;
        correo: string | null;
        web: string | null;
        version: number;
      }>("select nombre, telefono, correo, web, version from sucursal where id = $1", [sucursal])
    )[0];
  const auditorias = (empresa: string) =>
    filas<{ antes: unknown; despues: unknown; actor: string | null }>(
      `select antes, despues, actor_persona_id as actor from auditoria_empresa
        where empresa_id = $1 and accion = 'SUCURSAL_EDITADA' order by id`,
      [empresa],
    );
  const nuevo = (rol: RolDePrueba = "GERENTE") => crearEscenarioDeConfiguracion(dueno, { rol });
  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const versionDe = async (sucursal: string) => (await guardado(sucursal))?.version ?? -1;
  /** Un operador de la empresa, asignado (o no) a la sucursal. */
  async function operador(e: Awaited<ReturnType<typeof nuevo>>, asignado: boolean) {
    const persona = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona, "OPERADOR");
    if (asignado) await crearAsignacionDeBase(dueno, e.mundo.empresa, persona, e.mundo.sucursal);
    return comoEmpresa(empresaId(e.mundo.empresa), personaId(persona));
  }
  /** Una respuesta como resultado, para el apoyo de concurrencia: lo que agotó los reintentos de la base se reconoce por su registro. */
  async function comoResultado<T>(
    hacer: (d: DependenciasDeSucursalWeb) => Promise<Respuesta<T>>,
  ): Promise<Resultado<T, unknown>> {
    const propio: string[] = [];
    const r = await hacer(dependencias(propio));
    if (r.ok) return ok(r.dato);
    return propio.some((x) => x.includes("ConcurrenciaAgotada"))
      ? err({ tipo: "ConcurrenciaAgotada" })
      : err(r.error.codigo);
  }

  it("el gerente abre la ficha y guarda el contacto: queda guardado, la versión sube y deja UNA auditoría con el antes y el después", async () => {
    const e = await nuevo();
    const antes = datosDe(
      await fichaDeContactoDeSucursal(d(), e.como(), { sucursalId: e.mundo.sucursal }),
    );
    expect(antes).toEqual({
      id: e.mundo.sucursal,
      nombre: "Casa central",
      contacto: { telefono: null, correo: null, web: null },
      version: 1,
    });

    const r = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: antes.version,
      ...CONTACTO,
    });
    expect(r).toEqual({ ok: true, dato: { version: 2 } });
    expect(await guardado(e.mundo.sucursal)).toEqual({
      nombre: "Casa central",
      ...CONTACTO,
      version: 2,
    });
    const despues = datosDe(
      await fichaDeContactoDeSucursal(d(), e.como(), { sucursalId: e.mundo.sucursal }),
    );
    expect(despues).toEqual({
      id: e.mundo.sucursal,
      nombre: "Casa central",
      contacto: CONTACTO,
      version: 2,
    });
    const rastro = await auditorias(e.mundo.empresa);
    expect(rastro).toHaveLength(1);
    expect(rastro[0]).toMatchObject({
      actor: e.persona,
      antes: { telefono: null, correo: null, web: null },
      despues: CONTACTO,
    });
  });

  it("el administrador también puede", async () => {
    const e = await nuevo("ADMINISTRADOR");
    const r = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      telefono: CONTACTO.telefono,
    });
    expect(r).toEqual({ ok: true, dato: { version: 2 } });
  });

  it("un operador, asignado a la sucursal o no, ni lee ni escribe: sin permiso (o fuera de alcance) y nada cambia", async () => {
    const e = await nuevo();
    const asignado = await operador(e, true);
    const sinAsignar = await operador(e, false);
    const pedido = { sucursalId: e.mundo.sucursal, versionEsperada: 1, ...CONTACTO };

    expect(
      await fichaDeContactoDeSucursal(d(), asignado, { sucursalId: e.mundo.sucursal }),
    ).toMatchObject(SIN_PERMISO);
    expect(await editarContactoDeSucursal(d(), asignado, pedido)).toMatchObject(SIN_PERMISO);
    // Sin la sucursal asignada ni siquiera es de las que puede elegir: la misma respuesta que una ajena.
    expect(
      await fichaDeContactoDeSucursal(d(), sinAsignar, { sucursalId: e.mundo.sucursal }),
    ).toMatchObject(FUERA);
    expect(await editarContactoDeSucursal(d(), sinAsignar, pedido)).toMatchObject(FUERA);

    expect(await guardado(e.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await auditorias(e.mundo.empresa)).toEqual([]);
  });

  it("quien no es de la empresa (sin membresía, o con la membresía dada de baja) no lee ni escribe", async () => {
    const e = await nuevo();
    const ajena = (await crearPersonaDeBase(dueno)).id;
    const deBaja = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, e.mundo.empresa, deBaja, "GERENTE", false);
    for (const persona of [ajena, deBaja]) {
      const contexto = comoEmpresa(empresaId(e.mundo.empresa), personaId(persona));
      const pedido = { sucursalId: e.mundo.sucursal, versionEsperada: 1, ...CONTACTO };
      expect(await fichaDeContactoDeSucursal(d(), contexto, pedido)).toMatchObject({ ok: false });
      expect(await editarContactoDeSucursal(d(), contexto, pedido)).toMatchObject({ ok: false });
    }
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await auditorias(e.mundo.empresa)).toEqual([]);
  });

  it("otra empresa, una sucursal inexistente y una mal formada: fuera de alcance, sin pistas y sin tocar nada", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const pedido = (sucursal: unknown) => ({
      sucursalId: sucursal,
      versionEsperada: 1,
      ...CONTACTO,
    });

    // El gerente de B manda la sucursal de A.
    const ajena = await editarContactoDeSucursal(d(), b.como(), pedido(a.mundo.sucursal));
    const inexistente = await editarContactoDeSucursal(d(), b.como(), pedido(uuid()));
    expect(ajena).toMatchObject(FUERA);
    expect(ajena).toEqual(inexistente);
    expect(
      await fichaDeContactoDeSucursal(d(), b.como(), { sucursalId: a.mundo.sucursal }),
    ).toMatchObject(FUERA);
    expect(await editarContactoDeSucursal(d(), b.como(), pedido("no-es-un-id"))).toMatchObject({
      ok: false,
      error: { codigo: GENERICO, campo: "sucursalId" },
    });

    expect(await guardado(a.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await guardado(b.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await auditorias(a.mundo.empresa)).toEqual([]);
    expect(await auditorias(b.mundo.empresa)).toEqual([]);
  });

  it("el `empresaId` del pedido no cuenta: manda el del contexto del servidor", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const r = await editarContactoDeSucursal(d(), b.como(), {
      empresaId: a.mundo.empresa,
      sucursalId: a.mundo.sucursal,
      versionEsperada: 1,
      ...CONTACTO,
    });
    expect(r).toMatchObject(FUERA);
    expect(await guardado(a.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
  });

  it("una empresa que no opera (suspendida) no escribe", async () => {
    const e = await crearEscenarioDeConfiguracion(dueno, { rol: "GERENTE", estado: "SUSPENDED" });
    const r = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      ...CONTACTO,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "EMPRESA_NO_OPERA" } });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await auditorias(e.mundo.empresa)).toEqual([]);
  });

  it("sin sucursal elegida: con una sola abierta la toma el servidor; con varias hay que elegir y nunca se asume «todas»", async () => {
    const e = await nuevo();
    const sola = datosDe(await fichaDeContactoDeSucursal(d(), e.como(), {}));
    expect(sola.id).toBe(e.mundo.sucursal);

    const otra = (
      await filas<{ id: string }>(
        "insert into sucursal (empresa_id, nombre) values ($1, 'Anexo') returning id",
        [e.mundo.empresa],
      )
    )[0]?.id as string;
    const sinElegir = await editarContactoDeSucursal(d(), e.como(), {
      versionEsperada: 1,
      ...CONTACTO,
    });
    expect(sinElegir).toMatchObject({ ok: false, error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" } });
    expect(await fichaDeContactoDeSucursal(d(), e.como(), { sucursalId: null })).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_SUCURSAL_NO_ELEGIDA" },
    });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await guardado(otra)).toMatchObject({ telefono: null, version: 1 });

    // Elegida una, solo se toca esa.
    expect(
      await editarContactoDeSucursal(d(), e.como(), {
        sucursalId: otra,
        versionEsperada: 1,
        ...CONTACTO,
      }),
    ).toEqual({ ok: true, dato: { version: 2 } });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ telefono: null, version: 1 });
    expect(await guardado(otra)).toMatchObject({ ...CONTACTO, version: 2 });
  });

  it("idempotente: repetir el mismo guardado (clic doble, reintento) devuelve lo vigente y no escribe ni audita otra vez", async () => {
    const e = await nuevo();
    const pedido = { sucursalId: e.mundo.sucursal, versionEsperada: 1, ...CONTACTO };
    const primera = await editarContactoDeSucursal(d(), e.como(), pedido);
    const segunda = await editarContactoDeSucursal(d(), e.como(), pedido);
    expect(primera).toEqual({ ok: true, dato: { version: 2 } });
    // Aunque la versión del pedido ya quedó vieja, lo pedido es lo que ya está: no cambia nada.
    expect(segunda).toEqual({ ok: true, dato: { version: 2 } });
    expect(await versionDe(e.mundo.sucursal)).toBe(2);
    expect(await auditorias(e.mundo.empresa)).toHaveLength(1);
  });

  it("versión vieja con otros datos: «versión desactualizada» y no se pisa lo que otro guardó", async () => {
    const e = await nuevo();
    await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      telefono: "+54 11 1111-1111",
    });
    const vieja = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      telefono: "+54 11 2222-2222",
    });
    expect(vieja).toMatchObject({ ok: false, error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({
      telefono: "+54 11 1111-1111",
      version: 2,
    });
    expect(await auditorias(e.mundo.empresa)).toHaveLength(1);
  });

  it.each([
    ["telefono", "43\n21"],
    ["telefono", "1".repeat(41)],
    ["correo", "no-es-un-correo"],
    ["web", "hotel centro.com"],
  ])(
    "un %s inválido (%j): «Revisá los datos marcados.» con su campo, sin escribir ni auditar",
    async (campo, valor) => {
      const e = await nuevo();
      const r = await editarContactoDeSucursal(d(), e.como(), {
        sucursalId: e.mundo.sucursal,
        versionEsperada: 1,
        ...CONTACTO,
        [campo]: valor,
      });
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO, campo } });
      expect(await guardado(e.mundo.sucursal)).toMatchObject({
        telefono: null,
        correo: null,
        web: null,
        version: 1,
      });
      expect(await auditorias(e.mundo.empresa)).toEqual([]);
    },
  );

  it("un dato sin la forma pedida (no es texto, o demasiado largo) se rechaza antes de tocar la base", async () => {
    const e = await nuevo();
    for (const malo of [
      { telefono: 5 },
      { correo: "a".repeat(1001) },
      { web: {} },
      { versionEsperada: "x" },
    ]) {
      const r = await editarContactoDeSucursal(d(), e.como(), {
        sucursalId: e.mundo.sucursal,
        versionEsperada: 1,
        ...malo,
      });
      expect(r).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    }
    expect(await versionDe(e.mundo.sucursal)).toBe(1);
  });

  it("vaciar un dato lo borra (`null` o texto en blanco); el que no se manda no se toca", async () => {
    const e = await nuevo();
    await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      ...CONTACTO,
    });
    const r = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 2,
      telefono: null,
      correo: "   ",
    });
    expect(r).toEqual({ ok: true, dato: { version: 3 } });
    expect(await guardado(e.mundo.sucursal)).toEqual({
      nombre: "Casa central",
      telefono: null,
      correo: null,
      web: CONTACTO.web,
      version: 3,
    });
    const rastro = await auditorias(e.mundo.empresa);
    expect(rastro[1]).toMatchObject({
      antes: { telefono: CONTACTO.telefono, correo: CONTACTO.correo },
      despues: { telefono: null, correo: null },
    });
  });

  it("el nombre lo pone el servidor: el del navegador se ignora, y un cambio ajeno en el medio no se pisa", async () => {
    const e = await nuevo();
    // El navegador manda otro nombre y otra hora de corte: no cuentan.
    await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 1,
      telefono: CONTACTO.telefono,
      nombre: "Nombre del navegador",
      horaDeCorte: "05:00",
    });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ nombre: "Casa central", version: 2 });

    // Otra persona renombra la sucursal mientras esta pantalla seguía abierta con la versión 2.
    const otra = await otraPersona(dueno, e, "ADMINISTRADOR");
    const renombrada = await web.casosDeUsoDeEmpresas().editarSucursal(otra.como(), {
      sucursalId: sucursalId(e.mundo.sucursal),
      versionEsperada: 2,
      nombre: "Casa matriz",
    });
    expect(renombrada.ok).toBe(true);
    const r = await editarContactoDeSucursal(d(), e.como(), {
      sucursalId: e.mundo.sucursal,
      versionEsperada: 2,
      web: CONTACTO.web,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "FISCAL_VERSION_DESACTUALIZADA" } });
    expect(await guardado(e.mundo.sucursal)).toMatchObject({ nombre: "Casa matriz", web: null });
  });

  it("la respuesta es solo la lista blanca: sin empresa, hora de corte, zona horaria ni nada interno", async () => {
    const e = await nuevo();
    const ficha = datosDe(
      await fichaDeContactoDeSucursal(d(), e.como(), { sucursalId: e.mundo.sucursal }),
    );
    expect(Object.keys(ficha).sort()).toEqual(["contacto", "id", "nombre", "version"]);
    expect(Object.keys(ficha.contacto).sort()).toEqual(["correo", "telefono", "web"]);
    const salida = datosDe(
      await editarContactoDeSucursal(d(), e.como(), {
        sucursalId: e.mundo.sucursal,
        versionEsperada: 1,
        ...CONTACTO,
      }),
    );
    expect(Object.keys(salida)).toEqual(["version"]);
    // Ni los errores traen detalle de la base ni identificadores de la empresa.
    const error = JSON.stringify(
      await editarContactoDeSucursal(d(), e.como(), { sucursalId: uuid(), versionEsperada: 1 }),
    );
    expect(error).not.toContain(e.mundo.empresa);
    expect(error).not.toMatch(/sqlstate|relation|postgres|secret/i);
  });

  it("concurrencia: el mismo guardado dos veces a la vez (clic doble) escribe y audita UNA vez", async () => {
    const e = await nuevo();
    const pedido = { sucursalId: e.mundo.sucursal, versionEsperada: 1, ...CONTACTO };
    const salidas = await Promise.all(
      [0, 1].map(() =>
        reintentarSiAgotada(
          () => comoResultado((dep) => editarContactoDeSucursal(dep, e.como(), pedido)),
          {
            contexto: "guardar el mismo contacto",
          },
        ),
      ),
    );
    expect(salidas).toEqual([{ version: 2 }, { version: 2 }]);
    expect(await versionDe(e.mundo.sucursal)).toBe(2);
    expect(await auditorias(e.mundo.empresa)).toHaveLength(1);
  });

  it("concurrencia: dos guardados distintos con la misma versión no se pisan: gana uno y el otro recibe «versión desactualizada»", async () => {
    for (let ronda = 0; ronda < 3; ronda++) {
      const e = await nuevo();
      const pedidos = ["+54 11 1111-1111", "+54 11 2222-2222"].map((telefono) => ({
        sucursalId: e.mundo.sucursal,
        versionEsperada: 1,
        telefono,
      }));
      const resultados = await Promise.all(
        pedidos.map((pedido) =>
          comoResultado((dep) => editarContactoDeSucursal(dep, e.como(), pedido)),
        ),
      );
      const { ganadores } = perdedorAceptable(resultados, {
        esperados: ["FISCAL_VERSION_DESACTUALIZADA"],
        contexto: `ronda ${ronda}`,
      });
      expect(ganadores).toBe(1);
      const final = await guardado(e.mundo.sucursal);
      expect(final?.version).toBe(2);
      const ganador = resultados.findIndex((r) => r.ok);
      expect(final?.telefono).toBe(pedidos[ganador]?.telefono);
      expect(await auditorias(e.mundo.empresa)).toHaveLength(1);
    }
  });
});
