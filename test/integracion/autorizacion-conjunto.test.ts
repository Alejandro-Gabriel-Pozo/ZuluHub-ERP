import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, tablaDePermisos } from "../../src/capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA } from "../../src/capacidades/permisos/roles";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../src/primitivas/identificadores/marca";
import { ok } from "../../src/primitivas/resultado/resultado";
import { comoEmpresa, crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { crearMembresiaDeBase, crearPersonaDeBase, type RolDePrueba } from "./fixtures-identidad";

/**
 * H4b T3: el conjunto de acciones del actor sale de la BASE (la versión vigente de la plantilla de su rol), con el adaptador real
 * (`pedernal_app`, RLS) y dentro de la transacción en curso. Cubre: igual comportamiento que la matriz con las plantillas sembradas (I14),
 * el cambio de plantilla vale desde la operación siguiente (sin caché), el gerente no depende de la plantilla, y todo lo que falta o se
 * rompe cierra (fail closed) o falla, nunca otorga.
 */

const base = inject("baseDePruebas");

const CATALOGO = new Set(
  Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)),
);
const TABLA = tablaDePermisos(PERMISOS_DE_EMPRESA);
/** Lo que todo rol lleva sí o sí (piso `TODOS_LOS_ROLES`): la base rechaza una versión que no lo incluya. */
const PISO = [
  "gerencia.aceptar_traspaso",
  "gerencia.rechazar_traspaso",
  "gerencia.ver_traspaso",
  "permisos.ver_propios",
];

describe.skipIf(base === null)("autorización: el conjunto efectivo viene de la base", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 5);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const delActor = async (empresa: EmpresaId, persona: PersonaId | null) => {
    const contexto = comoEmpresa(empresa, persona);
    const r = await entorno.ejecutar({ contexto }, async (tx) =>
      ok(await tx.autorizacion.delActor(contexto)),
    );
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  };
  const miembro = async (empresa: EmpresaId, rol: RolDePrueba) => {
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, rol, true);
    return personaId(p.id);
  };
  const empresaNueva = async () => (await crearEmpresaActiva(entorno)).empresa;
  const siguienteNumero = async (clave: string): Promise<number> => {
    const { rows } = await dueno.query<{ n: number }>(
      "select coalesce(max(numero), 0) + 1 as n from version_de_plantilla where clave = $1",
      [clave],
    );
    return rows[0]?.n ?? 1;
  };
  const nuevaVersion = async (clave: "ADMINISTRADOR" | "OPERADOR", acciones: string[]) =>
    dueno.query(
      "insert into version_de_plantilla (clave, numero, acciones, autor) values ($1, $2, $3, 'prueba')",
      [clave, await siguienteNumero(clave), acciones],
    );

  it.each(ROLES_DE_EMPRESA)(
    "I14: con las plantillas sembradas, un %s tiene EXACTAMENTE las acciones de la matriz de siempre",
    async (rol) => {
      const empresa = await empresaNueva();
      const persona = await miembro(empresa, rol);
      const actor = await delActor(empresa, persona);
      expect([...(actor.acciones ?? [])].sort()).toEqual([...TABLA[rol]]);
      // Cada acción del catálogo, una por una: la tiene si y solo si la matriz se la daba.
      for (const accion of CATALOGO) {
        const enLaMatriz = (PERMISOS_DE_EMPRESA as Record<string, readonly string[]>)[accion];
        expect([accion, actor.acciones?.includes(accion)], `${rol} ${accion}`).toEqual([
          accion,
          enLaMatriz?.includes(rol) ?? false,
        ]);
      }
    },
  );

  it("el gerente tiene todo el catálogo, también si no hay ninguna plantilla (no depende de ellas)", async () => {
    const aparte = await crearBaseAparte(base!);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
    try {
      await cliente.connect();
      const e = await crearEmpresaActiva(entornoAparte);
      const p = await crearPersonaDeBase(cliente);
      await crearMembresiaDeBase(cliente, e.empresa, p.id, "GERENTE", true);
      await cliente.query("alter table version_de_plantilla disable trigger user");
      await cliente.query("delete from version_de_plantilla");
      const contexto = comoEmpresa(e.empresa, personaId(p.id));
      const r = await entornoAparte.ejecutar({ contexto }, async (tx) =>
        ok(await tx.autorizacion.delActor(contexto)),
      );
      if (!r.ok) throw new Error("falló la transacción");
      expect(new Set(r.valor.acciones)).toEqual(CATALOGO);
    } finally {
      await cliente.end();
      await entornoAparte.cerrar();
      await aparte.destruir();
    }
  });

  it("una plantilla SIN ninguna versión: ese rol queda sin acciones (nace cerrado) y el gerente no se entera", async () => {
    const aparte = await crearBaseAparte(base!);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
    try {
      await cliente.connect();
      const e = await crearEmpresaActiva(entornoAparte);
      const roles: RolDePrueba[] = ["GERENTE", "ADMINISTRADOR", "OPERADOR"];
      const personas = new Map<RolDePrueba, PersonaId>();
      for (const rol of roles) {
        const p = await crearPersonaDeBase(cliente);
        await crearMembresiaDeBase(cliente, e.empresa, p.id, rol, true);
        personas.set(rol, personaId(p.id));
      }
      await cliente.query("alter table version_de_plantilla disable trigger user");
      await cliente.query("delete from version_de_plantilla where clave = 'ADMINISTRADOR'");
      const de = async (rol: RolDePrueba) => {
        const contexto = comoEmpresa(e.empresa, personas.get(rol) ?? null);
        const r = await entornoAparte.ejecutar({ contexto }, async (tx) =>
          ok(await tx.autorizacion.delActor(contexto)),
        );
        if (!r.ok) throw new Error("falló la transacción");
        return r.valor;
      };
      const admin = await de("ADMINISTRADOR");
      expect(admin.rol).toBe("ADMINISTRADOR");
      expect(admin.acciones).toEqual([]);
      expect([...((await de("OPERADOR")).acciones ?? [])].sort()).toEqual([...TABLA.OPERADOR]);
      expect(new Set((await de("GERENTE")).acciones)).toEqual(CATALOGO);
    } finally {
      await cliente.end();
      await entornoAparte.cerrar();
      await aparte.destruir();
    }
  });

  it("vale la versión de MAYOR número, y un cambio rige desde la operación siguiente (sin caché)", async () => {
    const empresa = await empresaNueva();
    const operador = await miembro(empresa, "OPERADOR");
    const administrador = await miembro(empresa, "ADMINISTRADOR");
    const antes = await delActor(empresa, operador);
    expect(antes.acciones).toContain("comprobantes.emitir");

    await nuevaVersion("OPERADOR", [...PISO, "comprobantes.ver"]);
    expect((await delActor(empresa, operador)).acciones).toEqual(
      [...PISO, "comprobantes.ver"].sort(),
    );
    // La otra plantilla y el gerente no se mueven.
    expect([...((await delActor(empresa, administrador)).acciones ?? [])].sort()).toEqual([
      ...TABLA.ADMINISTRADOR,
    ]);

    // Una versión nueva con MÁS acciones vuelve a ampliar: no es «la última escrita» sino la de mayor número.
    await nuevaVersion("OPERADOR", [...PISO, "comprobantes.ver", "comprobantes.emitir"]);
    expect((await delActor(empresa, operador)).acciones).toEqual(
      [...PISO, "comprobantes.emitir", "comprobantes.ver"].sort(),
    );
  });

  it("una clave retirada del catálogo no otorga nada y no bloquea las demás (S10)", async () => {
    const empresa = await empresaNueva();
    const operador = await miembro(empresa, "OPERADOR");
    await nuevaVersion("OPERADOR", [...PISO, "comprobantes.ver", "modulo_que_ya_no_existe.hacer"]);
    expect((await delActor(empresa, operador)).acciones).toEqual(
      [...PISO, "comprobantes.ver"].sort(),
    );
  });

  it("sin rol (no es miembro, membresía apagada o sin persona): ninguna acción", async () => {
    const empresa = await empresaNueva();
    const ajena = personaId((await crearPersonaDeBase(dueno)).id);
    expect(await delActor(empresa, ajena)).toMatchObject({ rol: null, acciones: [] });
    expect(await delActor(empresa, null)).toMatchObject({ rol: null, acciones: [] });
  });

  it("una falla de la base al leer la plantilla se propaga: no se convierte en «sin permisos» ni en la matriz", async () => {
    const aparte = await crearBaseAparte(base!);
    const cliente = new pg.Client({ connectionString: aparte.base.dueno });
    const entornoAparte = crearEntornoDePrueba(aparte.base, 2);
    try {
      await cliente.connect();
      const e = await crearEmpresaActiva(entornoAparte);
      const p = await crearPersonaDeBase(cliente);
      await crearMembresiaDeBase(cliente, e.empresa, p.id, "OPERADOR", true);
      await cliente.query("alter table version_de_plantilla rename to version_de_plantilla_rota");
      const contexto = comoEmpresa(e.empresa, personaId(p.id));
      const r = await entornoAparte.ejecutar({ contexto }, async (tx) =>
        ok(await tx.autorizacion.delActor(contexto)),
      );
      // La operación termina en error (la transacción se deshace): nada se autoriza ni por la matriz ni por «vacío».
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toMatch(/version_de_plantilla/);
    } finally {
      await cliente.end();
      await entornoAparte.cerrar();
      await aparte.destruir();
    }
  });

  it("(f) ningún camino de producción devuelve un actor sin `acciones`: escritura y lectura, con rol, sin rol y sin persona", async () => {
    const empresa = await empresaNueva();
    const personas: (PersonaId | null)[] = [
      await miembro(empresa, "GERENTE"),
      await miembro(empresa, "ADMINISTRADOR"),
      await miembro(empresa, "OPERADOR"),
      personaId((await crearPersonaDeBase(dueno)).id),
      null,
    ];
    for (const persona of personas) {
      const contexto = comoEmpresa(empresa, persona);
      // `ejecutar` arma la transacción de ESCRITURA (adaptador sin memoria); `leer` la de LECTURA (el adaptador que memoriza).
      const escritura = await entorno.ejecutar({ contexto }, async (tx) =>
        ok(await tx.autorizacion.delActor(contexto)),
      );
      const lectura = await entorno.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx) => ok(await tx.autorizacion.delActor(contexto)),
      );
      if (!escritura.ok || !lectura.ok) throw new Error("falló la transacción");
      expect(Array.isArray(escritura.valor.acciones)).toBe(true);
      expect(Array.isArray(lectura.valor.acciones)).toBe(true);
      expect(lectura.valor).toEqual(escritura.valor);
    }
  });

  it("D8: la persona suspendida globalmente pierde TAMBIÉN las acciones", async () => {
    const empresa = await empresaNueva();
    const p = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, empresa, p.id, "GERENTE", true);
    expect((await delActor(empresa, personaId(p.id))).acciones?.length).toBeGreaterThan(0);
    await dueno.query("update persona set activo_global = false where id = $1", [p.id]);
    expect(await delActor(empresa, personaId(p.id))).toMatchObject({ rol: null, acciones: [] });
  });

  it("I8: dos operaciones simultáneas de la misma persona ven el mismo conjunto (lectura sin estado)", async () => {
    const empresa = await empresaNueva();
    const persona = await miembro(empresa, "OPERADOR");
    const [a, b] = await Promise.all([delActor(empresa, persona), delActor(empresa, persona)]);
    expect(a).toEqual(b);
  });
});
