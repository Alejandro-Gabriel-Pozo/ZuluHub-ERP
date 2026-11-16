import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  montarClientes,
  nombreUnico,
  nuevoId,
  valorDe,
  type EscenarioDeClientes,
  type MontajeDeClientes,
} from "./clientes-apoyo";

/**
 * LB-6 (DEC-0725, respuesta del dueño del 16/11/2026): marcar a alguien como EMPLEADO lo hacen solo gerente y administrador. Contra la base real: el operador queda
 * sin permiso y no se escribe nada (ni rol ni auditoría), el gerente y el administrador pueden, lo que no toca EMPLEADO sigue como antes para el operador, repetir no
 * duplica, dos pedidos a la vez dejan un solo rol y la otra empresa no ve nada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("clientes: el rol EMPLEADO y quién lo marca", () => {
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

  const alta = (quien: EscenarioDeClientes["operador"], roles: string[]) =>
    c.casos.crearParte(quien, {
      idempotencia: nuevoId(),
      naturaleza: "HUMANA",
      nombre: nombreUnico("Persona"),
      apellido: "Del personal",
      roles,
    });
  const persona = async (roles: string[] = []) => valorDe(await alta(e.gerente, roles)).parteId;
  const rolesDe = async (parteId: string) =>
    (
      await c.filas("select rol, activo from parte_rol where parte_id = $1 order by rol", [parteId])
    ).map((r) => `${String(r["rol"])}:${String(r["activo"])}`);
  const auditorias = async () => (await c.auditoria(e.empresa, "PARTE_ROLES_CAMBIADOS")).length;
  const partes = async () =>
    Number(
      (
        await c.filas("select count(*)::int as n from parte where empresa_id = $1", [e.empresa])
      )[0]?.["n"],
    );

  describe("cambiarRolesDeParte", () => {
    it("el operador NO marca empleado: SIN_PERMISO y no cambia nada", async () => {
      const id = await persona(["CUSTOMER"]);
      const antes = await auditorias();
      expect(
        await c.casos.cambiarRolesDeParte(e.operador, {
          parteId: id,
          roles: ["CUSTOMER", "EMPLEADO"],
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await rolesDe(id)).toEqual(["CUSTOMER:true"]);
      expect(await auditorias()).toBe(antes);
    });

    it("el gerente y el administrador sí lo marcan, y queda auditado", async () => {
      for (const quien of [e.gerente, e.administrador]) {
        const id = await persona();
        const antes = await auditorias();
        expect(
          valorDe(await c.casos.cambiarRolesDeParte(quien, { parteId: id, roles: ["EMPLEADO"] })),
        ).toEqual({ agregados: ["EMPLEADO"], reactivados: [], quitados: [] });
        expect(await rolesDe(id)).toEqual(["EMPLEADO:true"]);
        expect(await auditorias()).toBe(antes + 1);
      }
    });

    it("el operador tampoco lo quita ni lo reactiva; el gerente sí", async () => {
      const id = await persona(["EMPLEADO"]);
      expect(await c.casos.cambiarRolesDeParte(e.operador, { parteId: id, roles: [] })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await rolesDe(id)).toEqual(["EMPLEADO:true"]);
      valorDe(await c.casos.cambiarRolesDeParte(e.gerente, { parteId: id, roles: [] }));
      expect(await rolesDe(id)).toEqual(["EMPLEADO:false"]);
      expect(
        await c.casos.cambiarRolesDeParte(e.operador, { parteId: id, roles: ["EMPLEADO"] }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await rolesDe(id)).toEqual(["EMPLEADO:false"]);
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.administrador, { parteId: id, roles: ["EMPLEADO"] }),
        ),
      ).toEqual({ agregados: [], reactivados: ["EMPLEADO"], quitados: [] });
    });

    it("lo que no toca EMPLEADO no pide el permiso extra: el operador cambia clientes y proveedores y no pierde el rol de una parte que ya es empleado", async () => {
      const id = await persona(["EMPLEADO"]);
      // El conjunto pedido conserva EMPLEADO: no cambia ese rol, así que alcanza `partes.cambiar_roles`.
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.operador, {
            parteId: id,
            roles: ["EMPLEADO", "CUSTOMER"],
          }),
        ),
      ).toEqual({ agregados: ["CUSTOMER"], reactivados: [], quitados: [] });
      expect(await rolesDe(id)).toEqual(["CUSTOMER:true", "EMPLEADO:true"]);
      // Repetir lo que ya está (también con EMPLEADO) no pide el extra, no escribe ni audita.
      const antes = await auditorias();
      expect(
        valorDe(
          await c.casos.cambiarRolesDeParte(e.operador, {
            parteId: id,
            roles: ["CUSTOMER", "EMPLEADO"],
          }),
        ),
      ).toEqual({ agregados: [], reactivados: [], quitados: [] });
      expect(await auditorias()).toBe(antes);
    });

    it("una misma persona puede ser empleado y además cliente y proveedor", async () => {
      const id = await persona();
      valorDe(
        await c.casos.cambiarRolesDeParte(e.gerente, {
          parteId: id,
          roles: ["CUSTOMER", "PROVEEDOR", "EMPLEADO"],
        }),
      );
      expect(await rolesDe(id)).toEqual(["CUSTOMER:true", "EMPLEADO:true", "PROVEEDOR:true"]);
    });

    it("dos pedidos iguales a la vez dejan un solo rol y una sola auditoría de más", async () => {
      const id = await persona();
      const antes = await auditorias();
      const resultados = await Promise.all([
        c.casos.cambiarRolesDeParte(e.gerente, { parteId: id, roles: ["EMPLEADO"] }),
        c.casos.cambiarRolesDeParte(e.administrador, { parteId: id, roles: ["EMPLEADO"] }),
      ]);
      expect(resultados.every((r) => r.ok)).toBe(true);
      expect(await rolesDe(id)).toEqual(["EMPLEADO:true"]);
      expect(await auditorias()).toBe(antes + 1);
    });

    it("la otra empresa no ve ni toca a la persona: PARTE_NO_ENCONTRADA", async () => {
      const otra = await c.escenario();
      const id = await persona(["EMPLEADO"]);
      expect(await c.casos.cambiarRolesDeParte(otra.gerente, { parteId: id, roles: [] })).toEqual({
        ok: false,
        error: "PARTE_NO_ENCONTRADA",
      });
      expect(await rolesDe(id)).toEqual(["EMPLEADO:true"]);
    });
  });

  describe("crearParte y el puerto para otros módulos", () => {
    it("el operador no da de alta con el rol EMPLEADO: SIN_PERMISO y no queda ninguna parte", async () => {
      const antes = await partes();
      expect(await alta(e.operador, ["EMPLEADO"])).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await alta(e.operador, ["CUSTOMER", "EMPLEADO"])).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await partes()).toBe(antes);
    });

    it("el operador sigue dando de alta clientes y proveedores; el gerente y el administrador dan de alta empleados", async () => {
      expect((await alta(e.operador, ["CUSTOMER", "PROVEEDOR"])).ok).toBe(true);
      for (const quien of [e.gerente, e.administrador]) {
        const creada = valorDe(await alta(quien, ["EMPLEADO"]));
        expect(await rolesDe(creada.parteId)).toEqual(["EMPLEADO:true"]);
      }
    });

    it("repetir el alta del empleado con la misma idempotencia deja una sola parte", async () => {
      const entrada = {
        idempotencia: nuevoId(),
        naturaleza: "HUMANA" as const,
        nombre: nombreUnico("Persona"),
        apellido: "Del personal",
        roles: ["EMPLEADO"],
      };
      const primera = valorDe(await c.casos.crearParte(e.gerente, entrada));
      const segunda = valorDe(await c.casos.crearParte(e.gerente, entrada));
      expect(segunda).toMatchObject({ parteId: primera.parteId, yaExistia: true });
    });

    it("crearEnTx (el puerto de compras y otros) exige lo mismo: el operador no puede, el gerente sí, y nada queda si se niega", async () => {
      const entrada = (roles: string[]) => ({
        idempotencia: nuevoId(),
        naturaleza: "HUMANA",
        nombre: nombreUnico("Persona"),
        apellido: "Del personal",
        roles,
      });
      const crear = (contexto: EscenarioDeClientes["operador"], roles: string[]) =>
        c.entorno.ejecutar({ contexto }, async (tx) =>
          c.registro.crearEnTx(tx, contexto, REGLAS_DE_EMPRESA, entrada(roles) as never),
        );
      const antes = await partes();
      expect(await crear(e.operador, ["EMPLEADO"])).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await partes()).toBe(antes);
      expect((await crear(e.operador, ["PROVEEDOR"])).ok).toBe(true);
      expect((await crear(e.gerente, ["EMPLEADO"])).ok).toBe(true);
    });
  });
});
