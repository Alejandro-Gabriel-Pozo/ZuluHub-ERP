import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearTokensHmac } from "../../src/adaptadores/tokens/tokens-hmac";
import type { Respuesta } from "../../src/capacidades/experiencia/respuesta";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import { armarConexiones, type Conexiones } from "../../src/composicion/conexiones";
import {
  asignarSucursalesDeUsuario,
  editorDeSucursalesDeUsuario,
  type DependenciasDeSucursalesDeUsuarioWeb,
} from "../../src/composicion/usuarios-web";
import { armarWeb } from "../../src/composicion/web";
import { crearCasosDeUsoDeIdentidad } from "../../src/modulos/identidad/publico";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { agotadaSegunElRegistro, repetirSiAgotada } from "./concurrencia-apoyo";
import { comoEmpresa, crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { crearEscenarioDeConfiguracion } from "./fiscal-configuracion-apoyo";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  emailAlAzar,
} from "./fixtures-identidad";

/**
 * Las sucursales de un empleado en la ficha de «Usuarios» (tramo U4) con la composición REAL (conexiones y web, base de verdad, roles limitados y las reglas reales de empresa). Lo que se prueba es el
 * CABLEADO de `editorDeSucursalesDeUsuario` y `asignarSucursalesDeUsuario` (las reglas del caso de uso están en `asignar-sucursales-casos-de-uso.test.ts`):
 *  - I1 idempotencia: guardar el mismo conjunto (otra vez, en otro orden o con repetidos) deja UNA sola auditoría;
 *  - I2 conjunto vacío: quita todas (quedan apagadas, no borradas) y el empleado no tiene ninguna sucursal para elegir;
 *  - I3 concurrencia: dos ediciones distintas a la vez dejan exactamente UNO de los dos conjuntos, en 20 corridas;
 *  - I4 atomicidad: una falla a mitad de camino no deja ni asignaciones ni auditoría;
 *  - I5 sucursal desactivada: no se ofrece ni se acepta si habría que escribirla (y se documenta qué pasa con la asignación que ya tenía);
 *  - I6 aislamiento: una sucursal o una persona de otra empresa es el genérico, sin escribir;
 *  - I7 permisos: un empleado (por fuera de la pantalla) no ve el editor ni guarda;
 *  - I8 efecto real: lo guardado es lo que el empleado puede elegir;
 *  - I9 persona desactivada: no hay editor ni se guarda.
 * Además: solo el empleado (el gerente y el administrador no tienen editor ni se les guarda nada) y la lista blanca del pedido.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const GENERICO = { ok: false, error: { codigo: "USUARIOS_NO_PERMITIDO" } };
const CORRIDAS = 20;

describe.skipIf(base === null)("usuarios: sucursales de un empleado (web)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let conexiones: Conexiones;
  let web: ReturnType<typeof armarWeb>;
  const registrados: string[] = [];

  const d = (): DependenciasDeSucursalesDeUsuarioWeb => ({
    consultas: web.consultasDeIdentidad,
    consultasDeEmpresas: web.consultasDeEmpresas,
    casosDeUso: web.casosDeUsoDeIdentidad,
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

  type Escenario = Awaited<ReturnType<typeof crearEscenarioDeConfiguracion>>;
  const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
    crearEscenarioDeConfiguracion(dueno, { rol });
  const datosDe = <T>(r: Respuesta<T>): T => {
    if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
    return r.dato;
  };

  /** Una sucursal más de la empresa del escenario (la que ya tiene es la central). */
  async function sucursal(e: Escenario, nombre: string, activa = true): Promise<string> {
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre, activa) values ($1, $2, $3) returning id",
      [e.mundo.empresa, nombre, activa],
    );
    return rows[0]?.id as string;
  }
  /** Suma una persona con membresía a la empresa del escenario. */
  async function sumar(
    e: Escenario,
    rol: "ADMINISTRADOR" | "OPERADOR",
    activo = true,
  ): Promise<string> {
    const persona = await crearPersonaDeBase(dueno, emailAlAzar("p"));
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona.id, rol, activo);
    return persona.id;
  }
  const asignadas = async (e: Escenario, persona: string): Promise<string[]> =>
    (
      await dueno.query<{ sucursal_id: string }>(
        "select sucursal_id from asignacion_sucursal where empresa_id = $1 and persona_id = $2 and activa order by sucursal_id",
        [e.mundo.empresa, persona],
      )
    ).rows.map((f) => f.sucursal_id);
  const filasDeAsignacion = async (e: Escenario, persona: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from asignacion_sucursal where empresa_id = $1 and persona_id = $2",
          [e.mundo.empresa, persona],
        )
      ).rows[0]?.n,
    );
  const auditorias = async (e: Escenario, persona: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ n: string }>(
          "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'ASIGNACIONES_CAMBIADAS' and entidad_id = $2",
          [e.mundo.empresa, persona],
        )
      ).rows[0]?.n,
    );
  const guardar = (e: Escenario, persona: string, sucursales: readonly string[], quien = e) =>
    asignarSucursalesDeUsuario(d(), quien.como(), { personaId: persona, sucursales });
  const editor = (e: Escenario, persona: string) =>
    editorDeSucursalesDeUsuario(d(), e.como(), { personaId: persona });
  const ordenadas = (...ids: string[]) => [...ids].sort();
  const SIN_PERMISO_O_GENERICO = GENERICO;

  it("el gerente ve una casilla por sucursal ACTIVA, tildadas las del empleado; el desactivado y las de otra empresa no se ofrecen", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const cerrada = await sucursal(e, "Cerrada", false);
    const otra = await nuevo();
    await sucursal(otra, "De otra empresa");
    const emp = await sumar(e, "OPERADOR");
    await crearAsignacionDeBase(dueno, e.mundo.empresa, emp, norte);
    await crearAsignacionDeBase(dueno, e.mundo.empresa, emp, cerrada);

    const opciones = datosDe(await editor(e, emp));

    expect(opciones).not.toBeNull();
    const dibujadas = (opciones ?? []).map((o) => [o.id, o.marcada]);
    expect(dibujadas.sort()).toEqual(
      [
        [e.mundo.sucursal, false],
        [norte, true],
      ].sort(),
    );
    expect((opciones ?? []).map((o) => o.nombre).sort()).toHaveLength(2);
    expect(JSON.stringify(opciones)).not.toContain(cerrada);
  });

  it("solo el empleado activo tiene editor: para el gerente, un administrador o un desactivado no hay (null) y no se guarda nada", async () => {
    const e = await nuevo();
    const admin = await sumar(e, "ADMINISTRADOR");
    const desactivado = await sumar(e, "OPERADOR", false);

    expect(datosDe(await editor(e, admin))).toBeNull();
    expect(datosDe(await editor(e, e.persona))).toBeNull();
    expect(datosDe(await editor(e, desactivado))).toBeNull(); // I9

    for (const persona of [admin, e.persona, desactivado]) {
      expect(await guardar(e, persona, [e.mundo.sucursal])).toMatchObject(GENERICO);
      expect(await filasDeAsignacion(e, persona)).toBe(0);
      expect(await auditorias(e, persona)).toBe(0);
    }
  });

  it("I1 idempotencia: guardar el mismo conjunto otra vez, en otro orden o con repetidos deja UNA auditoría", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const emp = await sumar(e, "OPERADOR");

    const primera = datosDe(await guardar(e, emp, [e.mundo.sucursal, norte]));
    expect(primera.agregadas).toEqual(ordenadas(e.mundo.sucursal, norte));
    for (const repetido of [
      [e.mundo.sucursal, norte],
      [norte, e.mundo.sucursal],
      [norte, norte, e.mundo.sucursal, e.mundo.sucursal],
    ]) {
      expect(datosDe(await guardar(e, emp, repetido))).toEqual({
        agregadas: [],
        reactivadas: [],
        quitadas: [],
      });
    }
    expect(await asignadas(e, emp)).toEqual(ordenadas(e.mundo.sucursal, norte));
    expect(await auditorias(e, emp)).toBe(1);
    expect(await filasDeAsignacion(e, emp)).toBe(2);
  });

  it("I1 doble clic: el mismo guardado lanzado dos veces a la vez deja una sola auditoría y dos filas", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const emp = await sumar(e, "OPERADOR");
    const pedido = () =>
      repetirSiAgotada(() => guardar(e, emp, [e.mundo.sucursal, norte]), {
        esAgotada: agotadaSegunElRegistro(registrados),
      });

    const [a, b] = await Promise.all([pedido(), pedido()]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(await asignadas(e, emp)).toEqual(ordenadas(e.mundo.sucursal, norte));
    expect(await filasDeAsignacion(e, emp)).toBe(2);
    expect(await auditorias(e, emp)).toBe(1);
  });

  it("I2 conjunto vacío: quita todas (apagadas, no borradas), deja el editor sin tildes y vuelve a poder tildarlas", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const emp = await sumar(e, "OPERADOR");
    datosDe(await guardar(e, emp, [e.mundo.sucursal, norte]));

    const r = datosDe(await guardar(e, emp, []));

    expect(r.quitadas).toEqual(ordenadas(e.mundo.sucursal, norte));
    expect(await asignadas(e, emp)).toEqual([]);
    expect(await filasDeAsignacion(e, emp)).toBe(2); // nunca se borra
    expect((datosDe(await editor(e, emp)) ?? []).filter((o) => o.marcada)).toEqual([]);
    expect(datosDe(await guardar(e, emp, [norte])).reactivadas).toEqual([norte]);
    expect(await filasDeAsignacion(e, emp)).toBe(2);
  });

  it("I3 concurrencia: dos ediciones distintas a la vez sobre el mismo empleado dejan exactamente UNO de los dos conjuntos (20 corridas)", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const sur = await sucursal(e, "Sur");
    const admin = await otraDelMismoRol(e);
    for (let corrida = 0; corrida < CORRIDAS; corrida++) {
      const emp = await sumar(e, "OPERADOR");
      const conjuntoA = ordenadas(e.mundo.sucursal, norte);
      const conjuntoB = ordenadas(sur);
      const pedir = (quien: Escenario, conjunto: string[]) =>
        repetirSiAgotada(() => guardar(e, emp, conjunto, quien), {
          esAgotada: agotadaSegunElRegistro(registrados),
        });

      const [ra, rb] = await Promise.all([pedir(e, conjuntoA), pedir(admin, conjuntoB)]);

      expect(ra.ok, `corrida ${corrida}`).toBe(true);
      expect(rb.ok, `corrida ${corrida}`).toBe(true);
      const final = await asignadas(e, emp);
      expect([conjuntoA, conjuntoB], `corrida ${corrida}: ${JSON.stringify(final)}`).toContainEqual(
        final,
      );
    }
  });

  it("I4 atomicidad: si falla una escritura a mitad de camino no queda ninguna (ni asignaciones ni auditoría)", async () => {
    if (base === null) return;
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const sur = await sucursal(e, "Sur");
    const emp = await sumar(e, "OPERADOR");
    await crearAsignacionDeBase(dueno, e.mundo.empresa, emp, e.mundo.sucursal); // se quita
    await crearAsignacionDeBase(dueno, e.mundo.empresa, emp, norte, false); // se reactiva
    // `sur` se agrega.
    const falla = crearEntornoDePrueba(propia.base, 2, (tx) => ({
      ...tx,
      auditoria: { registrar: () => Promise.reject(new Error("falla forzada: auditoría")) },
    }));
    try {
      const conFalla: DependenciasDeSucursalesDeUsuarioWeb = {
        ...d(),
        casosDeUso: () =>
          crearCasosDeUsoDeIdentidad({
            transacciones: falla,
            tokens: crearTokensHmac(randomBytes(32)),
            reglas: REGLAS_DE_EMPRESA,
          }),
      };
      const antes = JSON.stringify(
        (
          await dueno.query(
            "select * from asignacion_sucursal where persona_id = $1 order by sucursal_id",
            [emp],
          )
        ).rows,
      );

      const r = await asignarSucursalesDeUsuario(conFalla, e.como(), {
        personaId: emp,
        sucursales: [norte, sur],
      });

      expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
      const despues = JSON.stringify(
        (
          await dueno.query(
            "select * from asignacion_sucursal where persona_id = $1 order by sucursal_id",
            [emp],
          )
        ).rows,
      );
      expect(despues).toBe(antes);
      expect(await auditorias(e, emp)).toBe(0);
    } finally {
      await falla.cerrar();
    }
  });

  it("I5 sucursal desactivada: no se ofrece; pedirla desde fuera de la pantalla da el genérico y no escribe; la asignación que ya tenía no se pierde al reactivarla", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const cerrada = await sucursal(e, "Cerrada", false);
    const emp = await sumar(e, "OPERADOR");

    expect(JSON.stringify(datosDe(await editor(e, emp)))).not.toContain(cerrada);
    expect(await guardar(e, emp, [norte, cerrada])).toMatchObject(GENERICO);
    expect(await filasDeAsignacion(e, emp)).toBe(0);
    expect(await auditorias(e, emp)).toBe(0);

    // La asignación a una sucursal que se desactiva DESPUÉS sigue guardada: al reactivarla, el empleado vuelve como estaba.
    datosDe(await guardar(e, emp, [norte]));
    await dueno.query("update sucursal set activa = false where id = $1", [norte]);
    expect(await asignadas(e, emp)).toEqual([norte]);
    expect((datosDe(await editor(e, emp)) ?? []).map((o) => o.id)).toEqual([e.mundo.sucursal]);
    await dueno.query("update sucursal set activa = true where id = $1", [norte]);
    expect((datosDe(await editor(e, emp)) ?? []).filter((o) => o.marcada).map((o) => o.id)).toEqual(
      [norte],
    );
  });

  it("I5 hallazgo: guardar el editor mientras una sucursal está desactivada apaga la asignación que el empleado tenía a ella (no se ve, así que el conjunto pedido no la trae)", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const emp = await sumar(e, "OPERADOR");
    datosDe(await guardar(e, emp, [e.mundo.sucursal, norte]));
    await dueno.query("update sucursal set activa = false where id = $1", [norte]);

    // La pantalla ofrece solo la central, tildada: guardar manda ese conjunto.
    const r = datosDe(await guardar(e, emp, [e.mundo.sucursal]));

    expect(r.quitadas).toEqual([norte]);
    expect(await asignadas(e, emp)).toEqual([e.mundo.sucursal]);
  });

  it("I6 aislamiento: una sucursal de OTRA empresa o una persona de otra empresa es el genérico, sin escribir", async () => {
    const e = await nuevo();
    const otra = await nuevo();
    const ajena = await sucursal(otra, "Ajena");
    const emp = await sumar(e, "OPERADOR");
    const empAjeno = await sumar(otra, "OPERADOR");

    expect(await guardar(e, emp, [ajena])).toMatchObject(GENERICO);
    expect(await guardar(e, emp, [e.mundo.sucursal, ajena])).toMatchObject(GENERICO);
    expect(await filasDeAsignacion(e, emp)).toBe(0);

    expect(await guardar(e, empAjeno, [e.mundo.sucursal])).toMatchObject(GENERICO);
    expect(await editor(e, empAjeno)).toMatchObject(GENERICO);
    expect(await filasDeAsignacion(otra, empAjeno)).toBe(0);
    expect(await filasDeAsignacion(e, empAjeno)).toBe(0);
    expect(await auditorias(e, emp)).toBe(0);
    expect(await auditorias(otra, empAjeno)).toBe(0);
  });

  it("I7 permisos: un empleado, por fuera de la pantalla, no ve el editor ni guarda; quien no es de la empresa tampoco", async () => {
    const e = await nuevo();
    const emp = await sumar(e, "OPERADOR");
    const otro = await sumar(e, "OPERADOR");
    const comoEmpleado = {
      ...e,
      como: () => comoEmpresa(empresaId(e.mundo.empresa), personaId(emp)),
    };
    const extraño = await nuevo();

    expect(await editor(comoEmpleado, otro)).toMatchObject(SIN_PERMISO_O_GENERICO);
    expect(await guardar(e, otro, [e.mundo.sucursal], comoEmpleado)).toMatchObject(GENERICO);
    expect(await guardar(e, otro, [e.mundo.sucursal], extraño)).toMatchObject(GENERICO);
    expect(await filasDeAsignacion(e, otro)).toBe(0);
    expect(await auditorias(e, otro)).toBe(0);
  });

  it("I8 efecto real: el empleado con la sucursal A asignada ve solo A para elegir; al quitarla deja de verla", async () => {
    const e = await nuevo();
    const norte = await sucursal(e, "Norte");
    const emp = await sumar(e, "OPERADOR");
    const comoEmpleado = comoEmpresa(empresaId(e.mundo.empresa), personaId(emp));
    const elegibles = async () => {
      const r = await web.consultasDeEmpresas().sucursalesElegibles(comoEmpleado);
      if (!r.ok) throw new Error(`se esperaba ok: ${JSON.stringify(r.error)}`);
      return r.valor.map((s) => s.id).sort();
    };

    expect(await elegibles()).toEqual([]);
    datosDe(await guardar(e, emp, [norte]));
    expect(await elegibles()).toEqual([norte]);
    datosDe(await guardar(e, emp, [e.mundo.sucursal, norte]));
    expect(await elegibles()).toEqual(ordenadas(e.mundo.sucursal, norte));
    datosDe(await guardar(e, emp, [e.mundo.sucursal]));
    expect(await elegibles()).toEqual([e.mundo.sucursal]);
    datosDe(await guardar(e, emp, []));
    expect(await elegibles()).toEqual([]);
  });

  it("la lista blanca: la empresa, el rol u otros campos que mande el navegador se descartan, y una forma que no es un identificador no llega a la base", async () => {
    const e = await nuevo();
    const emp = await sumar(e, "OPERADOR");
    const otra = await nuevo();

    const intruso = await asignarSucursalesDeUsuario(d(), e.como(), {
      personaId: emp,
      sucursales: [e.mundo.sucursal],
      empresaId: otra.mundo.empresa,
      rol: "GERENTE",
    });

    expect(intruso.ok).toBe(true);
    expect(await asignadas(e, emp)).toEqual([e.mundo.sucursal]);
    expect(await asignadas(otra, emp)).toEqual([]);
    for (const malo of [
      { personaId: emp },
      { personaId: emp, sucursales: "todas" },
      { personaId: emp, sucursales: ["no-es-un-id"] },
      { personaId: "no-es-un-id", sucursales: [] },
      null,
    ]) {
      expect(await asignarSucursalesDeUsuario(d(), e.como(), malo)).toMatchObject(GENERICO);
    }
    expect(await asignadas(e, emp)).toEqual([e.mundo.sucursal]);
    expect(await auditorias(e, emp)).toBe(1);
  });

  /** Otro gerente de la misma empresa, para que las dos ediciones las hagan dos personas. */
  async function otraDelMismoRol(e: Escenario): Promise<Escenario> {
    const persona = (await crearPersonaDeBase(dueno)).id;
    await crearMembresiaDeBase(dueno, e.mundo.empresa, persona, "ADMINISTRADOR");
    return {
      mundo: e.mundo,
      persona,
      como: (ahora) => ({
        ...comoEmpresa(empresaId(e.mundo.empresa), personaId(persona)),
        ...(ahora === undefined ? {} : { ahora }),
      }),
    };
  }
});
