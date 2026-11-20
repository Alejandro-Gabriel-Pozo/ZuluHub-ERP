import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  valorDe,
  RONDAS,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";

/**
 * `editarParteConRoles` contra la base real: editar los datos y los roles de una parte en UNA transacción (todo o nada). Concurrencia (dos ediciones a la vez: gana una y la otra
 * falla entera, sin tocar los roles), idempotencia (repetir lo aplicado no escribe ni audita), atomicidad (lo que se rechaza no deja nada a medias) y aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("clientes: editar datos y roles juntos", () => {
  let c: MontajeDeClientes;
  let e: EscenarioDeClientes;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarClientes(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const crear = async (extra: Record<string, unknown> = {}) =>
    valorDe(
      await c.casos.crearParte(e.operador, {
        idempotencia: nuevoId(),
        naturaleza: "JURIDICA",
        nombre: nombreUnico("Empresa"),
        roles: ["PROVEEDOR"],
        ...extra,
      }),
    ).parteId;
  const rolesDe = async (parteId: string) =>
    (
      await c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [parteId])
    ).map((r) => `${String(r["rol"])}:${String(r["activo"])}`);
  const versionDe = async (parteId: string) =>
    Number((await c.filas("select version from parte where id = $1", [parteId]))[0]?.["version"]);
  const nombreDe = async (parteId: string) =>
    String((await c.filas("select nombre from parte where id = $1", [parteId]))[0]?.["nombre"]);
  const auditadas = async () =>
    (await c.auditoria(e.empresa, "PARTE_EDITADA")).length +
    (await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).length;

  it("guarda los datos y los roles juntos, sube la versión y audita las dos cosas", async () => {
    const id = await crear();
    const nuevo = nombreUnico("Renombrada");
    const r = valorDe(
      await c.casos.editarParteConRoles(e.operador, {
        parteId: id,
        versionEsperada: 1,
        cambios: { nombre: nuevo },
        roles: ["CUSTOMER", "PROVEEDOR"],
      }),
    );
    expect(r.datos).toMatchObject({ version: 2, yaEstaba: false });
    expect(r.roles).toEqual({ agregados: ["CUSTOMER"], reactivados: [], quitados: [] });
    expect(await nombreDe(id)).toBe(nuevo);
    expect(await rolesDe(id)).toEqual(["CUSTOMER:true", "PROVEEDOR:true"]);
    expect((await c.auditoria(e.empresa, "PARTE_EDITADA")).some((a) => a.entidad_id === id)).toBe(
      true,
    );
    expect(
      (await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).some((a) => a.entidad_id === id),
    ).toBe(true);
  });

  it("I1: repetir editarParteConRoles ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
    const id = await crear();
    const pedido = {
      parteId: id,
      versionEsperada: 1,
      cambios: { nombre: nombreUnico("Una vez") },
      roles: ["CUSTOMER"],
    };
    valorDe(await c.casos.editarParteConRoles(e.operador, pedido));
    const versionTras = await versionDe(id);
    const antes = await auditadas();
    const otra = valorDe(await c.casos.editarParteConRoles(e.operador, pedido));
    expect(otra.datos).toMatchObject({ version: versionTras, yaEstaba: true });
    expect(otra.roles).toEqual({ agregados: [], reactivados: [], quitados: [] });
    expect(await versionDe(id)).toBe(versionTras);
    expect(await auditadas()).toBe(antes);
  });

  it("si lo que se rechaza son los datos (documento de otra parte), los roles no cambian", async () => {
    const cuit = cuitUnico();
    await crear({ documento: { tipo: "CUIT", numero: cuit } });
    const id = await crear();
    const antes = await auditadas();
    const r = await c.casos.editarParteConRoles(e.operador, {
      parteId: id,
      versionEsperada: 1,
      cambios: { documento: { tipo: "CUIT", numero: cuit } },
      roles: ["CUSTOMER"],
    });
    expect(r.ok === false && (r.error as { error: string }).error).toBe("DOCUMENTO_YA_REGISTRADO");
    expect(await rolesDe(id)).toEqual(["PROVEEDOR:true"]);
    expect(await versionDe(id)).toBe(1);
    expect(await auditadas()).toBe(antes);
  });

  it("si lo que se rechaza son los roles, los datos tampoco se guardan", async () => {
    const id = await crear();
    const original = await nombreDe(id);
    const antes = await auditadas();
    const r = await c.casos.editarParteConRoles(e.operador, {
      parteId: id,
      versionEsperada: 1,
      cambios: { nombre: nombreUnico("No debe quedar") },
      roles: ["NO_EXISTE"],
    });
    expect(r).toEqual({ ok: false, error: "ROL_DE_PARTE_INVALIDO" });
    expect(await nombreDe(id)).toBe(original);
    expect(await versionDe(id)).toBe(1);
    expect(await auditadas()).toBe(antes);
  });

  it("una versión vieja con datos distintos falla entera y no toca los roles", async () => {
    const id = await crear();
    valorDe(
      await c.casos.editarParteConRoles(e.operador, {
        parteId: id,
        versionEsperada: 1,
        cambios: { nombre: nombreUnico("Primera") },
        roles: ["PROVEEDOR"],
      }),
    );
    const r = await c.casos.editarParteConRoles(e.operador, {
      parteId: id,
      versionEsperada: 1,
      cambios: { nombre: nombreUnico("Segunda") },
      roles: ["CUSTOMER"],
    });
    expect(r).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    expect(await rolesDe(id)).toEqual(["PROVEEDOR:true"]);
  });

  it("C1: dos ediciones a la vez con la misma versión: gana una y la otra falla entera (no queda a medias)", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const id = await crear();
      const a = nombreUnico("Gana A");
      const b = nombreUnico("Gana B");
      c.armarBarrera(2);
      try {
        const [ra, rb] = await Promise.all([
          c.casos.editarParteConRoles(e.operador, {
            parteId: id,
            versionEsperada: 1,
            cambios: { nombre: a },
            roles: ["CUSTOMER"],
          }),
          c.casos.editarParteConRoles(e.operador, {
            parteId: id,
            versionEsperada: 1,
            cambios: { nombre: b },
            roles: ["CUSTOMER", "PROVEEDOR"],
          }),
        ]);
        const gano = [ra, rb].filter((r) => r.ok).length;
        const perdio = [ra, rb].filter(
          (r) =>
            !r.ok &&
            (codigoDe(r) === "VERSION_DESACTUALIZADA" || codigoDe(r) === "ConcurrenciaAgotada"),
        ).length;
        expect(gano).toBe(1);
        expect(perdio).toBe(1);
        // El estado final es el de UNA sola edición, entera.
        const nombre = await nombreDe(id);
        const roles = await rolesDe(id);
        if (nombre === a) expect(roles).toEqual(["CUSTOMER:true", "PROVEEDOR:false"]);
        else {
          expect(nombre).toBe(b);
          expect(roles).toEqual(["CUSTOMER:true", "PROVEEDOR:true"]);
        }
        expect(await versionDe(id)).toBe(2);
      } finally {
        c.soltarBarrera();
      }
    }
  });

  it("la misma edición repetida a la vez (doble clic) se aplica una sola vez", async () => {
    const id = await crear();
    const pedido = {
      parteId: id,
      versionEsperada: 1,
      cambios: { nombre: nombreUnico("Doble clic") },
      roles: ["CUSTOMER"],
    };
    c.armarBarrera(2);
    try {
      const [x, y] = await Promise.all([
        c.casos.editarParteConRoles(e.operador, pedido),
        c.casos.editarParteConRoles(e.operador, pedido),
      ]);
      expect(x.ok || y.ok).toBe(true);
    } finally {
      c.soltarBarrera();
    }
    expect(await versionDe(id)).toBe(2);
    expect(
      (await c.auditoria(e.empresa, "PARTE_EDITADA")).filter((a) => a.entidad_id === id),
    ).toHaveLength(1);
  });

  it("una parte que no existe sale PARTE_NO_ENCONTRADA y no escribe", async () => {
    const r = await c.casos.editarParteConRoles(e.operador, {
      parteId: nuevoId(),
      versionEsperada: 1,
      cambios: {},
      roles: [],
    });
    expect(r).toEqual({ ok: false, error: "PARTE_NO_ENCONTRADA" });
  });
});
